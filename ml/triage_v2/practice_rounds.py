"""Running the twelve practice rounds and recording their counts.

A practice round trains on a tuning file that leaves two folds of wording out, then scores
each of those two folds. The folds were read many times while the first model was chosen,
so these counts guide choices and judge nothing; the blind set judges.

Run from the project root in the training environment, for example:
`python -m triage_v2.practice_rounds --data v2 --model sentence --work-dir <a folder outside the repo>`
"""

import argparse
import json
import time
from pathlib import Path

from threadpoolctl import threadpool_limits

from triage.train import LABEL_FIELDS, fit_pipeline
from triage_v2.score_onnx import score
from triage_v2.share_machine import GPU_MEMORY_SHARE, GPU_REST_RATIO, share_the_machine

ML_DIR = Path(__file__).resolve().parents[1]
GENERATED = ML_DIR / "data" / "generated"
REPORT_PATH = ML_DIR / "reports" / "practice_v2.json"
FOLD_PAIRS = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
# The file names of the first model's data and of the second's.
DATA_NAMES = {"v1": ("tune_{a}_{b}.jsonl", "heldout_{fold}.jsonl"), "v2": ("v2_tune_{a}_{b}.jsonl", "v2_heldout_{fold}.jsonl")}
CONTROL_TRAIN, CONTROL_HELDOUT, CONTROL_EXPECTED = "train_0.jsonl", "heldout_0.jsonl", 2325
KEY_ERROR = "E_KEY_IN_USE"
LOW_SIDE = {"Low", "Medium"}
HIGH_SIDE = {"High", "Urgent"}


