"""Tests that the frozen blind test set is still the file that was frozen."""

import hashlib
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
BLIND_ROWS = 2000


def test_blind_set_matches_its_recorded_fingerprint():
    # The blind set judges a model once. A changed, added or dropped ticket
    # after a model was tuned would let the test drift toward the model, so the
    # bytes on disk must hash to the fingerprint written when it was frozen.
    data = (DATA_DIR / "blind.jsonl").read_bytes()
    recorded = (DATA_DIR / "blind.sha256").read_text(encoding="utf-8").strip()
    assert hashlib.sha256(data).hexdigest() == recorded
    assert data.count(b"\n") == BLIND_ROWS
