"""Scores the word-weight model against v0 on rows it never trained on, and writes eval.json.

Run from the ml folder: python -m triage.evaluate [--out PATH]
"""

import argparse
import hashlib
import json
import statistics
import sys
from pathlib import Path

from triage.data import FOLD_COUNT, HANDWRITTEN_PATH, TRAIN_ALL_PATH, fold_paths, load_rows
from triage.train import assert_no_leak, fit_fold_models, fit_models

REPORT_PATH = Path(__file__).resolve().parent.parent / "reports" / "eval.json"
DIVIDER = "=" * 60
STEP_COUNT = 4
METRICS = ("model_category", "model_priority", "v0_category", "v0_priority", "v0_review")
# The folds are the whole population being measured, not a sample of one.
STD_METHOD = "population"


def rows_fingerprint(rows):
    """Names a list of rows so a change to which rows are scored, or their order, shows.

    The fixed serialisation: one line per row in file order, each line the compact
    ASCII JSON array [id, fold, maskedText, category, priority], every line ended
    by "\\n"; the result is the SHA-256 of those bytes, in lowercase hex. Raw text
    and v0's answers are left out: they do not decide who is scored on what. The
    hand-written rows carry no fold, which reads as null, as the all-wording file's do.

    Args:
        rows: Exported rows, in file order.

    Returns:
        64 hex characters.
    """
    lines = (
        json.dumps([row["id"], row.get("fold"), row["maskedText"], row["category"], row["priority"]],
                   ensure_ascii=True, separators=(",", ":")) + "\n"
        for row in rows
    )
    return hashlib.sha256("".join(lines).encode("ascii")).hexdigest()


def count_correct(predicted, truth):
    """Counts matching answers.

    Args:
        predicted: Answers to check.
        truth: The right answers, same length.

    Returns:
        A dict with k right, n scored and accuracy k / n.
    """
    k = sum(1 for p, t in zip(predicted, truth) if p == t)
    return {"k": k, "n": len(truth), "accuracy": k / len(truth)}


def score_rows(models, rows):
    """Scores a trained model and v0 on the same rows.

    The model reads the masked text; v0's answers were made from the raw text
    at export and are read from each row.

    Args:
        models: The dict fit_models returns.
        rows: Exported rows with labels and a v0 block.

    Returns:
        A dict keyed by METRICS, each a count_correct result.
    """
    texts = [row["maskedText"] for row in rows]
    return {
        "model_category": count_correct(models["category"].predict(texts), [r["category"] for r in rows]),
        "model_priority": count_correct(models["priority"].predict(texts), [r["priority"] for r in rows]),
        "v0_category": count_correct([r["v0"]["category"] for r in rows], [r["category"] for r in rows]),
        "v0_priority": count_correct([r["v0"]["priority"] for r in rows], [r["priority"] for r in rows]),
        "v0_review": count_correct([r["v0"]["mustReview"] for r in rows], [r["mustReview"] for r in rows]),
    }


def fold_scores(k, train_rows, heldout_rows):
    """Trains fold k's models on its training rows and scores them on its held-out rows.

    Args:
        k: Fold number, kept in the result.
        train_rows: The fold's training rows.
        heldout_rows: The fold's held-out rows.

    Returns:
        A dict with "fold" and one count per METRICS.

    Raises:
        ValueError: A held-out text is in the training set.
    """
    models = fit_fold_models(train_rows, heldout_rows)
    return {"fold": k, **score_rows(models, heldout_rows)}


def handwritten_scores(train_all_rows, handwritten_rows):
    """Scores the shipped model (fitted on all wording) and v0 on the hand-written rows.

    Args:
        train_all_rows: Rows of every fold's wording.
        handwritten_rows: The frozen hand-written rows, never trained on.

    Returns:
        A dict with one count per METRICS.

    Raises:
        ValueError: A hand-written text is in the training rows.
    """
    # The hand-written set is the one test set no model may train on, so it gets
    # the same check the fold models get.
    assert_no_leak(train_all_rows, handwritten_rows)
    return score_rows(fit_models(train_all_rows), handwritten_rows)


def summarize_folds(fold_results):
    """Takes the mean and standard deviation of each accuracy over the folds.

    Args:
        fold_results: The fold_scores results.

    Returns:
        A dict keyed by METRICS with "mean" and "std" (population).
    """
    summary = {}
    for metric in METRICS:
        accuracies = [fold[metric]["accuracy"] for fold in fold_results]
        summary[metric] = {"mean": statistics.fmean(accuracies), "std": statistics.pstdev(accuracies)}
    return summary


