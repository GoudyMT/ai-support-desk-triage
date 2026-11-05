"""Tests that the fold models the live page loads are present, readable and each held out from its own fold."""

import json
from pathlib import Path

import pytest

from triage.check_model import load_model
from triage.data import FOLD_COUNT

MODELS_DIR = Path(__file__).resolve().parents[2] / "web" / "public" / "models"


@pytest.mark.parametrize("fold", range(FOLD_COUNT))
def test_committed_fold_model_loads_and_names_its_fold(fold):
    # The page picks fold_<seed mod 4>.json and scores that fold's held-out
    # tickets with it; a file trained on another fold would score tickets it
    # has seen, so the file name and the model's own record must agree.
    path = MODELS_DIR / f"fold_{fold}.json"
    load_model(path)
    assert json.loads(path.read_text(encoding="utf-8"))["heldOutFold"] == fold
