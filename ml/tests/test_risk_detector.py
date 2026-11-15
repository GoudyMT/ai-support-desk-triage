"""Tests for the risk detector: the yes/no word model for the five risk reasons, and its tuning side."""

import random

import pytest

from triage_v2.risk_detector import build_set, is_risky, split_tuning

RISK_WORDS = ["hacked", "lawyer", "screen reader", "disputed charge", "furious"]
ROUTINE_WORDS = ["invoice copy", "shipping date", "dark mode", "export csv", "time zone"]
FILLER = ["please", "help", "today", "thanks", "again"]


def make_rows(count, seed, prefix="T"):
    """Toy tickets: a risky one says a risk word, a routine one a routine word, both with filler."""
    rng = random.Random(seed)
    rows = []
    for i in range(count):
        risky = rng.random() < 0.4
        words = [rng.choice(RISK_WORDS if risky else ROUTINE_WORDS)] + rng.sample(FILLER, 2) + [f"{prefix.lower()}{i}"]
        rows.append({
            "id": f"{prefix}-{i}",
            "maskedText": " ".join(words),
            "category": "Security Concern" if risky else "Billing",
            "priority": "Urgent" if risky else "Low",
            "mustReview": risky,
            "reviewReason": "security incident" if risky else None,
        })
    return rows


def test_a_vague_ticket_is_a_routing_doubt_not_a_risk():
    assert is_risky({"mustReview": True, "reviewReason": "billing dispute"})
    assert not is_risky({"mustReview": True, "reviewReason": "vague ticket"})
    assert not is_risky({"mustReview": False, "reviewReason": None})


def test_the_tuning_side_is_a_fifth_of_the_training_side_the_same_every_time_and_apart_from_it():
    rows = make_rows(500, 1)
    train, tune = split_tuning(rows)
    assert len(tune) == 100
    assert {row["id"] for row in train}.isdisjoint({row["id"] for row in tune})
    assert sorted(row["id"] for row in train + tune) == sorted(row["id"] for row in rows)
    assert [row["id"] for row in split_tuning(rows)[1]] == [row["id"] for row in tune]


def test_a_judged_ticket_found_in_training_stops_the_set():
    rows = make_rows(300, 2)
    with pytest.raises(ValueError, match="E_HELDOUT_IN_TRAIN"):
        build_set(rows, [rows[0]])


# A tuning text the detector also learned from makes it look surer on the tuning side than on unseen tickets, which
# pushes the cut-off up; the generated sets repeat texts, so the guard must hold on the tuning side too.
def test_a_tuning_text_also_in_training_stops_the_set():
    rows = make_rows(300, 9)
    train, tune = split_tuning(rows)
    copied = [{**row, "maskedText": train[0]["maskedText"]} if row["id"] == tune[0]["id"] else row for row in rows]
    with pytest.raises(ValueError, match="E_HELDOUT_IN_TRAIN"):
        build_set(copied, make_rows(10, 10, prefix="J"))


def test_the_detector_says_yes_more_often_to_risky_tickets_it_never_saw():
    built = build_set(make_rows(400, 3), make_rows(100, 4, prefix="J"))
    judged = make_rows(100, 4, prefix="J")
    scores = dict(built["judged_scores"])
    assert [row["id"] for row in judged] == [pair[0] for pair in built["judged_scores"]]
    assert all(0.0 <= p <= 1.0 for p in scores.values())
    risky = [scores[row["id"]] for row in judged if is_risky(row)]
    routine = [scores[row["id"]] for row in judged if not is_risky(row)]
    assert min(risky) > max(routine)


def test_the_tuning_rows_are_kept_out_of_the_detector_and_the_word_model_it_is_tuned_beside():
    rows = make_rows(400, 5)
    _, tune = split_tuning(rows)
    held = {row["id"] for row in tune}
    # Only the tuning rows say "zebra", and all of them are risky: learned from, it would mean yes.
    marked = [
        {**row, "maskedText": row["maskedText"] + " zebra", "mustReview": True, "reviewReason": "security incident"} if row["id"] in held else row
        for row in rows
    ]
    probe = {"id": "J-0", "maskedText": "zebra please today", "category": "Billing", "priority": "Low", "mustReview": False, "reviewReason": None}
    built = build_set(marked, [probe])
    assert built["tune_ids"] == [row["id"] for row in tune]
    assert built["judged_scores"][0][1] < 0.5
    for head in built["tune_model"]["heads"].values():
        assert "zebra" not in head["vocabulary"]


def test_risk_scores_are_one_pair_per_row_in_order():
    built = build_set(make_rows(300, 7), make_rows(10, 8, prefix="J"))
    assert len(built["tune_scores"]) == len(built["tune_ids"])
    assert [pair[0] for pair in built["tune_scores"]] == built["tune_ids"]
