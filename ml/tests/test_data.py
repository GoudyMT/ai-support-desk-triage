"""Tests for loading the generated files and for keeping held-out wording out of training."""

import json
import re

import pytest

from triage.data import FOLD_COUNT, fold_paths, load_rows
from triage.train import assert_no_leak


def normalized(text):
    # Written out here, not imported, so the real-folds check does not lean on
    # the function it is meant to check.
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def row(masked_text, address="jo"):
    # The raw text keeps an address the masker hides, so two rows can read the
    # same masked and differ raw; the guard must go by what the model sees.
    return {
        "text": f"{masked_text} {address}@example.test",
        "maskedText": masked_text,
        "category": "Other",
        "priority": "Low",
    }


def test_load_rows_names_the_export_command_when_the_file_is_missing(tmp_path):
    # A fresh clone has no generated files; the message must say how to make them.
    with pytest.raises(FileNotFoundError, match=re.escape("npm --prefix web run export-data")):
        load_rows(tmp_path / "train_0.jsonl")


def test_load_rows_reads_utf8_and_keeps_a_line_separator_inside_a_text(tmp_path):
    # On Windows the default file encoding is not UTF-8, and U+2028 is a line
    # break to str.splitlines() but plain text inside a JSON string.
    text = "caf" + chr(0xE9) + " a" + chr(0x2028) + "b"
    path = tmp_path / "rows.jsonl"
    path.write_bytes((json.dumps({"text": text}, ensure_ascii=False) + "\n\n").encode("utf-8"))
    assert load_rows(path) == [{"text": text}]


@pytest.mark.parametrize("k", range(FOLD_COUNT))
def test_real_fold_heldout_wording_is_not_in_its_training_set(k):
    train_path, heldout_path = fold_paths(k)
    train = load_rows(train_path)
    heldout = load_rows(heldout_path)
    assert train and heldout
    train_texts = {normalized(r["maskedText"]) for r in train}
    leaked = [r["id"] for r in heldout if normalized(r["maskedText"]) in train_texts]
    assert leaked == []
    assert_no_leak(train, heldout)


def test_guard_raises_when_a_heldout_text_differs_only_in_case_and_punctuation():
    train = [row("Reset my password, please!")]
    heldout = [row("something else entirely"), row("reset MY password please", "ann")]
    with pytest.raises(ValueError, match="E_HELDOUT_IN_TRAIN"):
        assert_no_leak(train, heldout)


def test_guard_accepts_a_heldout_text_that_differs_by_a_word():
    assert_no_leak([row("Reset my password, please!")], [row("reset my password now")])
