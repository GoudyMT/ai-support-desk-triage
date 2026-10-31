"""Tests for fitting the pipeline and for counting k of n against v0, on toy tickets."""

import json
import math
import re
from pathlib import Path

import pytest

from triage import evaluate
from triage.evaluate import (
    METRICS,
    build_report,
    fold_scores,
    handwritten_scores,
    rows_fingerprint,
    summarize_folds,
    write_report,
)
from triage.train import fit_pipeline

CLASS_WORDS = {
    "Billing": "invoice refund",
    "Account Access": "password login",
    "Technical Issue": "crash error",
}
CLASS_PRIORITY = {"Billing": "High", "Account Access": "Low", "Technical Issue": "Medium"}
# Wording no training row has, in a class no training row has: a model that
# trained on the scored rows would get these right, one that did not cannot.
HELDOUT_NOVEL = ("quota limit", "Product Question")
HANDWRITTEN_NOVEL = ("parcel courier", "Shipping/Order Issue")
PLACEHOLDER = "[EMAIL_ADDRESS]"


def hidden_words(category):
    # What the raw text carries inside the address that the masker replaces: the
    # words of a different class, three times over, so a model that reads the raw
    # text is pulled to the wrong class.
    order = list(CLASS_WORDS)
    other = order[(order.index(category) + 1) % len(order)] if category in order else order[0]
    return ".".join(CLASS_WORDS[other].split() * 3)


def make_row(row_id, masked_text, category, priority, v0, must_review=False):
    v0_category, v0_priority, v0_review = v0
    return {
        "id": row_id,
        "fold": None,
        "text": masked_text.replace(PLACEHOLDER, hidden_words(category) + "@example.test"),
        "maskedText": masked_text,
        "category": category,
        "priority": priority,
        "mustReview": must_review,
        "v0": {"category": v0_category, "priority": v0_priority, "mustReview": v0_review},
    }


def training_rows(categories=tuple(CLASS_WORDS)):
    # Ten tickets per class; the item number is shared across classes so it
    # carries no signal.
    return [
        make_row(f"train-{category}-{i}", f"{CLASS_WORDS[category]} item{i} {PLACEHOLDER}", category,
                 CLASS_PRIORITY[category], (category, CLASS_PRIORITY[category], False))
        for category in categories
        for i in range(10)
    ]


def scored_rows(prefix, novel, v0_perfect=False):
    # Eight tickets: (masked text, category, priority, mustReview,
    #                 v0 category, v0 priority, v0 review).
    # Rows 7 and 8 are the novel wording, so no model trained on the training
    # rows can get them right. Known counts of 8:
    #   model category 5 (row 6 is labelled against its words, 7 and 8 are novel)
    #   model priority 4 (rows 3, 6, 7, 8 wrong)
    #   v0 category 3, v0 priority 6, v0 review 7
    # Every count is different, so a metric read from the wrong field changes one.
    novel_words, novel_category = novel
    table = [
        ("invoice refund extra", "Billing", "High", False, "Billing", "High", False),
        ("refund invoice today", "Billing", "High", False, "Other", "Medium", False),
        ("password login extra", "Account Access", "High", False, "Other", "High", True),
        ("login password today", "Account Access", "Low", True, "Other", "Low", True),
        ("crash error extra", "Technical Issue", "Medium", False, "Technical Issue", "Medium", False),
        ("error crash today", "Billing", "Low", False, "Billing", "Low", False),
        (f"{novel_words} plan", novel_category, "Urgent", False, "Other", "Urgent", False),
        (f"{' '.join(reversed(novel_words.split()))} plan", novel_category, "Urgent", False,
         "Other", "High", False),
    ]
    rows = []
    for i, (text, category, priority, must_review, v0_cat, v0_pri, v0_rev) in enumerate(table):
        v0 = (category, priority, must_review) if v0_perfect else (v0_cat, v0_pri, v0_rev)
        rows.append(make_row(f"{prefix}-{i}", f"{text} {PLACEHOLDER}", category, priority, v0, must_review))
    return rows


def heldout_rows(prefix="heldout", v0_perfect=False):
    return scored_rows(prefix, HELDOUT_NOVEL, v0_perfect)


def handwritten_rows(v0_perfect=False):
    rows = scored_rows("hand", HANDWRITTEN_NOVEL, v0_perfect)
    # The hand-written file has no fold key at all, unlike the exported files.
    for row in rows:
        del row["fold"]
    return rows


def count(k, n):
    return {"k": k, "n": n, "accuracy": k / n}


EXPECTED_COUNTS = {
    "model_category": count(5, 8),
    "model_priority": count(4, 8),
    "v0_category": count(3, 8),
    "v0_priority": count(6, 8),
    "v0_review": count(7, 8),
}


def test_pipeline_predicts_its_own_training_rows_and_a_new_ticket():
    rows = training_rows()
    assert len(rows) == 30
    pipeline = fit_pipeline([r["maskedText"] for r in rows], [r["category"] for r in rows])
    assert list(pipeline.predict([r["maskedText"] for r in rows])) == [r["category"] for r in rows]
    assert list(pipeline.predict(["crash error extra"])) == ["Technical Issue"]


