"""Loading the files that `npm --prefix web run export-data` writes."""

import json
from pathlib import Path

# Resolved from this file, not the current folder, so the tests and the
# commands find the same files wherever they are started from.
GENERATED_DIR = Path(__file__).resolve().parent.parent / "data" / "generated"
TRAIN_ALL_PATH = GENERATED_DIR / "train_all.jsonl"
HANDWRITTEN_PATH = GENERATED_DIR / "handwritten.jsonl"
FOLD_COUNT = 4
EXPORT_COMMAND = "npm --prefix web run export-data"


def fold_paths(k):
    """Returns the training and held-out file paths for one fold.

    Args:
        k: Fold number, 0 to FOLD_COUNT - 1.

    Returns:
        A (train_path, heldout_path) pair.
    """
    return GENERATED_DIR / f"train_{k}.jsonl", GENERATED_DIR / f"heldout_{k}.jsonl"


def load_rows(path):
    """Reads one JSON object per line from a generated file.

    Args:
        path: Path of a .jsonl file.

    Returns:
        The rows, in file order.

    Raises:
        FileNotFoundError: The file is missing; the message names the command
            that writes it.
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"E_DATA_FILE_MISSING: {path} - make it with: {EXPORT_COMMAND}")
    # UTF-8 is set because the Windows default is not. Lines are split on "\n"
    # only: a ticket may hold U+2028, which str.splitlines() would cut in two.
    text = path.read_text(encoding="utf-8")
    return [json.loads(line) for line in text.split("\n") if line.strip()]
