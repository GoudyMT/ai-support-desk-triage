"""Checks that eval.json is the one the code derives, and that it clears the owner's accuracy floor.

Run from the ml folder: python -m triage.check_eval <fresh.json> <committed.json>

Exits 0 when the fresh report matches the committed one on every right-answer
count, every row fingerprint and both beats-v0 verdicts, and the committed one
clears the floor. Exits 1 at the first thing that does not.
"""

import argparse
import json
from pathlib import Path

from triage.evaluate import METRICS

DIVIDER = "=" * 60
STEP_COUNT = 3
# The owner's floor, spec section 6 (docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md):
# set on 2026-10-30 from the first honest run. Category accuracy on each fold may
# not fall more than FLOOR_MARGIN below its first-run value (folds 0 to 3), and
# the shipped model stays at HANDWRITTEN_FLOOR_K right of the 48 hand-written rows.
FOLD_FIRST_RUN = (0.5813, 0.4855, 0.6240, 0.6012)
FLOOR_MARGIN = 0.01
HANDWRITTEN_FLOOR_K = 39
# Floats are compared after this many places, so 0.5813 - 0.01 does not miss by its last bit.
FLOAT_PLACES = 9
FINGERPRINT_KEYS = ("rows_sha256", "train_rows_sha256")
VERDICT_KEYS = ("beats_v0_every_fold", "beats_v0_handwritten")


def comparisons(report):
    """Lists what two reports must agree on, as (name, value) pairs in a fixed order.

    Counts are compared, not the float accuracies, so a Linux and a Windows run
    agree. A missing key reads as None, so a report without fingerprints differs.

    Args:
        report: An eval.json dict.

    Returns:
        The pairs: fold count, then per fold and for the hand-written set its
        fingerprints and each metric's k and n, then the two verdicts.
    """
    def block(name, entry):
        pairs = [(f"{name}.{key}", entry.get(key)) for key in FINGERPRINT_KEYS]
        for metric in METRICS:
            counts = entry.get(metric) or {}
            pairs += [(f"{name}.{metric}.{key}", counts.get(key)) for key in ("k", "n")]
        return pairs

    folds = report.get("folds") or []
    pairs = [("fold count", len(folds))]
    for index, entry in enumerate(folds):
        pairs += block(f"folds[{index}]", entry)
    pairs += block("handwritten", report.get("handwritten") or {})
    pairs += [(key, report.get(key)) for key in VERDICT_KEYS]
    return pairs


def first_difference(fresh, committed):
    """Finds the first thing the two reports disagree on.

    Args:
        fresh: The eval.json dict just derived.
        committed: The eval.json dict in the repository.

    Returns:
        None when they agree, else a line naming the first difference with both values.
    """
    fresh_pairs, committed_pairs = comparisons(fresh), comparisons(committed)
    # The fold count is the first pair, so the lists are only walked in full when it is equal.
    for (name, fresh_value), (_, committed_value) in zip(fresh_pairs, committed_pairs):
        if fresh_value != committed_value:
            return f"{name}: fresh {fresh_value!r}, committed {committed_value!r}"
    return None


def floor_problem(report):
    """Finds the first way a report falls below the owner's floor.

    Args:
        report: An eval.json dict.

    Returns:
        None when it clears the floor, else a line saying where it does not.
    """
    folds = report["folds"]
    if len(folds) != len(FOLD_FIRST_RUN):
        return f"floor: {len(folds)} folds, the floor is set for {len(FOLD_FIRST_RUN)}"
    for index, (entry, first_run) in enumerate(zip(folds, FOLD_FIRST_RUN)):
        counts = entry["model_category"]
        drop = round(first_run - counts["k"] / counts["n"], FLOAT_PLACES)
        if drop > FLOOR_MARGIN:
            return (f"fold {index} category accuracy {counts['k'] / counts['n']:.4f} is more than "
                    f"{FLOOR_MARGIN} below its first run {first_run}")
    handwritten = report["handwritten"]["model_category"]
    if handwritten["k"] < HANDWRITTEN_FLOOR_K:
        return f"hand-written category {handwritten['k']} of {handwritten['n']} is below the floor of {HANDWRITTEN_FLOOR_K}"
    return None


def main(argv=None):
    """Compares a fresh and a committed eval.json and returns the exit code: 0 when it holds, 1 when not."""
    parser = argparse.ArgumentParser(description="Check that eval.json is current and clears the floor.")
    parser.add_argument("fresh", help="the report just derived")
    parser.add_argument("committed", help="the report in the repository")
    args = parser.parse_args(argv)

    print(DIVIDER)
    print("EVALUATION CHECK")
    print(DIVIDER)

    # Step 1: read both reports.
    print(f"[1/{STEP_COUNT}] Loading {args.fresh} and {args.committed}")
    fresh = json.loads(Path(args.fresh).read_text(encoding="utf-8"))
    committed = json.loads(Path(args.committed).read_text(encoding="utf-8"))

    # Step 2: the committed report must be what the code derives.
    print(f"[2/{STEP_COUNT}] Comparing counts, row fingerprints and verdicts")
    found = first_difference(fresh, committed)
    if found is not None:
        print(f"    DIFFERENT {found}")
        print(DIVIDER)
        return 1
    print("    SAME on every count, fingerprint and verdict")

    # Step 3: the committed report must clear the owner's floor.
    print(f"[3/{STEP_COUNT}] Checking the owner's floor")
    problem = floor_problem(committed)
    if problem is not None:
        print(f"    BELOW THE FLOOR {problem}")
        print(DIVIDER)
        return 1
    print("    ABOVE the floor on every fold and on the hand-written rows")
    print(DIVIDER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
