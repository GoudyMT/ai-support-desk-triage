"""The 90-day run's pass mark, as code, written before the run it judges.

The mark (design 2026-11-12, section 4, locked by the owner): in days 61-90 the retrained
model is right on department more often than the frozen start model on the same tickets, on
at least 3 of 4 streams; its own accuracy in days 61-90 is higher than in days 1-30 on at
least 3 of 4 streams; and neither hard line (High/Urgent sent out as low, high-risk missed),
counted over days 1-90, is above the frozen model's count on any stream.
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
        A dict with the three accuracies, whether each part of the mark held, and whether
        the stream ran all its weeks.
    """
    late_retrained = _accuracy(stream, "retrained", LATE)
    late_frozen = _accuracy(stream, "frozen", LATE)
    early_retrained = _accuracy(stream, "retrained", EARLY)
    held = all(_total(stream, "retrained", line, ALL_DAYS) <= _total(stream, "frozen", line, ALL_DAYS) for line in HARD_LINES)
    return {
        "complete": len(stream["weeks"]) == WEEKS,
        "early_retrained": early_retrained,
        "late_retrained": late_retrained,
        "late_frozen": late_frozen,
        "beats_frozen": late_retrained > late_frozen,
        "beats_own_start": late_retrained > early_retrained,
        "hard_lines_held": held,
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


def main():
    """Writes the verdict into the run's record, so the record and its judgement travel together."""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "reports" / "ninety_day.json"
    report = json.loads(path.read_text(encoding="utf-8"))
    report["note"] = RECORD_NOTE
    report["verdict"] = judge(report)
    path.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"    Passed: {report['verdict']['passed']} (complete: {report['verdict']['complete']})")


if __name__ == "__main__":
    main()
