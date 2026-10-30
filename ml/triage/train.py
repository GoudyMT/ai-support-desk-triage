"""Fitting the category and priority models, and refusing to train on leaked wording."""

import re

from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from triage.features import make_vectorizer

RANDOM_STATE = 113
LABEL_FIELDS = ("category", "priority")
LEAK_ERROR = "E_HELDOUT_IN_TRAIN"


def normalize_text(text):
    """Reduces a text to what a person and a word-count model would call the same.

    The same rule as normalizeText in web/scripts/exportDataset.ts: lower case,
    every run of characters that are not a-z or 0-9 as one space, trimmed.

    Args:
        text: Any ticket text.

    Returns:
        The normalised text.
    """
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def assert_no_leak(train_rows, heldout_rows):
    """Fails if any held-out text is also a training text after normalising.

    A model scored on wording it trained on would inflate every number, so this
    runs before any fold model is fitted.

    Args:
        train_rows: Rows the fold model will learn from.
        heldout_rows: Rows it will be scored on.

    Raises:
        ValueError: A held-out maskedText is in the training set.
    """
    train_texts = {normalize_text(row["maskedText"]) for row in train_rows}
    if any(normalize_text(row["maskedText"]) in train_texts for row in heldout_rows):
        raise ValueError(LEAK_ERROR)


def fit_pipeline(texts, labels):
    """Fits one word-weight model.

    Args:
        texts: Masked ticket texts.
        labels: One label per text.

    Returns:
        A fitted Pipeline (vectorizer, then logistic regression).
    """
    pipeline = Pipeline([
        ("tfidf", make_vectorizer()),
        ("logreg", LogisticRegression(C=1.0, max_iter=2000, random_state=RANDOM_STATE)),
    ])
    return pipeline.fit(texts, labels)


def fit_models(rows):
    """Fits the category and priority models on the masked text of the rows.

    Args:
        rows: Exported rows with maskedText, category and priority.

    Returns:
        A dict with a fitted pipeline under "category" and under "priority".
    """
    texts = [row["maskedText"] for row in rows]
    return {field: fit_pipeline(texts, [row[field] for row in rows]) for field in LABEL_FIELDS}


def fit_fold_models(train_rows, heldout_rows):
    """Fits a fold's models after checking that no held-out text is in training.

    Args:
        train_rows: The fold's training rows.
        heldout_rows: The fold's held-out rows, used here only for the check.

    Returns:
        The dict fit_models returns.

    Raises:
        ValueError: A held-out text is in the training set.
    """
    assert_no_leak(train_rows, heldout_rows)
    return fit_models(train_rows)
