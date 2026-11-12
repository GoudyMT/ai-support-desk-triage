"""Tests of the 90-day driver, with stand-ins for training, scoring and the week run.

What they guard: a week is always scored by a model that has not been taught that week;
each retrain starts again from the base model on the start rows plus every checked ticket so
far; a stopped run carries on where it stopped and refuses other settings; the machine check
comes before any work.
"""

import json

import pytest

from triage_v2.ninety_day import KEY_ERROR, WEEKS, run_stream


class Fakes:
    def __init__(self, week_rows=3, checked_per_week=2):
        self.calls = []
        self.trained = []
        self.week_rows = week_rows
        self.checked_per_week = checked_per_week

    def share(self, force):
        self.calls.append("share")
        return 4

    def load(self, name):
        self.calls.append(f"load {name}")
        if name.startswith("v2_tune_"):
            return [{"id": f"t{i}", "maskedText": "x", "category": "Billing", "priority": "Low"} for i in range(5)]
        return [{"id": f"w{w}-{i}", "maskedText": f"week {w}", "week": w, "day": 1 + i % 7} for w in range(WEEKS) for i in range(self.week_rows)]

    def train(self, rows, bundle_dir):
        self.calls.append(f"train {bundle_dir.name}")
        self.trained.append(sorted(row["id"] for row in rows))
        bundle_dir.mkdir(parents=True, exist_ok=True)
        return f"fp-{len(self.trained)}"

    def score(self, bundle_dir, rows, fingerprint, threads):
        self.calls.append(f"score {bundle_dir.name} {rows[0]['week']}")
        return [{"id": row["id"], "category": "Billing", "priority": "Low"} for row in rows]

    def run_week(self, stream, week, retrained_path, frozen_path, out_path):
        self.calls.append(f"week {week}")
        checked = [{"id": f"w{week}-{i}", "maskedText": f"week {week}", "category": "Billing", "priority": "Low", "day": 1} for i in range(self.checked_per_week)]
        result = {"week": week, "days": [{"day": 1, "retrained": {}, "frozen": {}}], "checked": checked}
        out_path.write_text(json.dumps(result), encoding="utf-8")
        return result


def run(tmp_path, fakes, settings=None, max_weeks=None):
    return run_stream(1, fakes, tmp_path / "work", tmp_path / "report.json", settings or {"epochs": 1}, max_weeks=max_weeks)


def test_checks_the_machine_before_any_work(tmp_path):
    fakes = Fakes()
    run(tmp_path, fakes, max_weeks=1)
    assert fakes.calls[0] == "share"


def test_scores_each_week_before_learning_from_it(tmp_path):
    fakes = Fakes()
    run(tmp_path, fakes)
    # Week 0 is scored by the start model; week w by the model trained after week w - 1.
    assert fakes.calls.index("score stream_1_start 0") < fakes.calls.index("week 0")
    retrained_scores = [c for c in fakes.calls if c.startswith("score stream_1_after_")]
    assert len(retrained_scores) == WEEKS - 1
    for call in retrained_scores:
        _, bundle, week = call.split()
        assert int(bundle.rsplit("_", 1)[1]) == int(week) - 1
        # Each retrained model is used only after the week it learned from has been run.
        assert fakes.calls.index(f"week {int(week) - 1}") < fakes.calls.index(call)


def test_retrains_from_the_start_rows_plus_every_checked_ticket_so_far(tmp_path):
    fakes = Fakes()
    run(tmp_path, fakes)
    start = [f"t{i}" for i in range(5)]
    # First training is the start model; then one retrain after each of weeks 0 to 11.
    assert len(fakes.trained) == 1 + (WEEKS - 1)
    assert fakes.trained[0] == sorted(start)
    for after_week, rows in enumerate(fakes.trained[1:]):
        expected = start + [f"w{w}-{i}" for w in range(after_week + 1) for i in range(2)]
        assert rows == sorted(expected)


def test_records_every_week_for_the_judge(tmp_path):
    fakes = Fakes()
    run(tmp_path, fakes)
    report = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    weeks = report["streams"]["1"]["weeks"]
    assert [w["week"] for w in weeks] == list(range(WEEKS))
    assert all("days" in w and w["checked"] == 2 for w in weeks)


def test_a_stopped_run_carries_on_at_the_first_missing_week(tmp_path):
    first = Fakes()
    run(tmp_path, first, max_weeks=5)
    second = Fakes()
    run(tmp_path, second)
    assert [c for c in second.calls if c.startswith("week")] == [f"week {w}" for w in range(5, WEEKS)]
    # The start model is reused, not trained again.
    assert "train stream_1_start" not in second.calls
    report = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert [w["week"] for w in report["streams"]["1"]["weeks"]] == list(range(WEEKS))


def test_a_carried_on_run_retrains_on_the_checked_tickets_of_the_earlier_weeks(tmp_path):
    run(tmp_path, Fakes(), max_weeks=3)
    second = Fakes()
    run(tmp_path, second, max_weeks=1)
    # Week 3's model already exists; the next retrain (after week 3) holds weeks 0-3.
    run(tmp_path, second, max_weeks=1)
    assert any(f"w0-0" in rows and "w3-1" in rows for rows in second.trained)


def test_refuses_to_carry_on_with_other_settings(tmp_path):
    run(tmp_path, Fakes(), max_weeks=2)
    with pytest.raises(SystemExit) as stopped:
        run(tmp_path, Fakes(), settings={"epochs": 2})
    assert stopped.value.code == KEY_ERROR
