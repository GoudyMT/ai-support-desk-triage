# Fair 90-Day Run, Then the Desk and the Release - Plan

## Progress
- Current task: 2
- Done (with evidence):
  - design approved by the owner 2026-11-12 ("Plan looks good, lets continue"); plan approved 2026-11-12 ("And then let's begin")
  - Task 0 - fd51002 - `tracking-check.mjs progress` PASS on both plans
  - Task 1 - `pieces.test.ts` 12 tests red on the stub (11 failed), green after; 4 breaks (connector not swapped, one stand-in for all, month not swapped, unmapped piece kept) each turned rows red, files restored byte for byte; web suite 63 files, 1,425 tests, exit 0 (v1 and v2 hashes held); typecheck and lint exit 0
  - Task 2 - `exportFairPool.test.ts` 10 tests, 8 red on stubs, green after; 4 breaks (start-set guard, desk guard, pool from another stream; one break pattern first missed and was redone) each turned a row red, files restored; `npm run export-fair-pool` in 13.9 s: 40,000 tickets per stream, held-out templates 125, 124, 123, 123, none never drawn, fewest tickets for one template 16; typecheck and lint exit 0
  - Task 3 - `test_template_difficulty.py` 3 tests (2 red on the stub), `fairWeeks.test.ts` 7 tests (3 red on stubs), green after; the new `exportWeeks.test.ts` rows were written after the code, so each was shown red by a break instead; 7 breaks (plain start match, teaching copies outside the guards, fair rows without copies, missing start file read as empty, deal ignoring ratings, weeks without copies, pool start guard) each turned rows red, files restored; web suite 65 files, 1,447 tests; pytest 205 passed; typecheck and lint exit 0
  - Task 4 - `runWeek.test.ts` 2 new rows red on the stub, green after; 3 breaks (scored text masked instead, copy left unmasked, copy dropped on reading) each turned a row red, file restored
  - Task 5 - `test_ninety_day_fair.py` 9 tests, 8 red on stubs; two expected values in my own tests were wrong (a pool rating of 0.5, not 0; week 0's retrained arm is the start model) and were corrected against the stand-ins' arithmetic; green after; 8 breaks (limit +1, missing balance let through, frozen rescored, report written in place, work folder in repo, week run through npm.cmd, gap unrounded, pool rating skipped) each turned a row red, file restored; pytest 214 passed
  - Task 6 - `test_share_machine.py` 5 new rows red on stubs, green after; 4 breaks (highest reading decides, CPU ignored, one reading, missing reading not refused) each turned a row red, file restored; pytest 219 passed
  - Task 7, stream 0 balance phase on the owner's yes ("Yes, Run stream 0.", 2026-11-12): 9.1 min; load over 141 samples GPU avg 14.4% peak 44%, CPU avg 32.3% peak 48.6%; start model days 1-30 0.7783, days 61-90 0.8600, gap 8.17 points: OVER the 2.0 limit, stopped (owner stop 2). Pool ratings predicted each week's start-model share within about 3 points (week 0: 0.556 predicted, 0.554 actual); the deal, not the ratings, failed: week 0 took mostly hard templates (0.554), week 5 0.679, the rest 0.81-0.90. Script `why_gap.py` in the session scratchpad
  - The owner picked A (2026-11-13, "A"): swaps within each list after the one-pass deal, aimed at the days 1-30 vs 61-90 gap first, then the weeks' spread; limit unchanged. `fairWeeks.test.ts` 5 new rows red on stubs, green after; 4 breaks (swaps off, swaps across lists, gap left out of the goal, gap windows shifted) each turned a row red, the third only after its bound was tightened to 0.25 points; web suite 1,455 tests. Stream 0 from its real ratings: one pass predicted 6.13 points (measured 8.17), with swaps predicted 0.07 points; week 5 stays at 0.700 predicted (outside both windows)
- Next: rerun stream 0's balance phase on the owner's yes (start model and pool answers reused; the record's stream 0 inputs and balance cleared first)
- Branch: `feature/fair-ninety-day-run` (local, from `main` at 24653e4)
- Open questions: the owner's yes on the old scratch delete list (asked 2026-11-12); what Model History shows for two runs (Task 13, default: both, as measured)

**Goal:** a 90-day verdict that measures learning, not the deal of weeks or repeated wording; then the desk's reviewer sees the sentence model's suggestion, and Model History tells the truth about both runs.
**Record:** `docs/brainstorms/2026-11-10-next-model.brainstorm.md` (local): growth from understanding, not memory (Q1, option A); accuracy first (Q1); hard lines never worse (Q2). The fair run itself is the owner's pick of 2026-11-12 (option C, then approach A).
**Design:** [`../specs/2026-11-12-fair-ninety-day-run-design.md`](../specs/2026-11-12-fair-ninety-day-run-design.md) (approved 2026-11-12); Tasks 8-19 argue from [`../specs/2026-11-12-sentence-model-part2-design.md`](../specs/2026-11-12-sentence-model-part2-design.md) and the locked wireframe [`../specs/2026-11-12-desk-two-models-wireframe.md`](../specs/2026-11-12-desk-two-models-wireframe.md).
**Approach:** the generator records each ticket's held-out pieces and writes a teaching copy with them swapped; the start model scores a candidate pool, and templates are dealt into weeks by difficulty; a balance phase checks all four streams before any retrain; then the run, the judge, and Part 2's Tasks 7-18 unchanged except where noted.
**Stack:** TypeScript, Vitest, tsx; Python 3.12, PyTorch (CUDA), sentence-transformers, ONNX Runtime; Playwright and `onnxruntime-web` from Task 9.

## Global Constraints
- The two hard lines (High/Urgent sent out as Low/Medium; high-risk missed) are never worse on any set or stream.
- The pass mark (`ml/triage_v2/judge_ninety.py`) and the balance limit (2.0 points) are not changed after any number of this run exists.
- The first run's files stay as they are: `ml/reports/ninety_day.json`, `ml/data/generated/v2_weeks_<k>.jsonl`.
- The v1 and v2 stream hashes in `web/src/generator/wording.test.ts` hold: the teaching copy is an extra field, never a change to `text`.
- The blind set is never opened, scored or printed before Task 13; its text is checked by script only.
- Every training, export or bulk-scoring run: load check first (3 samples), `ml/triage_v2/share_machine.py`, the owner's yes, average and peak load reported after (L-14).
- `RANDOM_STATE = 113` wherever a seed is taken.
- New packages pinned exactly, at least 14 days old, with hashes for Python; each download needs the owner's yes.
- Tests read expected values from their source files, never today's number (L-12).
- Commits: one line, `type: subject`, no trailer. PR body: no attribution lines.
- No `cd` into a subfolder; paths from the project root (graduated #7). Errors throw static codes.

## Review Focus
1. A typo ticket whose held-out piece is misspelled after the swap point: the teaching copy still holds no held-out piece. Test in Task 1 (checked on the swap map and on the final text).
2. A month name that also appears in a template's fixed words: only slot values are swapped. Test in Task 1.
3. A template that never appears in the candidate pool: it is still dealt (difficulty = its list's mean, count 0). Test in Task 3.
4. The owner's repo path has spaces: the driver starts the week run without a shell, and a work folder inside the repo is refused. Test in Task 5.
5. The driver stops between the balance phase and the weeks: a rerun carries on, and the weeks phase refuses to start while any stream's balance is missing or over the limit. Test in Task 5.

## Execution approach
- **Phase A (Tasks 0-7), inline by the lead.** Each task feeds the next one's file format, and Task 7 runs on the owner's machine under the owner's eye. Source: rule:patterns-and-dispatch (sequential, shared files). Expected: about a day of work; machine time measured on stream 0's balance phase first, then about 15-18 min per stream for the 12 retrains (first run).
- **Phase B (Tasks 8-12), agent-team batch** as Part 2 planned it (builder Sonnet, checker Opus on Tasks 9 and 10): the desk tasks touch separate files with fixed interfaces.
- **Phase C and D (Tasks 13-19), inline.** Pages that state numbers are written against their source files by the lead.
- Linux CI is seen early: the branch is pushed once Phase A's code is in (L-08), on the owner's yes.

## Sweep tier
Feature tier, with the modifiers for a new runtime package and a new served file type (`onnxruntime-web`, the bundle).

## Owner stops
1. The balance phase and the retrains of Task 7 (each: load check, estimate in minutes and load, the owner's yes); the blind reading of Task 13.
2. If the balance check fails: stop; the owner decides (no seed retry, design section 10).
3. Task 8: the `onnxruntime-web` download, and the size budget line from its measurement.
4. Task 12: the owner's phone test.
5. Each push, the PR, the merge and the release; the Hugging Face post (the owner's own act).

## Files
| File | Job |
|---|---|
| `web/src/generator/pieces.ts` (new) | the swap map: for a stream, each held-out piece of each kind -> a seeded training-side piece of the same kind |
| `web/src/generator/generate.ts`, `fakeData.ts` (modify) | an optional swap map; with it, `generateTicketDetail` also returns `teachText` and the pieces it drew |
| `web/src/generator/weeks.ts` (modify) | `dealWeeksByDifficulty`; `buildWeeks` takes a deal; rows carry `teachText` and template refs |
| `web/scripts/exportFairPool.ts` (new) | write each stream's candidate pool with template refs |
| `web/scripts/exportWeeks.ts` (modify) | `--fair --difficulty <file>` writes `v2_fair_weeks_<k>.jsonl`; the week guard reads the files on disk |
| `web/scripts/runWeek.ts` (modify) | the checked file masks `teachText` when a row has one |
| `ml/triage_v2/ninety_day.py` (modify) | `--fair`: balance phase, weeks phase, new record; no shell; atomic writes; work folder outside the repo |
| `ml/triage_v2/template_difficulty.py` (new) | per-template department-right share and count from pool answers |
| `ml/triage_v2/share_machine.py` (modify) | busy check from 3 samples, GPU and CPU |
| `ml/reports/ninety_day_fair.json` (new) | the fair run's record, judged in CI |
| Part 2 files (Tasks 8-19) | as listed in `2026-11-12-sentence-model-part2.md` "Files" |

## Tasks

### Task 0 (must): Close the Part 2 plan
- [ ] Close the Progress block of `docs/superpowers/plans/2026-11-12-sentence-model-part2.md` with the merge of #13 (24653e4); Tasks 7-18 point here -> verify: `node .claude/tracking-check.mjs progress` PASS
- [ ] Commit `docs: close the part 2 plan and add the fair run design and plan`

### Task 1 (must): Teaching copy with swapped pieces
**Files:** Create `web/src/generator/pieces.ts` | Modify `generate.ts`, `fakeData.ts` | Test `web/src/generator/pieces.test.ts`
**Interfaces:**
- Produces: `type PieceKind = 'threat' | 'connector' | 'fakeFrame' | 'product' | 'plan' | 'feature' | 'month'`; `swapMapFor(stream: number, wording: Wording, seed = 113): SwapMap` (`ReadonlyMap<string, string>` per kind); `generateTicketDetail(seed, index, split, wording, swap?)` returns, with `swap`, `teachText: string` and `pieces: { kind: PieceKind; heldOut: string; taught: string }[]`.
- [ ] Failing tests: for 2,000 held-out tickets per stream and wording, `teachText` contains no held-out piece of that stream (each kind, its list from `poolOf(..., { fold: k, side: 'heldout' })`), every `taught` piece is in the start model's training pool (`{ fold, side: 'train', alsoHeldOut }` of `startPair(k)`); same templates, hard case, category and priority as without the swap; no piece drawn -> `teachText === text`; `{plan}` and `{otherPlan}` differ in `teachText`; a template's fixed words keep any month name they hold; the ticket without `swap` is byte-identical to today's (v1 and v2 hashes hold) -> verify: red on assertions
- [ ] Implement: the swap applies where the piece is picked, before typos and casing -> verify: `npm --prefix web run test` exit 0
- [x] Commit `feat: teach from a copy with each held-out piece swapped`

### Task 2 (must): The candidate pool
**Files:** Create `web/scripts/exportFairPool.ts` (+ test) | Modify `web/src/generator/weeks.ts` (export `templateRefOf`)
**Interfaces:** Produces `templateRefOf(template, wording): string` (`<wording>/<list>/<index>`); file `ml/data/generated/v2_fair_pool_<k>.jsonl`, rows `{ id, text, maskedText, category, priority, templates: string[] }`, the first 20,000 held-out draws of each wording from `WEEK_SEEDS`; `npm --prefix web run export-fair-pool`.
- [ ] Failing tests: refs are unique and stable; every held-out template of the stream is a ref of the stream; pool rows pass the blind, hand-written, desk and start-set guards of `exportWeeks.ts`; same run, same bytes -> verify: red
- [ ] Implement; print per stream the pool size and how many templates appear 0 times -> verify: suite exit 0; counts recorded here
- [ ] Commit `feat: export a candidate pool for scoring template difficulty`

### Task 3 (must): Deal by difficulty and the fair week files
**Files:** Modify `web/src/generator/weeks.ts`, `web/scripts/exportWeeks.ts` (+ tests) | Create `ml/triage_v2/template_difficulty.py` (+ `ml/tests/test_template_difficulty.py`)
**Interfaces:**
- Consumes: Task 2's refs and pool; the start model's answers on the pool (`score_onnx.score` output).
- Produces: `template_difficulty(rows, answers) -> {ref: {"right": float, "count": int}}` written to `<work>/fair_difficulty_<k>.json`; `dealWeeksByDifficulty(stream, difficulty, seed = 113): Map<Template, number>`; `buildWeeks(stream, perDay, deal?, swap?)`; `npm --prefix web run export-weeks -- --fair --difficulty <dir>` writes `v2_fair_weeks_<k>.jsonl` with `teachText` and `templates` per row.
- [ ] Failing tests (Python): a ticket counts toward each template it used; a template with no ticket is left out of the file -> verify: red
- [ ] Failing tests (TS): same inputs, same deal; every held-out template in exactly one week; a template missing from the file gets its list's mean and count 0; on a hand-made difficulty set where round-robin is lopsided, the spread of ticket-weighted week difficulty is smaller; the fair export leaves `v2_weeks_<k>.jsonl` untouched; the week guard reads the written files and uses the same normalized match as the other guards (sweep row D2) -> verify: red
- [ ] Implement: hardest first, each template to the week with the lowest ticket-weighted mean so far among weeks still taking that list; ties by seeded shuffle -> verify: both suites exit 0
- [ ] Commit `feat: deal templates into weeks by the start model's difficulty`

### Task 4 (must): Teach from the teaching copy
**Files:** Modify `web/scripts/runWeek.ts` (+ test)
- [ ] Failing tests: a row with `teachText` puts `mask(teachText)` in the checked file and scores on `text`; a row without it is unchanged; a break that masks `text` instead turns the row red -> verify: red
- [ ] Implement -> verify: suite exit 0
- [ ] Commit `feat: train retrained models on the teaching copy`

### Task 5 (must): The fair driver and its balance phase
**Files:** Modify `ml/triage_v2/ninety_day.py`, `ml/tests/test_ninety_day.py`
**Interfaces:** `python -m triage_v2.ninety_day --fair --phase balance|weeks --stream k --work-dir <outside repo>`; record `ml/reports/ninety_day_fair.json`, per stream `balance: {"early": float, "late": float, "gap": float}`; error `E_WEEKS_UNBALANCED`; `BALANCE_LIMIT = 2.0` (points).
- [ ] Failing tests (stand-in deps, as today): balance phase trains the start model, scores the pool, writes difficulty, exports the fair weeks, scores all 13 weeks with the start model and records the gap on days 1-30 vs 61-90 (day 91 left out, as the judge does); the weeks phase exits `E_WEEKS_UNBALANCED` when any of the 4 streams has gap 2.1, or has no balance yet, and trains nothing; at 2.0 it goes on; the frozen week answers of the balance phase are reused, not rescored; a rerun carries on in either phase; the first run's record and default paths are untouched without `--fair`
- [ ] Failing tests (carry-overs): the week run is started as an argument list with no shell (sweep P2); reports are written to a temp file and renamed (P3); a work folder inside the repo exits `E_WORK_IN_REPO` (P4) -> verify: red
- [ ] Implement -> verify: `ml\.venv\Scripts\python.exe -m pytest ml/tests` exit 0
- [ ] Commit `feat: check that the weeks are balanced before the fair run retrains`

### Task 6 (should): A steadier busy check
**Files:** Modify `ml/triage_v2/share_machine.py`, `ml/tests/test_share_machine.py`
- [ ] Failing tests: 3 samples are read; the median decides; a CPU load at or over the GPU limit refuses too; an unreadable sample refuses (sweep B1) -> verify: red
- [ ] Implement -> verify: pytest exit 0
- [ ] Commit `fix: read the machine three times, GPU and CPU, before a run`

### Task 7 (must): The fair run
- [ ] Owner stop 1: load check; the balance phase on stream 0 first (minutes and load measured), then the other 3 -> verify: each stream's gap recorded; any gap over 2.0 -> owner stop 2
- [ ] Owner stop 1: the weeks phase, 4 streams, load logged every 4 s -> verify: `ml/reports/ninety_day_fair.json` complete; start-model fingerprints compared with the first run's (reported, not required to match)
- [ ] `judge_ninety` on the record; `ml/tests/test_ninety_day_fair_record.py` re-judges it and checks its fingerprints and balance -> verify: red before the verdict, green after; the verdict reported as measured
- [ ] Commit `feat: record the fair 90-day run and its verdict`

### Tasks 8-19: Part 2's Tasks 7-18
Run as written in `docs/superpowers/plans/2026-11-12-sentence-model-part2.md` (Task N there = Task N+1 here), with these changes:
- Part 2 Task 6 (wireframe) is done: locked 2026-11-12; its OPEN line (may Try a ticket's Sort start the bundle download) is asked before Task 10.
- Part 2 Task 12 (blind reading, Task 13 here) reads the 90-day end models of the fair run, not the first run.
- Part 2 Task 13 (Model History, Task 14 here) shows both runs as measured, the fair one named as such, unless the owner picks otherwise.
- Part 2 Task 17 (carry-overs, Task 18 here) takes the Part 1, PR 5 and PR 4 rows; the 90-day sweep rows are in Tasks 3, 5 and 6 above.

## Parking Lot

## Execution Notes & Deviations
- 2026-11-12, Task 1 (mechanics, decided alone): the teaching copy is a second build from the same seed with a recording swap, so the scored ticket is untouched by construction (a test compares it byte for byte). Slot values are drawn raw and swapped only when written, so `{otherPlan}` still avoids the drawn plan and every later draw matches. Pieces: `SwapMap` is one map per kind (`ReadonlyMap<PieceKind, ReadonlyMap<string, string>>`); `recordingSwap` throws `E_PIECE_UNMAPPED`. Only one fixed-word clash exists across 115 pieces and 567 fixed texts ("March" in one Billing template, by probe), so the held-out check allows a word only where the ticket's own template carries it.
- 2026-11-12, Task 3 (mechanics, decided alone; drift from design 5.2 recorded): "hardest first to the easiest week" left the lopsided test set 0.8 apart, because an easy template also went to the easiest week. Each template now goes to the open week it brings closest to the stream's overall rating (hard to easy weeks, easy to hard ones). "Open" = the fewest of its list (same department mix per week) and at most one template above the emptiest week; requiring the very fewest left one choice, which rebuilt the round-robin deal. Weeks may now differ by two templates, not one; a test builds every week full under such a deal. Same goal and the same balance check.
- 2026-11-12, Task 3 (sweep row D2, decided alone): the start-set guard now uses the other guards' match (raw and masked text), and the commands read the start set from the tuning file the driver trains on (`E_START_MISSING` if absent); teaching copies pass every isolation guard too.
- 2026-11-12, Task 5 break check left a folder: the "work folder in the repo allowed" break let a stand-in run write 29 small files into `ml/work-that-must-not-exist` (stand-in answers, nothing real). Found by the next full pytest run, listed, deleted; the test now points the driver at a stand-in repo inside its own temp folder, and the same break was rerun: red, nothing written in the repo.
- 2026-11-12, Task 6 (decided alone): the CPU mark is the GPU's (50%), on the middle of three readings each; one reading takes 1 s.
- 2026-11-12, crash log: two full web runs had worker access violations (0xC0000005) on different files each time (exportV2, exportDataset, folds, measureTwoModels) with 63 workers while the owner's machine was at 51% CPU; each file passed alone, and the suite passed whole on 8 workers. Not investigated (rule:test-and-review-cadence, crashes).
