"""Tests that the recorded two-model counts keep the promise the design makes about them."""

import json
from pathlib import Path

import pytest

REPORTS = Path(__file__).resolve().parents[1] / "reports"
SAFETY_COUNTS = ("highRiskMissed", "highUrgentOutLow", "silentCategory", "silentPriority")
ROUNDS = json.loads((REPORTS / "two_model_practice.json").read_text(encoding="utf-8"))["rounds"]
SETS_REPORT = json.loads((REPORTS / "two_model_sets.json").read_text(encoding="utf-8"))
SETS = SETS_REPORT["sets"]
RECORDS = [(f"tune_{record['train']}_fold_{record['fold']}", record) for record in ROUNDS] + list(SETS.items())


def test_the_practice_report_holds_every_practice_round():
    assert len(ROUNDS) == 12
    assert len({(record["train"], record["fold"]) for record in ROUNDS}) == 12


def test_the_sets_report_holds_the_desk_wording_and_both_hand_written_sets():
    assert set(SETS) == {"desk-only wording", "hand-written (seen)", "hand-written (fresh)"}


def test_the_sets_were_measured_with_the_bundle_that_is_on_record():
    # A count measured with one model and published beside another model's
    # fingerprint would describe a model nobody can check.
    bundle = json.loads((REPORTS / "bundle_v2.json").read_text(encoding="utf-8"))
    assert SETS_REPORT["answer"]["bundle_fingerprint"] == bundle["fingerprint"]


@pytest.mark.parametrize("record", [record for _, record in RECORDS], ids=[name for name, _ in RECORDS])
def test_no_safety_count_is_higher_with_both_models_than_with_the_gate_alone(record):
    # The site may say "no safety line is worse on any set" only while this holds
    # for every recorded round and set, not for the totals alone.
    for name in SAFETY_COUNTS:
        assert record["both"][name] <= record["today"][name], name
    # A ticket both models release is one the gate alone releases too.
    assert record["both"]["flagged"] >= record["today"]["flagged"]
    assert record["both"]["tickets"] == record["today"]["tickets"]