def load(name):
    """Reads one generated jsonl file as a list of rows."""
    with open(GENERATED / name, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def count(rows, answers):
    """
    Counts what a model's raw answers got right and the two mistakes that matter most.

    These are the model's answers alone, before any rule or review step: a
    High/Urgent ticket called Low or Medium here may still be caught later.

    Args:
        rows: The scored tickets with their true labels.
        answers: One answer per row, in order, with `category` and `priority`.

    Returns:
        A dict of counts.
    """
    pairs = list(zip(rows, answers))
    return {
        "n": len(rows),
        "category_right": sum(a["category"] == r["category"] for r, a in pairs),
        "priority_right": sum(a["priority"] == r["priority"] for r, a in pairs),
        "high_urgent_called_low": sum(r["priority"] in HIGH_SIDE and a["priority"] in LOW_SIDE for r, a in pairs),
        "must_review_wrong_category": sum(r["mustReview"] and a["category"] != r["category"] for r, a in pairs),
    }


def fit_word_models(train_rows):
    """Fits the first model's recipe, one model per field, on train_rows."""
    texts = [row["maskedText"] for row in train_rows]
    return {field: fit_pipeline(texts, [row[field] for row in train_rows]) for field in LABEL_FIELDS}


def word_answers(models, rows):
    """
    Answers rows with fitted word models, in the same shape the bundle scorer returns.

    Args:
        models: The dict fit_word_models returns.
        rows: Tickets with `id` and `maskedText`.

    Returns:
        One answer per row with `id`, `category`, `priority` and each field's probabilities.
    """
    scored = [row["maskedText"] for row in rows]
    answers = [{"id": row["id"]} for row in rows]
    for field, model in models.items():
        classes = list(model.classes_)
        for answer, probs in zip(answers, model.predict_proba(scored)):
            answer[field] = classes[int(probs.argmax())]
            answer[f"{field}_probs"] = {name: float(value) for name, value in zip(classes, probs)}
    return answers


def run_control():
    """Stops the run unless the first model's recipe reproduces its recorded fold 0 count."""
    train_rows, heldout = load(CONTROL_TRAIN), load(CONTROL_HELDOUT)
    got = count(heldout, word_answers(fit_word_models(train_rows), heldout))["category_right"]
    print(f"    Control: {got:,} of {len(heldout):,} (expected {CONTROL_EXPECTED:,})")
    if got != CONTROL_EXPECTED:
        raise SystemExit("E_CONTROL_FAILED")


def run_rounds(data, model_kind, work_dir, settings, threads, key, max_pairs=None):
    """
    Runs the twelve rounds for one kind of model on one data set.

    The report is written after every pair of rounds, so a run that is stopped
    keeps what it finished, and a later run of the same key carries on from there.

    Args:
        data: "v1" or "v2".
        model_kind: "word" or "sentence".
        work_dir: Where sentence bundles and answer files go; outside the repo.
        settings: Keyword arguments for train_sentence.fit; ignored for "word".
        threads: The most CPU threads scoring may use.
        key: The run's name in the report.
        max_pairs: The most tuning files to train on in this run; all six when None.

    Returns:
        The round records so far: twelve once every pair has run.

    Raises:
        SystemExit: The name is already used by a run with other settings (E_KEY_IN_USE).
    """
    tune_name, heldout_name = DATA_NAMES[data]
    entry = {"model": model_kind, "data": data, "settings": settings, "rounds": []}
    earlier = load_report()["runs"].get(key)
    if earlier is not None:
        # A run carries on only from a record made with the same model, data and
        # settings. Any other record under this name would be written over.
        if {k: earlier.get(k) for k in ("model", "data", "settings")} != {k: entry[k] for k in ("model", "data", "settings")}:
            print(f"    The name {key} is already used by a run with other settings. Pick another --key.")
            raise SystemExit(KEY_ERROR)
        entry["rounds"] = earlier["rounds"]
    rounds = entry["rounds"]
    trained = 0
    for a, b in FOLD_PAIRS:
        if any(record["train"] == f"{a}_{b}" for record in rounds):
            print(f"    tune {a}_{b}: already recorded, kept")
            continue
        if max_pairs is not None and trained >= max_pairs:
            print(f"    tune {a}_{b}: left for a later run")
            continue
        trained += 1
        train_rows = load(tune_name.format(a=a, b=b))
        heldout = {fold: load(heldout_name.format(fold=fold)) for fold in (a, b)}
        started = time.perf_counter()
        if model_kind == "sentence":
            from triage_v2.export_onnx import export
            from triage_v2.train_sentence import fit

            bundle = Path(work_dir) / f"{key}_tune_{a}_{b}"
            exported = export(fit(train_rows, rest_ratio=GPU_REST_RATIO, **settings), bundle)
            answers = {fold: score(bundle, rows, exported["fingerprint"], threads) for fold, rows in heldout.items()}
        else:
            models = fit_word_models(train_rows)
            answers = {fold: word_answers(models, rows) for fold, rows in heldout.items()}
        # Kept beside the bundles so the rules and the review step can be measured on these answers.
        for fold, fold_answers in answers.items():
            target = Path(work_dir) / f"{key}_tune_{a}_{b}_answers_fold_{fold}.json"
            target.write_text(json.dumps(fold_answers), encoding="utf-8")
        seconds = time.perf_counter() - started
        for fold, rows in heldout.items():
            record = {"train": f"{a}_{b}", "fold": fold, "seconds_for_the_pair": round(seconds, 1), **count(rows, answers[fold])}
            rounds.append(record)
            print(f"    tune {a}_{b} -> fold {fold}: category {record['category_right']:,} of {record['n']:,}, "
                  f"priority {record['priority_right']:,}, high/urgent called low {record['high_urgent_called_low']:,}")
        save(key, entry)
    return rounds


def load_report():
    """Returns the report file's content, or an empty report when there is none yet."""
    return json.loads(REPORT_PATH.read_text(encoding="utf-8")) if REPORT_PATH.exists() else {"runs": {}}


def save(key, entry):
    """Writes one run's record under its key, keeping every other run in the file."""
    report = load_report()
    report["runs"][key] = entry
    REPORT_PATH.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--data", choices=sorted(DATA_NAMES), required=True)
    parser.add_argument("--model", choices=["word", "sentence"], required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--key", help="name of this run in the report; default <model>_<data>")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--learning-rate", type=float)
    parser.add_argument("--fields", help="comma-separated answers to train a head for; default category,priority")
    parser.add_argument("--pairs", type=int, help="train on at most this many tuning files now; a later run carries on")
    parser.add_argument("--force", action="store_true", help="the owner's override: start even when the GPU is busy")
    args = parser.parse_args()
    settings = {name: value for name, value in (("epochs", args.epochs), ("learning_rate", args.learning_rate)) if value is not None}
    if args.fields:
        settings["fields"] = args.fields.split(",")
    key = args.key or f"{args.model}_{args.data}"

    print("=" * 60)
    print(f"PRACTICE ROUNDS: {args.model.upper()} MODEL ON {args.data.upper()} DATA")
    print("=" * 60)
    # Step 1: leave room for the owner's other work, or do not start
    print("\n[1/3] Checking the machine and capping this run...")
    threads = share_the_machine(force=args.force)
    print(f"    CPU threads: {threads}, GPU memory share: {GPU_MEMORY_SHARE:.0%}, GPU rest after each step: {GPU_REST_RATIO:g}x the step, priority: below normal")
    with threadpool_limits(limits=threads):
        # Step 2: control
        print("\n[2/3] Control: the first model's recipe on fold 0...")
        run_control()
        # Step 3: the rounds, recorded as they finish
        print("\n[3/3] Running the rounds...")
        Path(args.work_dir).mkdir(parents=True, exist_ok=True)
        rounds = run_rounds(args.data, args.model, args.work_dir, settings, threads, key, args.pairs)
    print(f"    Rounds recorded: {len(rounds)} of {2 * len(FOLD_PAIRS)}")
    if rounds:
        mean = sum(r["category_right"] / r["n"] for r in rounds) / len(rounds)
        print(f"    Mean category accuracy so far: {mean * 100:.2f}%")
    print(f"    Saved: {REPORT_PATH} under {key}")


if __name__ == "__main__":
    main()
