"""Training the sentence model that ships and writing its frozen bundle.

It trains on every training ticket of the second model's data (`v2_train.jsonl`), writes the
bundle to a folder, and records the bundle's fingerprint and its answers' counts on the
desk-only wording, which no model trains on.

Run from the project root in the training environment:
`python -m triage_v2.build_bundle --out <bundle folder> --answers-dir <folder for answer files>`
"""

import argparse
import json
import time
from pathlib import Path

from threadpoolctl import threadpool_limits

from triage_v2.practice_rounds import count, load
from triage_v2.score_onnx import score
from triage_v2.share_machine import GPU_REST_RATIO, share_the_machine

REPORT_PATH = Path(__file__).resolve().parents[1] / "reports" / "bundle_v2.json"
TRAIN_FILE = "v2_train.jsonl"
# Scored with the new bundle. Each file's rows carry `maskedText`; none is trained on.
SCORED_FILES = {"desk": "v2_desk.jsonl", "handwritten": "handwritten.jsonl"}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", required=True, help="the bundle folder to write")
    parser.add_argument("--answers-dir", required=True, help="where the answer files go; outside the repo")
    parser.add_argument("--force", action="store_true", help="the owner's override: start even when the GPU is busy")
    args = parser.parse_args()

    print("=" * 60)
    print("BUILDING THE SENTENCE MODEL BUNDLE")
    print("=" * 60)
    # Step 1: leave room for the owner's other work, or do not start
    print("\n[1/4] Checking the machine and capping this run...")
    threads = share_the_machine(force=args.force)
    from triage_v2.export_onnx import export
    from triage_v2.train_sentence import BATCH_SIZE, EPOCHS, FIELDS, LEARNING_RATE, MAX_LENGTH, fit

    with threadpool_limits(limits=threads):
        # Step 2: train on every training ticket
        print("\n[2/4] Training...")
        train_rows = load(TRAIN_FILE)
        started = time.perf_counter()
        model = fit(train_rows, rest_ratio=GPU_REST_RATIO)
        train_seconds = time.perf_counter() - started
        print(f"    Tickets: {len(train_rows):,}, seconds: {train_seconds:.0f}")

        # Step 3: write the bundle
        print("\n[3/4] Writing the bundle...")
        exported = export(model, args.out)
        print(f"    Fingerprint: {exported['fingerprint']}")

        # Step 4: score the sets no model trains on, with the bundle itself
        print("\n[4/4] Scoring with the bundle...")
        Path(args.answers_dir).mkdir(parents=True, exist_ok=True)
        scored = {}
        for name, file_name in SCORED_FILES.items():
            rows = load(file_name)
            answers = score(args.out, rows, exported["fingerprint"], threads)
            (Path(args.answers_dir) / f"bundle_v2_answers_{name}.json").write_text(json.dumps(answers), encoding="utf-8")
            scored[name] = count(rows, answers)
            print(f"    {name}: category {scored[name]['category_right']:,} of {scored[name]['n']:,}, priority {scored[name]['priority_right']:,}")

    report = {
        "fingerprint": exported["fingerprint"],
        "max_length": exported["max_length"],
        "trained_on": {"file": TRAIN_FILE, "tickets": len(train_rows)},
        "settings": {"fields": list(FIELDS), "epochs": EPOCHS, "learning_rate": LEARNING_RATE, "batch_size": BATCH_SIZE, "max_length": MAX_LENGTH},
        "bundle_bytes": {path.name: path.stat().st_size for path in sorted(Path(args.out).iterdir())},
        "train_seconds": round(train_seconds, 1),
        "scored": scored,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"\n    Saved: {REPORT_PATH}")


if __name__ == "__main__":
    main()
