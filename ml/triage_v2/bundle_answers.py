"""Recording the bundle's answer for every ticket of the sets it is judged on.

Every published number of the sentence model is worked out from this record, and a test
scores the bundle again and compares answer by answer. A count alone can hide a change:
two tickets that swap answers leave every count as it was.

Run from the project root, after `npm run export-data` and `npm run export-v2`:
`python -m triage_v2.bundle_answers`
"""

import hashlib
import json
from pathlib import Path

from triage_v2.practice_rounds import count, load
from triage_v2.score_onnx import bundle_fingerprint, score
from triage_v2.share_machine import CPU_THREADS, limit_cpu

ML_DIR = Path(__file__).resolve().parents[1]
BUNDLE = ML_DIR / "models" / "bundle_v2"
ANSWERS_PATH = ML_DIR / "reports" / "bundle_v2_answers.json"
REPORT_PATH = ML_DIR / "reports" / "bundle_v2.json"
# Each file's rows carry `maskedText`; no model trains or tunes on any of them.
SCORED_FILES = {"desk": "v2_desk.jsonl", "handwritten": "handwritten.jsonl", "fresh": "v2_handwritten_fresh.jsonl"}
FIELDS = ("category", "priority")


def rows_digest(rows):
    """
    Returns one fingerprint for the tickets a set holds: ids, model input and true labels.

    Args:
        rows: The set's rows, in file order.

    Returns:
        The SHA-256, in hex. A regenerated file with other tickets, or the same
        tickets with other labels, has another digest.
    """
    lines = [json.dumps([row["id"], row["maskedText"], row["category"], row["priority"], row["mustReview"]], ensure_ascii=True) for row in rows]
    return hashlib.sha256("\n".join(lines).encode("ascii")).hexdigest()


def answer_rows(answers):
    """Returns each answer as `[id, category, priority]`, the form the record keeps."""
    return [[answer["id"], *(answer[field] for field in FIELDS)] for answer in answers]


def as_answers(recorded):
    """Returns the record's rows as answers with `id`, `category` and `priority`."""
    return [dict(zip(("id", *FIELDS), row)) for row in recorded]


def build_record(bundle_dir, fingerprint, threads):
    """
    Scores every judged set with the bundle.

    Args:
        bundle_dir: The model folder.
        fingerprint: The recorded bundle fingerprint; the scorer refuses any other bundle.
        threads: The most CPU threads the model may use.

    Returns:
        The record (`bundle_fingerprint` and, per set, its file, its digest and the
        answers) and the counts per set for `bundle_v2.json`.
    """
    sets, scored = {}, {}
    for name, file_name in SCORED_FILES.items():
        rows = load(file_name)
        answers = score(bundle_dir, rows, fingerprint, threads)
        sets[name] = {"file": file_name, "rows_sha256": rows_digest(rows), "answers": answer_rows(answers)}
        scored[name] = count(rows, answers)
    return {"bundle_fingerprint": fingerprint, "sets": sets}, scored


def write_record(bundle_dir, fingerprint, threads):
    """Writes the answers record and returns the counts per set."""
    record, scored = build_record(bundle_dir, fingerprint, threads)
    ANSWERS_PATH.write_text(json.dumps(record, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    return scored


def main():
    print("=" * 60)
    print("RECORDING THE BUNDLE'S ANSWERS")
    print("=" * 60)
    # Step 1: leave room for the owner's other work
    print("\n[1/2] Capping this run...")
    limit_cpu()
    # Step 2: score the judged sets and write both records
    print("\n[2/2] Scoring with the bundle...")
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if bundle_fingerprint(BUNDLE) != report["fingerprint"]:
        raise SystemExit("E_MODEL_HASH")
    report["scored"] = write_record(BUNDLE, report["fingerprint"], CPU_THREADS)
    REPORT_PATH.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    for name, counts in report["scored"].items():
        print(f"    {name}: category {counts['category_right']:,} of {counts['n']:,}, priority {counts['priority_right']:,}")
    print(f"\n    Saved: {ANSWERS_PATH}")


if __name__ == "__main__":
    main()
