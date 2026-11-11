"""Tests that the recorded two-model counts keep the promise the design makes about them."""

import json
from pathlib import Path

import pytest

REPORT = Path(__file__).resolve().parents[1] / "reports" / "two_model_practice.json"
SAFETY_COUNTS = ("highRiskMissed", "highUrgentOutLow", "silentCategory", "silentPriority")
ROUNDS = json.loads(REPORT.read_text(encoding="utf-8"))["rounds"]


def test_the_report_holds_every_practice_round():
    assert len(ROUNDS) == 12
    assert len({(record["train"], record["fold"]) for record in ROUNDS}) == 12


@pytest.mark.parametrize("record", ROUNDS, ids=lambda record: f"tune_{record['train']}_fold_{record['fold']}")
def test_no_safety_count_is_higher_with_both_models_than_with_the_gate_alone(record):
    # The site may say "no safety line is worse on any set" only while this holds
    # for every recorded round, not for the totals alone.
    for name in SAFETY_COUNTS:
        assert record["both"][name] <= record["today"][name], name
    # A ticket both models release is one the gate alone releases too.
    assert record["both"]["flagged"] >= record["today"]["flagged"]
    assert record["both"]["tickets"] == record["today"]["tickets"]
