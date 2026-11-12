"""The 90-day run: a sentence model that learns week by week from tickets a person checked.

A stream is one practice fold. It starts from a sentence model trained on the practice pair
that leaves the stream out, so the stream's wording is new to it. Each simulated week brings
tickets built only from that week's templates (`npm run export-weeks`). The week is scored
by the current model and by the frozen start model, run through the word gate and the
two-model rule (`npm run run-week`), and the tickets the current model's path sent to a
person become training rows with the reviewer's answer. Then the model is trained again,
from the base model, on the start rows plus every checked ticket so far.

The fair run (`--fair`) has two phases. The balance phase trains the start model, rates each
held-out template on a candidate pool, deals the templates into weeks by that rating, and
scores every week with the start model; it records how far apart days 1-30 and 61-90 are for
that model. The weeks phase retrains only once all four streams are within BALANCE_LIMIT. Its
retrained models learn from teaching copies, in which held-out pieces are swapped.

Run in the training environment with `ml` as the process's working folder (as CI runs the
`triage` modules), one stream at a time, on the owner's yes after a load check:
`python -m triage_v2.ninety_day --stream 0 --work-dir <a folder outside the repo>`
`python -m triage_v2.ninety_day --fair --phase balance --stream 0 --work-dir <...>`
"""

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

WEEKS = 13
DAYS_PER_WEEK = 7
KEY_ERROR = "E_KEY_IN_USE"
MODEL_GONE = "E_MODEL_GONE"
UNBALANCED = "E_WEEKS_UNBALANCED"
WORK_IN_REPO = "E_WORK_IN_REPO"
FOLDS = 4
# The most the start model's department share may differ between days 1-30 and days
# 61-90, in points, for the weeks to count as equally hard (fair run design, section 2).
BALANCE_LIMIT = 2.0
EARLY = range(1, 31)
LATE = range(61, 91)
ML_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = ML_DIR.parent
REPORT_PATH = ML_DIR / "reports" / "ninety_day.json"
FAIR_REPORT_PATH = ML_DIR / "reports" / "ninety_day_fair.json"
GENERATED = ML_DIR / "data" / "generated"
TSX_CLI = REPO_DIR / "web" / "node_modules" / "tsx" / "dist" / "cli.mjs"


def report_path(fair):
    """The run's record: the fair run keeps its own, so the first run's stays as it was."""
    return FAIR_REPORT_PATH if fair else REPORT_PATH


def weeks_name(stream, fair):
    """The week tickets of a stream."""
    return f"v2_fair_weeks_{stream}.jsonl" if fair else f"v2_weeks_{stream}.jsonl"


def start_pair(stream):
    """The practice pair whose training file leaves this stream out, low fold first, as the files are named."""
    other = (stream + 1) % FOLDS
    return (stream, other) if stream < other else (other, stream)


def _load_report(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"streams": {}}