def isolation_block():
    """Names, for each number, the model and the rows it was scored on.

    Returns:
        A dict with "folds" and "handwritten" entries keyed by METRICS.
    """
    def entry(fold_model, trained_on, scored_on):
        return {"model": fold_model, "trained_on": trained_on, "scored_on": scored_on}

    block = {"folds": {}, "handwritten": {}}
    for metric in METRICS:
        if metric.startswith("model_"):
            block["folds"][metric] = entry("fold_k", "train_k", "heldout_k")
            block["handwritten"][metric] = entry("shipped", "train_all", "handwritten")
        else:
            # v0 is rules written by hand: nothing is trained.
            block["folds"][metric] = entry("v0", None, "heldout_k")
            block["handwritten"][metric] = entry("v0", None, "handwritten")
    return block


def build_report(folds, train_all_rows, handwritten_rows, progress=None):
    """Runs the whole measurement and returns the report.

    Args:
        folds: One (train_rows, heldout_rows) pair per fold.
        train_all_rows: Rows used to fit the shipped model.
        handwritten_rows: The hand-written rows.
        progress: Optional function called with a line of text per stage.

    Returns:
        The eval.json content as a dict.
    """
    say = progress or (lambda message: None)
    fold_results = []
    for k, (train_rows, heldout_rows) in enumerate(folds):
        say(f"    fold {k}: train {len(train_rows):,}, held out {len(heldout_rows):,}")
        fold_results.append({
            **fold_scores(k, train_rows, heldout_rows),
            "rows_sha256": rows_fingerprint(heldout_rows),
            "train_rows_sha256": rows_fingerprint(train_rows),
        })
    say(f"    shipped model: train {len(train_all_rows):,}, hand-written {len(handwritten_rows):,}")
    handwritten = {
        **handwritten_scores(train_all_rows, handwritten_rows),
        "rows_sha256": rows_fingerprint(handwritten_rows),
        "train_rows_sha256": rows_fingerprint(train_all_rows),
    }
    # The rows are the same for model and v0, so comparing right-answer counts
    # is comparing accuracy, without float equality.
    return {
        "std_method": STD_METHOD,
        "folds": fold_results,
        "summary": summarize_folds(fold_results),
        "handwritten": handwritten,
        "beats_v0_every_fold": all(f["model_category"]["k"] > f["v0_category"]["k"] for f in fold_results),
        "beats_v0_handwritten": handwritten["model_category"]["k"] > handwritten["v0_category"]["k"],
        "isolation": isolation_block(),
    }


def write_report(report, path):
    """Writes the report as indented JSON, making the folder if needed.

    Args:
        report: The build_report result.
        path: Where to write it.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main(argv=()):
    """Loads the generated files, measures every fold and the hand-written set, writes the report.

    Args:
        argv: Command-line words. "--out PATH" writes the report there instead of
            over the committed eval.json. Empty when called from code, so a test
            runner's own arguments are never read.
    """
    parser = argparse.ArgumentParser(description="Score the model against v0 and write the report.")
    parser.add_argument("--out", type=Path, default=None, help="where to write the report (default: the committed eval.json)")
    out_path = parser.parse_args(argv).out or REPORT_PATH

    print(DIVIDER)
    print("WORD-WEIGHT MODEL AGAINST V0, PER FOLD")
    print(DIVIDER)

    # Step 1: read the exported files.
    print(f"[1/{STEP_COUNT}] Loading generated files")
    folds = [tuple(load_rows(path) for path in fold_paths(k)) for k in range(FOLD_COUNT)]
    train_all_rows = load_rows(TRAIN_ALL_PATH)
    handwritten_rows = load_rows(HANDWRITTEN_PATH)

    # Step 2: train each fold model and the shipped model, score each on its own rows.
    print(f"[2/{STEP_COUNT}] Training and scoring")
    report = build_report(folds, train_all_rows, handwritten_rows, print)

    # Step 3: write the report.
    print(f"[3/{STEP_COUNT}] Writing {out_path}")
    write_report(report, out_path)

    # Step 4: show the headline.
    print(f"[4/{STEP_COUNT}] Result")
    print(f"    beats v0 on every fold: {report['beats_v0_every_fold']}")
    print(f"    beats v0 on hand-written: {report['beats_v0_handwritten']}")
    print(DIVIDER)


if __name__ == "__main__":
    main(sys.argv[1:])
