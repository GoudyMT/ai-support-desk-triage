"""Tests that the recorded fair 90-day run is whole, balanced and judged by the code, not typed.

Model History will show this record beside the first run's; a verdict edited by hand, a stream
whose weeks were never checked for balance, or a balance figure the counts do not support would
put a claim on the page that the run does not back.
"""

import json
from pathlib import Path

import pytest

from triage_v2.judge_ninety import STREAMS, WEEKS, judge, record_verdict
from triage_v2.ninety_day import BALANCE_LIMIT, EARLY, LATE

REPORTS = Path(__file__).resolve().parents[1] / "reports"
RECORD = json.loads((REPORTS / "ninety_day_fair.json").read_text(encoding="utf-8"))


def test_the_record_holds_every_week_of_every_stream():
    assert sorted(RECORD["streams"], key=int) == [str(k) for k in range(STREAMS)]
    for stream in RECORD["streams"].values():
        assert [week["week"] for week in stream["weeks"]] == list(range(WEEKS))
        assert all(len(week["days"]) == 7 for week in stream["weeks"])


def test_each_week_was_scored_by_the_model_trained_before_it():
    for key, stream in RECORD["streams"].items():
        for week in stream["weeks"]:
            name = f"stream_{key}_start" if week["week"] == 0 else f"stream_{key}_after_{week['week'] - 1}"
            assert week["model_fingerprint"] == stream["models"][name]


def test_every_stream_was_balanced_before_it_retrained_and_its_order_is_a_full_calendar():
    for stream in RECORD["streams"].values():
        assert stream["balance"]["gap"] <= BALANCE_LIMIT
        assert sorted(stream["week_order"]) == list(range(WEEKS))


def test_the_recorded_balance_is_what_the_frozen_counts_show():
    # The frozen model's day counts in the weeks are the ones the balance check read.
    for stream in RECORD["streams"].values():
        def share(days):
            pairs = [(day["frozen"]["categoryRight"], day["frozen"]["tickets"]) for week in stream["weeks"] for day in week["days"] if week["week"] * 7 + day["day"] in days]
            return sum(right for right, _ in pairs) / sum(tickets for _, tickets in pairs)

        assert share(EARLY) == pytest.approx(stream["balance"]["early"], abs=1e-12)
        assert share(LATE) == pytest.approx(stream["balance"]["late"], abs=1e-12)


def test_the_recorded_verdict_is_what_the_judge_finds_in_the_counts():
    assert RECORD["verdict"] == judge(RECORD)


def test_recording_a_verdict_writes_only_the_record_named(tmp_path):
    first = tmp_path / "first.json"
    fair = tmp_path / "fair.json"
    first.write_text(json.dumps({"streams": {}}), encoding="utf-8")
    fair.write_text(json.dumps({"streams": {}}), encoding="utf-8")
    record_verdict(fair, "a note")
    assert json.loads(first.read_text(encoding="utf-8")) == {"streams": {}}
    written = json.loads(fair.read_text(encoding="utf-8"))
    assert written["verdict"] == judge({"streams": {}}) and written["note"] == "a note"
