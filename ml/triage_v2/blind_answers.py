"""Scores the blind set once with every sentence model of the ladder, and records the answers.

The blind set (`ml/data/blind.jsonl`, frozen, its SHA-256 beside it) is read once, at
the end of the version, by the shipped sentence bundle and the model each stream of the
fair 90-day run ended with. Only the answers are written; `web/scripts/blindReading.ts`
works the reading out from them (with the word model, which runs in TypeScript), and CI
works it out again. The 90-day models are not in the repo; each must have the fingerprint
the fair run recorded for it, and is checked before the blind set is opened.

Run from the project root, on the owner's yes, after the load check:
`python -m triage_v2.blind_answers --work <the fair run's work folder>`
"""

import argparse
import hashlib
import json
import subprocess
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
MISSING_ERROR = "E_MODEL_MISSING"
HASH_ERROR = "E_MODEL_HASH"
FAIR_RUN = ML_DIR / "reports" / "ninety_day_fair.json"


def models(work):
    """Returns (name, folder, recorded fingerprint) for every model read."""
    found = [("sentence", BUNDLE, json.loads(REPORT.read_text(encoding="utf-8"))["fingerprint"])]
    streams = json.loads(FAIR_RUN.read_text(encoding="utf-8"))["streams"]
    for stream in range(STREAMS):
        name = f"stream_{stream}_after_{LAST_WEEK}"
        found.append((f"ninety_day_end_{stream}", Path(work) / name, streams[str(stream)]["models"][name]))
    return found


def check_models(found):
    """Refuses, before the blind set is read, a model folder that is missing or not the recorded model."""
    for _, folder, recorded in found:
        if not Path(folder).is_dir():
            raise SystemExit(MISSING_ERROR)
        if bundle_fingerprint(folder) != recorded:
            raise SystemExit(HASH_ERROR)


def ever_committed(path):
    """Whether the file was ever in the repo's history, so a deleted copy still counts as read."""
    found = subprocess.run(["git", "-C", str(ML_DIR), "log", "--oneline", "-1", "--", str(path)], capture_output=True, text=True, check=True)
    return found.stdout.strip() != ""


def claim(path):
    """Creates the answers file empty, failing if it exists: a reading that starts counts, even if it stops."""
    try:
        path.open("x", encoding="utf-8").close()
    except FileExistsError:
        raise SystemExit(EXISTS_ERROR) from None


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
        answers = score(folder, rows, recorded, threads)
        record["models"][name] = {"fingerprint": recorded, "answers": [[a["id"], a["category"], a["priority"]] for a in answers]}
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
    if ever_committed(ANSWERS):
        raise SystemExit(EXISTS_ERROR)
    # Step 1: every model is checked before the blind set is opened, then the reading is claimed
    print("\n[1/3] Checking the models...")
    found = models(args.work)
    check_models(found)
    claim(ANSWERS)
    # Step 2: leave room for the owner's other work
    print("\n[2/3] Capping this run...")
    limit_cpu()
    # Step 3: score and write
    print("\n[3/3] Scoring the blind set...")
    rows, digest = read_blind()
    record = build_answers(rows, digest, found, CPU_THREADS)
    ANSWERS.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"\n    Saved: {ANSWERS}")


if __name__ == "__main__":
    main()
