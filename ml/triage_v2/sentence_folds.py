"""Measures the sentence model the way the word model was measured, fold by fold.

The word model's "right on tickets it never saw" is the mean over 4 folds of a model
trained on 3 folds of wording and scored on the 4th (`ml/reports/eval.json`). Its
"Cards with Approve per run" replays 40 desk runs, each scored by the fold model that
never saw that run's wording. This script trains the sentence model once per fold, with
the shipped bundle's settings, scores the held-out fold, and answers each Approve-run
ticket with the fold model that never saw it. `web/src/history/sources.test.ts` works the
two numbers out from this report.

Run from the project root, on the owner's yes, after the load check, with
`ml/data/generated/approve_runs.jsonl` written first
(`npm --prefix web exec --no -- tsx web/scripts/exportApproveTickets.ts`):
`python -m triage_v2.sentence_folds --work-dir <a folder outside the repo>`
"""

import argparse
import json
import time
from pathlib import Path

from threadpoolctl import threadpool_limits

from triage.data import FOLD_COUNT, fold_paths, load_rows
from triage_v2.practice_rounds import count
from triage_v2.score_onnx import score
from triage_v2.share_machine import GPU_REST_RATIO, share_the_machine
from triage_v2.train_sentence import BATCH_SIZE, EPOCHS, FIELDS, LEARNING_RATE, MAX_LENGTH

ML_DIR = Path(__file__).resolve().parents[1]
TICKETS = ML_DIR / "data" / "generated" / "approve_runs.jsonl"
REPORT = ML_DIR / "reports" / "sentence_folds.json"
# The shipped bundle's settings (ml/reports/bundle_v2.json), so the folds measure the same recipe.
SETTINGS = {"fields": list(FIELDS), "epochs": EPOCHS, "learning_rate": LEARNING_RATE, "batch_size": BATCH_SIZE, "max_length": MAX_LENGTH}
MISSING_ERROR = "E_TICKETS_MISSING"
SETTINGS_ERROR = "E_SETTINGS_CHANGED"


def tickets_of(tickets, fold):
    """Returns the Approve-run tickets a fold's model may answer: those of the runs that hold that fold out."""
    return [ticket for ticket in tickets if ticket["fold"] == fold]


def mean_right(folds):
    """Returns the mean share of held-out tickets right on department, over the folds."""
    return sum(fold["category_right"] / fold["n"] for fold in folds) / len(folds)


def start_report(earlier):
    """Returns the report to carry on from: the earlier one when its settings match, else a new one."""
    if earlier is None:
        return {"settings": SETTINGS, "folds": [], "approve_answers": []}
    if earlier["settings"] != SETTINGS:
        raise SystemExit(SETTINGS_ERROR)
    return earlier


def run_fold(k, tickets, work_dir, threads):
    """Trains fold k's sentence model, scores its held-out fold and its Approve-run tickets."""
    from triage_v2.export_onnx import export
    from triage_v2.train_sentence import fit

    train_path, heldout_path = fold_paths(k)
    train_rows, heldout = load_rows(train_path), load_rows(heldout_path)
    started = time.perf_counter()
    bundle = Path(work_dir) / f"sentence_fold_{k}"
    exported = export(fit(train_rows, rest_ratio=GPU_REST_RATIO), bundle)
    answers = score(bundle, heldout, exported["fingerprint"], threads)
    own = tickets_of(tickets, k)
    approve = score(bundle, own, exported["fingerprint"], threads) if own else []
    record = {"fold": k, "fingerprint": exported["fingerprint"], "seconds": round(time.perf_counter() - started, 1), **count(heldout, answers)}
    return record, [[a["id"], a["category"], a["priority"]] for a in approve]


def main():
    """Runs every fold not yet recorded and writes the report after each one."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--work-dir", required=True, help="where the fold bundles go; outside the repo")
    parser.add_argument("--force", action="store_true", help="the owner's override: start even when the GPU is busy")
    args = parser.parse_args()
    print("=" * 60)
    print("SENTENCE MODEL, FOLD BY FOLD")
    print("=" * 60)
    if not TICKETS.exists():
        raise SystemExit(MISSING_ERROR)
    # Step 1: leave room for the owner's other work, or do not start
    print("\n[1/2] Checking the machine and capping this run...")
    threads = share_the_machine(force=args.force)
    tickets = load_rows(TICKETS)
    report = start_report(json.loads(REPORT.read_text(encoding="utf-8")) if REPORT.exists() else None)
    Path(args.work_dir).mkdir(parents=True, exist_ok=True)
    # Step 2: one fold at a time, saved as it finishes
    print("\n[2/2] Training and scoring each fold...")
    with threadpool_limits(limits=threads):
        for k in range(FOLD_COUNT):
            if any(fold["fold"] == k for fold in report["folds"]):
                print(f"    fold {k}: already recorded, kept")
                continue
            record, approve = run_fold(k, tickets, args.work_dir, threads)
            report["folds"].append(record)
            report["approve_answers"].extend(approve)
            REPORT.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
            print(f"    fold {k}: {record['category_right']:,} of {record['n']:,} right, {len(approve):,} Approve-run tickets, {record['seconds']} s")
    if len(report["folds"]) == FOLD_COUNT:
        print(f"\n    Mean right on held-out folds: {mean_right(report['folds']) * 100:.1f}%")
    print(f"    Saved: {REPORT}")


if __name__ == "__main__":
    main()
