"""Scoring tickets with a frozen model folder, and refusing a folder that is not the frozen one.

A model folder (a "bundle") holds four files: `model_quantized.onnx` (the sentence model),
`tokenizer.json` (how text becomes token numbers), `heads.json` (the weights that turn a
sentence vector into a category and a priority) and `manifest.json` (the token limit).
"""

import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

BUNDLE_FILES = ("model_quantized.onnx", "tokenizer.json", "heads.json")
HASH_ERROR = "E_MODEL_HASH"
FIELDS = ("category", "priority")
BATCH_SIZE = 64
# A ticket with no known word has a zero vector; dividing by this instead of by
# zero leaves it a zero vector, so its answer comes from the bias alone.
MIN_NORM = 1e-12


def file_digest(path):
    """
    Returns the SHA-256 of a bundle file as the repo stores it.

    Git on Windows checks a text file out with CRLF line ends. The JSON files are
    hashed in their LF form so one bundle has one fingerprint on every machine.

    Args:
        path: The file to hash.

    Returns:
        The hex digest.
    """
    data = Path(path).read_bytes()
    if Path(path).suffix == ".json":
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def bundle_fingerprint(model_dir):
    """
    Returns one fingerprint for the three files that decide a model's answers.

    Args:
        model_dir: The model folder.

    Returns:
        The SHA-256, in hex, of the three files' digests joined in a fixed order.
    """
    digests = [file_digest(Path(model_dir) / name) for name in BUNDLE_FILES]
    return hashlib.sha256("\n".join(digests).encode("ascii")).hexdigest()


def _softmax(scores):
    """Turns each row of scores into probabilities."""
    shifted = scores - scores.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def _embed(session, tokenizer, texts):
    """Returns one unit-length sentence vector per text: the mean of its real tokens' vectors."""
    wanted = {item.name for item in session.get_inputs()}
    vectors = []
    for start in range(0, len(texts), BATCH_SIZE):
        encoded = tokenizer.encode_batch(texts[start:start + BATCH_SIZE])
        feeds = {
            "input_ids": np.array([item.ids for item in encoded], dtype=np.int64),
            "attention_mask": np.array([item.attention_mask for item in encoded], dtype=np.int64),
            "token_type_ids": np.array([item.type_ids for item in encoded], dtype=np.int64),
        }
        hidden = session.run(None, {name: value for name, value in feeds.items() if name in wanted})[0]
        mask = feeds["attention_mask"][..., None].astype(np.float32)
        pooled = (hidden * mask).sum(axis=1) / mask.sum(axis=1)
        vectors.append(pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), MIN_NORM))
    return np.concatenate(vectors) if vectors else np.zeros((0, 0), dtype=np.float32)


def score(model_dir, rows, expected_sha256):
    """
    Scores tickets with a model folder after proving it is the recorded one.

    Args:
        model_dir: The model folder.
        rows: Tickets, each with `id` and `maskedText`.
        expected_sha256: The recorded bundle fingerprint.

    Returns:
        One answer per row, in order: `id`, `category`, `priority`, and under
        `category_probs` and `priority_probs` a probability for every class.

    Raises:
        ValueError: The folder's fingerprint is not the recorded one (E_MODEL_HASH).
    """
    model_dir = Path(model_dir)
    if bundle_fingerprint(model_dir) != expected_sha256:
        raise ValueError(HASH_ERROR)
    manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
    heads = json.loads((model_dir / "heads.json").read_text(encoding="utf-8"))
    tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=manifest["max_length"])
    tokenizer.enable_padding()
    session = ort.InferenceSession(str(model_dir / "model_quantized.onnx"), providers=["CPUExecutionProvider"])
    vectors = _embed(session, tokenizer, [row["maskedText"] for row in rows])

    answers = [{"id": row["id"]} for row in rows]
    for field in FIELDS:
        head = heads[field]
        weight = np.array(head["weight"], dtype=np.float32)
        probs = _softmax(vectors @ weight.T + np.array(head["bias"], dtype=np.float32)) if rows else []
        for answer, row_probs in zip(answers, probs):
            answer[field] = head["classes"][int(row_probs.argmax())]
            answer[f"{field}_probs"] = {name: float(value) for name, value in zip(head["classes"], row_probs)}
    return answers
