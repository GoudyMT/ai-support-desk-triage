"""Tests that the sentence model in the repo is the one on record and still gives the recorded answers."""

import json
from pathlib import Path

import pytest

from triage_v2.practice_rounds import count
from triage_v2.score_onnx import bundle_fingerprint, score

ML_DIR = Path(__file__).resolve().parents[1]
BUNDLE = ML_DIR / "models" / "bundle_v2"
REPORT = json.loads((ML_DIR / "reports" / "bundle_v2.json").read_text(encoding="utf-8"))
GENERATED = ML_DIR / "data" / "generated"
SCORED_FILES = {"desk": "v2_desk.jsonl", "handwritten": "handwritten.jsonl"}
# The recorded counts were measured on the owner's PC. Another machine's CPU may
# round a close call the other way, so a count may differ from the record by at
# most this share of the set, and never by less than one ticket's room.
CLOSE_MATCH_SHARE = 0.005
THREADS = 4


def test_the_bundle_in_the_repo_is_the_bundle_on_record():
    # Every published number of the second model is this bundle's. A retrained
    # or edited bundle without a new record would publish another model's numbers.
    assert bundle_fingerprint(BUNDLE) == REPORT["fingerprint"]


@pytest.mark.parametrize("name", sorted(SCORED_FILES))
def test_the_bundle_still_gives_its_recorded_answers(name):
    # The export writes these files (`npm run export-data` and `export-v2`); a
    # missing file fails here on purpose, so the check is never skipped.
    with open(GENERATED / SCORED_FILES[name], encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    got = count(rows, score(BUNDLE, rows, REPORT["fingerprint"], THREADS))
    recorded = REPORT["scored"][name]
    assert got["n"] == recorded["n"]
    room = max(1, int(CLOSE_MATCH_SHARE * recorded["n"]))
    for field in ("category_right", "priority_right", "high_urgent_called_low", "must_review_wrong_category"):
        assert abs(got[field] - recorded[field]) <= room, f"{field}: {got[field]} against the recorded {recorded[field]}"
