"""Tests that the frozen blind test set is still the file that was frozen."""

import hashlib
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
BLIND_ROWS = 2000
# pin: 3. The fingerprint of the set as frozen on 2026-11-10, before any model
# of the second version was trained. It is written here, not only beside the
# data, because the export that writes the data also writes that file: a set
# written again would bring a matching fingerprint with it.
FROZEN_SHA256 = "bc140a2421fba1426f8eefaf80ceaa5bad6381283e39bf25938776ae4850415d"


def test_blind_set_is_the_set_that_was_frozen():
    # The blind set judges a model once. A changed, added or dropped ticket
    # after a model was tuned would let the test drift toward the model.
    # Git on Windows checks the file out with CRLF line ends; the fingerprint is
    # of the LF form, which is what was written and what the repo stores.
    data = (DATA_DIR / "blind.jsonl").read_bytes().replace(b"\r\n", b"\n")
    recorded = (DATA_DIR / "blind.sha256").read_text(encoding="utf-8").strip()
    assert hashlib.sha256(data).hexdigest() == FROZEN_SHA256
    assert recorded == FROZEN_SHA256
    assert data.count(b"\n") == BLIND_ROWS
