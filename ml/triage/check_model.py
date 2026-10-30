"""Checks that two model files give the same category and priority on every evaluation row.

Run from the ml folder: python -m triage.check_model <fresh.json> <committed.json>

Exits 0 when they agree on every row and 1 at the first row they do not.
"""

import argparse
import json
import math
import re
from pathlib import Path

from triage.data import FOLD_COUNT, HANDWRITTEN_PATH, fold_paths, load_rows
from triage.features import TOKEN_PATTERN
from triage.train import LABEL_FIELDS

DIVIDER = "=" * 60
STEP_COUNT = 3
SETTINGS_ERROR = "E_MODEL_SETTINGS"
# The only n-gram range the scorer below implements, as the browser scorer does;
# a model made with other vectorizer settings is refused.
SUPPORTED_NGRAM_RANGE = [1, 2]

# The scorer here follows the browser scorer step by step, from the model file
# alone (plain Python, no scikit-learn), so two files are judged by a second
# reading of the file and not by the fit that wrote it.
_TOKEN = re.compile(TOKEN_PATTERN)


def load_model(path):
    """Reads a model file and indexes each head's vocabulary.

    Args:
        path: Path of a model JSON file.

    Returns:
        The model dict, with an "index" (term to column) added to each head.

    Raises:
        ValueError: The model was made with settings this scorer does not implement.
    """
    model = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        model.get("tokenPattern") != TOKEN_PATTERN
        or model.get("ngramRange") != SUPPORTED_NGRAM_RANGE
        or model.get("sublinearTf") is not True
    ):
        raise ValueError(SETTINGS_ERROR)
    for head in model["heads"].values():
        head["index"] = {term: column for column, term in enumerate(head["vocabulary"])}
    return model


def tokenize(text):
    """Splits text into the terms the vectorizer builds.

    Args:
        text: Any masked ticket text.

    Returns:
        The one-word terms, then the two-word terms joined by one space.
    """
    words = _TOKEN.findall(text.lower())
    return words + [f"{first} {second}" for first, second in zip(words, words[1:])]


def class_scores(head, text):
    """Scores every class of one head for one text.

    Args:
        head: One entry of load_model's "heads".
        text: The masked ticket text.

    Returns:
        One score per class, in the head's class order (the logits: softmax
        of them is the model's probabilities).
    """
    counts = {}
    for term in tokenize(text):
        column = head["index"].get(term)
        if column is not None:
            counts[column] = counts.get(column, 0) + 1
    # Sublinear term frequency times idf, scaled to length 1 (a text with no
    # known term stays all zero, as in scikit-learn).
    weights = {column: (1 + math.log(count)) * head["idf"][column] for column, count in counts.items()}
    length = math.sqrt(sum(value * value for value in weights.values()))
    scores = []
    for coefficients, intercept in zip(head["coef"], head["intercept"]):
        dot = sum(value / length * coefficients[column] for column, value in weights.items()) if length > 0 else 0.0
        scores.append(dot + intercept)
    return scores


def predict_class(head, text):
    """Answers one head's question for one text.

    Args:
        head: One entry of load_model's "heads".
        text: The masked ticket text.

    Returns:
        The class with the highest score; the first of equal scores.
    """
    scores = class_scores(head, text)
    return head["classes"][scores.index(max(scores))]


def first_difference(fresh, committed, rows):
    """Finds the first row on which the two models give a different class.

    Args:
        fresh: A model from load_model.
        committed: A model from load_model.
        rows: Rows with id, fold and maskedText, in the order to check.

    Returns:
        None when they agree everywhere, else a dict with the row's id and fold,
        the head, and the class each model gave.
    """
    for row in rows:
        for name in LABEL_FIELDS:
            fresh_class = predict_class(fresh["heads"][name], row["maskedText"])
            committed_class = predict_class(committed["heads"][name], row["maskedText"])
            if fresh_class != committed_class:
                return {
                    "id": row["id"],
                    "fold": row["fold"],
                    "head": name,
                    "fresh": fresh_class,
                    "committed": committed_class,
                }
    return None


def load_check_rows():
    """Reads every held-out row (tagged with its fold) and every hand-written row.

    Returns:
        The rows, held-out first. Ids repeat from fold to fold, so a row is named
        by id and fold; the hand-written rows have no fold (None).
    """
    rows = [{**row, "fold": k} for k in range(FOLD_COUNT) for row in load_rows(fold_paths(k)[1])]
    return rows + [{**row, "fold": None} for row in load_rows(HANDWRITTEN_PATH)]


def main(argv=None):
    """Compares two model files and returns the exit code: 0 when they agree, 1 when not."""
    parser = argparse.ArgumentParser(description="Check that two model files give the same classes.")
    parser.add_argument("fresh", help="the model just exported")
    parser.add_argument("committed", help="the model in the repository")
    args = parser.parse_args(argv)

    print(DIVIDER)
    print("MODEL CHECK")
    print(DIVIDER)

    # Step 1: read both model files.
    print(f"[1/{STEP_COUNT}] Loading {args.fresh} and {args.committed}")
    fresh, committed = load_model(args.fresh), load_model(args.committed)

    # Step 2: read the rows both models are judged on.
    print(f"[2/{STEP_COUNT}] Loading the evaluation rows")
    rows = load_check_rows()
    print(f"    {len(rows):,} rows")

    # Step 3: score every row with both models.
    print(f"[3/{STEP_COUNT}] Comparing the classes")
    found = first_difference(fresh, committed, rows)
    if found is None:
        print(f"    SAME category and priority on all {len(rows):,} rows")
        print(DIVIDER)
        return 0
    fold = "none" if found["fold"] is None else found["fold"]
    print(f"    DIFFERENT {found['head']} on {found['id']} (fold {fold}): "
          f"fresh {found['fresh']}, committed {found['committed']}")
    print(DIVIDER)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
