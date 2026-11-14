"""How hard the start model finds each held-out template, rated on the candidate pool.

The fair 90-day run deals templates into weeks so every week is about as hard for the
start model. A template's rating is the start model's share of right departments on the
pool tickets built from it, and its count is how many pool tickets used it (how often the
week builder will meet it).
"""

ANSWER_MISSING = "E_ANSWER_MISSING"


def template_difficulty(rows, answers):
    """
    Rates every template the pool used.

    Args:
        rows: Pool tickets, each with id, category (the true department) and templates
            (the names of the templates it was built from).
        answers: The start model's answers, each with id and category.

    Returns:
        {template name: {"right": share of right departments, "count": tickets}}; a template
        no ticket used is left out.

    Raises:
        SystemExit: A pool ticket has no answer (E_ANSWER_MISSING).
    """
    said = {answer["id"]: answer["category"] for answer in answers}
    totals = {}
    for row in rows:
        if row["id"] not in said:
            print(f"    No answer for pool ticket {row['id']}. Score the whole pool again.")
            raise SystemExit(ANSWER_MISSING)
        right = said[row["id"]] == row["category"]
        for name in row["templates"]:
            seen, hits = totals.get(name, (0, 0))
            totals[name] = (seen + 1, hits + int(right))
    return {name: {"right": hits / seen, "count": seen} for name, (seen, hits) in totals.items()}
