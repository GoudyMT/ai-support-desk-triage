"""Training the sentence model on tickets: the model itself and one answer head per field.

Needs the training environment (`ml/requirements-train.txt`) and a GPU. Nothing here is
imported by the scorer or by CI.
"""

import time
from dataclasses import dataclass

import numpy as np
import torch
from sentence_transformers import SentenceTransformer

RANDOM_STATE = 113
BASE_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
FIELDS = ("category", "priority")
# A third answer a model may be trained to give: whether a person must see the ticket.
REVIEW_FIELD = "mustReview"
EPOCHS = 2
LEARNING_RATE = 2e-5
BATCH_SIZE = 64
MAX_LENGTH = 256
PREDICT_BATCH_SIZE = 512


@dataclass
class TrainedModel:
    """A trained sentence model with its answer heads and the classes each head chooses from."""

    encoder: SentenceTransformer
    heads: torch.nn.ModuleDict
    classes: dict
    max_length: int


def _embed(encoder, texts, device):
    """Returns the encoder's unit-length sentence vectors for the texts, with gradients."""
    features = {key: (value.to(device) if hasattr(value, "to") else value) for key, value in encoder.tokenize(texts).items()}
    return encoder(features)["sentence_embedding"]


def label_of(row, field):
    """Returns a row's label for a field as text; a yes/no field becomes "true" or "false"."""
    value = row[field]
    return str(value).lower() if isinstance(value, bool) else value


def fit(rows, epochs=EPOCHS, learning_rate=LEARNING_RATE, batch_size=BATCH_SIZE, max_length=MAX_LENGTH, device="cuda", rest_ratio=0.0, fields=FIELDS):
    """
    Trains the sentence model and both heads on the rows.

    The whole model is trained, not only the heads: on practice data a model whose
    sentence vectors were left as they came was right far less often.

    Args:
        rows: Tickets with `maskedText`, `category` and `priority`.
        epochs: Passes over the rows.
        learning_rate: Step size for AdamW.
        batch_size: Tickets per step.
        max_length: Tokens kept per ticket; longer tickets are cut.
        device: Where to train.
        rest_ratio: How long to leave the GPU idle after each step, as a share of
            the step's own time: 1.0 keeps the GPU busy about half the time, so
            other programs that use it keep running. It changes the time a run
            takes and nothing about the model it produces.
        fields: The answers to train a head for; each names a key of the rows.

    Returns:
        The trained model, in evaluation mode.
    """
    torch.manual_seed(RANDOM_STATE)
    np.random.seed(RANDOM_STATE)
    encoder = SentenceTransformer(BASE_MODEL, device=device)
    encoder.max_seq_length = max_length
    classes = {field: sorted({label_of(row, field) for row in rows}) for field in fields}
    width = encoder.get_sentence_embedding_dimension()
    heads = torch.nn.ModuleDict({field: torch.nn.Linear(width, len(classes[field])) for field in fields}).to(device)
    optimizer = torch.optim.AdamW(list(encoder.parameters()) + list(heads.parameters()), lr=learning_rate)
    targets = {field: torch.tensor([classes[field].index(label_of(row, field)) for row in rows]) for field in fields}
    texts = [row["maskedText"] for row in rows]
    order_rng = np.random.default_rng(RANDOM_STATE)

    encoder.train()
    for _ in range(epochs):
        order = order_rng.permutation(len(texts))
        for start in range(0, len(order), batch_size):
            step_started = time.perf_counter()
            index = order[start:start + batch_size]
            vectors = _embed(encoder, [texts[i] for i in index], device)
            loss = sum(torch.nn.functional.cross_entropy(heads[field](vectors), targets[field][index].to(device)) for field in fields)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            if rest_ratio > 0:
                # The step's work is only finished once the GPU says so; without
                # the wait the rest would be timed from a step still running.
                torch.cuda.synchronize()
                time.sleep((time.perf_counter() - step_started) * rest_ratio)
    encoder.eval()
    heads.eval()
    return TrainedModel(encoder=encoder, heads=heads, classes=classes, max_length=max_length)


def predict(model, rows, device="cuda"):
    """
    Answers tickets with the trained model as PyTorch runs it.

    Args:
        model: A TrainedModel.
        rows: Tickets with `id` and `maskedText`.
        device: Where to run.

    Returns:
        One dict per row, in order, with `id` and the chosen class of every head.
    """
    answers = [{"id": row["id"]} for row in rows]
    texts = [row["maskedText"] for row in rows]
    with torch.no_grad():
        for start in range(0, len(texts), PREDICT_BATCH_SIZE):
            vectors = _embed(model.encoder, texts[start:start + PREDICT_BATCH_SIZE], device)
            for field in model.heads:
                chosen = model.heads[field](vectors).argmax(dim=1).tolist()
                for answer, choice in zip(answers[start:start + PREDICT_BATCH_SIZE], chosen):
                    answer[field] = model.classes[field][choice]
    return answers