def test_fold_scores_counts_k_of_n_from_masked_text_on_rows_the_model_did_not_train_on():
    # Raw text points at the wrong classes (see hidden_words), the novel rows
    # carry wording only the held-out rows have: reading raw text, or fitting on
    # the held-out rows, changes a count.
    assert fold_scores(2, training_rows(), heldout_rows()) == {"fold": 2, **EXPECTED_COUNTS}


def test_fold_scores_refuses_a_fold_whose_heldout_text_is_in_training():
    leaked = heldout_rows()
    leaked[0]["maskedText"] = training_rows()[0]["maskedText"].upper()
    with pytest.raises(ValueError, match="E_HELDOUT_IN_TRAIN"):
        fold_scores(0, training_rows(), leaked)


def test_summary_is_mean_and_population_standard_deviation_over_folds():
    accuracies = [0.5, 0.6, 0.7, 0.8]
    folds = [{"fold": i, **{m: {"k": 0, "n": 1, "accuracy": a} for m in METRICS}}
             for i, a in enumerate(accuracies)]
    summary = summarize_folds(folds)
    assert set(summary) == set(METRICS)
    assert summary["model_category"]["mean"] == pytest.approx(0.65)
    assert summary["model_category"]["std"] == pytest.approx(math.sqrt(0.0125))


def test_handwritten_scores_come_from_a_model_that_never_saw_the_handwritten_rows():
    # The two novel hand-written rows are misses: a model fitted on them as well
    # as on train_all would keep their shared words and get them right.
    assert handwritten_scores(training_rows(), handwritten_rows()) == EXPECTED_COUNTS


def test_handwritten_scores_refuse_a_handwritten_text_that_is_in_train_all():
    # The hand-written set is the one test set no model may ever train on.
    leaked = handwritten_rows()
    leaked[0]["maskedText"] = training_rows()[0]["maskedText"].lower()
    with pytest.raises(ValueError, match="E_HELDOUT_IN_TRAIN"):
        handwritten_scores(training_rows(), leaked)


def toy_folds():
    return [(training_rows(), heldout_rows(f"fold{k}")) for k in range(4)]


def test_report_has_every_number_the_owner_reads_and_names_the_rows_behind_each(tmp_path):
    messages = []
    report = build_report(toy_folds(), training_rows(), handwritten_rows(), messages.append)
    assert set(report) == {
        "std_method", "folds", "summary", "handwritten",
        "beats_v0_every_fold", "beats_v0_handwritten", "isolation",
    }
    assert [f["fold"] for f in report["folds"]] == [0, 1, 2, 3]
    assert report["folds"][3]["model_category"] == count(5, 8)
    assert set(report["summary"]) == set(METRICS)
    assert report["handwritten"]["v0_review"] == count(7, 8)
    assert report["beats_v0_every_fold"] is True
    assert report["beats_v0_handwritten"] is True
    for metric in METRICS:
        assert metric in report["isolation"]["folds"]
        assert metric in report["isolation"]["handwritten"]
    assert report["isolation"]["folds"]["model_category"] == {
        "model": "fold_k", "trained_on": "train_k", "scored_on": "heldout_k"}
    assert report["isolation"]["handwritten"]["model_category"] == {
        "model": "shipped", "trained_on": "train_all", "scored_on": "handwritten"}
    assert report["isolation"]["handwritten"]["v0_category"]["model"] == "v0"
    assert messages

    path = tmp_path / "reports" / "eval.json"
    write_report(report, path)
    text = path.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert json.loads(text) == report


def test_beats_v0_is_false_when_v0_is_as_good_as_the_model_on_a_fold():
    # Q5 asks for a strict win: v0 right on all 8 beats the model's 5 of 8.
    folds = toy_folds()
    folds[1] = (training_rows(), heldout_rows("fold1", v0_perfect=True))
    report = build_report(folds, training_rows(), handwritten_rows())
    assert report["beats_v0_every_fold"] is False
    assert report["beats_v0_handwritten"] is True

    report = build_report(toy_folds(), training_rows(), handwritten_rows(v0_perfect=True))
    assert report["beats_v0_every_fold"] is True
    assert report["beats_v0_handwritten"] is False


def test_beats_v0_is_false_on_a_tie():
    # Two more right answers for v0 make it 5 of 8, level with the model.
    tied = handwritten_rows()
    to_fix = 2
    for r in tied:
        if to_fix and r["v0"]["category"] != r["category"]:
            r["v0"]["category"] = r["category"]
            to_fix -= 1
    report = build_report(toy_folds(), training_rows(), tied)
    assert report["handwritten"]["v0_category"]["k"] == report["handwritten"]["model_category"]["k"] == 5
    assert report["beats_v0_handwritten"] is False
    folds = [(training_rows(), tied)] * 4
    assert build_report(folds, training_rows(), handwritten_rows())["beats_v0_every_fold"] is False


