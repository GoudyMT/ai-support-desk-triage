"""The 90-day run's pass mark, as code, written before the run it judges.

The mark (design 2026-11-12, section 4, locked by the owner): in days 61-90 the retrained
model is right on department more often than the frozen start model on the same tickets, on
at least 3 of 4 streams; its own accuracy in days 61-90 is higher than in days 1-30 on at
least 3 of 4 streams; and neither hard line (High/Urgent sent out as low, high-risk missed),
counted over days 1-90, is above the frozen model's count on any stream.

Thirteen weeks of seven days run 91 days; day 91 is scored and kept in the record, but the
mark names days 1-90, so it counts in no window here.
"""

STREAMS = 4
WEEKS = 13
DAYS_PER_WEEK = 7
STREAMS_NEEDED = 3
EARLY = range(1, 31)
LATE = range(61, 91)
ALL_DAYS = range(1, 91)
HARD_LINES = ("highUrgentOutLow", "highRiskMissed")


def _days(stream):
    """Yields (day number from 1, the day's counts) across the stream's weeks in order."""
    for week in sorted(stream["weeks"], key=lambda w: w["week"]):
        for day in week["days"]:
            yield week["week"] * DAYS_PER_WEEK + day["day"], day


def _total(stream, model, field, days):
    return sum(counts[model][field] for number, counts in _days(stream) if number in days)


def _accuracy(stream, model, days):
    tickets = _total(stream, model, "tickets", days)
    return _total(stream, model, "categoryRight", days) / tickets if tickets else 0.0


def judge_stream(stream):
    """
    Judges one stream against its share of the mark.

    Args:
        stream: The stream's record, with its weeks and each day's counts for both models.

    Returns:
        A dict with the three accuracies, whether each part of the mark held, each hard
        line's total for both models, and whether the stream ran every week once.
    """
    late_retrained = _accuracy(stream, "retrained", LATE)
    late_frozen = _accuracy(stream, "frozen", LATE)
    early_retrained = _accuracy(stream, "retrained", EARLY)
    totals = {line: {model: _total(stream, model, line, ALL_DAYS) for model in ("retrained", "frozen")} for line in HARD_LINES}
    held = all(totals[line]["retrained"] <= totals[line]["frozen"] for line in HARD_LINES)
    return {
        "complete": sorted(week["week"] for week in stream["weeks"]) == list(range(WEEKS)),
        "early_retrained": early_retrained,
        "late_retrained": late_retrained,
        "late_frozen": late_frozen,
        "beats_frozen": late_retrained > late_frozen,
        "beats_own_start": late_retrained > early_retrained,
        "hard_lines_held": held,
        "hard_line_totals": totals,
    }


def judge(report):
    """
    Judges the whole run.

    Args:
        report: The run's record, with one entry per stream under "streams".

    Returns:
        A dict: "passed", "complete" and one verdict per stream in stream order. A run
        that has not finished every week of every stream never passes.
    """
    streams = [judge_stream(report["streams"][key]) for key in sorted(report["streams"], key=int)]
    complete = len(streams) == STREAMS and all(s["complete"] for s in streams)
    passed = (
        complete
        and sum(s["beats_frozen"] for s in streams) >= STREAMS_NEEDED
        and sum(s["beats_own_start"] for s in streams) >= STREAMS_NEEDED
        and all(s["hard_lines_held"] for s in streams)
    )
    return {"passed": passed, "complete": complete, "streams": streams}


RECORD_NOTE = (
    "Recorded once on the owner's PC; the models trained in the run are not in the repo, so CI "
    "judges these counts again (test_ninety_day_record.py) but does not retrain."
)


FAIR_RECORD_NOTE = (
    "The fair run: weeks dealt and ordered so the start model scores days 1-30 and 61-90 alike "
    "(see each stream's balance), and retrained models taught from copies with held-out pieces "
    "swapped. Recorded once on the owner's PC; CI judges these counts again "
    "(test_ninety_day_fair_record.py) but does not retrain."
)


def record_verdict(path, note):
    """
    Writes the judge's verdict and a note into one run's record, so they travel together.

    Args:
        path: The record to judge; no other file is touched.
        note: What the record is, in a sentence or two.

    Returns:
        The verdict.
    """
    import json

    report = json.loads(path.read_text(encoding="utf-8"))
    report["note"] = note
    report["verdict"] = judge(report)
    path.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    return report["verdict"]


def main():
    """Judges the first run's record, or the fair run's with --fair."""
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--fair", action="store_true", help="judge the fair run's record")
    args = parser.parse_args()
    reports = Path(__file__).resolve().parents[1] / "reports"
    path, note = (reports / "ninety_day_fair.json", FAIR_RECORD_NOTE) if args.fair else (reports / "ninety_day.json", RECORD_NOTE)
    verdict = record_verdict(path, note)
    print(f"    Passed: {verdict['passed']} (complete: {verdict['complete']})")


if __name__ == "__main__":
    main()
