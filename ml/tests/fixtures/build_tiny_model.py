"""Builds the tiny stand-in model the scorer tests run on.

Run by hand, once, from the project root, in an environment that has the `onnx` package
(the training environment does): `python ml/tests/fixtures/build_tiny_model.py`. The files
it writes are committed, so the tests themselves need only what `ml/requirements.txt` pins.

The model is a lookup table, not a language model: each word has a fixed two-number
vector, so a test can work out by hand what the scorer must answer.
"""

import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from triage_v2.score_onnx import BUNDLE_FILES, file_digest  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "tiny_model"
MAX_LENGTH = 6
VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "refund", "crash", "please", "now"]
# "refund" points along the first axis and "crash" along the second; every other
# word is the zero vector, so it never moves an answer. Padding is given a large
# vector on purpose: a scorer that let padding into a ticket's average would
# visibly change that ticket's answer.
EMBEDDINGS = np.zeros((len(VOCAB), 2), dtype=np.float32)
EMBEDDINGS[VOCAB.index("refund")] = [1.0, 0.0]
EMBEDDINGS[VOCAB.index("crash")] = [0.0, 1.0]
EMBEDDINGS[VOCAB.index("[PAD]")] = [0.0, 5.0]
HEADS = {
    "category": {"classes": ["Billing", "Technical Issue"], "weight": [[4.0, 0.0], [0.0, 4.0]], "bias": [0.0, 0.0]},
    "priority": {"classes": ["High", "Medium"], "weight": [[0.0, 4.0], [4.0, 0.0]], "bias": [0.0, 0.0]},
}


def build_graph():
    """Returns an ONNX model with a sentence model's inputs and one output of word vectors."""
    inputs = [
        helper.make_tensor_value_info(name, TensorProto.INT64, ["batch", "tokens"])
        for name in ("input_ids", "attention_mask", "token_type_ids")
    ]
    output = helper.make_tensor_value_info("last_hidden_state", TensorProto.FLOAT, ["batch", "tokens", 2])
    table = numpy_helper.from_array(EMBEDDINGS, name="table")
    node = helper.make_node("Gather", ["table", "input_ids"], ["last_hidden_state"], axis=0)
    graph = helper.make_graph([node], "tiny", inputs, [output], initializer=[table])
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


def build_tokenizer():
    """Returns the tokenizer file's content: lower-cased whole words, wrapped in [CLS] and [SEP]."""
    return {
        "version": "1.0",
        "truncation": None,
        "padding": None,
        "added_tokens": [
            {"id": index, "content": token, "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True}
            for index, token in enumerate(VOCAB[:4])
        ],
        "normalizer": {"type": "Lowercase"},
        "pre_tokenizer": {"type": "Whitespace"},
        "post_processor": {
            "type": "TemplateProcessing",
            "single": [
                {"SpecialToken": {"id": "[CLS]", "type_id": 0}},
                {"Sequence": {"id": "A", "type_id": 0}},
                {"SpecialToken": {"id": "[SEP]", "type_id": 0}},
            ],
            "pair": [
                {"SpecialToken": {"id": "[CLS]", "type_id": 0}},
                {"Sequence": {"id": "A", "type_id": 0}},
                {"SpecialToken": {"id": "[SEP]", "type_id": 0}},
                {"Sequence": {"id": "B", "type_id": 1}},
                {"SpecialToken": {"id": "[SEP]", "type_id": 1}},
            ],
            "special_tokens": {
                "[CLS]": {"id": "[CLS]", "ids": [2], "tokens": ["[CLS]"]},
                "[SEP]": {"id": "[SEP]", "ids": [3], "tokens": ["[SEP]"]},
            },
        },
        "decoder": None,
        "model": {"type": "WordLevel", "vocab": {token: index for index, token in enumerate(VOCAB)}, "unk_token": "[UNK]"},
    }


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "model_quantized.onnx").write_bytes(build_graph().SerializeToString())
    (OUT_DIR / "tokenizer.json").write_text(json.dumps(build_tokenizer(), indent=1) + "\n", encoding="utf-8", newline="\n")
    (OUT_DIR / "heads.json").write_text(json.dumps(HEADS, indent=1) + "\n", encoding="utf-8", newline="\n")
    manifest = {"max_length": MAX_LENGTH, "files": {name: file_digest(OUT_DIR / name) for name in BUNDLE_FILES}}
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT_DIR}")


if __name__ == "__main__":
    main()
