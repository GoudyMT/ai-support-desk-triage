"""Tests for the CI check that two model files give the same classes on every evaluation row."""

import copy
import json
import math

import pytest

from triage.check_model import (
    class_scores,
    first_difference,
    load_check_rows,
    load_model,
    main,
    predict_class,
    tokenize,
)
from triage.data import HANDWRITTEN_PATH, TRAIN_ALL_PATH, fold_paths, load_rows
from triage.export_model import MODEL_PATH, build_model
from triage.train import LABEL_FIELDS, fit_models

SAMPLE_COUNT = 300
TOLERANCE = 1e-9
TOY_WORDS = ("alpha", "beta", "gamma")
TOY_CLASSES = {"category": ["Billing", "Account Access", "Technical Issue"], "priority": ["High", "Medium", "Low"]}


def toy_model():
    """A model by hand: each word scores 1 for the class at its own position and 0 for the others."""
    head = {
        "vocabulary": list(TOY_WORDS),
        "idf": [1.0, 1.0, 1.0],
        "coef": [[1.0 if c == w else 0.0 for w in range(3)] for c in range(3)],
        "intercept": [0.0, 0.0, 0.0],
    }
    return {
        "version": 1,
        "tokenPattern": r"(?a)\b\w\w+\b",
        "ngramRange": [1, 2],
        "sublinearTf": True,
        "heads": {name: {**copy.deepcopy(head), "classes": classes} for name, classes in TOY_CLASSES.items()},
    }


def write_model(directory, name, model):
    path = directory / name
    path.write_text(json.dumps(model), encoding="utf-8", newline="\n")
    return path


def toy_row(row_id, fold, word):
    return {"id": row_id, "fold": fold, "maskedText": word}


@pytest.fixture(scope="module")
def fitted(tmp_path_factory):
    """The shipped model's fit on all training wording, and the same model as the scorer reads it."""
    models = fit_models(load_rows(TRAIN_ALL_PATH))
    path = write_model(tmp_path_factory.mktemp("fitted"), "model.json", build_model(models))
    return models, load_model(path)


def softmax(scores):
    top = max(scores)
    exps = [math.exp(s - top) for s in scores]
    return [e / sum(exps) for e in exps]


def test_scorer_gives_the_fitted_models_classes_and_probabilities_on_real_rows(fitted):
    # The check judges two files with this scorer, so it must answer as the
    # trained model does. Most tickets say each word once, so each ticket is
    # also scored with its first word said three more times: otherwise a wrong
    # repeat weight (1 + ln(count)) would pass unseen.
    models, model = fitted
    rows = load_rows(fold_paths(0)[1])[:SAMPLE_COUNT] + load_rows(HANDWRITTEN_PATH)
    texts = [row["maskedText"] for row in rows]
    texts += [f"{text} {' '.join(tokenize(text)[:1] * 3)}" for text in texts]
    for name in LABEL_FIELDS:
        head = model["heads"][name]
        expected = models[name].predict_proba(texts)
        assert [predict_class(head, text) for text in texts] == [str(c) for c in models[name].predict(texts)]
        for text, wanted in zip(texts, expected):
            assert max(abs(p - w) for p, w in zip(softmax(class_scores(head, text)), wanted)) < TOLERANCE


def test_tokenize_gives_words_then_pairs_of_ascii_words_only():
    # One-letter words and non-ASCII letters split as the browser scorer splits
    # them; a different split would make the two scorers answer differently.
    assert tokenize("A caf" + chr(0xE9) + " x_y 4o") == ["caf", "x_y", "4o", "caf x_y", "x_y 4o"]


def test_two_equal_models_agree_on_every_evaluation_row(capsys):
    assert main([str(MODEL_PATH), str(MODEL_PATH)]) == 0
    assert "SAME" in capsys.readouterr().out


