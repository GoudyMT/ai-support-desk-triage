"""Tests for the model export: the written file must give the answers the fitted model gives."""

import json
import random

import numpy as np
import pytest

from triage import export_model
from triage.check_model import class_scores, load_model, predict_class
from triage.export_model import build_model, export, parity_records
from triage.train import LABEL_FIELDS, fit_models

CATEGORY_WORDS = {
    "Billing": ["invoice", "refund", "charge", "receipt", "payment"],
    "Account Access": ["password", "login", "locked", "reset", "username"],
    "Technical Issue": ["crash", "error", "freezes", "timeout", "bug"],
}
SHARED_WORDS = ["please", "help", "today", "again", "urgent", "thanks"]
PRIORITY_WORDS = {"High": "asap", "Medium": "soon", "Low": "whenever"}
PLACEHOLDER = "[CARD_NUMBER]"
ROW_COUNT = 200
TOLERANCE = 1e-12


def make_rows(count, seed):
    """Toy tickets: category words, a priority cue, shared filler, sometimes a placeholder or odd text."""
    rng = random.Random(seed)
    rows = []
    for i in range(count):
        category = rng.choice(list(CATEGORY_WORDS))
        priority = rng.choice(list(PRIORITY_WORDS))
        words = rng.sample(CATEGORY_WORDS[category], 3) + rng.sample(SHARED_WORDS, 2)
        words.append(PRIORITY_WORDS[priority])
        # A word said three times, so the model's handling of repeats shows in its answers.
        if rng.random() < 0.4:
            words += [words[0]] * 2
        if rng.random() < 0.3:
            words.append(PLACEHOLDER)
        if rng.random() < 0.2:
            words.append("caf" + chr(0xE9) + " x_y 4o")
        rng.shuffle(words)
        rows.append({"id": f"toy-{seed}-{i}", "maskedText": " ".join(words), "category": category, "priority": priority})
    return rows


def test_written_model_reloads_to_the_fitted_models_answers(tmp_path):
    # What this alone guards: export() itself. check_model's own test scores
    # build_model's dict, so a loss between that dict and the bytes on disk
    # (floats rounded or truncated when written) shows only here. The scoring is
    # check_model's scorer, which reads only the file as the browser does.
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    model_path = tmp_path / "model.json"
    export(models, make_rows(1, seed=9), model_path, tmp_path / "parity.jsonl")
    model = load_model(model_path)
    texts = [row["maskedText"] for row in make_rows(ROW_COUNT, seed=2)]
    for head_name in LABEL_FIELDS:
        head = model["heads"][head_name]
        assert [predict_class(head, text) for text in texts] == list(models[head_name].predict(texts))
        # For this multi-class fit the scores are the decision function.
        scores = np.array([class_scores(head, text) for text in texts])
        assert np.max(np.abs(scores - models[head_name].decision_function(texts))) < TOLERANCE


def test_model_declares_the_settings_it_was_fitted_with_and_lines_up_its_arrays():
    # The scorer refuses a file whose declared settings it does not implement,
    # so the file must say what the vectorizer really did. A vocabulary out of
    # index order, or a transposed coef, would give every word another word's
    # weight with no error anywhere.
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    model = build_model(models)
    vectorizer = models["category"].named_steps["tfidf"]
    assert model["version"] == 1
    assert model["ngramRange"] == list(vectorizer.ngram_range)
    assert model["sublinearTf"] is vectorizer.sublinear_tf
    assert model["tokenPattern"] == vectorizer.token_pattern
    for head_name in LABEL_FIELDS:
        pipeline = models[head_name]
        vocabulary = pipeline.named_steps["tfidf"].vocabulary_
        head = model["heads"][head_name]
        assert head["vocabulary"] == sorted(vocabulary, key=vocabulary.get)
        assert head["classes"] == list(pipeline.classes_)
        assert np.array(head["coef"]).shape == (len(head["classes"]), len(head["vocabulary"]))
        assert len(head["idf"]) == len(head["vocabulary"])
        assert len(head["intercept"]) == len(head["classes"])


def test_a_model_with_a_nan_weight_is_not_written(tmp_path):
    # JSON.parse in the browser fails on NaN with an error that quotes the file;
    # a model that cannot be read must stop the export, and leave no file behind.
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    models["category"].named_steps["logreg"].intercept_[0] = float("nan")
    model_path = tmp_path / "model.json"
    with pytest.raises(ValueError, match="JSON compliant"):
        export(models, make_rows(1, seed=9), model_path, tmp_path / "parity.jsonl")
    assert not model_path.exists()


def test_a_parity_row_with_a_nan_is_not_written(tmp_path, monkeypatch):
    # The TypeScript parity test reads this file with JSON.parse too.
    monkeypatch.setattr(export_model, "parity_records", lambda models, rows: [{"id": "t-1", "probability": float("nan")}])
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    with pytest.raises(ValueError, match="JSON compliant"):
        export(models, make_rows(1, seed=9), tmp_path / "model.json", tmp_path / "parity.jsonl")


def test_files_are_written_with_unix_line_endings(tmp_path):
    # The CI export runs on Linux and is compared with the model committed from
    # Windows; a carriage return added on Windows would make them differ.
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    model_path, parity_path = tmp_path / "model.json", tmp_path / "parity.jsonl"
    export(models, make_rows(3, seed=9), model_path, parity_path)
    assert b"\r" not in model_path.read_bytes()
    assert b"\r" not in parity_path.read_bytes()


def test_parity_file_holds_the_fitted_models_class_and_probability_per_row(tmp_path):
    # The TypeScript parity test judges the scorer against exactly this file.
    models = fit_models(make_rows(ROW_COUNT, seed=1))
    # Ids repeat from fold to fold, so each row carries its fold (none for the
    # hand-written rows) for the parity test to name a mismatch by.
    rows = [{**row, "fold": i % 4} for i, row in enumerate(make_rows(25, seed=3))] + make_rows(5, seed=4)
    parity_path = tmp_path / "parity.jsonl"
    export(models, rows, tmp_path / "model.json", parity_path)
    written = [json.loads(line) for line in parity_path.read_text(encoding="utf-8").split("\n") if line]
    assert [r["id"] for r in written] == [r["id"] for r in rows]
    assert [r.get("fold", "absent") for r in written] ==[row.get("fold") for row in rows]
    assert written == parity_records(models, rows)
    texts = [row["maskedText"] for row in rows]
    for head_name in LABEL_FIELDS:
        expected = models[head_name].predict_proba(texts)
        classes = list(models[head_name].classes_)
        for record, row, probs in zip(written, rows, expected):
            assert record["maskedText"] == row["maskedText"]
            assert record[head_name]["label"] == classes[int(np.argmax(probs))]
            assert list(record[head_name]["probabilities"]) == classes
            assert list(record[head_name]["probabilities"].values()) == list(probs)
