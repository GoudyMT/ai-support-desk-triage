# PR 3: The Pipeline - Design

Parent design: `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` (sections 5.1, 5.4, 5.6, 6, 7, 9,
10.2). This doc adds only what PR 3 needs on top of it; it does not restate the parent.

## 1. Intent and why

PR 2 left three working parts with nothing joining them: the masker, the model scorer and the v0 port. PR 3
joins them into the six-stage pipeline, adds the guardrails and the simulated reviewer, and computes the run's
numbers. PR 4 (the page) and PR 5 (the report) only display what this PR produces.

Evidence that shapes it (probe, 2026-10-31, fold models on held-out tickets): the model plus a confidence
floor alone cannot meet the v1 gate of zero high-risk tickets missed.

| Flag rule (model only) | Folds flagged | Folds missed | Hand-written flagged | Hand-written missed |
|---|---|---|---|---|
| must-review category, no floor | 42% | 2,365 of 5,856 | 38% | 6 of 22 |
| plus floor 0.5 | 85% | 680 | 60% | 3 |
| plus floor 0.7 | 95% | 300 | 88% | 0 |

About 37% of tickets are must-review by the labeling rules, so 37% is the lowest honest flag rate. The model
alone misses 909 of 1,008 billing disputes and 597 of 944 vague tickets: a dispute is still "Billing" and a
vague ticket is still "Other" to a category model. Only rules that read the words can catch them.

## 2. Goals

1. Every ticket passes through the six stages, and each stage leaves a record the page can show.
2. Zero high-risk tickets missed on every held-out fold, through the full pipeline (parent section 6).
   > SUPERSEDED (2026-10-31): zero on the hand-written set, no regression on the folds - see section 5.
3. The flag rate is measured and shown beside "high-risk missed", with the floor and target set with the owner.
   > SUPERSEDED (2026-10-31): no separate target; each set's flag rate is held at its start point - see section 5.
4. The run's numbers (parent 5.6) are computed from real outcomes, each one traceable to the tickets it counts.

## 3. Non-goals and anti-goals

- **Non-goals:** any screen (PR 4); the end report page and value panel (PR 5); retraining or tuning the model;
  a second model in the browser (parent stretch tier).
- **Anti-goals:** personal data reaching the model or a rule log; a rule that lowers priority on a sensitive
  ticket; a "zero missed" result that comes from rules fitted to the generator's own wording.

## 4. Constraints

- Tier 0 (adapter A2-A4): fictional data only; nothing typed leaves the page; no network calls.
- Runs in the browser and in Node (tests, measurement scripts) with the same code.
- Size budgets start in PR 4; PR 3 adds no runtime dependency.

## 5. What the owner decided

- 2026-10-29 (parent 10.2): flagged = a keyword rule fires, or the model predicts a must-review category, or
  confidence is below the floor. Flag-rate target set after the first honest run.
  > SUPERSEDED (2026-10-31): no separate target; the flag rate is held at each set's start point - see the last
  > entry of this section.
- 2026-10-29 (parent 10.2): the second check is a PR 3 experiment. It may clear only flags whose only reason is
  low confidence, never a hard-rule flag; its misses count; kept only if it lowers the flag rate with zero
  added misses on the hand-written set.
  > SUPERSEDED (2026-10-31): built, measured, and kept off by the owner - see the last entry of this section.
- 2026-10-31: the keyword rules are written only from the review list in parent C1 (security, accessibility,
  billing dispute, threatening language, escalated complaint, vague), frozen before the first measurement, and
  the hand-written set is their real test.
  > SUPERSEDED (2026-10-31): the rules were revised twice by the owner's rulings, and the first hand-written set
  > is now "seen"; the fresh set is their real test - see the last two entries of this section.
- 2026-10-31: the reviewer error rate, the intake size cap and the live-stream split are Claude's calls
  (section 12).
- 2026-10-31: the second check is a stricter rule, not a second model: a flag whose only reason is low
  confidence is cleared when the category head's top two classes are both outside the must-review
  categories. Design approved the same day.
