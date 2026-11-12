"""Tests of the template rating the fair 90-day run deals weeks by.

What they guard: a ticket counts toward every template it was built from; the rating is the
start model's share of right departments on those tickets; a template no ticket used gets no
rating (the deal then gives it its list's mean); an answer missing for a pool ticket stops the
rating instead of skewing it.
"""

import pytest

from triage_v2.template_difficulty import ANSWER_MISSING, template_difficulty


def row(ticket_id, category, templates):
    return {"id": ticket_id, "category": category, "templates": templates}


def answer(ticket_id, category):
    return {"id": ticket_id, "category": category, "priority": "Low"}


def test_rates_each_template_on_every_ticket_that_used_it():
    rows = [
        row("a", "Billing", ["built-in|plain1|0"]),
        row("b", "Billing", ["built-in|plain1|0"]),
        row("c", "Billing", ["built-in|plain1|0", "built-in|plain3|2"]),
        row("d", "Other", ["extra|vague|4"]),
    ]
    answers = [answer("a", "Billing"), answer("b", "Technical Issue"), answer("c", "Billing"), answer("d", "Billing")]
    rated = template_difficulty(rows, answers)
    assert rated == {
        "built-in|plain1|0": {"right": pytest.approx(2 / 3), "count": 3},
        "built-in|plain3|2": {"right": 1.0, "count": 1},
        "extra|vague|4": {"right": 0.0, "count": 1},
    }


def test_leaves_out_a_template_no_ticket_used():
    rated = template_difficulty([row("a", "Billing", ["built-in|plain1|0"])], [answer("a", "Billing")])
    assert "built-in|plain1|1" not in rated


def test_refuses_a_pool_ticket_with_no_answer():
    rows = [row("a", "Billing", ["built-in|plain1|0"]), row("b", "Billing", ["built-in|plain1|0"])]
    with pytest.raises(SystemExit) as stopped:
        template_difficulty(rows, [answer("a", "Billing")])
    assert stopped.value.code == ANSWER_MISSING
