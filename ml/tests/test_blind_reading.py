"""Tests that the one blind reading is recorded, of the frozen blind set, and judged by the bar written before it.

The reading itself is worked out again by `npm --prefix web run blind-reading` in CI.
"""

import hashlib
import json
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
READING = ML_DIR / "reports" / "blind_reading.json"
ANSWERS = ML_DIR / "reports" / "blind_answers.json"
BLIND = ML_DIR / "data" / "blind.jsonl"
REPORT = ML_DIR / "reports" / "bundle_v2.json"
# The release bar (design 2026-11-10, Revision 1, section 9), written before the reading.
BAR_POINTS = 10
COUNTS = ("highRiskMissed", "highUrgentOutLow", "silentCategory", "silentPriority")
LADDER = {"sentence", "ninety_day_end_0", "ninety_day_end_1", "ninety_day_end_2", "ninety_day_end_3"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_the_reading_is_of_the_frozen_blind_set_with_every_ladder_row():
    reading = load(READING)
    answers = load(ANSWERS)
    digest = hashlib.sha256(BLIND.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    assert reading["blind_sha256"] == answers["blind_sha256"] == digest
    assert set(reading["models"]) == set(answers["models"]) == LADDER
    assert answers["models"]["sentence"]["fingerprint"] == load(REPORT)["fingerprint"]


def test_the_verdict_is_the_bar_applied_to_the_recorded_numbers():
    reading = load(READING)
    two = reading["models"]["sentence"]["all"]["twoModel"]
    reviewed = two["reviewed"]
    gain = (two["suggestion"]["answer"]["category"] - two["suggestion"]["gate"]["category"]) / reviewed * 100
    held = all(two["both"][count] <= two["today"][count] for count in COUNTS)
    assert reading["bar"]["points"] == BAR_POINTS
    assert abs(reading["bar"]["gain_points"] - gain) < 0.01
    assert reading["bar"]["counts_held"] == held
    assert reading["bar"]["met"] == (gain >= BAR_POINTS and held)
