"""The risk detector (B1): a yes/no word model for the five risk reasons, tried against the three-path desk.

For each judged set it learns from that set's word model's training tickets with a fifth held back, the tuning side.
It writes the detector's yes-probability for the tuning tickets and the judged tickets, and a word model fitted on the
same four fifths, so web/scripts/measureRiskDetector.ts can set the cut-off on the tuning side (where the word rules
and the word model's doubt are worked out the same way the desk works them out) before any judged ticket is read.

Run from the ml folder on the owner's yes: python -m triage_v2.risk_detector
"""

import json
import random
import time

from threadpoolctl import threadpool_limits

from triage.data import GENERATED_DIR, load_rows
from triage.export_model import build_model, write_atomically
from triage.train import RANDOM_STATE, assert_no_leak, fit_models, fit_pipeline
from triage_v2.share_machine import (
    BUSY_ERROR,
    CPU_THREADS,
    SAMPLES,
    limit_cpu,
    machine_too_busy,
    read_cpu_percent,
    read_gpu_percent,
)

TUNE_SHARE = 0.2
YES = "yes"
NO = "no"
OUT_DIR = GENERATED_DIR / "risk"
DIVIDER = "=" * 60
STEP_COUNT = 3

# Each judged set, the tickets its word model learned from, and the files it is judged on. The desk-only wording and
# both hand-written sets are judged with the shipped model; each fold with its own fold model.
SETS = {
    "desk": ("train_all.jsonl", "v2_desk.jsonl"),
    "handwritten": ("train_all.jsonl", "handwritten.jsonl"),
    "fresh": ("train_all.jsonl", "v2_handwritten_fresh.jsonl"),
    "fold 0": ("train_0.jsonl", "heldout_0.jsonl"),
    "fold 1": ("train_1.jsonl", "heldout_1.jsonl"),
    "fold 2": ("train_2.jsonl", "heldout_2.jsonl"),
    "fold 3": ("train_3.jsonl", "heldout_3.jsonl"),
}


def is_risky(row):
    """Whether a person must handle the ticket for one of the five risk reasons; a vague ticket is a routing doubt."""
    return bool(row["mustReview"]) and row.get("reviewReason") != "vague ticket"


def split_tuning(rows, share=TUNE_SHARE, seed=RANDOM_STATE):
    """
    Holds back a fixed share of the training tickets as the tuning side.

    Args:
        rows: The training tickets.
        share: The share held back.
        seed: The shuffle's seed, so the split is the same every run.

    Returns:
        (train, tune): the rows learned from and the rows held back, each in file order.
    """
    order = list(range(len(rows)))
    random.Random(seed).shuffle(order)
    held = set(order[: round(len(rows) * share)])
    train = [row for at, row in enumerate(rows) if at not in held]
    tune = [row for at, row in enumerate(rows) if at in held]
    return train, tune


def risk_scores(pipeline, rows):
    """Returns [id, yes-probability] for each row, in order."""
    yes = list(pipeline.classes_).index(YES)
    probabilities = pipeline.predict_proba([row["maskedText"] for row in rows])
    return [[row["id"], float(p[yes])] for row, p in zip(rows, probabilities)]


def build_set(train_rows, judged_rows):
    """
    Fits the detector and the tuning word model on four fifths of a set's training tickets and scores both sides.

    Args:
        train_rows: The tickets the set's word model learned from.
        judged_rows: The set's judged tickets.

    Returns:
        A dict: tune_ids, tune_scores and judged_scores ([id, yes-probability] pairs), and tune_model (a word model
        file, as web/src/model/scorer.ts reads it, fitted on the same four fifths).

    Raises:
        ValueError: E_HELDOUT_IN_TRAIN when a judged or tuning text is also a training text.
    """
    train, tune = split_tuning(train_rows)
    assert_no_leak(train, judged_rows)
    assert_no_leak(train, tune)
    assert_no_leak(tune, judged_rows)
    detector = fit_pipeline([row["maskedText"] for row in train], [YES if is_risky(row) else NO for row in train])
    return {
        "tune_ids": [row["id"] for row in tune],
        "tune_scores": risk_scores(detector, tune),
        "judged_scores": risk_scores(detector, judged_rows),
        "tune_model": build_model(fit_models(train)),
    }


def main():
    print(DIVIDER)
    print("RISK DETECTOR (B1)")
    print(DIVIDER)
    # Step 1: leave room for the owner's other work, or do not start
    print(f"\n[1/{STEP_COUNT}] Checking the machine and capping this run...")
    # A CPU-only run: the same busy check as share_the_machine, then the CPU caps, without the GPU library it loads.
    gpu = [read_gpu_percent() for _ in range(SAMPLES)]
    cpu = [read_cpu_percent() for _ in range(SAMPLES)]
    print(f"    GPU in use: {gpu}%, CPU in use: {cpu}%")
    if machine_too_busy(gpu, cpu):
        raise SystemExit(BUSY_ERROR)
    limit_cpu()
    threads = CPU_THREADS
    started = time.perf_counter()
    OUT_DIR.mkdir(exist_ok=True)
    with threadpool_limits(limits=threads):
        # Step 2: one detector per judged set
        print(f"\n[2/{STEP_COUNT}] Fitting and scoring {len(SETS)} sets...")
        for name, (train_file, judged_file) in SETS.items():
            built = build_set(load_rows(GENERATED_DIR / train_file), load_rows(GENERATED_DIR / judged_file))
            stem = name.replace(" ", "_")
            write_atomically(OUT_DIR / f"{stem}_tune_model.json", json.dumps(built.pop("tune_model")))
            write_atomically(OUT_DIR / f"{stem}_scores.json", json.dumps({"train": train_file, **built}))
            print(f"    {name}: tuning {len(built['tune_ids']):,}, judged {len(built['judged_scores']):,}")
    # Step 3: what it cost
    print(f"\n[3/{STEP_COUNT}] Done in {time.perf_counter() - started:.1f} s, {threads} CPU threads, below-normal priority")
    print(f"    Written to: {OUT_DIR}")


if __name__ == "__main__":
    main()
