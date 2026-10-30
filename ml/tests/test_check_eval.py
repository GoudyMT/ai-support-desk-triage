"""Tests for the CI check that eval.json is the one the code derives and clears the owner's floor."""

import copy
import json

import pytest

from triage.check_eval import (
    FLOOR_MARGIN,
    FOLD_FIRST_RUN,
    HANDWRITTEN_FLOOR_K,
    first_difference,
    floor_problem,
    main,
)
from triage.data import FOLD_COUNT, HANDWRITTEN_PATH, fold_paths, load_rows
from triage.evaluate import METRICS, REPORT_PATH, rows_fingerprint

FLOOR_N = 10_000
HANDWRITTEN_N = 48


def metric_counts(k, n):
    return {"k": k, "n": n, "accuracy": k / n}


def fold_entry(fold, category_k, n=FLOOR_N):
    entry = {"fold": fold, "rows_sha256": f"heldout-{fold}", "train_rows_sha256": f"train-{fold}"}
    entry.update({metric: metric_counts(category_k + index, n) for index, metric in enumerate(METRICS)})
    return entry


def report(category_ks=None, handwritten_k=HANDWRITTEN_FLOOR_K):
    """A report whose fold category accuracy sits exactly on the floor (1 point under the first run)."""
    if category_ks is None:
        category_ks = [round((first_run - FLOOR_MARGIN) * FLOOR_N) for first_run in FOLD_FIRST_RUN]
    handwritten = {metric: metric_counts(handwritten_k + index, HANDWRITTEN_N) for index, metric in enumerate(METRICS)}
    handwritten.update({"rows_sha256": "handwritten", "train_rows_sha256": "train-all"})
    return {
        "std_method": "population",
        "folds": [fold_entry(fold, k) for fold, k in enumerate(category_ks)],
        "summary": {metric: {"mean": 0.5, "std": 0.1} for metric in METRICS},
        "handwritten": handwritten,
        "beats_v0_every_fold": True,
        "beats_v0_handwritten": True,
    }


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8", newline="\n")
    return str(path)


def test_the_floor_constants_are_the_owners_first_run_values():
    # Spec section 6: folds 0-3 and the hand-written count, set by the owner on 2026-10-30.
    assert FOLD_FIRST_RUN == (0.5813, 0.4855, 0.6240, 0.6012)
    assert FLOOR_MARGIN == 0.01
    assert HANDWRITTEN_FLOOR_K == 39


# What each change does to a fresh report, as a bug in fold assignment, training or
# the scorer would. Every one must be seen even though the others stay equal.
CHANGES = {
    "folds[1].model_category.k": lambda r: r["folds"][1]["model_category"].update(k=1),
    "folds[3].v0_review.n": lambda r: r["folds"][3]["v0_review"].update(n=3999),
    "folds[2].rows_sha256": lambda r: r["folds"][2].update(rows_sha256="x"),
    "folds[0].train_rows_sha256": lambda r: r["folds"][0].update(train_rows_sha256="x"),
    "handwritten.model_priority.k": lambda r: r["handwritten"]["model_priority"].update(k=1),
    "handwritten.rows_sha256": lambda r: r["handwritten"].update(rows_sha256="x"),
    "handwritten.train_rows_sha256": lambda r: r["handwritten"].update(train_rows_sha256="x"),
    "beats_v0_every_fold": lambda r: r.update(beats_v0_every_fold=False),
    "beats_v0_handwritten": lambda r: r.update(beats_v0_handwritten=False),
    "folds[1].rows_sha256 (missing)": lambda r: r["folds"][1].pop("rows_sha256"),
    "fold count": lambda r: r["folds"].pop(),
}


def test_two_equal_reports_have_no_difference_and_float_noise_is_not_one():
    # Linux and Windows may differ in the last digit of a float; counts are compared exactly.
    fresh, committed = report(), report()
    committed["folds"][0]["model_category"]["accuracy"] += 1e-12
    committed["summary"]["model_category"]["mean"] += 0.01
    assert first_difference(fresh, committed) is None


@pytest.mark.parametrize("name", CHANGES)
def test_any_change_to_a_count_a_fingerprint_or_a_verdict_is_reported_by_name(name):
    fresh, committed = report(), report()
    CHANGES[name](fresh)
    message = first_difference(fresh, committed)
    assert message is not None
    assert name.split(" ")[0] in message


def test_the_first_difference_is_the_one_named():
    fresh, committed = report(), report()
    CHANGES["folds[3].v0_review.n"](fresh)
    CHANGES["folds[1].model_category.k"](fresh)
    assert "folds[1].model_category.k" in first_difference(fresh, committed)


def test_a_report_on_the_floor_passes():
    assert floor_problem(report()) is None


@pytest.mark.parametrize("fold", range(FOLD_COUNT))
def test_a_fold_more_than_a_point_below_its_first_run_fails_whichever_fold_it_is(fold):
    ks = [round((first_run - FLOOR_MARGIN) * FLOOR_N) for first_run in FOLD_FIRST_RUN]
    # 0.011 below the first run, 0.001 under the floor.
    ks[fold] = round((FOLD_FIRST_RUN[fold] - 0.011) * FLOOR_N)
    message = floor_problem(report(ks))
    assert message is not None
    assert f"fold {fold}" in message


def test_a_report_well_above_the_floor_passes():
    ks = [round(first_run * FLOOR_N) for first_run in FOLD_FIRST_RUN]
    assert floor_problem(report(ks, handwritten_k=45)) is None


def test_handwritten_below_39_of_48_fails():
    message = floor_problem(report(handwritten_k=HANDWRITTEN_FLOOR_K - 1))
    assert message is not None
    assert "hand-written" in message


def write_pair(tmp_path, fresh, committed):
    return [write_json(tmp_path / "fresh.json", fresh), write_json(tmp_path / "committed.json", committed)]


def test_the_command_exits_0_when_the_reports_agree_and_clear_the_floor(tmp_path, capsys):
    assert main(write_pair(tmp_path, report(), report())) == 0
    assert "SAME" in capsys.readouterr().out


def test_the_command_exits_1_and_prints_the_first_difference(tmp_path, capsys):
    fresh = report()
    CHANGES["handwritten.rows_sha256"](fresh)
    assert main(write_pair(tmp_path, fresh, report())) == 1
    assert "handwritten.rows_sha256" in capsys.readouterr().out


def test_the_command_exits_1_when_the_two_agree_but_are_below_the_floor(tmp_path, capsys):
    low = report(handwritten_k=HANDWRITTEN_FLOOR_K - 1)
    assert main(write_pair(tmp_path, copy.deepcopy(low), low)) == 1
    assert "hand-written" in capsys.readouterr().out


def test_the_committed_eval_json_clears_the_floor_and_is_complete():
    committed = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    assert floor_problem(committed) is None
    assert first_difference(committed, committed) is None
    assert all("rows_sha256" in entry for entry in committed["folds"] + [committed["handwritten"]])


def test_the_committed_fingerprints_are_those_of_the_exported_test_sets():
    # The same comparison CI makes after a retrain, without the retrain: a changed
    # fold assignment or hand-written set fails here at once, before any counts move.
    committed = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    for k in range(FOLD_COUNT):
        assert committed["folds"][k]["rows_sha256"] == rows_fingerprint(load_rows(fold_paths(k)[1]))
    assert committed["handwritten"]["rows_sha256"] == rows_fingerprint(load_rows(HANDWRITTEN_PATH))