- 2026-10-31 (after measurement): confidence floor 0.5; the bar is zero missed on the hand-written set and no
  regression on the held-out folds from the recorded start point (parent section 6); the second check is off.
  This replaces "zero missed on every held-out fold" in goal 2 and section 8.
- 2026-10-31 (after the sweep): (1) the rules are narrowed from plain meaning where they flagged ordinary
  tickets; (2) the first hand-written set shaped the rule revision, so it is reported as "seen", and a fresh
  set of 60, written blind to the rules, the model, the generator and the old set, was reviewed and frozen by
  the owner before any measurement on it; (3) each set's flag rate and must-review count are held at its start
  point too (flagging everything would miss nothing; lost labels would hide misses); (4) the second check stays
  off: at floor 0.5 it adds 2-49 misses per fold and 1 on the fresh set, although it added none on the seen
  set (the 2026-10-29 keep rule).

## 6. The approach

Each stage is a pure function from the ticket's record so far to the next record; one `runTicket` calls them in
order and returns the whole trail. A run is a list of trails; the metrics are pure functions over that list.
The reviewer is passed in, so PR 4's "Take over" swaps the simulated reviewer for the viewer without touching
the pipeline (build seam-first, rule:dual-horizon).

Rejected: an event stream or a stateful engine object (more moving parts, harder to test, nothing in v1 needs
streaming between stages); putting the rules inside the model step (hides which layer flagged a ticket).

## 7. Requirements

**Must**
1. **Intake:** assigns id and time; rejects empty text and text over the cap with static error codes.
2. **Privacy:** runs `maskText`; every later stage reads only the masked text, except v0, which reads the raw
   text as v0 did (parent C2) and is used only for the comparison.
3. **Classify:** runs both model heads on the masked text; keeps label, confidence and top words.
4. **Guardrails:** the keyword rules and the confidence floor; output = flag yes or no, every reason that fired,
   and the priority after rules. A rule may raise priority to the C1 priority of its reason; it never lowers
   one. The model's category is kept as its suggestion; rules do not change it. The must-review categories
   are Security Concern, Accessibility Support and Urgent Complaint (a predicted Billing is not one: the model
   cannot see a dispute, the dispute rule does). The floor tests the category head's confidence only, as the
   probe in section 1 did.
5. **Review:** flagged tickets go to a reviewer function; unflagged tickets are done as the model said.
6. **Simulated reviewer:** decides from the ticket's true answer, wrong at a stated rate, seeded so a run
   replays exactly; when it disagrees with the model it gives a reason in plain words (parent 5.4).
7. **Report metrics:** category and priority accuracy for the model alone and the system after review;
   high-risk missed; flag rate and the share of flags by reason; reviewer override rate; v0 on the same tickets
   (category, priority, review flag); time per ticket measured; the most instructive misses with their words.
8. **Measurement script and CI check:** runs the pipeline over every held-out fold (each with its fold model)
   and the hand-written set (with the shipped model, as `evaluate.py` scores it), and prints the numbers in
   goals 2-3, so the floor and target are set from it. The CI model job, which already retrains, also exports
   the four fold models to a temporary folder and fails if any fold or the hand-written set has a high-risk
   miss. Fold models are never committed.
   > SUPERSEDED (2026-10-31): it fails when a set breaks its start point (misses, flag rate, ticket and
   > must-review counts), over the folds and both hand-written sets (seen and fresh), and when a set is missing, a
   > fold file names another fold or the frozen fresh set changed - see section 5.

**Should**
- The second-check experiment (section 5), as a stage between guardrails and review that is off unless the
  measurement keeps it. (Built; off - section 5.)

**Later (seams only)**
- The viewer as reviewer (PR 4 Take over); the run clock, arrival rate and capacity test (PR 4); value saved
  (PR 5 assumptions panel). PR 3 exposes "handled without manual triage" so PR 5 needs no pipeline change.

## 8. Acceptance criteria

- Given empty or whitespace text, intake rejects it with its code and nothing reaches later stages.
- Given text over the cap, intake rejects it; given text at the cap, it passes.
- Given a ticket with an email, phone, order or card number, no later stage's record holds the raw value
  (the classify input, rule log, reviewer input and trail are checked).
