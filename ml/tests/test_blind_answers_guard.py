"""Tests the guards that keep the blind set read once, and only by the models the records name.

None of these tests scores or reads the blind set: they check what the script refuses before it would.
"""

import json
from pathlib import Path

import pytest

from triage_v2 import blind_answers

ML_DIR = Path(__file__).resolve().parents[1]
FAIR = ML_DIR / "reports" / "ninety_day_fair.json"


def recorded_ends():
    streams = json.loads(FAIR.read_text(encoding="utf-8"))["streams"].values()
    return [stream["models"][f"stream_{at}_after_{blind_answers.LAST_WEEK}"] for at, stream in enumerate(streams)]


def test_each_ninety_day_model_is_held_to_the_fingerprint_the_fair_run_recorded(tmp_path):
    found = blind_answers.models(tmp_path)
    assert [recorded for name, _, recorded in found if name.startswith("ninety_day_end_")] == recorded_ends()


def test_the_recorded_answers_came_from_those_models():
    answers = json.loads(blind_answers.ANSWERS.read_text(encoding="utf-8"))["models"]
    assert [answers[f"ninety_day_end_{at}"]["fingerprint"] for at in range(blind_answers.STREAMS)] == recorded_ends()


# A missing or misspelt work folder used to stop the run after the blind set was read, with nothing written, so the
# reading could be run again.
def test_a_missing_model_folder_is_refused_before_anything_is_read(tmp_path):
    with pytest.raises(SystemExit, match=blind_answers.MISSING_ERROR):
        blind_answers.check_models(blind_answers.models(tmp_path / "nowhere"))


def test_a_model_other_than_the_recorded_one_is_refused():
    with pytest.raises(SystemExit, match=blind_answers.HASH_ERROR):
        blind_answers.check_models([("sentence", blind_answers.BUNDLE, "0" * 64)])


def test_the_reading_is_claimed_once(tmp_path):
    target = tmp_path / "blind_answers.json"
    blind_answers.claim(target)
    with pytest.raises(SystemExit, match=blind_answers.EXISTS_ERROR):
        blind_answers.claim(target)


def test_answers_in_the_repo_history_count_as_read_even_when_the_file_is_gone():
    assert blind_answers.ever_committed(blind_answers.ANSWERS)
