"""Tests of training and export, run by hand on a machine with the training environment and a GPU.

CI has neither, so every test here carries the `local_gpu` marker, which the default run
leaves out (`pytest.ini`). Run them with `python -m pytest ml/tests -m local_gpu` from the
project root, after `npm --prefix web run export-v2` has written the tickets.
"""

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.local_gpu

GENERATED = Path(__file__).resolve().parents[1] / "data" / "generated"
TRAIN_ROWS = 3000
SCORED_ROWS = 400
MIN_SAME_ANSWER = 0.9
CHANCE_LEVEL = 0.25


def read_rows(name, count):
    """Reads the first `count` rows of a generated file."""
    with open(GENERATED / name, encoding="utf-8") as handle:
        return [json.loads(line) for _, line in zip(range(count), handle)]


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    """One small trained model, its bundle and the tickets both are checked on."""
    from triage_v2.export_onnx import export
    from triage_v2.share_machine import share_the_machine
    from triage_v2.train_sentence import fit

    share_the_machine()
    # Every other row, so both training wordings are in: the file holds the
    # built-in tickets first and the extra ones after.
    rows = read_rows("v2_train.jsonl", 20000)[:: 20000 // TRAIN_ROWS]
    model = fit(rows)
    bundle = tmp_path_factory.mktemp("bundle")
    return {"model": model, "bundle": bundle, "exported": export(model, bundle), "desk": read_rows("v2_desk.jsonl", SCORED_ROWS)}


def test_training_learns_the_task_on_wording_it_never_saw(trained):
    from triage_v2.train_sentence import predict

    answers = predict(trained["model"], trained["desk"])
    right = sum(answer["category"] == row["category"] for answer, row in zip(answers, trained["desk"]))
    assert right / len(answers) > CHANCE_LEVEL


def test_the_bundle_answers_like_the_model_it_was_made_from(trained):
    # The bundle stores 8-bit weights, so a few close calls flip. Many flips
    # would mean the export wrote a different model than the one trained.
    from triage_v2.score_onnx import score
    from triage_v2.train_sentence import predict

    torch_answers = predict(trained["model"], trained["desk"])
    bundle_answers = score(trained["bundle"], trained["desk"], trained["exported"]["fingerprint"])
    for field in ("category", "priority"):
        same = sum(a[field] == b[field] for a, b in zip(torch_answers, bundle_answers))
        assert same / len(torch_answers) >= MIN_SAME_ANSWER, field


def test_a_long_ticket_is_cut_at_the_same_token_in_training_and_in_the_bundle(trained):
    # A ticket cut at a different place in the scorer than in training would be
    # a different ticket to the model.
    from triage_v2.score_onnx import load_tokenizer

    model = trained["model"]
    tokenizer = load_tokenizer(trained["bundle"])
    long_text = " ".join(row["maskedText"] for row in trained["desk"][:40])
    texts = [long_text] + [row["maskedText"] for row in trained["desk"][:50]]
    for text in texts:
        trained_ids = model.encoder.tokenize([text])["input_ids"][0].tolist()
        assert tokenizer.encode(text).ids == trained_ids
    assert len(tokenizer.encode(long_text).ids) == model.max_length
