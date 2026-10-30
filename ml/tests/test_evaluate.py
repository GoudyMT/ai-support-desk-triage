"""Tests for fitting the pipeline and for counting k of n against v0, on toy tickets."""

import json
import math
from pathlib import Path

import pytest

from triage import evaluate
from triage.evaluate import (
    METRICS,
    build_report,
    fold_scores,
    handwritten_scores,
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


def make_row(row_id, text, category, priority, v0, must_review=False):
    v0_category, v0_priority, v0_review = v0
    return {
        "id": row_id,
        "text": text,
        "maskedText": text,
        "category": category,
        "priority": priority,
        "mustReview": must_review,
        "v0": {"category": v0_category, "priority": v0_priority, "mustReview": v0_review},
    }


def training_rows(categories=tuple(CLASS_WORDS)):
    # Ten tickets per class; the item number is shared across classes so it
    # carries no signal.
    return [
        make_row(f"train-{category}-{i}", f"{CLASS_WORDS[category]} item{i}", category,
                 CLASS_PRIORITY[category], (category, CLASS_PRIORITY[category], False))
        for category in categories
        for i in range(10)
    ]


def scored_rows(prefix, v0_perfect=False):
    # (text, category, priority, mustReview, v0 category, v0 priority, v0 review)
    # Known answers: the model gets category right on 5 of 6 (row 6 is labelled
    # against its words) and priority right on 4 of 6 (rows 3 and 6); v0 gets
    # category 4 of 6, priority 5 of 6, review flag 5 of 6.
    table = [
        ("invoice refund extra", "Billing", "High", False, "Billing", "High", False),
        ("refund invoice today", "Billing", "High", False, "Other", "Medium", False),
        ("password login extra", "Account Access", "High", False, "Account Access", "High", True),
        ("login password today", "Account Access", "Low", True, "Other", "Low", True),
        ("crash error extra", "Technical Issue", "Medium", False, "Technical Issue", "Medium", False),
        ("error crash today", "Billing", "Low", False, "Billing", "Low", False),
    ]
    rows = []
    for i, (text, category, priority, must_review, v0_cat, v0_pri, v0_rev) in enumerate(table):
        v0 = (category, priority, must_review) if v0_perfect else (v0_cat, v0_pri, v0_rev)
        rows.append(make_row(f"{prefix}-{i}", text, category, priority, v0, must_review))
    return rows


def count(k, n):
    return {"k": k, "n": n, "accuracy": k / n}


def test_pipeline_predicts_its_own_training_rows_and_a_new_ticket():
    rows = training_rows()
    assert len(rows) == 30
    pipeline = fit_pipeline([r["maskedText"] for r in rows], [r["category"] for r in rows])
    assert list(pipeline.predict([r["maskedText"] for r in rows])) == [r["category"] for r in rows]
    assert list(pipeline.predict(["crash error extra"])) == ["Technical Issue"]


def test_fold_scores_counts_k_of_n_for_the_model_and_for_v0():
    scores = fold_scores(2, training_rows(), scored_rows("heldout"))
    assert scores == {
        "fold": 2,
        "model_category": count(5, 6),
        "model_priority": count(4, 6),
        "v0_category": count(4, 6),
        "v0_priority": count(5, 6),
        "v0_review": count(5, 6),
    }


def test_fold_scores_refuses_a_fold_whose_heldout_text_is_in_training():
    leaked = scored_rows("heldout")
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


def test_handwritten_scores_use_the_model_fitted_on_all_wording():
    scores = handwritten_scores(training_rows(), scored_rows("hand"))
    assert scores == {
        "model_category": count(5, 6),
        "model_priority": count(4, 6),
        "v0_category": count(4, 6),
        "v0_priority": count(5, 6),
        "v0_review": count(5, 6),
    }


def toy_folds(rows=None):
    return [(rows if rows is not None else training_rows(), scored_rows(f"fold{k}")) for k in range(4)]


def test_report_has_every_number_the_owner_reads_and_names_the_rows_behind_each(tmp_path):
    messages = []
    report = build_report(toy_folds(), training_rows(), scored_rows("hand"), messages.append)
    assert set(report) == {
        "std_method", "folds", "summary", "handwritten",
        "beats_v0_every_fold", "beats_v0_handwritten", "isolation",
    }
    assert [f["fold"] for f in report["folds"]] == [0, 1, 2, 3]
    assert report["folds"][3]["model_category"] == count(5, 6)
    assert set(report["summary"]) == set(METRICS)
    assert report["handwritten"]["v0_review"] == count(5, 6)
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
    # Q5 asks for a strict win: v0 right on all 6 beats the model's 5 of 6.
    folds = toy_folds()
    folds[1] = (training_rows(), scored_rows("fold1", v0_perfect=True))
    report = build_report(folds, training_rows(), scored_rows("hand"))
    assert report["beats_v0_every_fold"] is False
    assert report["beats_v0_handwritten"] is True

    report = build_report(toy_folds(), training_rows(), scored_rows("hand", v0_perfect=True))
    assert report["beats_v0_every_fold"] is True
    assert report["beats_v0_handwritten"] is False


def test_beats_v0_is_false_on_a_tie():
    # v0 right on row 2 as well makes it 5 of 6, level with the model.
    tied = scored_rows("hand")
    tied[1]["v0"]["category"] = "Billing"
    report = build_report(toy_folds(), training_rows(), tied)
    assert report["handwritten"]["v0_category"]["k"] == report["handwritten"]["model_category"]["k"] == 5
    assert report["beats_v0_handwritten"] is False
    folds = [(training_rows(), tied)] * 4
    assert build_report(folds, training_rows(), scored_rows("hand"))["beats_v0_every_fold"] is False


def test_the_command_reads_each_fold_file_and_writes_the_report(tmp_path, monkeypatch, capsys):
    # The command is what the owner runs; this proves its wiring (which file is
    # which row set) without touching the real data or the committed report.
    report_path = tmp_path / "eval.json"

    def fake_load_rows(path):
        name = Path(path).name
        if name.startswith("heldout_"):
            return scored_rows(name)
        if name == "handwritten.jsonl":
            return scored_rows("hand")
        return training_rows()

    monkeypatch.setattr(evaluate, "load_rows", fake_load_rows)
    monkeypatch.setattr(evaluate, "REPORT_PATH", report_path)
    evaluate.main()

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert [f["model_category"]["n"] for f in report["folds"]] == [6, 6, 6, 6]
    assert report["handwritten"]["model_category"] == count(5, 6)
    assert "[4/4]" in capsys.readouterr().out


def test_each_row_set_is_scored_by_the_model_trained_for_it():
    # The fold models never saw Technical Issue wording, so they miss those
    # held-out rows; the shipped model, fitted on all wording, gets the
    # hand-written ones. Swapping the two models would flip both counts.
    fold_train = training_rows(("Billing", "Account Access"))
    heldout = [r for r in scored_rows("fold") if r["category"] == "Technical Issue"]
    hand = [r for r in scored_rows("hand") if r["category"] == "Technical Issue"]
    report = build_report([(fold_train, heldout)] * 4, training_rows(), hand)
    assert [f["model_category"]["k"] for f in report["folds"]] == [0, 0, 0, 0]
    assert report["handwritten"]["model_category"] == count(1, 1)
