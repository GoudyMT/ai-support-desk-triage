"""Tests of the fair 90-day run's driver, with stand-ins for training, scoring and the week run.

What they guard: the weeks are dealt from the start model's own ratings and checked for balance
before any model is retrained; no stream retrains while any stream is unbalanced or unchecked;
the balance phase's frozen answers are the ones the weeks phase uses; the first run's paths stay
untouched; and the leftovers of the last review (no shell for the week run, a report written in
one step, no work folder inside the repo).
"""

import json
import subprocess
from pathlib import Path

import pytest

from triage_v2 import ninety_day
from triage_v2.ninety_day import BALANCE_LIMIT, UNBALANCED, WEEKS, WORK_IN_REPO, run_balance, run_stream

TICKETS_PER_DAY = 1000


class FairFakes:
    """Stand-ins whose start model is right `early` per 1,000 tickets on weeks 0-6 and `late` on weeks 7-12."""

    def __init__(self, early=900, late=880):
        self.calls = []
        self.trained = []
        self.early = early
        self.late = late

    def inputs(self, stream):
        return {"start": "s", "weeks": "w", "gate": "g", "pool": "p"}

    def share(self, force):
        self.calls.append("share")
        return 4

    def load(self, name):
        self.calls.append(f"load {name}")
        if name.startswith("v2_tune_"):
            return [{"id": f"t{i}", "maskedText": "x", "category": "Billing", "priority": "Low"} for i in range(3)]
        if name.startswith("v2_fair_pool_"):
            return [{"id": f"p{i}", "maskedText": "x", "category": "Billing", "templates": [f"built-in|plain1|{i % 2}"]} for i in range(4)]
        if name.startswith("v2_fair_weeks_"):
            return [{"id": f"w{w}-{i}", "maskedText": f"week {w}", "week": w, "day": 1 + i % 7} for w in range(WEEKS) for i in range(2)]
        raise AssertionError(f"unexpected file {name}")

    def train(self, rows, bundle_dir):
        self.calls.append(f"train {bundle_dir.name}")
        self.trained.append(sorted(row["id"] for row in rows))
        bundle_dir.mkdir(parents=True, exist_ok=True)
        return f"fp-{len(self.trained)}"

    def score(self, bundle_dir, rows, fingerprint, threads):
        what = rows[0].get("week", "pool")
        self.calls.append(f"score {bundle_dir.name} {what}")
        return [{"id": row["id"], "category": "Billing" if row["id"] != "p1" else "Other", "priority": "Low"} for row in rows]

    def export_weeks(self, stream, difficulty_path):
        self.calls.append(f"export {stream}")
        self.difficulty = json.loads(Path(difficulty_path).read_text(encoding="utf-8"))

    def run_week(self, stream, week, retrained_path, frozen_path, out_path):
        self.calls.append(f"week {week} {Path(retrained_path).name}")
        right = self.early if week < 7 else self.late
        counts = {"tickets": TICKETS_PER_DAY, "categoryRight": right, "highUrgentOutLow": 0, "highRiskMissed": 0}
        days = [{"day": d, "retrained": dict(counts), "frozen": dict(counts)} for d in range(1, 8)]
        checked = [{"id": f"w{week}-0", "maskedText": f"taught {week}", "category": "Billing", "priority": "Low", "day": 1}]
        result = {"week": week, "days": days, "checked": checked}
        Path(out_path).write_text(json.dumps(result), encoding="utf-8")
        return result


def balance(tmp_path, fakes, stream=1):
    return run_balance(stream, fakes, tmp_path / "work", tmp_path / "report.json", {"epochs": 1})


def weeks(tmp_path, fakes, stream=1, max_weeks=None):
    return run_stream(stream, fakes, tmp_path / "work", tmp_path / "report.json", {"epochs": 1}, max_weeks=max_weeks, fair=True)


def balance_all(tmp_path, early=900, late=880):
    for stream in range(4):
        balance(tmp_path, FairFakes(early, late), stream)


def test_the_balance_phase_rates_templates_with_the_start_model_then_deals_and_scores_every_week(tmp_path):
    fakes = FairFakes()
    entry = balance(tmp_path, fakes)
    assert fakes.calls[0] == "share"
    order = [c for c in fakes.calls if c.startswith(("train", "score", "export", "week"))]
    assert order[:3] == ["train stream_1_start", "score stream_1_start pool", "export 1"]
    assert [c for c in order if c.startswith("score")][1:] == [f"score stream_1_start {w}" for w in range(WEEKS)]
    # A template's rating is the start model's share right on its pool tickets.
    # Pool tickets p1 and p3 use template 1; the stand-in start model gets p1 wrong.
    assert fakes.difficulty == {"built-in|plain1|0": {"right": 1.0, "count": 2}, "built-in|plain1|1": {"right": 0.5, "count": 2}}
    # Only the start model is trained in this phase.
    assert [c for c in fakes.calls if c.startswith("train")] == ["train stream_1_start"]
    assert entry["balance"] == {"early": 0.9, "late": 0.88, "gap": 2.0}


