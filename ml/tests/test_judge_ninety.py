"""Tests of the 90-day pass mark, written before the run it judges.

The mark (design 2026-11-12, section 4): in days 61-90 the retrained model is right on
department more often than the frozen start model on the same tickets, on at least 3 of 4
streams; its own days 61-90 beat its days 1-30 on at least 3 of 4 streams; and neither
hard line, counted over days 1-90, is above the frozen model's on any stream.
"""

import copy

from triage_v2.judge_ninety import judge

WEEKS = 13
FIELDS = ("tickets", "toPerson", "categoryRight", "priorityRight", "highUrgentOutLow", "highRiskMissed", "silentCategory", "silentPriority")


def model_day(right, tickets=100, high_low=0, risk_missed=0):
    day = dict.fromkeys(FIELDS, 0)
    day.update(tickets=tickets, categoryRight=right, highUrgentOutLow=high_low, highRiskMissed=risk_missed)
    return day


def stream(early, late, frozen):
    """A stream whose retrained model is right `early` times a day in days 1-30 and `late` after; frozen is flat."""
    weeks = []
    for week in range(WEEKS):
        days = []
        for day in range(1, 8):
            number = week * 7 + day
            retrained = early if number <= 30 else late
            days.append({"day": day, "retrained": model_day(retrained), "frozen": model_day(frozen)})
        weeks.append({"week": week, "days": days})
    return {"weeks": weeks}


def report(*streams):
    return {"streams": {str(k): s for k, s in enumerate(streams)}}


GROWING = stream(early=70, late=80, frozen=72)
FLAT = stream(early=75, late=75, frozen=76)


def test_passes_when_three_of_four_streams_grow_past_the_frozen_model():
    verdict = judge(report(GROWING, GROWING, GROWING, FLAT))
    assert verdict["passed"] is True
    assert [s["beats_frozen"] for s in verdict["streams"]] == [True, True, True, False]


def test_fails_when_only_two_streams_grow():
    assert judge(report(GROWING, GROWING, FLAT, FLAT))["passed"] is False


def test_fails_when_late_days_beat_frozen_but_not_the_early_days():
    # Better than frozen late on, but no better than its own start: no growth.
    steady = stream(early=80, late=80, frozen=70)
    verdict = judge(report(steady, steady, steady, steady))
    assert [s["beats_frozen"] for s in verdict["streams"]] == [True] * 4
    assert verdict["passed"] is False


def test_fails_when_one_stream_lets_more_high_tickets_out_as_low_than_frozen():
    worse = copy.deepcopy(GROWING)
    worse["weeks"][5]["days"][2]["retrained"]["highUrgentOutLow"] = 1
    verdict = judge(report(GROWING, GROWING, GROWING, worse))
    assert verdict["passed"] is False
    assert verdict["streams"][3]["hard_lines_held"] is False


def test_fails_when_one_stream_misses_more_high_risk_tickets_than_frozen():
    worse = copy.deepcopy(GROWING)
    worse["weeks"][0]["days"][0]["retrained"]["highRiskMissed"] = 2
    worse["weeks"][0]["days"][0]["frozen"]["highRiskMissed"] = 1
    assert judge(report(worse, GROWING, GROWING, GROWING))["passed"] is False


def test_counts_hard_lines_over_days_1_to_90_only():
    # Day 91 lies outside the 90 days the mark names.
    late = copy.deepcopy(GROWING)
    late["weeks"][12]["days"][6]["retrained"]["highUrgentOutLow"] = 5
    assert judge(report(late, GROWING, GROWING, GROWING))["passed"] is True


def test_an_unfinished_run_never_passes():
    short = copy.deepcopy(GROWING)
    short["weeks"] = short["weeks"][:12]
    verdict = judge(report(GROWING, GROWING, GROWING, short))
    assert verdict["passed"] is False
    assert verdict["complete"] is False
    assert judge(report(GROWING, GROWING, GROWING))["passed"] is False
