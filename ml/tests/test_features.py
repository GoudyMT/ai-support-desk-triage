"""Tests for the vectorizer the TypeScript scorer must reproduce."""

import math

import pytest

from triage.features import make_vectorizer


def test_tokenizer_splits_non_ascii_underscores_and_digits_the_scorer_way():
    # ASCII-only word characters: the accent ends the token, the underscore and
    # the digit-letter mix stay inside one, the masking placeholder is one lower
    # case word, and a single character is dropped. Bigrams follow the unigrams.
    text = "caf" + chr(0xE9) + " x_y 4o [CARD_NUMBER]"
    expected = [
        "caf",
        "x_y",
        "4o",
        "card_number",
        "caf x_y",
        "x_y 4o",
        "4o card_number",
    ]
    assert make_vectorizer().build_analyzer()(text) == expected


def test_a_single_letter_is_not_a_word():
    assert make_vectorizer().build_analyzer()("a b cc") == ["cc"]


def test_words_seen_in_one_ticket_are_dropped_and_repeats_count_less_than_linearly():
    # min_df=2 keeps the model from learning one-off words; sublinear_tf means
    # three mentions weigh 1 + ln(3), not 3, which is what the scorer computes.
    corpus = ["aa aa aa bb", "aa bb", "zz"]
    vectorizer = make_vectorizer().fit(corpus)
    assert set(vectorizer.vocabulary_) == {"aa", "bb", "aa bb"}

    row = vectorizer.transform(["aa aa aa bb"]).toarray()[0]
    weights = {term: row[index] for term, index in vectorizer.vocabulary_.items()}
    assert weights["aa"] / weights["bb"] == pytest.approx(1 + math.log(3))
    assert sum(w * w for w in row) == pytest.approx(1.0)
