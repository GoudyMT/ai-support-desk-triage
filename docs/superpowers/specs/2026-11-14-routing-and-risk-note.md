# Design Note: Routing and Risk as Separate Jobs

**Date:** 2026-11-14
**Status:** finding recorded; the starting point for the final version, to be planned with plan-feature
**Owner's words (2026-11-14):** "we have 90% accuracy, but more tickets - the logic is broken, meaning our guards and
system arent aligned to my intent"; the final version "shows the correction with high accuracy and lowered tickets to
operator".

## The finding

The desk does two jobs and treats them as one:

1. **Routing:** which department, and how urgent.
2. **Risk:** whether a person must handle the ticket themselves.

A ticket waits for a triage person whenever either job raises a doubt. Routing improved a lot this version: the
sentence model is right on the department 83.9% of the time on held-out wording (word model 57.3%) and 90.8% on the
blind set (69.6%). Risk did not change: it is still six keyword rules, three always-checked departments and the word
model's 50% confidence floor. The stronger model was only allowed to add tickets for a person. So a better model could
not mean fewer tickets: the design ruled it out.

## What the numbers show

On the desk's own wording, 4,000 tickets, with both models, from the recorded answers in `ml/reports/`. The table and
the escalated-complaint counts are printed by `npm --prefix web run measure-routing` (its "why sent" lines); the floor
tries by `npm --prefix web run measure-agreement`; the direct routes by `measure-routing` too.

| | Tickets |
|---|---|
| Truly need a person (label) | 1,493 (37%) |
| Sent to a person today | 3,333 (83%) |
| First reason: a word rule fired | 1,835 (805 did not need a person) |
| First reason: an always-checked department | 542 (275 did not) |
| First reason: the word model under 50% sure | 806 (693 did not; 113 truly risky that no rule caught) |
| First reason: the models disagree | 150 |

**Tried and not adopted** (the bar: fewer tickets to a person on every set, high-risk missed and High/Urgent out as
low never worse, wrong answers out unchecked within 0.25% of a set):

- **Let agreement skip the 50% floor** (the "full lift" lines). Cut 10 to 18 points of tickets on the folds, but high-risk tickets out rose on
  three of four folds (fold 1: 4 to 36). The floor is quietly catching risky tickets the rules miss.
- **A partial lift, chosen on the folds** (agreement skips the floor only from 45% down to 5%). No setting met the bar
  on all four folds; even 45% let more high-risk tickets out on folds 1 to 3.
- **Narrow the escalated-complaint rule.** It fires on 1,379 desk tickets, 722 not needed. But each of its busiest
  words ("fed up", "sick of", "annoyed", "tired of", "angry") is also the only catch for some truly risky tickets:
  the newer wording has annoyed-but-routine customers using the same words as real escalations. A word list cannot
  tell them apart. (The fire counts come from `measure-routing`; the per-word check was a one-off probe that is not in
  the repo, so that part is UNVERIFIED by a script and should be measured again before the final version leans on it.)
- **Send agreed, urgent, flagged tickets straight to their department** (triage keeps disagreements and unsure ones).
  Triage fell 5 to 19 points on every set, and no risky ticket left without a person. But on the desk wording 129 of
  560 direct tickets reached the wrong department first (115 of them flagged by a word rule), and on fold 1 131 of 327
  (120 by an always-checked department alone).

## The direction for the final version

- **Triage only for routing doubt:** a person checks the routing when the models disagree on where a ticket goes.
- **Risk is a mark, not a wait:** a risky ticket goes straight to its team, marked urgent and "needs a person".
- **A risk detector of its own, judged on its own bar,** built and measured before any ticket stops going to triage.
  It must at least replace what the 50% floor catches today (113 risky desk tickets no rule sees). A learned "needs a
  person" head was tried in Part 1 and failed its bar in all 12 rounds; the new attempt starts from that record.
- **Direct routes must be right:** the measured misroutes above set the bar to beat.

To be decided with the owner in the plan: the success charter (what "fewer tickets" must reach, and how many
misroutes, if any, are acceptable), the risk detector's approach, and how the desk shows a "needs a person" ticket that
skipped triage.
