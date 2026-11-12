"""The 90-day run: a sentence model that learns week by week from tickets a person checked.

A stream is one practice fold. It starts from a sentence model trained on the practice pair
that leaves the stream out, so the stream's wording is new to it. Each simulated week brings
tickets built only from that week's templates (`npm run export-weeks`). The week is scored
by the current model and by the frozen start model, run through the word gate and the
two-model rule (`npm run run-week`), and the tickets the current model's path sent to a
person become training rows with the reviewer's answer. Then the model is trained again,
from the base model, on the start rows plus every checked ticket so far.

Run in the training environment with `ml` as the process's working folder (as CI runs the
`triage` modules), one stream at a time, on the owner's yes after a load check:
`python -m triage_v2.ninety_day --stream 0 --work-dir <a folder outside the repo>`
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

WEEKS = 13
KEY_ERROR = "E_KEY_IN_USE"
FOLDS = 4
ML_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = ML_DIR.parent
REPORT_PATH = ML_DIR / "reports" / "ninety_day.json"
GENERATED = ML_DIR / "data" / "generated"


def start_pair(stream):
    """The practice pair whose training file leaves this stream out, low fold first, as the files are named."""
    other = (stream + 1) % FOLDS
    return (stream, other) if stream < other else (other, stream)


def _load_report(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"streams": {}}


def _save_report(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")


def _model(deps, entry, name, rows, work_dir):
    """Returns (folder, fingerprint) of a named model, training it only when it is not on disk yet."""
    folder = work_dir / name
    known = entry["models"].get(name)
    if known is not None and folder.exists():
        return folder, known
    fingerprint = deps.train(rows, folder)
    entry["models"][name] = fingerprint
    return folder, fingerprint


def _training_row(checked):
    return {"id": checked["id"], "maskedText": checked["maskedText"], "category": checked["category"], "priority": checked["priority"]}


def run_stream(stream, deps, work_dir, report_path, settings, max_weeks=None, force=False):
    """
    Runs one stream's weeks, carrying on from the first week not yet recorded.

    Args:
        stream: The practice fold (0 to 3).
        deps: share(force), load(name), train(rows, folder), score(folder, rows, fingerprint, threads)
            and run_week(stream, week, retrained_path, frozen_path, out_path).
        work_dir: Where models, answers and week results go; outside the repo.
        report_path: The run's record.
        settings: The training settings; a carried-on run must use the same.
        max_weeks: The most weeks to run now; all that are left when None.
        force: The owner's override of the busy-machine check.

    Returns:
        The stream's record so far.

    Raises:
        SystemExit: The stream was started with other settings (E_KEY_IN_USE).
    """
    threads = deps.share(force)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    report = _load_report(report_path)
    if report.get("settings", settings) != settings:
        print("    This record was made with other settings. Use another report or the same settings.")
        raise SystemExit(KEY_ERROR)
    report["settings"] = settings
    entry = report["streams"].setdefault(str(stream), {"start_pair": list(start_pair(stream)), "models": {}, "weeks": []})

    a, b = start_pair(stream)
    start_rows = deps.load(f"v2_tune_{a}_{b}.jsonl")
    by_week = {}
    for row in deps.load(f"v2_weeks_{stream}.jsonl"):
        by_week.setdefault(row["week"], []).append(row)

    frozen_dir, frozen_fp = _model(deps, entry, f"stream_{stream}_start", start_rows, work_dir)
    _save_report(report_path, report)
    checked = []
    for done in entry["weeks"]:
        result = json.loads((work_dir / f"stream_{stream}_week_{done['week']}_result.json").read_text(encoding="utf-8"))
        checked.extend(_training_row(c) for c in result["checked"])

    ran = 0
    for week in range(len(entry["weeks"]), WEEKS):
        if max_weeks is not None and ran >= max_weeks:
            break
        if week == 0:
            model_dir, model_fp = frozen_dir, frozen_fp
        else:
            model_dir, model_fp = _model(deps, entry, f"stream_{stream}_after_{week - 1}", start_rows + checked, work_dir)
        rows = by_week[week]
        paths = {}
        for who, folder, fingerprint in (("retrained", model_dir, model_fp), ("frozen", frozen_dir, frozen_fp)):
            paths[who] = work_dir / f"stream_{stream}_week_{week}_{who}.json"
            paths[who].write_text(json.dumps(deps.score(folder, rows, fingerprint, threads)), encoding="utf-8")
        out = work_dir / f"stream_{stream}_week_{week}_result.json"
        result = deps.run_week(stream, week, paths["retrained"], paths["frozen"], out)
        checked.extend(_training_row(c) for c in result["checked"])
        entry["weeks"].append({"week": week, "model_fingerprint": model_fp, "checked": len(result["checked"]), "days": result["days"]})
        _save_report(report_path, report)
        ran += 1
        print(f"    stream {stream} week {week}: {len(rows):,} tickets, {len(result['checked']):,} checked")
    return entry


class LiveDeps:
    """The real training, scoring and week run, behind the same calls the tests stand in for."""

    def __init__(self, settings):
        self.settings = settings

    def share(self, force):
        from triage_v2.share_machine import share_the_machine

        return share_the_machine(force=force)

    def load(self, name):
        with open(GENERATED / name, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def train(self, rows, folder):
        from triage_v2.export_onnx import export
        from triage_v2.share_machine import GPU_REST_RATIO
        from triage_v2.train_sentence import fit

        return export(fit(rows, rest_ratio=GPU_REST_RATIO, **self.settings), folder)["fingerprint"]

    def score(self, folder, rows, fingerprint, threads):
        from triage_v2.score_onnx import score

        return score(folder, rows, fingerprint, threads)

    def run_week(self, stream, week, retrained_path, frozen_path, out_path):
        npm = "npm.cmd" if sys.platform == "win32" else "npm"
        gate = REPO_DIR / "web" / "public" / "models" / f"fold_{stream}.json"
        rows = GENERATED / f"v2_weeks_{stream}.jsonl"
        subprocess.run(
            [npm, "--prefix", str(REPO_DIR / "web"), "run", "run-week", "--", "--rows", str(rows), "--week", str(week),
             "--gate-model", str(gate), "--retrained", str(retrained_path), "--frozen", str(frozen_path), "--out", str(out_path)],
            check=True,
        )
        return json.loads(Path(out_path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--stream", type=int, choices=range(FOLDS), required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--weeks", type=int, help="run at most this many weeks now; a later run carries on")
    parser.add_argument("--force", action="store_true", help="the owner's override: start even when the GPU is busy")
    args = parser.parse_args()
    settings = {}

    print("=" * 60)
    print(f"90-DAY RUN: STREAM {args.stream}")
    print("=" * 60)
    # Step 1: cap this run before anything loads; Step 2: the weeks, each recorded as it ends
    print("\n[1/2] Checking the machine and capping this run...")
    print("\n[2/2] Running the weeks...")
    entry = run_stream(args.stream, LiveDeps(settings), args.work_dir, REPORT_PATH, settings, args.weeks, args.force)
    print(f"    Weeks recorded: {len(entry['weeks'])} of {WEEKS}")
    print(f"    Saved: {REPORT_PATH}")


if __name__ == "__main__":
    main()
