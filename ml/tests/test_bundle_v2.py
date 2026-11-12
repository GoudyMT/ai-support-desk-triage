"""Tests that the sentence model in the repo is the one on record and still gives the recorded answers."""

import json
from pathlib import Path

import pytest

from triage_v2.bundle_answers import SCORED_FILES, answer_rows, as_answers, rows_digest
from triage_v2.practice_rounds import count
from triage_v2.score_onnx import bundle_fingerprint, score

ML_DIR = Path(__file__).resolve().parents[1]
BUNDLE = ML_DIR / "models" / "bundle_v2"
REPORT = json.loads((ML_DIR / "reports" / "bundle_v2.json").read_text(encoding="utf-8"))
RECORD = json.loads((ML_DIR / "reports" / "bundle_v2_answers.json").read_text(encoding="utf-8"))
GENERATED = ML_DIR / "data" / "generated"
# How many tickets of a set another machine may answer differently from the
# record, which was made on the owner's PC. The model file holds 8-bit weights,
# and CPUs round them differently: CI's Linux machine gave another answer on 13
# of the 4,000 desk-only tickets, all of them close calls between two classes,
# and on none of either hand-written set (measured 2026-11-11). The owner set
# the limit at 0.5% of the desk-only set and one ticket on each small set. Every
# published count is worked out from the recorded answers, never from the
# machine that runs this test, so this room moves no published number.
ANSWERS_MAY_DIFFER = {"desk": 20, "handwritten": 1, "fresh": 1}
THREADS = 4


def load_set(name):
    """Reads a judged set. The export writes these files; a missing one fails on purpose."""
    with open(GENERATED / SCORED_FILES[name], encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def test_the_bundle_in_the_repo_is_the_bundle_on_record():
    # Every published number of the second model is this bundle's. A retrained
    # or edited bundle without a new record would publish another model's numbers.
    assert bundle_fingerprint(BUNDLE) == REPORT["fingerprint"]
    assert RECORD["bundle_fingerprint"] == REPORT["fingerprint"]


def test_the_record_holds_every_judged_set():
    assert set(RECORD["sets"]) == set(SCORED_FILES) == set(REPORT["scored"])


@pytest.mark.parametrize("name", sorted(SCORED_FILES))
def test_the_judged_tickets_are_the_ones_the_record_was_made_on(name):
    # The generated files are written again on every machine. A generator edit
    # that kept the ticket count would otherwise change the set under the record.
    assert rows_digest(load_set(name)) == RECORD["sets"][name]["rows_sha256"]


@pytest.mark.parametrize("name", sorted(SCORED_FILES))
def test_the_bundle_still_gives_its_recorded_answer_for_every_ticket(name):
    rows = load_set(name)
    got = answer_rows(score(BUNDLE, rows, REPORT["fingerprint"], THREADS))
    recorded = RECORD["sets"][name]["answers"]
    assert len(got) == len(recorded)
    differing = [new[0] for new, old in zip(got, recorded) if new != old]
    assert len(differing) <= ANSWERS_MAY_DIFFER[name], f"{len(differing)} tickets answered differently: {differing}"


@pytest.mark.parametrize("name", sorted(SCORED_FILES))
def test_the_recorded_counts_are_the_counts_of_the_recorded_answers(name):
    # The report's numbers are quoted in the docs; they must be these answers'.
    assert REPORT["scored"][name] == count(load_set(name), as_answers(RECORD["sets"][name]["answers"]))


def test_a_ticket_file_with_one_changed_label_has_another_digest():
    rows = load_set("handwritten")
    changed = [dict(rows[0], mustReview=not rows[0]["mustReview"]), *rows[1:]]
    assert rows_digest(changed) != rows_digest(rows)
    assert rows_digest(list(reversed(rows))) != rows_digest(rows)
