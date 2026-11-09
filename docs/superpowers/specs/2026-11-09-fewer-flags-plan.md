# Fewer Tickets to a Person, Without Losing Accuracy - The Plan

**Date:** 2026-11-09. **Status:** approved by the owner ("Approved", 2026-11-09), with checks 3-5 of Phase 2 added at their request. **Closed at Phase 2, check 1 (2026-11-09):** on wording it was not taught, the loop cut no flags on any of 4 tuning streams and one stream sent one more High/Urgent ticket out low, so the -51% below is memory of checked wording, not learning. Phase 1 also failed the High/Urgent rule on the test folds. The owner chose to close the version with no model change ("Just go" on the recommendation). Results: `.kit/reports/learning-loop-phase2-2026-11-09.md`, `.kit/reports/deciding-test-2026-11-08.md`. Next lever: a model that reads new wording better (research method 10), a future version's decision.
**Evidence:** `.kit/reports/deciding-test-2026-11-08.md` (36 candidates, batches 1-2, the High/Urgent check), `.kit/reports/fewer-flags-research-2026-11-09.md` (11 methods), `.kit/reports/fewer-flags-skeptic-2026-11-09.md` (attack on the best static idea). Probe scripts and outputs: the session scratchpad `dt\` folder (kept out of the repo by the owner's rule).

## 1. The goal and the rules it keeps

- **Goal:** send fewer tickets to a person.
- **Never negotiated (the owner, 2026-11-09):** identifying High and Urgent tickets. Per set, never more High/Urgent tickets sent out unchecked as Low/Medium, and never more high-risk (must-review) tickets missed.
- **Also held:** unchecked wrong categories and priorities at or under today, per set. The owner accepted two small accuracy dips (fold 3 priority, 3 tickets on the older hand-written set), because they are not High/Urgent tickets slipping through ("This is fine", 2026-11-09).

## 2. What we know (measured)

1. **Any model that sees a ticket's wording for the first time hits a floor.** 36 static candidates failed the bar: model families, two-tier, joint heads, learned gates, floors, guards. The best static combination (new wording + two-tier + joint priority) looked good in total on the tuning sets. The skeptic showed it breaks safety on single tuning splits and is about 3x over the model size budget.
2. **New wording makes the model much safer, but not leaner.** Batch 2 + the High/Urgent guard, scored on the test folds: missed high-risk 71 -> 9, High/Urgent sent out low 27 -> 10, unchecked wrong category 134 -> 51, unchecked wrong priority 391 -> 111. Flags +4.0% (14,224 vs 13,683).
3. **The lever that works is learning from the person who checks.** Every flagged ticket gets a correct answer from the reviewer. A model that retrains on those answers learns the wording it is actually seeing. Simulated on all 12 tuning splits (batch 2 + guard, then the model retrains on the reviewed tickets every 500 tickets, plus a third head that learns "needs a person"):

   | Over tickets 501-4,000 of each split | Model never learns | Model learns from the reviewer |
   |---|---|---|
   | Sent to a person | 38,343 | 18,589 (-51.5%) |
   | High-risk missed | 33 | 0 |
   | High/Urgent sent out low | 60 | 0 |
   | Unchecked wrong category / priority | 323 / 488 | 9 / 21 |
   | Tuning splits where any safety count got worse | - | 0 of 12 |

   Script: `dt\learning_desk.py`, output `learning_desk.txt`. Tuning sets only; no test set read.
4. **Day by day (the owner asked for a day, week and month view, 2026-11-09).** A desk day is 100 tickets (`ACT2_TICKETS_PER_DAY`); the model retrains each night on the day's reviewed tickets. Four tuning splits, 400 tickets a day (`dt\daily.py`, `daily.txt`):

   | Desk day | Sent to a person, model never learns | Model learns each night |
   |---|---|---|
   | 1 | 88.2% | 90.5% |
   | 3 | 89.2% | 79.0% |
   | 7 (one week) | 90.2% | 49.0% |
   | 14 | 93.8% | 47.5% |
   | 30 (one month) | 91.5% | 45.2% |

   Over the 30 days: high-risk missed 5 -> 0, unchecked wrong category 106 -> 3, unchecked wrong priority 197 -> 12, High/Urgent sent out low 48 -> 0. The curve flattens near 37%, the share of tickets that must go to a person by design (security, accessibility, escalations, disputes), so most of what can be cut is cut within a week.
   **Name:** this is learning from human feedback (retraining on the operator's answers), not reinforcement learning in the strict sense: the operator gives the right answer, not a reward score.
5. **A cheaper cousin, a memory of reviewed tickets** (no retraining; a near-identical reviewed ticket waives or forces the flag), cut flags 5.8% on top of batch 2 + guard, safe on all 12 splits (`memory_guard.txt`). It is dominated by item 3, so it is not in the plan.

**Shipped precedent:** support products retrain on their own ticket history and treat agent corrections as labels; learning to defer and active learning are the literature's names for it (research report, methods 1 and 4).

## 3. The honest catch

- **The generator repeats its wording.** A fold has a few templates per category, filled thousands of times. Some of item 3's gain is the model memorising wording it has now seen. Real desks also repeat (the same issue, asked many ways), but less. The size of the real-world gain is UNKNOWN until Phase 2's checks run.
- **So the claim changes.** The fold numbers stay the conservative headline: "on wording the model has never seen". The learning gain is a second, clearly labelled number: "on wording the desk has already had checked".
- **The test folds have been read 5 times.** Phase 2 uses a brand-new stream from an unused seed, never read, as its test.

## 4. The plan

### Phase 1 - Ship the safer model (step 3, the open branch)
- Batch 2 wording, the High/Urgent guard (flag a ticket called Low/Medium when High + Urgent are at least 0.2 likely), and the 0.55 floor.
- A new CI gate count: High/Urgent sent out as Low/Medium, per set, next to the existing counts.
- The Model History page: the new model becomes the current row and the baseline stays below it (the owner, 2026-11-08). The history page test reads its expected numbers from `history.json` instead of typing today's numbers (lesson L-12).
- Carry-overs ride along. Shared vocabulary first if the model file goes over budget.
- **Gate:** the new numbers, recorded as the start point with the owner's yes. Flags +4%, every safety count better.

### Phase 2 - Prove the learning loop before building it (no product code)
Two deciding checks on the tuning sets, each bar written first:
1. **Does it generalise, or only memorise?** Teach the model only from tickets of some templates; measure flags and safety on tickets of templates it has not been taught. Bar: a flag cut with no safety count worse, on most tuning splits.
2. **How much checked work does it take?** Flags against the number of reviewed tickets (100, 250, 500, 1,000). This sets the retraining cycle.
3. **Faster first week (active learning):** the desk sends a person the tickets it would learn most from, not only the unsure ones. Bar: the Week 1 flag share reached in fewer days, no safety count worse.
4. **Self-learning from its own unchecked answers:** measured only to show the risk (it teaches the model its own mistakes). Not built unless it passes the section 1 rules, which it is not expected to.
5. **A "new product launch" day:** new wording arrives mid-run; flags jump, then fall as the desk learns. Bar: recovery to the pre-launch share within a week, no safety count worse.
- If check 1 fails, the plan stops here and goes back to the owner with what it found.
- If it passes: one score on a fresh, never-read stream (a new seed for every fold), held to the section 1 rules.

### Phase 3 - Build the learning loop (its own design, then a PR)
- **Where the learning runs:** at training time, in Python, the way shipped desks do it. Each "cycle" adds the reviewed tickets of the last batch to the training data and retrains. No training code in the browser, so the scorer's exact match with Python (parity) holds.
- **A third head, "needs a person":** a small yes/no model trained on what the reviewer confirmed. It flags tickets the floor misses. It is one weight row, so the shared vocabulary saving pays for it.
- **The page shows growth:** each cycle is a Model History row, shown at Day 1, Week 1 and Month 1 (the owner, 2026-11-09). The flag share falls cycle by cycle, with every safety count shown beside it. That is the growth over time the owner asked for.
- **CI:** retrains each cycle from the recorded reviewed tickets and checks the committed models, as today.

### Phase 4 (stretch, owner-gated) - Make the bar robust to one-ticket noise
- Learn then Test (research method 3) certifies a setting's miss rate instead of failing it on one ticket. It changes the bar, so it is the owner's call; it is not needed for Phases 1-3.

## 5. What could make it fail

| Risk | Check | If it happens |
|---|---|---|
| The gain is only memorisation | Phase 2 check 1 | Stop and report; keep Phase 1 |
| A retrain undoes a safety count | The CI gate per set, every cycle | The cycle is not shipped |
| Size budget | Measure model.json per cycle | Shared vocabulary first, then ask |
| Reviewer mistakes taught to the model | The simulated reviewer never errs on priority (`web/src/pipeline/reviewer.ts:53`); a real desk would. Stated on the page | A noisy-reviewer simulation in Phase 2 (stretch) |

## 6. For the owner to decide

1. Approve this plan (Phases 1-3, Phase 4 as stretch).
2. Phase 1 ships before Phase 2, as a "safer and more accurate" release with +4% flags.
3. The Model History wording for a learning cycle (asked when Phase 3's design is written).