- Given each review reason in C1, a plain ticket of that kind that the model misreads is still flagged by its
  rule (one test per reason, model stubbed to a wrong safe answer).
- Given a sensitive ticket the model scores Low, the final priority is the C1 priority; no path lowers a
  priority a rule set.
- Given a confident non-sensitive ticket with no rule fired, it is done without review.
- Given the same seed twice, the reviewer's decisions are identical; over 10,000 decisions its error rate is
  within 1 point of the stated rate.
- Given a run, every metric equals a hand count on a fixed small fixture.
- On every held-out fold and on the hand-written set (parent 10.1), through the full pipeline with the chosen
  floor: high-risk missed = 0, checked in CI.
  > SUPERSEDED (2026-10-31): zero on the hand-written set, each fold at or under its start-point count - see
  > section 5.

## 9. Success criteria

Parent section 6, unchanged; PR 3 owns "high-risk tickets missed: 0" and supplies the numbers for "every number
on screen traces to a measurement". The flag-rate target is added to parent 6 once the owner sets it.
> SUPERSEDED (2026-10-31): "missed: 0" holds on both hand-written sets; each fold is held at its start point,
> and the flag rate is held there too, not a separate target (parent section 6).

## 10. Risks and open questions

- **Blocking, the owner (after measurement):** the confidence floor and the flag-rate target, from the
  measurement script's table.
  > RESOLVED (2026-10-31): floor 0.5; no separate flag-rate target - see section 5.
- **Blocking, a probe:** if frozen rules plus any floor under 0.9 still miss tickets on held-out folds, stop
  and bring the misses to the owner. Rule changes after the freeze are a recorded decision with before / after
  numbers on the hand-written set, never quiet tuning (rule:re-plan-on-failure).
  > RESOLVED (2026-10-31): the stop was hit and brought to the owner; rulings in section 5.
- **Non-blocking:** keyword rules will flag some non-sensitive tickets that use the words ("security" in a
  question about a plan); that cost shows up in the flag rate, which is the point of measuring it.

## 11. Left to the builder

File layout under `web/src/pipeline/`; record field names; the plain-words wording of reviewer reasons (the
owner reviews it in PR 4); how the most instructive misses are ranked.

## 12. Your calls (Claude, for the owner to check)

- **Reviewer error rate: 5%,** shown on screen as an assumption. An error picks a different category (seeded)
  and keeps the true priority, so the rate is one number with one meaning. It lowers the system's accuracy; it
  is not a "high-risk missed", because the ticket was reviewed.
- **Priority a rule raises to:** the lowest C1 priority of its reason: security Urgent, threatening language
  Urgent, accessibility High, escalated complaint High, billing dispute Medium, vague Medium. Every rule-fired
  ticket is reviewed, so this sets only the priority shown before review.
- **Fold models in CI, not committed:** follows the PR 2 precedent (the model job retrains and checks the floor
  on a fresh export); it costs the training time of four fold models in the CI model job.
- **Intake cap:** set from a measurement in the plan: the masker's time at 2,000 / 5,000 / 10,000 / 20,000
  characters, and the largest size that masks in under 5 ms on the owner's PC. Measured 2026-10-31: 20,000
  characters mask in 0.50 ms (median), so the cap is 20,000.
  > SUPERSEDED (2026-10-31): that measurement was English text only; Chinese text masks in 23 ms. The cap stays
  > 20,000, judged on the whole pipeline (English 8 ms, Chinese 27 ms at most) against 50 ms, where a browser
  > task counts as long - see the plan's Execution Notes.
- **Live stream split:** all folds, its own seed range (parent 5.2 already says so); the live page has no
  held-out claim, and its accuracy is labelled "on generated tickets".
- **Who writes the keyword rules:** a fresh builder whose brief gives only parent C1 and this doc, and forbids
  reading the generator, its data or the hand-written set; the lead has read the generator and so does not
  write them.
- **Model category "Other" is not a flag by itself;** vague tickets are caught by the vague rule. The
  measurement shows the cost of that choice and it can flip.
- **Sweep:** Opus checker on guardrails and privacy wiring, plus a security sweep (parent section 7).
