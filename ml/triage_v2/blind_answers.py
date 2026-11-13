"""Scores the blind set once with every sentence model of the ladder, and records the answers.

The blind set (`ml/data/blind.jsonl`, frozen, its SHA-256 beside it) is read once, at
the end of the version, by the shipped sentence bundle and the model each stream of the
fair 90-day run ended with. Only the answers are written; `web/scripts/blindReading.ts`
works the reading out from them (with the word model, which runs in TypeScript), and CI
works it out again. The 90-day models are not in the repo, so their fingerprints are
recorded beside their answers.

Run from the project root, on the owner's yes, after the load check:
`python -m triage_v2.blind_answers --work <the fair run's work folder>`
"""

import argparse
import hashlib
import json
from pathlib import Path

from triage_v2.score_onnx import bundle_fingerprint, score
from triage_v2.share_machine import CPU_THREADS, limit_cpu

ML_DIR = Path(__file__).resolve().parents[1]
BLIND = ML_DIR / "data" / "blind.jsonl"
BLIND_SHA = ML_DIR / "data" / "blind.sha256"
BUNDLE = ML_DIR / "models" / "bundle_v2"
REPORT = ML_DIR / "reports" / "bundle_v2.json"
ANSWERS = ML_DIR / "reports" / "blind_answers.json"
STREAMS = 4
# The fair run's last retrain is after week 11 (12 retrains, weeks 0 to 11).
LAST_WEEK = 11
CHANGED_ERROR = "E_BLIND_CHANGED"
EXISTS_ERROR = "E_READ_ONCE"


def models(work):
    """Returns (name, folder, recorded fingerprint or None) for every model read."""
    found = [("sentence", BUNDLE, json.loads(REPORT.read_text(encoding="utf-8"))["fingerprint"])]
    for stream in range(STREAMS):
        found.append((f"ninety_day_end_{stream}", Path(work) / f"stream_{stream}_after_{LAST_WEEK}", None))
    return found


def read_blind():
    """Returns the blind rows and the file's SHA-256, refusing a file that is not the frozen one."""
    # Git on Windows checks the file out with CRLF line ends; its fingerprint is of the LF form it was written in.
    content = BLIND.read_bytes().replace(b"\r\n", b"\n")
    digest = hashlib.sha256(content).hexdigest()
    if digest != BLIND_SHA.read_text(encoding="utf-8").strip():
        raise SystemExit(CHANGED_ERROR)
    rows = [json.loads(line) for line in content.decode("utf-8").splitlines() if line.strip()]
    return rows, digest


def build_answers(rows, digest, found, threads):
    """Scores the blind rows with each model; returns the answers record."""
    record = {"blind_sha256": digest, "models": {}}
    for name, folder, recorded in found:
        fingerprint = recorded if recorded is not None else bundle_fingerprint(folder)
        answers = score(folder, rows, fingerprint, threads)
        record["models"][name] = {"fingerprint": fingerprint, "answers": [[a["id"], a["category"], a["priority"]] for a in answers]}
        print(f"    {name}: {len(answers):,} tickets")
    return record


def main():
    """Reads the blind set once and writes the answers; refuses to read it a second time."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--work", required=True, help="the fair 90-day run's work folder")
    args = parser.parse_args()
    print("=" * 60)
    print("THE ONE BLIND READING")
    print("=" * 60)
    if ANSWERS.exists():
        raise SystemExit(EXISTS_ERROR)
    # Step 1: leave room for the owner's other work
    print("\n[1/2] Capping this run...")
    limit_cpu()
    # Step 2: score and write
    print("\n[2/2] Scoring the blind set...")
    rows, digest = read_blind()
    record = build_answers(rows, digest, models(args.work), CPU_THREADS)
    ANSWERS.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"\n    Saved: {ANSWERS}")


if __name__ == "__main__":
    main()
