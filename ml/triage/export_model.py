"""Writes the trained model for the TypeScript scorer, and what scikit-learn answers on the evaluation rows.

Run from the ml folder: python -m triage.export_model [--model-out PATH] [--parity-out PATH]
"""

import argparse
import json
from pathlib import Path

from triage.data import FOLD_COUNT, GENERATED_DIR, HANDWRITTEN_PATH, TRAIN_ALL_PATH, fold_paths, load_rows
from triage.train import LABEL_FIELDS, fit_models

MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "web" / "src" / "model" / "model.json"
PARITY_PATH = GENERATED_DIR / "parity_predictions.jsonl"
MODEL_VERSION = 1
DIVIDER = "=" * 60
STEP_COUNT = 4


def head_dict(pipeline):
    """Reads one fitted pipeline into the plain lists the scorer needs.

    Args:
        pipeline: A fitted Pipeline (vectorizer, then logistic regression).

    Returns:
        A dict with classes, vocabulary (in column order), idf, coef (classes
        by vocabulary) and intercept.
    """
    vectorizer = pipeline.named_steps["tfidf"]
    classifier = pipeline.named_steps["logreg"]
    vocabulary = vectorizer.vocabulary_
    return {
        "classes": [str(label) for label in classifier.classes_],
        "vocabulary": sorted(vocabulary, key=vocabulary.get),
        "idf": vectorizer.idf_.tolist(),
        "coef": classifier.coef_.tolist(),
        "intercept": classifier.intercept_.tolist(),
    }


def build_model(models):
    """Builds the model file content.

    Args:
        models: The dict fit_models returns.

    Returns:
        A dict ready to write as JSON; floats keep their full precision.
    """
    # Both heads are fitted with make_vectorizer, so one head's vectorizer
    # states the settings. They are read from it, not repeated here, so a changed
    # vectorizer is declared as changed and the scorer refuses what it cannot do.
    vectorizer = models[LABEL_FIELDS[0]].named_steps["tfidf"]
    return {
        "version": MODEL_VERSION,
        "tokenPattern": vectorizer.token_pattern,
        "ngramRange": list(vectorizer.ngram_range),
        "sublinearTf": vectorizer.sublinear_tf,
        "heads": {field: head_dict(models[field]) for field in LABEL_FIELDS},
    }


def parity_records(models, rows):
    """Records what scikit-learn answers for each row, for the TypeScript parity test.

    Args:
        models: The dict fit_models returns.
        rows: Rows with id and maskedText, and optionally the fold they were
            held out in.

    Returns:
        One dict per row: id, fold (None when the row has none), maskedText,
        and per head the class ("label") and the probability of every class.
    """
    texts = [row["maskedText"] for row in rows]
    answers = {}
    for field in LABEL_FIELDS:
        pipeline = models[field]
        answers[field] = (pipeline.predict(texts), pipeline.predict_proba(texts), pipeline.classes_)
    records = []
    for i, row in enumerate(rows):
        record = {"id": row["id"], "fold": row.get("fold"), "maskedText": row["maskedText"]}
        for field in LABEL_FIELDS:
            labels, probabilities, classes = answers[field]
            record[field] = {
                "label": str(labels[i]),
                "probabilities": {str(c): float(p) for c, p in zip(classes, probabilities[i])},
            }
        records.append(record)
    return records


def export(models, parity_rows, model_path, parity_path):
    """Writes the model file and the parity file.

    Args:
        models: The dict fit_models returns.
        parity_rows: Rows to record scikit-learn's answers for.
        model_path: Where to write the model JSON.
        parity_path: Where to write the parity JSON lines.
    """
    model_path, parity_path = Path(model_path), Path(parity_path)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    parity_path.parent.mkdir(parents=True, exist_ok=True)
    # Compact separators: the file ships to the browser. ensure_ascii (the
    # default) keeps both files ASCII and lines free of U+2028, so a reader may
    # split on "\n". newline="\n" so Windows writes the same bytes as Linux.
    # allow_nan=False: NaN and Infinity are not JSON, so JSON.parse in the
    # browser would refuse the file; stop here instead of writing it.
    model_path.write_text(
        json.dumps(build_model(models), separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    lines = [
        json.dumps(record, separators=(",", ":"), allow_nan=False) for record in parity_records(models, parity_rows)
    ]
    parity_path.write_text("".join(line + "\n" for line in lines), encoding="utf-8", newline="\n")


def main(argv=None):
    """Fits both heads on all wording, then writes the model file and the parity file."""
    parser = argparse.ArgumentParser(description="Write the model file and the parity predictions.")
    parser.add_argument("--model-out", default=MODEL_PATH, help="where to write the model JSON")
    parser.add_argument("--parity-out", default=PARITY_PATH, help="where to write the parity JSON lines")
    args = parser.parse_args(argv)

    print(DIVIDER)
    print("MODEL EXPORT")
    print(DIVIDER)

    # Step 1: read the exported files.
    print(f"[1/{STEP_COUNT}] Loading generated files")
    train_all_rows = load_rows(TRAIN_ALL_PATH)
    # Ids repeat from fold to fold, so each held-out row is tagged with its
    # fold; the hand-written rows have none.
    parity_rows = [{**row, "fold": k} for k in range(FOLD_COUNT) for row in load_rows(fold_paths(k)[1])]
    parity_rows += load_rows(HANDWRITTEN_PATH)
    print(f"    train {len(train_all_rows):,}, parity rows {len(parity_rows):,}")

    # Step 2: fit both heads on all wording, as the shipped model is.
    print(f"[2/{STEP_COUNT}] Fitting category and priority")
    models = fit_models(train_all_rows)

    # Step 3: write both files.
    print(f"[3/{STEP_COUNT}] Writing {args.model_out} and {args.parity_out}")
    export(models, parity_rows, args.model_out, args.parity_out)

    # Step 4: show the sizes.
    print(f"[4/{STEP_COUNT}] Result")
    for field in LABEL_FIELDS:
        head = head_dict(models[field])
        print(f"    {field}: {len(head['classes'])} classes, {len(head['vocabulary']):,} terms")
    print(f"    model file: {Path(args.model_out).stat().st_size:,} bytes")
    print(DIVIDER)


if __name__ == "__main__":
    main()
