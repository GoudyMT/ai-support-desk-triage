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


def test_the_hard_lines_held_against_the_frozen_model_on_every_stream():
    assert all(stream["hard_lines_held"] for stream in RECORD["verdict"]["streams"])