def write_flipped_copy(model_path, tmp_path):
    """Writes a copy of the model with one category coefficient negated, and returns the one row it changes first.

    Goes through the rows in the order they are checked and takes the first
    row that some single negation gives another class, among the negations
    that leave every earlier row's class as it was. So the row returned is
    the first one any check must name, found without using the check itself.
    """
    raw = json.loads(model_path.read_text(encoding="utf-8"))
    head = load_model(model_path)["heads"]["category"]
    earlier = []
    for row in load_check_rows():
        text = row["maskedText"]
        before = predict_class(head, text)
        columns = sorted({head["index"][t] for t in tokenize(text) if t in head["index"]})
        for c in range(len(head["classes"])):
            for column in columns:
                head["coef"][c][column] *= -1
                found = predict_class(head, text) != before and all(predict_class(head, t) == b for t, b in earlier)
                head["coef"][c][column] *= -1
                if found:
                    raw["heads"]["category"]["coef"][c][column] *= -1
                    write_model(tmp_path, "flipped.json", raw)
                    return row
        earlier.append((text, before))
    raise AssertionError("no single coefficient changes any row's class")


def test_a_flipped_coefficient_exits_one_and_names_the_first_row_it_changes(tmp_path, capsys):
    row = write_flipped_copy(MODEL_PATH, tmp_path)
    assert main([str(tmp_path / "flipped.json"), str(MODEL_PATH)]) == 1
    out = capsys.readouterr().out
    fold = "none" if row["fold"] is None else row["fold"]
    assert f"{row['id']} (fold {fold})" in out
    assert "category" in out


def test_difference_in_the_priority_head_alone_is_found(tmp_path):
    # The model answers two questions; agreeing on category says nothing about priority.
    same = toy_model()
    other = toy_model()
    other["heads"]["priority"]["coef"][0][0] = -1.0
    rows = [toy_row("t-1", 0, "beta"), toy_row("t-2", 0, "alpha")]
    found = first_difference(
        load_model(write_model(tmp_path, "a.json", other)), load_model(write_model(tmp_path, "b.json", same)), rows
    )
    assert found is not None
    assert (found["id"], found["head"]) == ("t-2", "priority")


def test_an_id_shared_by_two_folds_is_named_with_the_fold_that_differs(tmp_path):
    # Ids repeat from fold to fold, so the id alone would point at the wrong row.
    same = toy_model()
    other = toy_model()
    other["heads"]["category"]["coef"][1][1] = -1.0
    rows = [toy_row("t-1", 0, "alpha"), toy_row("t-1", 2, "beta")]
    found = first_difference(
        load_model(write_model(tmp_path, "a.json", other)), load_model(write_model(tmp_path, "b.json", same)), rows
    )
    assert found is not None
    assert (found["id"], found["fold"]) == ("t-1", 2)


def test_models_that_agree_on_every_row_have_no_difference(tmp_path):
    path = write_model(tmp_path, "a.json", toy_model())
    rows = [toy_row("t-1", 0, "alpha beta"), toy_row("t-1", None, "gamma")]
    assert first_difference(load_model(path), load_model(path), rows) is None


def test_a_model_made_with_other_settings_is_refused(tmp_path):
    # The scorer implements one vectorizer; scoring a model made with another
    # would give wrong answers with no error.
    other = toy_model()
    other["sublinearTf"] = False
    with pytest.raises(ValueError, match="E_MODEL_SETTINGS"):
        load_model(write_model(tmp_path, "other.json", other))


def test_check_rows_are_every_heldout_row_with_its_fold_then_the_handwritten_rows():
    rows = load_check_rows()
    heldout = sum(len(load_rows(fold_paths(k)[1])) for k in range(4))
    assert len(rows) == heldout + len(load_rows(HANDWRITTEN_PATH))
    assert {row["fold"] for row in rows[:heldout]} == {0, 1, 2, 3}
    assert {row["fold"] for row in rows[heldout:]} == {None}
