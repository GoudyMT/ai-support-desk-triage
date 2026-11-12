# Sentence Model, Part 2 Plan: The 90-Day Run, the Desk and the Release

## Progress
- Current task: 5 (plan approved by the owner 2026-11-12, "Let's begin")
- Done (with evidence), 2026-11-12:
  - Part 1 plan's Progress block closed with the merge of #12 - 9d93c1f - `tracking-check.mjs progress` PASS
  - Design approved and committed - e1ae8fe
  - Tasks 1-2 (merged, see notes) - `weeks.ts` 15 tests, `exportWeeks.ts` 5 tests; breaks of the week check and of each of the three export guards each turned one row red; `npm run export-weeks` in 4 s: streams hold 125, 124, 123, 123 templates, 9 or 10 per week, every week filled, 9,100 rows per stream
  - Task 3 - `runWeek.ts` 6 tests red on the stub, green after; breaks of the department count and of the checked-ticket path each turned rows red; typecheck and lint exit 0
  - Task 4 - `judge_ninety.py` 7 tests and `ninety_day.py` 7 tests, red on stubs, green after; 3 breaks of the mark and 3 of the driver each turned rows red; `pytest ml/tests` 188 passed
  - Task 5 - run on the owner's yes (2026-11-12), 4 streams of 13 weeks, about 15-18 min each, load logged every 4 s (CPU avg 7.2-17.5%, peaks 47-97% with the owner's other work; GPU avg 27.5-34.6%, peaks 60-99%); `ml/reports/ninety_day.json` with its verdict by `python -m triage_v2.judge_ninety`; `test_ninety_day_record.py` red before the verdict, green after. VERDICT: NOT PASSED. Department right, days 1-30 -> days 61-90 (frozen in 61-90): 83.1 -> 92.1 (83.8); 84.1 -> 81.6 (80.8); 90.2 -> 80.3 (76.7); 77.4 -> 84.2 (82.7). Beats frozen 4 of 4, beats own start 2 of 4 (needs 3). Hard lines equal to frozen on every stream; stream 3's gate let 122 high-risk tickets out unchecked for both models
  - The owner's call (2026-11-12, "show it as measured, then consider methods to continue"): Model History shows the 90-day result as measured, mark not met, with the frozen comparison (Task 13)
  - The owner picked option A of the ways to continue (2026-11-12, "lets go with your recommendation"): a fixed-pool look, a practice measurement. BAR, written before any number: for each stream, the fixed pool is the tickets of weeks 10-12 (2,100; their templates were taught to no model before week 10). The start model and the models after weeks 0 to 9 each answer the pool alone (no gate). Growth shows if, on at least 3 of 4 streams, (1) the model after week 9 is right on department more often than the start model, and (2) the mean of the models after weeks 5-9 beats the mean of the start model and the models after weeks 0-4. High/Urgent called Low or Medium is reported beside each. Practice only: these tickets were scored once in the run; the script stays out of the repo (owner, 2026-11-08)
- Next: the fixed-pool look; Task 6 wireframe sent, waiting on the owner's lock
- Branch: `feat/sentence-model-part2` (local, from `main` at 5287e12)
- Open questions: see "Owner stops"; the wider privacy mask (Task 16) is marked stretch because it changes the text the bundle was trained on

**Goal:** the desk's reviewer sees a far better suggestion, Model History shows real growth over a simulated 90 days and one honest blind-set reading, and anyone can download the model.
**Record:** `docs/brainstorms/2026-11-10-next-model.brainstorm.md` (local). Goals trace: accuracy first (Q1); hard lines never worse (Q2); growth over 90 days from understanding, not memory (Q1, option A); download on GitHub and Hugging Face (Q8). The owner, 2026-11-12: "I just want the model scores to go up".
**Design:** [`../specs/2026-11-12-sentence-model-part2-design.md`](../specs/2026-11-12-sentence-model-part2-design.md) (approved 2026-11-12), on top of [`../specs/2026-11-10-sentence-model-design.md`](../specs/2026-11-10-sentence-model-design.md) Revision 1.
**Approach:** first the offline 90-day run (new generator mode, weekly ticket files, a resumable driver, a judge written before the run); then both models on the desk, with the suggestion's look locked from a wireframe; then the single blind-set reading and the pages that show the truth; the carry-overs ride along; one sweep, one PR, one release.
**Stack:** Python 3.12, PyTorch (CUDA), sentence-transformers, ONNX Runtime; TypeScript, Vitest, Playwright, tsx; `onnxruntime-web` (new, Task 7).

