# A Fair Second 90-Day Run - Design

**Status:** draft for the owner's approval (2026-11-12). Builds on the Part 2 design (`2026-11-12-sentence-model-part2-design.md`) and its record `ml/reports/ninety_day.json`.

## 1. Intent and why

The first 90-day run was not passed: the retrained model beat the frozen model on 4 of 4 streams, but beat its own start on only 2 of 4 (needs 3). Two flaws in the run, both measured, make that verdict hard to read:

- **The weeks were not equally hard.** The frozen model never changes, yet its department-right share moved between days 1-30 and days 61-90 by +1.7, -4.6, -14.4 and +8.4 points (streams 0-3, computed from the record's per-day `frozen` counts). "Beats its own start" therefore measured mostly the deal of templates into weeks, not learning.
- **Some wording repeats across weeks.** Threat phrases, two-topic joins, fake-data frames and slot values (products, plans, features, months) are split by fold, not by week, so a retrained model meets again what it was taught. That favours the retrained model. Each stream holds back only 6 threat phrases, 6 joins and 2 or 3 of each name list (`hardCases.ts:34-63`, `extraFrames.ts:567-594`, `fakeData.ts:28-157`), too few to give each of 13 weeks its own.

A fair run fixes both, so the verdict says whether the model learns from checked tickets.

## 2. Goals

1. **Equal weeks:** on every stream, the start model's department-right share on days 1-30 and days 61-90 differ by at most 2.0 points, shown before any retrained model is trained.
2. **No memory from repeated pieces:** no retrained model is ever taught a threat phrase, join, fake-data frame or slot value of its own stream's held-out side.
3. **The same bar, judged as code:** `judge_ninety.py` unchanged; the verdict recorded as measured, pass or fail.
4. **The hard lines** (High/Urgent sent out as Low/Medium; high-risk missed) never worse than frozen on any stream, as before.

## 3. Non-goals and anti-goals

- **Not changed:** the pass mark, the start models' training side, the gate (fold word model per stream), the week length, the ticket count per day.
- **Not built:** new wording lists (option B, rejected below); retraining in the browser.
- **Failure even if it passes:** a bar or a balance limit changed after a retrained number exists; a teaching copy that still holds a held-out piece; the first run's record overwritten.

## 4. What the owner decided

- 2026-11-12: explore option C (a fresh 90-day run) before the desk work; carry-overs ride with it.
- 2026-11-12: approach A below ("Let's go with your recommendation and continue").
- Standing: never loosen a bar after a result; every training or bulk-scoring run waits for a load check and the owner's yes (L-14).

## 5. The approach (A, locked)

**Balance the deal by the start model's difficulty, and teach from a copy with the repeated pieces swapped.**

1. **Score first, then deal.** The driver trains the stream's start model (as today), then scores a candidate pool: the first 20,000 held-out draws of each wording from the week seeds (`weeks.ts` `WEEK_SEEDS`), the same draws the week builder picks from. A ticket counts toward every template it used. Each template gets two numbers: the start model's department-right share on its tickets, and its ticket count in the pool (how often the week builder will meet it).
2. **Weighted deal.** Templates are taken hardest first and each goes to the week whose ticket-weighted mean difficulty is lowest so far, among weeks that still need templates of that list; ties break by the seeded shuffle (`RANDOM_STATE = 113`). Every held-out template still lands in exactly one week.
3. **Balance check before training.** The frozen arm (start model) scores all 13 weeks of the new deal. If any stream's days 1-30 vs days 61-90 gap is over 2.0 points, the run stops before any retrain and I bring the gaps to the owner. No retry with another seed or deal: one deal, decided by this rule, and the limit is never raised to let a run go on.
4. **Teaching copy.** Each week row carries `text` (what both models are scored on) and `teachText` (what a retrained model learns from). The generator builds `teachText` from the same draws with a swap map: each held-out piece it picks is replaced, before typos and casing are applied, by a piece of the same kind that the start model trained on (the stream's training side, which leaves out fold stream+1, `exportWeeks.ts:49`). `runWeek` masks `teachText` for the checked file the driver trains on; scoring always uses `text`. `teachText` passes the same isolation guards as `text`.
5. **Run and judge.** 4 streams, 13 weeks, 12 retrains each, through `share_machine.py`, as today. New files throughout: weeks `v2_fair_weeks_<k>.jsonl`, a new work folder, record `ml/reports/ninety_day_fair.json`. The first run's files and record stay as they are; the start models are retrained and their fingerprints compared with the first run's.

**Rejected:** B, write new week-only wording (about 200 phrases and 100 names: large authoring effort, and new wording could drift in style from what the start model knows); C, skip the run (leaves a verdict that we now know measures the deal). Grouping weeks into blocks was also ruled out: a piece would still repeat inside its block.

## 6. Requirements

**Must**
- M1. Week rows record the held-out pieces each ticket used, and a `teachText` with each replaced by a training-side piece of the same kind.
- M2. A difficulty-sorted snake deal, from per-template start-model scores; same scores and seed give the same deal.
- M3. A balance check that stops the run before the first retrain when a stream's gap is over 2.0 points.
- M4. The driver trains only on `teachText`; a new CI test re-judges the new record and checks its fingerprints.
- M5. The run itself, on the owner's yes after a load check.

**Should (carry-overs from `.kit/sweeps/2026-11-12-ninety-day-run.md`)**
- D2: the week guard checks the files on disk with the same match as the other guards.
- P2: the driver starts npm without passing `--work-dir` through cmd.exe.
- P3: report writes are atomic (write a temp file, then rename).
- P4: a work folder inside the repo is refused.
- B1: the busy check takes 3 samples and reads CPU load too.

**Later:** Model History, model card and guide show both runs (Part 2 Tasks 13-14).

## 7. Acceptance criteria

- **M1:** Given a week row, then `teachText` holds no threat phrase, join, fake-data frame, product, plan, feature or month of the stream's held-out side (checked before typos, on the swap map, and after, on the text); it uses the same templates, hard case and labels as `text`; a ticket that drew no piece has `teachText === text`. A `{plan}`/`{otherPlan}` pair stays two different plans. Typos may land in other places in the two texts, since the swapped piece changes the text length.
- **M2:** Given the same per-template scores, counts and seed, the same deal; every held-out template sits in exactly one week; on a hand-made score set where the round-robin deal is lopsided, the weighted deal's spread of week difficulty is smaller.
- **M3:** Given a frozen record with a 2.1-point gap on one stream, the driver exits with `E_WEEKS_UNBALANCED` and trains nothing; given 2.0, it goes on.
- **M4:** The checked file the driver reads holds `teachText`; a break that feeds `text` instead turns a test red. The new record passes `judge_ninety` re-derivation in CI.
- **Must NOT happen:** the first run's `ml/reports/ninety_day.json` changes; any v1 or v2 stream hash changes (`wording.test.ts`); the blind set is opened.

## 8. Success

- **Functional end goal:** a complete, fair 90-day record with its verdict, balance numbers and load numbers, whatever the verdict is.
- **Honest note:** a fairer test can lower the retrained model's lead over frozen, because the repeats helped it. That is the point of the run.
- **Stretch (gated):** none.

## 9. Risks and open questions

- **The 2.0-point balance may be out of reach** (blocking only if it fails). Templates differ a lot in difficulty and there are about 9 or 10 per week. Deciding measurement first: the balance check runs before any retrain; if it fails, I report the gaps and stop.
- **Machine time:** one scoring pass per stream with the start model, plus 12 retrains per stream (the first run took about 15-18 min per stream). Owner stop with a load check.
- **Months inside template text:** a month swap must touch only slot values. A test row guards it.
- **What Model History shows** (non-blocking, the owner's at Task 13): both runs as measured, the second named as the fairer one, is my default.

## 10. My calls (say so if any is wrong)

- The balance limit is 2.0 points on days 1-30 vs days 61-90 of the start model, per stream. About 2 standard errors at 3,000 tickets per third; tighter would likely be unreachable, looser would not fix the problem.
- The new record is `ml/reports/ninety_day_fair.json`; the first run's record and week files are kept untouched.
- If the balance check fails, there is no seed retry: you decide what comes next.
- Swapped pieces come only from what the start model trained on, so the swap teaches the retrained model no wording the frozen one never saw.
- The deal weighs templates by how many tickets they give, since the balance is measured on tickets.
- Openers, requests and closers are not swapped: they are not split by fold, so both models learned them equally.
- The plan covers this run first, then Part 2 Tasks 7-18 on the same branch, one sweep, one PR (Active Plan "Order of a run").
- Branch `feature/fair-ninety-day-run`, from `main` at 24653e4 (rule:branching names).