def save_report(path, report):
    """Writes the record beside its old copy, then swaps it in, so a failed write never leaves half a record."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def _refuse_work_in_repo(work_dir):
    # Models and answers are large and are never committed; a work folder in the repo
    # could be staged by accident.
    resolved = Path(work_dir).resolve()
    if resolved == REPO_DIR or REPO_DIR in resolved.parents:
        print("    The work folder is inside the repo. Use a folder outside it.")
        raise SystemExit(WORK_IN_REPO)


def _model(deps, entry, name, rows, work_dir):
    """Returns (folder, fingerprint) of a named model, training it only when it is not on disk yet."""
    folder = work_dir / name
    known = entry["models"].get(name)
    if known is not None:
        if not folder.exists():
            # Training again gives a different model under the same name; the weeks already
            # recorded would then have been judged against another model than the ones to come.
            print(f"    {name} is in the record but not in the work folder. Restore it, or start a new record.")
            raise SystemExit(MODEL_GONE)
        return folder, known
    fingerprint = deps.train(rows, folder)
    entry["models"][name] = fingerprint
    return folder, fingerprint


def _training_row(checked):
    return {"id": checked["id"], "maskedText": checked["maskedText"], "category": checked["category"], "priority": checked["priority"]}


def _open_stream(stream, deps, work_dir, path, settings, force):
    """Checks the machine and the record; returns (threads, work folder, report, the stream's entry)."""
    threads = deps.share(force)
    _refuse_work_in_repo(work_dir)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    report = _load_report(path)
    if report.get("settings", settings) != settings:
        print("    This record was made with other settings. Use another report or the same settings.")
        raise SystemExit(KEY_ERROR)
    report["settings"] = settings
    entry = report["streams"].setdefault(str(stream), {"start_pair": list(start_pair(stream)), "models": {}, "weeks": []})
    return threads, work_dir, report, entry


def _check_inputs(deps, entry, stream):
    inputs = deps.inputs(stream)
    if entry.setdefault("inputs", inputs) != inputs:
        print("    The week tickets, the start set or the gate changed since this stream began. Use another report.")
        raise SystemExit(KEY_ERROR)


def _frozen_share(results, days):
    """The start model's department share on the given day numbers, from the week results."""
    tickets = right = 0
    for result in results:
        for day in result["days"]:
            if result["week"] * DAYS_PER_WEEK + day["day"] in days:
                tickets += day["frozen"]["tickets"]
                right += day["frozen"]["categoryRight"]
    return right / tickets if tickets else 0.0


def run_balance(stream, deps, work_dir, path, settings, force=False):
    """
    The fair run's first phase for one stream: rate, deal, and check that the weeks are equal.

    Args:
        stream: The practice fold (0 to 3).
        deps: As for run_stream, plus export_weeks(stream, difficulty_path).
        work_dir: Where models, answers and week results go; outside the repo.
        path: The fair run's record.
        settings: The training settings; a carried-on run must use the same.
        force: The owner's override of the busy-machine check.

    Returns:
        The stream's record, with "balance": {"early", "late", "gap"} (gap in points).

    Raises:
        SystemExit: E_WORK_IN_REPO, E_KEY_IN_USE or E_MODEL_GONE, as for run_stream.
    """
    from triage_v2.template_difficulty import template_difficulty

    threads, work_dir, report, entry = _open_stream(stream, deps, work_dir, path, settings, force)
    a, b = start_pair(stream)
    frozen_dir, frozen_fp = _model(deps, entry, f"stream_{stream}_start", deps.load(f"v2_tune_{a}_{b}.jsonl"), work_dir)
    save_report(path, report)
    pool_answers = work_dir / f"stream_{stream}_pool_answers.json"
    if not pool_answers.exists():
        pool_answers.write_text(json.dumps(deps.score(frozen_dir, deps.load(f"v2_fair_pool_{stream}.jsonl"), frozen_fp, threads)), encoding="utf-8")
    difficulty = template_difficulty(deps.load(f"v2_fair_pool_{stream}.jsonl"), json.loads(pool_answers.read_text(encoding="utf-8")))
    difficulty_path = work_dir / f"fair_difficulty_{stream}.json"
    difficulty_path.write_text(json.dumps(difficulty, indent=1), encoding="utf-8")
    deps.export_weeks(stream, difficulty_path)
    _check_inputs(deps, entry, stream)

    by_week = {}
    for row in deps.load(weeks_name(stream, fair=True)):
        by_week.setdefault(row["week"], []).append(row)
    results = []
    for week in range(WEEKS):
        frozen_path = work_dir / f"stream_{stream}_week_{week}_frozen.json"
        frozen_path.write_text(json.dumps(deps.score(frozen_dir, by_week[week], frozen_fp, threads)), encoding="utf-8")
        # Both paths are the start model here: only its own counts are read.
        results.append(deps.run_week(stream, week, frozen_path, frozen_path, work_dir / f"stream_{stream}_week_{week}_balance.json"))
    early, late = _frozen_share(results, EARLY), _frozen_share(results, LATE)
    entry["balance"] = {"early": early, "late": late, "gap": round(abs(early - late) * 100, 6)}
    save_report(path, report)
    return entry


def _refuse_unbalanced(report):
    gaps = [report["streams"].get(str(stream), {}).get("balance", {}).get("gap") for stream in range(FOLDS)]
    if any(gap is None or gap > BALANCE_LIMIT for gap in gaps):
        print(f"    Balance gaps (points): {gaps}; the limit is {BALANCE_LIMIT}. No stream retrains.")
        raise SystemExit(UNBALANCED)


def run_stream(stream, deps, work_dir, path, settings, max_weeks=None, force=False, fair=False):
    """
    Runs one stream's weeks, carrying on from the first week not yet recorded.

    Args:
        stream: The practice fold (0 to 3).
        deps: share(force), inputs(stream), load(name), train(rows, folder),
            score(folder, rows, fingerprint, threads) and
            run_week(stream, week, retrained_path, frozen_path, out_path).
        work_dir: Where models, answers and week results go; outside the repo.
        path: The run's record.
        settings: The training settings; a carried-on run must use the same.
        max_weeks: The most weeks to run now; all that are left when None.
        force: The owner's override of the busy-machine check.
        fair: The fair run's weeks phase: refuses until every stream's balance is
            recorded and within the limit, and reuses the balance phase's frozen answers.

    Returns:
        The stream's record so far.

    Raises:
        SystemExit: The work folder is in the repo (E_WORK_IN_REPO); the stream was started
            with other settings or inputs (E_KEY_IN_USE); a recorded model is missing from the
            work folder (E_MODEL_GONE); a stream is unbalanced or unchecked (E_WEEKS_UNBALANCED).
    """
    threads, work_dir, report, entry = _open_stream(stream, deps, work_dir, path, settings, force)
    if fair:
        _refuse_unbalanced(report)
    _check_inputs(deps, entry, stream)

    a, b = start_pair(stream)
    start_rows = deps.load(f"v2_tune_{a}_{b}.jsonl")
    by_week = {}
    for row in deps.load(weeks_name(stream, fair)):
        by_week.setdefault(row["week"], []).append(row)

    frozen_dir, frozen_fp = _model(deps, entry, f"stream_{stream}_start", start_rows, work_dir)
    save_report(path, report)
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
            # The fair run's balance phase already scored every week with the start model.
            if fair and who == "frozen" and paths[who].exists():
                continue
            paths[who].write_text(json.dumps(deps.score(folder, rows, fingerprint, threads)), encoding="utf-8")
        out = work_dir / f"stream_{stream}_week_{week}_result.json"
        result = deps.run_week(stream, week, paths["retrained"], paths["frozen"], out)
        checked.extend(_training_row(c) for c in result["checked"])
        entry["weeks"].append({"week": week, "model_fingerprint": model_fp, "checked": len(result["checked"]), "days": result["days"]})
        save_report(path, report)
        ran += 1
        print(f"    stream {stream} week {week}: {len(rows):,} tickets, {len(result['checked']):,} checked")
    return entry


class LiveDeps:
    """The real training, scoring and week run, behind the same calls the tests stand in for."""

    def __init__(self, settings, fair=False):
        self.settings = settings
        self.fair = fair

    def share(self, force):
        from triage_v2.share_machine import share_the_machine

        return share_the_machine(force=force)

    def inputs(self, stream):
        import hashlib

        a, b = start_pair(stream)
        files = {
            "start": GENERATED / f"v2_tune_{a}_{b}.jsonl",
            "weeks": GENERATED / weeks_name(stream, self.fair),
            "gate": REPO_DIR / "web" / "public" / "models" / f"fold_{stream}.json",
        }
        if self.fair:
            files["pool"] = GENERATED / f"v2_fair_pool_{stream}.jsonl"
        return {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in files.items()}

    def load(self, name):
        with open(GENERATED / name, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def train(self, rows, folder):
        from triage_v2.export_onnx import export
        from triage_v2.share_machine import GPU_REST_RATIO
        from triage_v2.train_sentence import fit

        settings = {**self.settings, "fields": tuple(self.settings["fields"])}
        return export(fit(rows, rest_ratio=GPU_REST_RATIO, **settings), folder)["fingerprint"]

    def score(self, folder, rows, fingerprint, threads):
        from triage_v2.score_onnx import score

        return score(folder, rows, fingerprint, threads)

    def _tsx(self, script, *args):
        # Node runs tsx directly, with the arguments as a list: no shell reads a path, so a
        # work folder holding "&" or "%" is passed as it is.
        node = shutil.which("node") or "node"
        subprocess.run([node, str(TSX_CLI), str(REPO_DIR / "web" / "scripts" / script), *[str(arg) for arg in args]], check=True, cwd=REPO_DIR / "web")

    def export_weeks(self, stream, difficulty_path):
        self._tsx("exportWeeks.ts", "--fair", "--stream", stream, "--difficulty", difficulty_path)

    def run_week(self, stream, week, retrained_path, frozen_path, out_path):
        gate = REPO_DIR / "web" / "public" / "models" / f"fold_{stream}.json"
        rows = GENERATED / weeks_name(stream, self.fair)
        self._tsx("runWeek.ts", "--rows", rows, "--week", week, "--gate-model", gate, "--retrained", retrained_path, "--frozen", frozen_path, "--out", out_path)
        return json.loads(Path(out_path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--stream", type=int, choices=range(FOLDS), required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--weeks", type=int, help="run at most this many weeks now; a later run carries on")
    parser.add_argument("--force", action="store_true", help="the owner's override: start even when the GPU is busy")
    parser.add_argument("--fair", action="store_true", help="the fair run: its own weeks, teaching copies and record")
    parser.add_argument("--phase", choices=("balance", "weeks"), default="weeks", help="fair run only")
    args = parser.parse_args()
    from triage_v2 import train_sentence as ts

    # The values that train every model of the run, recorded so a carried-on run cannot mix two.
    settings = {"fields": list(ts.FIELDS), "epochs": ts.EPOCHS, "learning_rate": ts.LEARNING_RATE, "batch_size": ts.BATCH_SIZE, "max_length": ts.MAX_LENGTH}
    path = report_path(args.fair)
    deps = LiveDeps(settings, fair=args.fair)

    print("=" * 60)
    print(f"90-DAY RUN{' (FAIR)' if args.fair else ''}: STREAM {args.stream}")
    print("=" * 60)
    # Step 1: cap this run before anything loads; Step 2: the phase, each step recorded as it ends
    print("\n[1/2] Checking the machine and capping this run...")
    if args.fair and args.phase == "balance":
        print("\n[2/2] Rating templates, dealing the weeks, checking their balance...")
        entry = run_balance(args.stream, deps, args.work_dir, path, settings, args.force)
        balance = entry["balance"]
        print(f"    Start model, days 1-30: {balance['early']:.4f}  days 61-90: {balance['late']:.4f}  gap: {balance['gap']:.2f} points (limit {BALANCE_LIMIT})")
    else:
        print("\n[2/2] Running the weeks...")
        entry = run_stream(args.stream, deps, args.work_dir, path, settings, args.weeks, args.force, args.fair)
        print(f"    Weeks recorded: {len(entry['weeks'])} of {WEEKS}")
    print(f"    Saved: {path}")


if __name__ == "__main__":
    main()
