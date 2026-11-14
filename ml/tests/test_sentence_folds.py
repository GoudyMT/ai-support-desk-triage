"""Tests for the sentence model's fold-by-fold measurement, the parts that run without a GPU."""

import json
from pathlib import Path

import pytest

from triage_v2.ninety_day import REPO_DIR, WORK_IN_REPO
from triage_v2.sentence_folds import FOLDS_ERROR, SETTINGS, SETTINGS_ERROR, check_all_folds, check_work_dir, mean_right, start_report, tickets_of
from triage_v2.sentence_settings import BATCH_SIZE, EPOCHS, LEARNING_RATE, MAX_LENGTH

BUNDLE_REPORT = Path(__file__).resolve().parents[1] / "reports" / "bundle_v2.json"


def test_a_fold_model_answers_only_the_runs_that_hold_its_fold_out():
    # A model that trained on a run's wording would score that run too well.
    tickets = [{"id": "T-2000-0", "fold": 0}, {"id": "T-2001-0", "fold": 1}, {"id": "T-2004-0", "fold": 0}]
    assert [t["id"] for t in tickets_of(tickets, 0)] == ["T-2000-0", "T-2004-0"]
    assert tickets_of(tickets, 3) == []


def test_the_mean_is_of_each_folds_share_as_the_word_model_reports_it():
    # Folds of different sizes: a pooled count would weigh the larger fold more than eval.json's mean does.
    folds = [{"category_right": 90, "n": 100}, {"category_right": 40, "n": 50}]
    assert mean_right(folds) == pytest.approx(0.85)


def test_the_settings_are_the_shipped_bundles():
    # ml/reports/bundle_v2.json records how the shipped model was trained; the folds repeat that recipe, and fit's
    # defaults are what run_fold trains with.
    shipped = json.loads(BUNDLE_REPORT.read_text(encoding="utf-8"))["settings"]
    assert SETTINGS == shipped
    assert (EPOCHS, LEARNING_RATE, BATCH_SIZE, MAX_LENGTH) == tuple(shipped[k] for k in ("epochs", "learning_rate", "batch_size", "max_length"))


def test_a_rerun_carries_on_from_the_same_settings_and_refuses_others():
    earlier = {"settings": SETTINGS, "folds": [{"fold": 0}], "approve_answers": [["T-2000-0", "Billing", "Low"]]}
    assert start_report(earlier) is earlier
    assert start_report(None) == {"settings": SETTINGS, "folds": [], "approve_answers": []}
    with pytest.raises(SystemExit, match=SETTINGS_ERROR):
        start_report({**earlier, "settings": {**SETTINGS, "epochs": 3}})


# Fold bundles are large and never committed; a work folder in the repo could be staged by accident.
def test_a_work_folder_inside_the_repo_is_refused_and_one_outside_is_kept(tmp_path):
    with pytest.raises(SystemExit, match=WORK_IN_REPO):
        check_work_dir(REPO_DIR / "ml" / "fold_work")
    check_work_dir(tmp_path)


# The answers file is read as complete by the measuring scripts, so it is written only from a report of every fold.
def test_answers_are_written_only_from_a_report_of_every_fold():
    with pytest.raises(SystemExit, match=FOLDS_ERROR):
        check_all_folds({"folds": [{"fold": 0}, {"fold": 1}, {"fold": 2}]})
    check_all_folds({"folds": [{"fold": k} for k in range(4)]})
