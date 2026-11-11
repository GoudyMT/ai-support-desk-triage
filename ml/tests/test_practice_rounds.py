"""Tests of the counts every practice record and bundle record is built from, and of a run's name."""

import json

import pytest

from triage_v2 import practice_rounds
from triage_v2.practice_rounds import KEY_ERROR, count, run_rounds


def ticket(category, priority, must_review=False):
    return {"category": category, "priority": priority, "mustReview": must_review}


def answer(category, priority):
    return {"category": category, "priority": priority}


def test_the_counts_name_the_two_mistakes_that_matter_and_nothing_else():
    # One row per case the counts tell apart. The reports compare these counts
    # with each other, so a wrong rule here would be wrong on both sides and
    # no comparison would show it.
    rows = [
        ticket("Billing", "High"),                       # called Low: a High ticket sent down
        ticket("Billing", "Urgent"),                     # called High: still the high side
        ticket("Billing", "Low"),                        # called Urgent: sent up, not counted
        ticket("Security Concern", "Urgent", True),      # wrong department on a must-see ticket
        ticket("Security Concern", "Urgent", True),      # right department, called Medium
        ticket("Other", "Medium"),                       # wrong department on an ordinary ticket
    ]
    answers = [
        answer("Billing", "Low"),
        answer("Billing", "High"),
        answer("Billing", "Urgent"),
        answer("Account Access", "Urgent"),
        answer("Security Concern", "Medium"),
        answer("Billing", "Medium"),
    ]
    assert count(rows, answers) == {
        "n": 6,
        "category_right": 4,
        "priority_right": 2,
        "high_urgent_called_low": 2,
        "must_review_wrong_category": 1,
    }


def test_a_run_name_already_used_with_other_settings_is_refused_before_anything_is_trained(tmp_path, monkeypatch):
    # A second run under the same name with other settings used to drop the
    # first run's recorded rounds at its first save.
    report = tmp_path / "practice.json"
    earlier = {"model": "word", "data": "v2", "settings": {"epochs": 3}, "rounds": [{"train": "0_1", "fold": 0}]}
    report.write_text(json.dumps({"runs": {"mine": earlier}}), encoding="utf-8")
    monkeypatch.setattr(practice_rounds, "REPORT_PATH", report)
    monkeypatch.setattr(practice_rounds, "load", lambda name: pytest.fail("a refused run must not read any tickets"))
    with pytest.raises(SystemExit) as stop:
        run_rounds("v2", "word", tmp_path, {}, 1, "mine")
    assert stop.value.code == KEY_ERROR
    assert json.loads(report.read_text(encoding="utf-8"))["runs"]["mine"] == earlier