def test_the_command_reads_each_fold_file_and_writes_the_report(tmp_path, monkeypatch, capsys):
    # The command is what the owner runs; this proves its wiring (which file is
    # which row set) and its output format without touching the real data or
    # the committed report.
    report_path = tmp_path / "eval.json"

    def fake_load_rows(path):
        name = Path(path).name
        if name.startswith("heldout_"):
            return heldout_rows(name)
        if name == "handwritten.jsonl":
            return handwritten_rows()
        return training_rows() * 40

    monkeypatch.setattr(evaluate, "load_rows", fake_load_rows)
    monkeypatch.setattr(evaluate, "REPORT_PATH", report_path)
    evaluate.main()

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert [f["model_category"]["n"] for f in report["folds"]] == [8, 8, 8, 8]
    assert report["handwritten"]["model_category"] == count(5, 8)

    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == "=" * 60
    assert lines[1] == lines[1].upper() and lines[1].strip()
    assert any(line.startswith("[4/4]") for line in lines)
    details = [line for line in lines if line.startswith(" ")]
    assert details and all(re.match(r" {4}\S", line) for line in details)
    assert any("train 1,200" in line for line in details)


def test_report_fingerprints_each_scored_row_set_and_the_rows_its_model_trained_on():
    # A later change to a test set (fold assignment, row order) must show in
    # eval.json even when every count happens to stay the same.
    folds = toy_folds()
    train_all = training_rows() * 2
    report = build_report(folds, train_all, handwritten_rows())
    for entry, (train_rows, heldout) in zip(report["folds"], folds):
        assert entry["rows_sha256"] == rows_fingerprint(heldout)
        assert entry["train_rows_sha256"] == rows_fingerprint(train_rows)
    assert len({entry["rows_sha256"] for entry in report["folds"]}) == 4
    assert report["handwritten"]["rows_sha256"] == rows_fingerprint(handwritten_rows())
    assert report["handwritten"]["train_rows_sha256"] == rows_fingerprint(train_all)
    assert re.fullmatch(r"[0-9a-f]{64}", report["handwritten"]["rows_sha256"])
    assert report["handwritten"]["rows_sha256"] != report["handwritten"]["train_rows_sha256"]


def moved(rows, index, field, value):
    changed = [dict(row) for row in rows]
    changed[index][field] = value
    return changed


@pytest.mark.parametrize("change", [
    pytest.param(lambda rows: list(reversed(rows)), id="order"),
    pytest.param(lambda rows: moved(rows, 3, "id", "other-id"), id="id"),
    pytest.param(lambda rows: moved(rows, 3, "fold", 2), id="fold"),
    pytest.param(lambda rows: moved(rows, 3, "maskedText", "other words"), id="masked-text"),
    pytest.param(lambda rows: moved(rows, 3, "category", "Other"), id="category"),
    pytest.param(lambda rows: moved(rows, 3, "priority", "Urgent"), id="priority"),
    pytest.param(lambda rows: rows[:-1], id="a-row-dropped"),
])
def test_the_fingerprint_changes_when_any_scored_field_or_the_row_order_changes(change):
    rows = handwritten_rows()
    assert rows_fingerprint(change(rows)) != rows_fingerprint(rows)


def test_the_report_is_written_with_unix_line_endings(tmp_path):
    # CI re-derives the report on Linux and compares it with the one committed from
    # Windows; the committed bytes must not depend on the platform that wrote them.
    path = tmp_path / "eval.json"
    write_report({"folds": [1, 2], "std_method": "population"}, path)
    assert b"\r" not in path.read_bytes()


def test_the_command_writes_to_the_path_after_out_and_leaves_the_committed_report_alone(tmp_path, monkeypatch):
    # CI re-derives the report into a temp file so it can be compared with the
    # committed one; writing over the committed file would make that check vacuous.
    committed_path = tmp_path / "committed.json"
    out_path = tmp_path / "elsewhere" / "fresh.json"

    def fake_load_rows(path):
        name = Path(path).name
        if name.startswith("heldout_"):
            return heldout_rows(name)
        if name == "handwritten.jsonl":
            return handwritten_rows()
        return training_rows()

    monkeypatch.setattr(evaluate, "load_rows", fake_load_rows)
    monkeypatch.setattr(evaluate, "REPORT_PATH", committed_path)
    evaluate.main(["--out", str(out_path)])
    assert not committed_path.exists()
    assert out_path.is_file()
    assert json.loads(out_path.read_text(encoding="utf-8"))["handwritten"]["model_category"] == count(5, 8)


def test_each_row_set_is_scored_by_the_model_trained_for_it():
    # The fold models never saw Technical Issue wording, so they miss those
    # held-out rows; the shipped model, fitted on all wording, gets the
    # hand-written ones. Swapping the two models would flip both counts.
    fold_train = training_rows(("Billing", "Account Access"))
    heldout = [r for r in heldout_rows() if r["category"] == "Technical Issue"]
    hand = [r for r in handwritten_rows() if r["category"] == "Technical Issue"]
    report = build_report([(fold_train, heldout)] * 4, training_rows(), hand)
    assert [f["model_category"]["k"] for f in report["folds"]] == [0, 0, 0, 0]
    assert report["handwritten"]["model_category"] == count(1, 1)