def test_the_weeks_phase_refuses_while_any_stream_is_over_the_limit(tmp_path):
    balance_all(tmp_path)
    balance(tmp_path, FairFakes(900, 879), stream=2)
    fakes = FairFakes()
    with pytest.raises(SystemExit) as stopped:
        weeks(tmp_path, fakes)
    assert stopped.value.code == UNBALANCED
    assert not any(c.startswith(("train", "score", "week")) for c in fakes.calls)


def test_the_weeks_phase_refuses_while_a_stream_has_no_balance_yet(tmp_path):
    for stream in (0, 1, 3):
        balance(tmp_path, FairFakes(), stream)
    fakes = FairFakes()
    with pytest.raises(SystemExit) as stopped:
        weeks(tmp_path, fakes)
    assert stopped.value.code == UNBALANCED
    assert not any(c.startswith(("train", "score", "week")) for c in fakes.calls)


def test_the_weeks_phase_goes_on_at_the_limit_and_reuses_the_frozen_answers(tmp_path):
    assert BALANCE_LIMIT == 2.0
    balance_all(tmp_path)
    fakes = FairFakes()
    entry = weeks(tmp_path, fakes)
    assert [w["week"] for w in entry["weeks"]] == list(range(WEEKS))
    # The start model scored every week in the balance phase; as the frozen model it is not
    # asked again. It scores week 0 once more only as that week's retrained model.
    assert [c for c in fakes.calls if c.startswith("score stream_1_start")] == ["score stream_1_start 0"]
    assert "train stream_1_start" not in fakes.calls
    # Each retrain learns from the teaching copies of the checked tickets.
    assert len(fakes.trained) == WEEKS - 1


def test_a_stopped_balance_phase_carries_on_without_scoring_the_pool_again(tmp_path):
    balance(tmp_path, FairFakes())
    again = FairFakes()
    balance(tmp_path, again)
    assert "score stream_1_start pool" not in again.calls
    assert "train stream_1_start" not in again.calls


def test_the_fair_run_keeps_to_its_own_record_and_files():
    assert ninety_day.report_path(fair=True).name == "ninety_day_fair.json"
    assert ninety_day.report_path(fair=False).name == "ninety_day.json"
    assert ninety_day.weeks_name(2, fair=True) == "v2_fair_weeks_2.jsonl"
    assert ninety_day.weeks_name(2, fair=False) == "v2_weeks_2.jsonl"


def test_refuses_a_work_folder_inside_the_repo(tmp_path, monkeypatch):
    # A stand-in repo, so a broken check writes into the test's own folder, never the real repo.
    monkeypatch.setattr(ninety_day, "REPO_DIR", tmp_path / "repo")
    fakes = FairFakes()
    inside = tmp_path / "repo" / "ml" / "work"
    with pytest.raises(SystemExit) as stopped:
        run_balance(1, fakes, inside, tmp_path / "report.json", {"epochs": 1})
    assert stopped.value.code == WORK_IN_REPO
    assert not inside.exists()
    with pytest.raises(SystemExit) as stopped:
        run_stream(1, fakes, inside, tmp_path / "report.json", {"epochs": 1})
    assert stopped.value.code == WORK_IN_REPO


def test_writes_the_report_in_one_step(tmp_path, monkeypatch):
    path = tmp_path / "report.json"
    path.write_text('{"streams": {}}\n', encoding="utf-8")

    def broken_replace(source, target):
        raise OSError("disk full")

    monkeypatch.setattr(ninety_day.os, "replace", broken_replace)
    with pytest.raises(OSError):
        ninety_day.save_report(path, {"streams": {"1": {}}})
    # The old report is whole: the new one was written beside it first.
    assert path.read_text(encoding="utf-8") == '{"streams": {}}\n'


def test_starts_the_week_run_without_a_shell(tmp_path, monkeypatch):
    seen = {}

    def fake_run(args, **kwargs):
        seen["args"] = args
        seen["kwargs"] = kwargs
        Path(args[args.index("--out") + 1]).write_text('{"week": 0, "days": [], "checked": []}', encoding="utf-8")
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(ninety_day.subprocess, "run", fake_run)
    out = tmp_path / "work & 100%" / "result.json"
    out.parent.mkdir()
    ninety_day.LiveDeps({}, fair=True).run_week(1, 0, out.parent / "r.json", out.parent / "f.json", out)
    assert seen["kwargs"].get("shell", False) is False
    assert not str(seen["args"][0]).lower().endswith((".cmd", ".bat"))
    assert str(out) in seen["args"]
    assert any(str(arg).endswith("v2_fair_weeks_1.jsonl") for arg in seen["args"])
