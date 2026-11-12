"""Tests that the recorded 90-day run is whole and that its verdict is the judge's, not typed.

Model History shows this record; a verdict edited by hand, or a run with a missing week,
would put a claim on the page the counts do not support.
"""

import json
from pathlib import Path

from triage_v2.judge_ninety import STREAMS, WEEKS, judge

RECORD = json.loads((Path(__file__).resolve().parents[1] / "reports" / "ninety_day.json").read_text(encoding="utf-8"))


def test_the_record_holds_every_week_of_every_stream():
    assert sorted(RECORD["streams"], key=int) == [str(k) for k in range(STREAMS)]
    for stream in RECORD["streams"].values():
        assert [week["week"] for week in stream["weeks"]] == list(range(WEEKS))
        assert all(len(week["days"]) == 7 for week in stream["weeks"])


def test_the_recorded_verdict_is_what_the_judge_finds_in_the_counts():
    assert RECORD["verdict"] == judge(RECORD)


def test_every_recorded_day_scored_tickets_for_both_models():
    # A day with no tickets reads as 0% right and would drag a window down with no cause.
    for stream in RECORD["streams"].values():
        for week in stream["weeks"]:
            assert all(day[model]["tickets"] > 0 for day in week["days"] for model in ("retrained", "frozen"))
