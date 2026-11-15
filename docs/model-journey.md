# How the Triage Model Got Here

A plain account of where this project started, what was tried, what worked and what did not. Numbers come from the project's records; each table names its source file.

## 1. Where it started

The project began as course work: a support-ticket triage page that sorted tickets with keyword rules. Version 1 replaced the rules with a trained word model (word weights plus safety rules) and showed it working live on generated tickets.

| Model | Department right on unseen wording | Hand-written tickets right | High-risk missed | Sent to a person |
|---|---|---|---|---|
| Course prototype (keyword rules) | 33.6% | 14 of 48 | not measured | not measured |
| Version 1 word model | 57.3% | 39 of 48 | 0 of 24 | 78% |

Source: `web/src/history/history.json`.

Two rules were set early and never bent: a High or Urgent ticket is never sent out unchecked as Low or Medium, and a high-risk ticket is never missed. Every change since has been judged against those two lines first.

## 2. First try: send fewer tickets to a person (did not work)

The first goal after version 1 was to cut the 78% of tickets that go to a person. Three things were tried:

- **A stricter gate and a guard for High/Urgent tickets.** It failed the High/Urgent line on the test sets.
- **Two batches of new training wording.** They missed the bar.
- **Learning from the answers people give.** It looked like a 51% cut, but a check showed the model was remembering wording it had already been shown, not learning. It passed that check on 0 of 4 sets.

The version closed with no model change. **What it taught:** a gain that comes from remembered wording is not real. Every later test was built to rule that out, and the old test sets, read six times by then, were retired for a fresh blind set.

## 3. Second try: a sentence model (accuracy worked, workload did not)

The word model only knows words it has seen. A small sentence model (all-MiniLM-L6-v2) reads meaning, so it should cope better with new wording. Measured on 12 practice rounds:

| Step | Department right |
|---|---|
| Word model | 52.4% |
| Sentence model, as it comes | 66.8% |
| Sentence model trained on our tickets | 81.5% |

High/Urgent tickets called low fell from 5,276 to 2,799 across those rounds.

**What did not work:** using the sentence model to send fewer tickets to a person. Four ways were tried and all failed their bar. Vague tickets and disputes would have left unchecked, and some high-risk tickets were wrong on new wording.

**What worked instead: the two-model rule.** The word model stays the gate. The sentence model gives the suggestion the person sees. A ticket leaves unchecked only when the gate allows it and both models agree, so no safety line can get worse. The share sent to a person rose slightly (90.1% -> 91.9% on the practice rounds), and the suggestion a person sees went from fully right 38% of the time to 60%.

Source: the project's records for the sentence model version (practice report and the Part 1 plan).

## 4. The first 90-day run (did not pass, and the test had two flaws)

To show growth over time, the sentence model was put through a simulated 90 days: 4 streams of 13 weeks, retrained each week on the tickets a person checked, beside a frozen copy that never learns. The pass mark, written before the run: on at least 3 of 4 streams the retrained model beats the frozen one in days 61-90, beats its own days 1-30, and is never worse on the two safety lines.

| Stream | Days 1-30 | Days 61-90 | Frozen, days 61-90 |
|---|---|---|---|
| 0 | 83.1% | 92.1% | 83.8% |
| 1 | 84.1% | 81.6% | 80.8% |
| 2 | 90.2% | 80.3% | 76.7% |
| 3 | 77.4% | 84.2% | 82.7% |

It beat the frozen model on 4 of 4 streams but its own start on only 2 of 4, so it **did not pass**. Source: `ml/reports/ninety_day.json`.

Looking closer found two flaws in the test itself:

1. **The weeks were not equally hard.** The frozen model never changes, yet its score moved between days 1-30 and 61-90 by -14.4 to +8.4 points. "Beats its own start" was mostly measuring which weeks were hard.
2. **Some wording repeated across weeks.** Threat phrases, two-topic joins and product names came back in later weeks, which helped the retrained model by memory.

## 5. The fair 90-day run: making the test fair

Two fixes were built:

- **A teaching copy.** The retrained model learns from a copy of each checked ticket in which every repeated piece is swapped for one the start model already knew. It cannot gain by remembering them.
- **Equal weeks.** Before any retraining, the start model's scores on days 1-30 and days 61-90 must be within 2.0 points on every stream.

Getting equal weeks took four tries. Each was measured, and each failure was stopped and reported before anything was retrained:

| Try | What it did | Result |
|---|---|---|
| 1. Deal templates by difficulty, one pass | Rated each template on 40,000 pool tickets, then dealt them out | Failed: stream 0 was 8.2 points apart. The ratings were good; the dealing put most hard templates into week 0. |
| 2. Swap templates between weeks | Evened out the predicted weeks | Stream 0, 1 and 3 passed (1.93, 0.57, 1.20); stream 2 failed at 2.53. |
| 3. A better prediction | Predicted each week from its actual tickets | Not used: still up to 1.7 points off. With 3,000 tickets per window, chance alone moves the gap by about a point. |
| 4. Reorder whole weeks | Kept every week exactly as built and changed only their calendar order, using the start model's measured scores | Passed: gaps 0.00, 0.00, 0.00 and 0.03. |

The limit was never raised. **What it taught:** when a prediction cannot be trusted, measure instead, as long as the measurement uses only the model that never learns. Reordering by the start model's scores makes its curve flat by design, which is exactly what "equal weeks" means. It cannot favor the retrained model.

Source: `ml/reports/ninety_day_fair.json` and the fair run plan, `docs/superpowers/plans/2026-11-12-fair-run-and-desk.md`.

## 6. Where it stands now

- **The fair run did not pass.** With equal weeks and no repeated wording to remember, retraining each week did not make the model reliably better:

| Stream | Days 1-30 | Days 61-90 | Frozen, days 61-90 |
|---|---|---|---|
| 0 | 86.2% | 86.2% | 84.2% |
| 1 | 76.1% | 86.1% | 76.9% |
| 2 | 76.7% | 71.0% | 75.5% |
| 3 | 78.0% | 75.0% | 75.5% |

  It beat the frozen model on 2 of 4 streams and its own start on 1 of 4 (3 of 4 needed for each). The two safety lines were never worse than the frozen model's on any stream. Source: `ml/reports/ninety_day_fair.json`.

  Read beside the first run, this is the honest finding: much of the first run's growth came from the uneven weeks and the repeated wording. Week-by-week retraining on the tickets a person checks, as built today, does not yet show real growth.
- **Both models went on the live desk (v1.1).** The 2,000-ticket blind set was read once, after everything was frozen. The sentence model got the category right on 90.8% of it, against 69.6% for the word model. On the tickets a person checks, the suggestion they see was right on the category 88.8% of the time, against 62.9% for the word model's answer. Model History, the model card and a download page show these numbers, the two runs that did not pass included. Source: `ml/reports/blind_reading.json`.

## 7. Version 1.2: routing and risk as separate jobs (worked)

Better routing had not shrunk the operator's queue: on the desk wording, 3,333 of 4,000 tickets (83%) still waited for a person. The reason was that one queue did two jobs. "Where does this ticket go?" and "must a person handle it?" were the same question.

Version 1.2 split them. The operator now checks a ticket only when the two models place it on a different team or priority, or it is too vague to place. A risky ticket goes straight to its team, marked "needs a person" and raised to at least High. Every other ticket goes to the team both models name.

| Desk wording, 4,000 tickets | Before | After the split |
|---|---|---|
| Waiting for the operator | 3,333 (83%) | 1,915 (48%) |
| Risky tickets sent out with no person | 55 | 55 |
| High or Urgent sent out as low | 0 | 0 |
| Sent to the team marked "needs a person" | not used | 1,418 (691 did not need one) |
| Marked tickets that reach the wrong team first | not used | 301 |

On the 60 tickets written blind, the operator checks 24 instead of 50, and none of the 20 risky tickets is missed. The costs are shown, not hidden: 691 marks were not needed, and 301 marked tickets reach the wrong team first. CI works the numbers out again on every change and fails if any safety line gets worse. Source: `ml/reports/split_flow.json`.

**What did not work: a learned risk detector.** It was meant to replace the word model's doubt as the trigger for the mark. Its bar was written before any number: no worse than the split on every safety line, on all seven sets, and fewer false marks. It cut false marks on every set, but it failed the bar on 6 of 7 and let more risky tickets through on 3 (on the desk, 55 to 75). It was not adopted. Source: `ml/reports/risk_detector.json`.

**What it taught:** the queue was too long because of how the work was shaped, not because the model was weak. Separating the two jobs did what the earlier tries at a better gate could not.

## 8. How to explain it

- **The goal:** a model that gets better at sorting support tickets, without ever being less safe on urgent or high-risk tickets.
- **What worked:** a sentence model reads new wording far better (52% -> 82% on practice rounds), and pairing it with the word model keeps every safety line intact.
- **What did not:** making the gate itself send fewer tickets to a person. Every attempt either broke a safety line or turned out to be memory, not learning. What did cut the queue was splitting routing from risk (83% -> 48% of desk tickets to the operator, no safety line worse).
- **The habit behind it:** write the pass mark before the result, never loosen it afterwards, and when a result looks too good or too bad, check the test before trusting the model. Twice, checking the test changed the story.
