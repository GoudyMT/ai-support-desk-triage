"""Checks that eval.json is the one the code derives, and that it clears the owner's accuracy floor.

Run from the ml folder: python -m triage.check_eval <fresh.json> <committed.json>

Exits 0 when the fresh report is the committed one in every field (floats within
a tolerance) and the committed one clears the floor. Exits 1 at the first thing
that does not.
"""

import argparse
import json
from pathlib import Path

DIVIDER = "=" * 60
STEP_COUNT = 3
# The owner's floor, spec section 6 (docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md):
# set on 2026-10-30 from the first honest run. Category accuracy on each fold may
# not fall more than FLOOR_MARGIN below its first-run value (folds 0 to 3), and
# the shipped model stays at HANDWRITTEN_FLOOR_K right of the 48 hand-written rows.
FOLD_FIRST_RUN = (0.5813, 0.4855, 0.6240, 0.6012)
FLOOR_MARGIN = 0.01
HANDWRITTEN_FLOOR_K = 39
HANDWRITTEN_FLOOR_N = 48
# Floats are compared after this many places, so 0.5813 - 0.01 does not miss by its last bit.
FLOAT_PLACES = 9
# How far two floats of the same report may differ: a Linux and a Windows run
# may disagree in the last digits, never by this much.
FLOAT_TOLERANCE = 1e-9


def _differs(fresh, committed):
    """True when two leaf values are not the same value.

    Floats are the only values that may differ, and only within FLOAT_TOLERANCE;
    a different kind of value (a float for an integer, a number for a boolean)
    is a difference, so a count cannot hide behind the tolerance.
    """
    if type(fresh) is not type(committed):
        return True
    if isinstance(fresh, float):
        return not abs(fresh - committed) <= FLOAT_TOLERANCE
    return fresh != committed


def _walk(fresh, committed, path):
    """Finds the first difference between two parsed JSON values, depth first, in file order.

    Returns:
        None when they agree, else a line naming the path and both values (or
        the key or length that one report has and the other lacks).
    """
    if isinstance(fresh, dict) and isinstance(committed, dict):
        for key in [*fresh, *(key for key in committed if key not in fresh)]:
            where =f"{path}.{key}" if path else key
            if key not in committed:
                return f"{where}: only in fresh"
            if key not in fresh:
                return f"{where}: only in committed"
            found = _walk(fresh[key], committed[key], where)
            if found is not None:
                return found
        return None
    if isinstance(fresh, list) and isinstance(committed, list):
        if len(fresh) != len(committed):
            return f"{path}: {len(fresh)} entries in fresh, {len(committed)} in committed"
        for index, (new, old) in enumerate(zip(fresh, committed)):
            found = _walk(new, old, f"{path}[{index}]")
            if found is not None:
                return found
        return None
    if _differs(fresh, committed):
        return f"{path}: fresh {fresh!r}, committed {committed!r}"
    return None


def first_difference(fresh, committed):
    """Finds the first thing the two reports disagree on, anywhere in them.

    Every key of either report counts: the counts, the float accuracies, the
    summary, the fingerprints, the verdicts, std_method and the isolation block.

    Args:
        fresh: The eval.json dict just derived.
        committed: The eval.json dict in the repository.

    Returns:
        None when they agree, else a line naming the first difference with both values.
    """
    return _walk(fresh, committed, "")


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
    # The floor is a count of the frozen 48 rows, as the spec words it; a set of
    # another size is a different measurement, not a pass or a fail by rate.
    if handwritten["n"] != HANDWRITTEN_FLOOR_N or handwritten["k"] < HANDWRITTEN_FLOOR_K:
        return (f"hand-written category {handwritten['k']} of {handwritten['n']} is below the floor of "
                f"{HANDWRITTEN_FLOOR_K} of {HANDWRITTEN_FLOOR_N}")
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
    print(f"[2/{STEP_COUNT}] Comparing every field of the two reports")
    found = first_difference(fresh, committed)
    if found is not None:
        print(f"    DIFFERENT {found}")
        print(DIVIDER)
        return 1
    print("    SAME in every field")

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