## Global Constraints
- The two hard lines (High/Urgent sent out as Low/Medium; high-risk missed) are never worse on any set or stream.
- The blind set is never opened, scored or printed before Task 12, and is read once there. Its text is checked by script only.
- Every training, export or bulk-scoring run: load check first (3 samples), `ml/triage_v2/share_machine.py`, the owner's yes, average and peak load reported after (lesson L-14; the owner, 2026-11-12).
- `RANDOM_STATE = 113` wherever a seed is taken.
- New packages pinned exactly, at least 14 days old, with hashes for Python; each download needs the owner's yes.
- The page calls no outside host at run time; model, tokenizer and runtime are served from the site.
- Size budgets in `web/size-budgets.json`: the demo page has 16 bytes of room and is not touched; any new or raised line is asked for once, from a measurement (rule:size-budgets).
- Tests read expected values from their source files, never today's number (lesson L-12).
- Commits: one line, `type: subject`, no trailer. PR body: no attribution lines.
- No `cd` into a subfolder; paths from the project root (graduated lesson #7).

## Review Focus
1. A visitor on a slow link starts the desk: the run starts on the word model at once, and the suggestion appears when the bundle arrives, without moving what the reviewer is reading. Test in Task 10.
2. The bundle fails to load (404, cut off, wrong fingerprint): the desk keeps working on the word model alone and says so in plain words; nothing is sent anywhere. Test in Task 10.
3. A replayed seed: the same seed gives the same desk-only tickets and the same answers after the change. Test in Task 9.
4. A week of a stream with no template of some department: the driver and the judge still count every day. Test in Task 4.
5. The driver stops mid-stream (crash, owner stops it): a rerun resumes at the first missing week and refuses a changed setting. Test in Task 4.

## Execution approach
- **Phase A (Tasks 1-5), inline by the lead.** The tasks feed each other's file formats, and Task 5 is a GPU run under the owner's eye. Expected: about a day of work, and 1 to 2.5 h of capped GPU time (estimate from the 68 s training of Part 1).
- **Phase B (Tasks 6-11), agent-team batch** (builder Sonnet, checker Opus on Tasks 8 and 9) after the wireframe is locked. Source: rule:patterns-and-dispatch; Tasks 8-10 touch separate files with fixed interfaces.
- **Phase C and D (Tasks 12-18), inline.** Pages that state numbers are written against their source files by the lead.
- Linux CI is seen early: the branch is pushed once Phase A's code is in (lesson L-08), on the owner's yes.

## Sweep tier
Feature tier, with the modifiers for a new runtime package and a new served file type (`onnxruntime-web`, the bundle).

## Owner stops
1. Each GPU run (Tasks 5 and 12): the load check and its numbers, then the owner's yes.
2. Task 6: the wireframe of the late suggestion, locked before any desk code.
3. Task 7: the `onnxruntime-web` download, and the new size budget line from its measurement.
4. Task 11: the owner's phone test.
5. Each push, the PR, the merge and the release; the Hugging Face post (the owner's own act).

## Files
| File | Job |
|---|---|
| `web/src/generator/templates.ts` (modify) | a split that names its templates (`Split` gains `{ templates: TemplateRef[] }`) |
| `web/src/generator/weeks.ts` (new) | deal one stream's held-out templates into 13 weekly batches |
| `web/scripts/exportWeeks.ts` (new) | write each stream's weekly ticket files and print the template counts |
| `web/scripts/runWeek.ts` (new) | run one week's tickets through the real pipeline with two answer tables; write checked labels and daily counts |
| `ml/triage_v2/ninety_day.py` (new) | drive 13 weeks per stream: score, run the week, retrain; resumable |
| `ml/triage_v2/judge_ninety.py` (new) | the pass mark, as code, written before the run |
| `ml/reports/ninety_day.json` (new) | the run's record, checked by CI |
| `web/src/model/sentenceScorer.ts` (new) | tokenizer and ONNX scoring in the browser, loaded on demand |
| `web/src/desk/main.ts`, `web/src/desk/tryPanel.ts`, `web/src/run/engine.ts` (modify) | desk-only wording, word gate plus suggestion |
| `web/scripts/copyBundle.ts` (new) | put the bundle under `web/public/models/bundle_v2/` after a fingerprint check |
| `web/scripts/readBlind.ts`, `ml/reports/blind_reading.json` (new) | the one blind reading and its record |
| `web/src/history/history.json`, `web/src/history/view.ts` | the new rows and the 90-day line |
| `ml/MODEL_CARD.md`, `docs/guide/*.md`, `web/src/download/*` (new page) | the truth in words, and the download |

## Tasks

### Task 1 (must): Tickets from a named list of templates
**Files:** Modify `web/src/generator/templates.ts` | Test `web/src/generator/folds.test.ts`
**Interfaces:** Produces `type TemplateRef = { wording: 'built-in' | 'extra'; category: Category; index: number }` and `Split` member `{ templates: TemplateRef[]; slotsFold: number }`.
- [ ] Failing tests: a templates split draws only the named templates (every ticket's template is in the list); slot values come from `slotsFold`'s held-out side; an empty list throws `E_SPLIT_EMPTY`; the four v1 stream hashes in `wording.test.ts` hold -> verify: red on assertions
- [ ] Implement -> verify: `npm --prefix web run test` exit 0, v1 hashes unchanged
- [ ] Commit `feat: build tickets from a named list of templates`

### Task 2 (must): Weekly batches and week files
**Files:** Create `web/src/generator/weeks.ts`, `web/scripts/exportWeeks.ts` (+ tests)
**Interfaces:** Produces `dealWeeks(stream: number, weeks = 13, seed = 113): TemplateRef[][]`; files `ml/data/generated/v2_week_<k>_<w>.jsonl` (100 tickets a day, 7 days, day in each row).
- [ ] Failing tests: every held-out template of stream k (built-in and extra, hard-case lists included) is in exactly one week; no week template is on the stream's training side; departments are dealt in turn per department; same seed, same deal; the blind guard of `exportV2` refuses a blind text -> verify: red
- [ ] Implement; the script prints per stream the template count and the per-week counts -> verify: counts match `templates.ts` and `extraFrames.ts` by script (deciding check: every week has at least 1 template; record the counts here)
- [ ] Commit `feat: deal each stream's held-out templates into weekly ticket files`

### Task 3 (must): One week through the real pipeline
**Files:** Create `web/scripts/runWeek.ts` (+ test), reusing `runTicketWith` and `tablePredict` (`web/scripts/measureTwoModels.ts`)
**Interfaces:** `npm run run-week -- --stream k --week w --answers <retrained.json> --control <frozen.json> --out <dir>`; writes `checked_<k>_<w>.jsonl` (id, text, reviewer's department and priority) and `days_<k>_<w>.json` (per day, for retrained and frozen: department right, priority right, High/Urgent out low, high-risk missed, to a person).
- [ ] Failing tests: only tickets sent to a person appear in the checked file; labels are the simulated reviewer's (5% wrong department by `REVIEWER_ERROR_RATE`); counts against the true label; answers matched by id AND text (the Part 1 carry-over) -> verify: red
- [ ] Implement -> verify: suite exit 0
- [ ] Commit `feat: run one simulated week through the pipeline with two answer tables`

### Task 4 (must): The driver and the judge
**Files:** Create `ml/triage_v2/ninety_day.py`, `ml/triage_v2/judge_ninety.py`, `ml/tests/test_ninety_day.py`, `ml/tests/test_judge_ninety.py`
**Interfaces:** `python -m triage_v2.ninety_day --stream k --run-name <name>`; `judge(report) -> {"passed": bool, "streams": [...]}`.
- [ ] Failing tests (tiny stand-in model, as `score_onnx` tests do): week w is scored before week w's retrain; each retrain starts from the base model on the training side plus checked tickets of weeks < w+1; a rerun resumes at the first missing week and refuses a changed setting; `share_the_machine()` is called first; a week with a department missing still counts
- [ ] Failing judge tests with hand-made reports: passes on 3 of 4 streams beating frozen in days 61-90 AND beating own days 1-30; fails on 2 of 4; fails when either hard line over 90 days is above frozen on any one stream -> verify: red
- [ ] Implement both -> verify: `ml\.venv\Scripts\python.exe -m pytest ml/tests` exit 0
- [ ] Commit `feat: drive and judge the 90-day run`

### Task 5 (must): The 90-day run
- [ ] Owner stop 1: load check (3 samples), estimate (minutes and load), owner's yes
- [ ] Run 4 streams through `share_machine.py`, logging load every 4 s -> verify: `ml/reports/ninety_day.json` written by script; average and peak load reported to the owner
- [ ] `judge_ninety` on the record; a CI test re-judges the record and checks its fingerprints -> verify: the verdict reported as measured, pass or fail
- [ ] Commit `feat: record the 90-day run and its verdict`

### Task 6 (must): Wireframe of the late suggestion
- [ ] On the real desk screen, with real desk-only tickets: how the reviewer sees the word model's answer at once and the suggestion when it arrives; front stage vs on demand named first (lesson L-05) -> verify: Owner stop 2, locked

### Task 7 (must): The browser runtime and the served bundle
**Files:** `web/package.json`, `web/scripts/copyBundle.ts`, `web/size-budgets.json`, `web/scripts/checkSizes.ts`
- [ ] Owner stop 3: `onnxruntime-web` version (at least 14 days old), download yes
- [ ] Failing tests: `copyBundle` refuses a bundle whose fingerprint differs from `ml/reports/bundle_v2.json`; `checkSizes` counts the bundle and runtime under a new `sentenceBytes` line and fails with no limit set -> verify: red
- [ ] Implement; measure; ask the owner once for the `sentenceBytes` limit (measured plus 10%) -> verify: `npm --prefix web run gate` exit 0
- [ ] Commit `feat: serve the sentence bundle and its runtime from the site`

### Task 8 (must): Scoring in the browser, and the close-match test
**Files:** Create `web/src/model/sentenceScorer.ts`, `web/e2e/sentence-match.spec.ts`
**Interfaces:** `loadSentenceModel(fetcher?): Promise<SentenceModel>`; `SentenceModel.predict(maskedText: string): { category: Category; priority: Priority }`; errors `E_SENTENCE_LOAD`, `E_SENTENCE_SHAPE`.
- [ ] The limit, written now: the browser's answers equal `ml/reports/bundle_v2_answers.json` on every ticket of both hand-written sets except at most 1 per set, and on all but at most 20 of 4,000 desk-only tickets (the owner's CI limit of 2026-11-11)
- [ ] Failing tests, then implement -> verify: the e2e spec passes in Chromium; the count of differing tickets recorded here
- [ ] Commit `feat: score tickets with the sentence model in the browser`

### Task 9 (must): The desk on desk-only wording, with both models
**Files:** Modify `web/src/run/engine.ts:50`, `web/src/desk/main.ts:545-570`, `web/src/desk/tryPanel.ts`
- [ ] Failing tests: a desk run draws only `DESK_WORDING` tickets; it loads the shipped word model, never a fold file; a ticket leaves unchecked only when the gate lets it and both models agree; a reviewer's card shows the suggestion; the same seed replays the same tickets and answers; Try a ticket shows both answers -> verify: red
- [ ] Implement to the locked wireframe -> verify: `npm --prefix web run gate` exit 0
- [ ] Commit `feat: run the desk on unseen wording with the word gate and the suggestion`

### Task 10 (must): Browser tests of loading and failure
**Files:** `web/e2e/desk-loading.spec.ts`
- [ ] Rows: Review Focus 1 and 2; the demo and history pages request no bundle file; no request to another host; reduced motion -> verify: all pass locally in Chromium, then on Linux CI
- [ ] Commit `test: guard the desk while the suggestion model loads or fails`

### Task 11 (must): The owner's phone test
- [ ] Owner stop 4: a preview build on the owner's phone; load time and whether the desk stays usable -> verify: the owner's word, recorded here

### Task 12 (must): The one blind reading
**Files:** `web/scripts/readBlind.ts`, `ml/reports/blind_reading.json`, `ml/tests/test_blind_reading.py`
- [ ] Before reading: the rows (today's word model; sentence model alone; two-model rule; 90-day end model of each stream) and the release bar written in the record's test (10 points on department for the suggestion; four counts at or under today's) -> verify: tests red on an empty record
- [ ] Owner stop 1, then read once, with and without the tickets of the 6 near-match templates (listed in the Part 1 plan's notes of 2026-11-10) -> verify: record written by script; CI re-derives it from recorded answers
- [ ] Commit `feat: record the single blind-set reading`

### Task 13 (must): Model History shows the truth
- [ ] Failing tests that read `history.json` and the reports: the new rows, the 90-day line, the sentence "the share sent to a person went up" -> verify: red, then green
- [ ] Commit `feat: show the sentence model and the 90-day run on Model History`

### Task 14 (must): Model card and guide pages
- [ ] Every number quoted from a report file (file:line in the edit) -> verify: a grep of each number finds its source
- [ ] Commit `docs: describe the two-model desk in the model card and guide`

### Task 15 (must): The download page and the Hugging Face page
- [ ] The page: the bundle, the card, a load how-to, the Apache 2.0 notice of the base model; the Hugging Face card drafted in `docs/` for the owner to post -> verify: the page's e2e row; links open
- [ ] Commit `feat: add a page to download the model`

### Task 16 (stretch): The wider privacy mask
- [ ] Flag first: a wider mask changes the text the bundle was trained on, so it means a retrain, a new fingerprint and new records. Ask the owner before starting.

### Task 17 (should): Carry-overs
- [ ] Part 1 sweep, "DEFERRED Part 2": a dependency-presence test; an offline switch for the export; answers matched by id and text (in Task 3); the carry-on row of a practice run; the scorer's small paths (empty input, unknown words, the thread option)
- [ ] PR 5: T2-4, T2-6, T2-7, T2-8; PR 4: H6b, H9, H10 (`.kit/sweeps/2026-11-06-pr5-desk.md`, `.kit/sweeps/2026-11-04-pr4-page.md`) -> verify: each row's test red first, then green; one commit per row

### Task 18 (must): The gate, the sweep and the PR
- [ ] Full gate locally; workflow files parsed (lesson L-02); Parking Lot triage; feature sweep; version bump on the branch; PR body shown first -> verify: every step exit 0, sweep report exists
- [ ] Owner stop 5: push, PR, merge, release

## Parking Lot

## Execution Notes & Deviations
- 2026-11-12, Tasks 1-2 (mechanics, decided alone): the generator is NOT changed. A week of about 7 templates leaves most departments empty, and `buildBody` picks a department before a template, so a templates split would fail on an empty pool (`generate.ts:165`). Instead `web/src/generator/weeks.ts` deals each stream's held-out templates into 13 weeks and keeps a generated held-out ticket only when every template it used (`TicketDetail.templates`) falls in one week; tickets are drawn until each week is full. Same goal (every scored ticket uses only that week's untaught templates), no change to the v1 or v2 streams. Tasks 1 and 2 become one task. Stream 3 starts from `v2_tune_0_3` (pairs are written low fold first).
- 2026-11-12, Task 3 (mechanics, decided alone): the gate of stream k is the word fold model `web/public/models/fold_k.json`, not the shipped word model, because the shipped one trained on all built-in wording, the stream's held-out templates included; fold k never saw them. The gate stays fixed for all 13 weeks. "Department right" for the pass mark is counted on every ticket of a day (the model's own answer against the true label), so the retrained and frozen models are compared on identical tickets; the share sent to a person and the four error counts are recorded beside it. Answers are matched by id only, as `tablePredict` does; ids are unique within a stream file and refused when repeated (`E_WEEK_ID`).
