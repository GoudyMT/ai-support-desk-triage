"""Checks that two model files are the same model and give the same category and priority on every evaluation row.

Run from the ml folder: python -m triage.check_model <fresh.json> <committed.json>

Exits 0 when the classes, vocabulary and numbers match (the numbers within a
tolerance) and every row gets the same classes; exits 1 at the first part or
row that differs.
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
STEP_COUNT = 4
SETTINGS_ERROR = "E_MODEL_SETTINGS"
SHAPE_ERROR = "E_MODEL_SHAPE"
MODEL_VERSION = 1
# Only the multi-class softmax is implemented, as in the browser scorer.
MIN_CLASSES = 3
# The only n-gram range the scorer below implements, as the browser scorer does;
# a model made with other vectorizer settings is refused.
SUPPORTED_NGRAM_RANGE = [1, 2]
# The arrays of one head, in the order they are compared.
HEAD_ARRAYS = ("classes", "vocabulary", "idf", "coef", "intercept")
# How far two numbers of the same model may differ. The solver stops early, so a
# refit differs in its last digits. Measured: refitting on the same rows
# shuffled, on Windows, the worst difference was 1.1e-10. The fit CI makes on
# Linux has not been measured and is first seen in CI. This allows four orders
# more than 1e-10 and still fails a hand-edited weight of 1e-3.
VALUE_TOLERANCE = 1e-6
# The browser's loader refuses a number past this magnitude (a value near the
# largest float overflows its sums into NaN), and so does this one.
MAX_WEIGHT_MAGNITUDE = 1e6
# The names `name in {}` is true for in JavaScript. The browser refuses a class
# with one of them, because class names become keys of its probabilities record.
INHERITED_OBJECT_KEYS = frozenset({
    "constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
    "__lookupGetter__", "__lookupSetter__",
})

# The scorer here follows the browser scorer step by step, from the model file
# alone (plain Python, no scikit-learn), so two files are judged by a second
# reading of the file and not by the fit that wrote it.
_TOKEN = re.compile(TOKEN_PATTERN)


def _is_number(value):
    """True for a finite JSON number within MAX_WEIGHT_MAGNITUDE; a bool is not one, as in the browser's loader."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and abs(value) <= MAX_WEIGHT_MAGNITUDE
    )


def _is_list_of(values, test):
    return isinstance(values, list) and all(test(value) for value in values)


def _check_head_shape(head):
    """Raises E_MODEL_SHAPE unless one head has the shape the browser's loader accepts."""
    if not isinstance(head, dict):
        raise ValueError(SHAPE_ERROR)
    classes, vocabulary, idf = head.get("classes"), head.get("vocabulary"), head.get("idf")
    coef, intercept = head.get("coef"), head.get("intercept")
    if not (
        _is_list_of(classes, lambda value: isinstance(value, str))
        and _is_list_of(vocabulary, lambda value: isinstance(value, str))
        and _is_list_of(idf, _is_number)
        and _is_list_of(coef, lambda row: _is_list_of(row, _is_number))
        and _is_list_of(intercept, _is_number)
    ):
        raise ValueError(SHAPE_ERROR)
    # Repeats would be silently resolved (the last wins), and a short array
    # silently zipped against more classes.
    if (
        len(classes) < MIN_CLASSES
        or len(set(classes)) != len(classes)
        or any(name in INHERITED_OBJECT_KEYS for name in classes)
        or len(set(vocabulary)) != len(vocabulary)
        or len(idf) != len(vocabulary)
        or len(coef) != len(classes)
        or any(len(row) != len(vocabulary) for row in coef)
        or len(intercept) != len(classes)
    ):
        raise ValueError(SHAPE_ERROR)


def load_model(path):
    """Reads a model file and indexes each head's vocabulary.

    Args:
        path: Path of a model JSON file.

    Returns:
        The model dict, with an "index" (term to column) added to each head.

    Raises:
        ValueError: E_MODEL_SETTINGS when the model was made with settings this
            scorer does not implement; E_MODEL_SHAPE when anything else the
            browser's loader refuses is wrong with it.
    """
    model = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(model, dict) or not _is_number(model.get("version")) or model["version"] != MODEL_VERSION:
        raise ValueError(SHAPE_ERROR)
    ngram_range = model.get("ngramRange")
    if (
        model.get("tokenPattern") != TOKEN_PATTERN
        or not _is_list_of(ngram_range, _is_number)
        or ngram_range != SUPPORTED_NGRAM_RANGE
        or model.get("sublinearTf") is not True
    ):
        raise ValueError(SETTINGS_ERROR)
    heads = model.get("heads")
    if not isinstance(heads, dict):
        raise ValueError(SHAPE_ERROR)
    for name in LABEL_FIELDS:
        head = heads.get(name)
        _check_head_shape(head)
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


def _entries(values):
    """Lists a flat array, or a list of rows, as (index text, value) pairs."""
    for i, value in enumerate(values):
        if isinstance(value, list):
            for j, inner in enumerate(value):
                yield f"{i},{j}", inner
        else:
            yield str(i), value


def first_model_difference(fresh, committed):
    """Finds the first part of the two models that is not the same model.

    Classes and vocabulary (terms and their order) must be equal; every idf,
    coef and intercept must be within VALUE_TOLERANCE.

    Args:
        fresh: A model from load_model.
        committed: A model from load_model.

    Returns:
        None when they are the same model, else a line naming the head, the
        array, the index and the two values (or the two lengths).
    """
    for name in LABEL_FIELDS:
        for array in HEAD_ARRAYS:
            fresh_entries = list(_entries(fresh["heads"][name][array]))
            committed_entries = list(_entries(committed["heads"][name][array]))
            if len(fresh_entries) != len(committed_entries):
                return f"{name} {array}: {len(fresh_entries)} values in fresh, {len(committed_entries)} in committed"
            for (index, new), (_, old) in zip(fresh_entries, committed_entries):
                if isinstance(new, str) or isinstance(old, str):
                    differs = new != old
                else:
                    differs = abs(new - old) > VALUE_TOLERANCE
                if differs:
                    return f"{name} {array}[{index}]: fresh {new}, committed {old}"
    return None


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

    # Step 2: compare the models part by part, so a change no evaluation row
    # exercises (an added term, a nudged weight) is still found.
    print(f"[2/{STEP_COUNT}] Comparing the classes, vocabulary and numbers")
    difference = first_model_difference(fresh, committed)
    if difference is not None:
        print(f"    DIFFERENT {difference}")
        print(DIVIDER)
        return 1

    # Step 3: read the rows both models are judged on.
    print(f"[3/{STEP_COUNT}] Loading the evaluation rows")
    rows = load_check_rows()
    print(f"    {len(rows):,} rows")

    # Step 4: score every row with both models.
    print(f"[4/{STEP_COUNT}] Comparing the classes")
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
