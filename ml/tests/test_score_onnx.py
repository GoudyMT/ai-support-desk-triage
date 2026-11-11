"""Tests of the scorer for a frozen model folder, on a tiny stand-in model."""

import json
import shutil
import sys
from pathlib import Path

import pytest

from triage_v2 import score_onnx
from triage_v2.score_onnx import bundle_fingerprint, score

TINY = Path(__file__).resolve().parent / "fixtures" / "tiny_model"
# In the stand-in model "refund" means Billing and Medium, "crash" means
# Technical Issue and High, and every other word means nothing.
ROWS = [
    {"id": "a", "maskedText": "refund please"},
    {"id": "b", "maskedText": "CRASH now"},
    {"id": "c", "maskedText": "refund refund crash"},
]


def test_answers_come_back_in_input_order_with_the_models_choice():
    answers = score(TINY, ROWS, bundle_fingerprint(TINY))
    assert [answer["id"] for answer in answers] == ["a", "b", "c"]
    assert [answer["category"] for answer in answers] == ["Billing", "Technical Issue", "Billing"]
    assert [answer["priority"] for answer in answers] == ["Medium", "High", "Medium"]


def test_every_answer_head_in_the_bundle_is_answered_not_only_category_and_priority():
    # A model may also answer "does a person need to see this ticket?". The
    # scorer must not drop an answer the bundle was trained to give.
    answers = score(TINY, ROWS, bundle_fingerprint(TINY))
    assert [answer["mustReview"] for answer in answers] == ["false", "true", "false"]
    assert set(answers[0]["mustReview_probs"]) == {"false", "true"}


def test_each_answer_carries_probabilities_that_sum_to_one_and_name_every_class():
    for answer in score(TINY, ROWS, bundle_fingerprint(TINY)):
        assert set(answer["category_probs"]) == {"Billing", "Technical Issue"}
        assert set(answer["priority_probs"]) == {"High", "Medium"}
        assert sum(answer["category_probs"].values()) == pytest.approx(1.0, abs=1e-6)
        assert answer["category_probs"][answer["category"]] == max(answer["category_probs"].values())


def test_a_ticket_scores_the_same_alone_as_beside_a_longer_one():
    # Tickets are padded to the longest in their batch. Padding that leaked
    # into the average would make an answer depend on its neighbours.
    together = score(TINY, ROWS, bundle_fingerprint(TINY))
    alone = [score(TINY, [row], bundle_fingerprint(TINY))[0] for row in ROWS]
    for one, other in zip(alone, together):
        assert one["category_probs"] == pytest.approx(other["category_probs"], abs=1e-6)
        assert one["priority_probs"] == pytest.approx(other["priority_probs"], abs=1e-6)


def test_a_long_ticket_is_cut_at_the_models_limit_not_refused():
    # The stand-in model reads 6 tokens: [CLS], four words, [SEP]. The crashes
    # after the fourth word are past the limit, so the answer is the refund's.
    long_text = "refund please please please " + "crash " * 40
    cut = score(TINY, [{"id": "long", "maskedText": long_text}], bundle_fingerprint(TINY))[0]
    short = score(TINY, [{"id": "short", "maskedText": "refund please please please"}], bundle_fingerprint(TINY))[0]
    assert cut["category"] == "Billing"
    assert cut["category_probs"] == pytest.approx(short["category_probs"], abs=1e-6)


@pytest.mark.parametrize("changed", ["model_quantized.onnx", "tokenizer.json", "heads.json", "manifest.json"])
def test_a_changed_file_is_refused_before_any_ticket_is_scored(tmp_path, changed):
    # Every published number is the frozen bundle's. One changed byte in the
    # model, its word list, its answer weights or its token limit makes it a
    # different model.
    recorded = bundle_fingerprint(TINY)
    copy = tmp_path / "model"
    shutil.copytree(TINY, copy)
    with open(copy / changed, "ab") as handle:
        handle.write(b" ")
    with pytest.raises(ValueError, match="E_MODEL_HASH"):
        score(copy, ROWS, recorded)


def test_a_wrong_recorded_fingerprint_is_refused():
    with pytest.raises(ValueError, match="E_MODEL_HASH"):
        score(TINY, ROWS, "0" * 64)


def test_windows_line_ends_in_the_text_files_do_not_change_the_fingerprint(tmp_path):
    # Git on Windows checks text files out with CRLF line ends; the bundle is
    # still the same model.
    copy = tmp_path / "model"
    shutil.copytree(TINY, copy)
    for name in ("tokenizer.json", "heads.json", "manifest.json"):
        path = copy / name
        path.write_bytes(path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert bundle_fingerprint(copy) == bundle_fingerprint(TINY)


def test_a_command_line_run_limits_itself_before_it_scores(tmp_path, monkeypatch):
    # The scorer's own thread count does not bind the tokenizer's thread pool;
    # only the process-wide limit does, so it must be set before any scoring.
    order = []
    rows = tmp_path / "rows.jsonl"
    rows.write_text("\n".join(json.dumps(row) for row in ROWS), encoding="utf-8")
    real_score = score_onnx.score
    monkeypatch.setattr(score_onnx, "limit_cpu", lambda: order.append("limit"))
    monkeypatch.setattr(score_onnx, "score", lambda *args: order.append("score") or real_score(*args))
    monkeypatch.setattr(sys, "argv", ["score_onnx", "--bundle", str(TINY), "--fingerprint", bundle_fingerprint(TINY), "--rows", str(rows), "--out", str(tmp_path / "out.json")])
    score_onnx.main()
    assert order == ["limit", "score"]


def test_a_command_line_run_writes_the_bundle_fingerprint_beside_its_answers(tmp_path, monkeypatch):
    # A report built from an answers file copies this value, so its counts
    # cannot be filed under a bundle that did not give them.
    rows = tmp_path / "rows.jsonl"
    rows.write_text("\n".join(json.dumps(row) for row in ROWS), encoding="utf-8")
    monkeypatch.setattr(score_onnx, "limit_cpu", lambda: None)
    monkeypatch.setattr(sys, "argv", ["score_onnx", "--bundle", str(TINY), "--fingerprint", bundle_fingerprint(TINY), "--rows", str(rows), "--out", str(tmp_path / "out.json")])
    score_onnx.main()
    written = json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))
    assert written["bundle_fingerprint"] == bundle_fingerprint(TINY)
    assert [answer["id"] for answer in written["answers"]] == ["a", "b", "c"]
