# More Ticket Wording Plan

## Progress
- Current task: 1
- Done (with evidence): Task 0 - blast-radius scan, no commit (results below)
- Next: Task 1, batch 1 written in the scratch copy and checked on the tuning sets
- Branch: feature/more-ticket-wording (from main 85eddc4)
- Open questions: the history row (design 10), asked at the plan hand-off; needed before Task 6

**Goal:** the generator's wording gets wider in checked batches until a batch sends fewer tickets to a person with no rise in misses or unchecked wrong answers, then the repo moves to it.
**Record:** `.kit/reports/step2-intent-2026-11-08.md` (the owner's words); goals 1-3 from the owner's step 3 approval (2026-11-08); the batch loop and stop rule are the planner's.
**Design:** `docs/superpowers/specs/2026-11-08-more-ticket-wording-design.md`
**Approach:** write each batch in the scratchpad copy of the generator, check every new template on the tuning sets, score the batch on the tuning sets, then once on the test sets against today's model on the same files; land only a passing batch.
**Stack:** TypeScript generator (`web/src/generator/templates.ts`), tsx, Python 3 + scikit-learn (`ml/triage`), the scratchpad harness of the deciding test.

## Global Constraints
- Bar and definitions: design sections 6 and 8, word for word.
- Templates: ASCII; 4 per kind, appended at the end of their list; no existing template edited or moved.
- Never read `ml/data/handwritten_fresh.jsonl` text or tune on it; never copy a held-out ticket's text into a template.
- Model budget 3,850,000 bytes (`web/size-budgets.json`); over it -> the shared-vocabulary trim first (design 6).
- Measurement scripts stay in the session scratchpad (`...\scratchpad\dt\`), never committed.
- Commands run from the project root; no `cd` into subfolders; Python: `$env:PYTHONPATH = "ml"; ml\.venv\Scripts\python.exe ...` (harness scripts with `-I`).

## Review Focus
1. A template whose `{slot}` text is missing in its category's slot lists: the generator must fill it; checked by `generate.test.ts` on the new list.
2. A new template that repeats a hand-written ticket's normalized text: `assertHandwrittenIsolated` stops the export; the export must run clean.
3. The history's first row and `START_POINT` changing in one commit with the retrained model, so `measurePipeline --check` never sees one without the other.

## Execution approach
Inline by the lead for every task. The batch loop is sequential (each batch is written from the last one's tuning numbers) and judgment-heavy; no unit has a clean interface to hand a builder. Expected machine time per batch: under 3 minutes (stage 3c measured 2 min for fits plus seconds to score); the full gate plus e2e about 30 minutes on Windows.

## Sweep tier
feature (deep sweep under a Swarm Contract; auto-approval is paused, so the contract goes to the owner). Modifiers: model and data change (ML), CI-checked artifacts.

## Task 0 (done): what this change invalidates, repo-wide

Measured 2026-11-08 on main 85eddc4:
- Tests pinning template wording: `web/src/generator/generate.test.ts` (3 template fragments); `templates.test.ts` reads whole lists (counts by kind) and `folds.test.ts` checks fold spread. Appending keeps the pinned fragments.
- Files CI regenerates and compares: `web/src/model/model.json`, `web/public/models/fold_<k>.json`, `ml/reports/eval.json`, the parity check (`web/src/model/scorer.parity.test.ts`, against the gitignored `parity_predictions.jsonl`), `START_POINT` in `web/scripts/measurePipeline.ts`, `web/src/history/history.json` row 0.
- Tests that load the committed models (re-read after retrain, never edited to pass): `web/src/model/scorer.test.ts`, `web/src/pipeline/run.test.ts`, `web/src/run/narrate.test.ts`, `web/src/desk/tryTicket.test.ts`, `web/src/page/fetchModel.test.ts`, `web/scripts/measurePipeline.test.ts`, `web/scripts/checkSizes.test.ts`, `web/e2e/server.spec.ts`, `ml/tests/test_*`.
- Seed-driven tests (desk, engine, e2e) build tickets from the generator; any pinned ticket text is found by Task 6's full run, then read against the new output first (rule:test-integrity).

### Task 1: batch 1, written and checked on the tuning sets (must)

**Files:** scratchpad only: `wb/web/src/generator/templates.ts` (fresh copy from the branch), `dt/add_wording.py`, `dt/check_templates.py` (new)
**Interfaces:**
- Produces: `check_templates.py` printing one row per new template: `phrase | tickets found | own-category rate | top other category (rate) | own-priority rate`, over the tuning splits only (heldout_j scored by tune_<min>_<max> models, today's model type, floor-free).

- [ ] Re-copy `web/src` and `web/scripts` into `scratchpad\wb\web\` from the branch -> verify: `diff -r` against the branch shows no difference before edits
- [ ] Re-measure on the tuning splits only which category/priority pairs carry the most silent priority errors -> verify: a table in the batch log, built from heldout_j under tune models, no test fold
- [ ] Write batch 1: the 19 kept scratch templates (all of `add_wording.py` except "How many people can share one {plan}...") plus 4-per-kind priority-cue templates aimed at the top pairs of the step above -> verify: `check_folds.ts` prints "old templates that moved fold: 0" and each new kind lands on folds 0,1,2,3
- [ ] Export data and tuning sets in the copy (`node web/node_modules/tsx/dist/cli.mjs <copy>/web/scripts/exportDataset.ts`, then with `--tuning`) -> verify: both run clean (no `E_HANDWRITTEN_IN_TRAIN`, `E_TUNE_OVERLAP`)
- [ ] Run `check_templates.py` -> verify: every new template's own-category rate beats its top other category; any that fails is rewritten or dropped and the check re-run

### Task 2: batch 1 scored (must)

**Files:** scratchpad only: `dt/dump_new.ts`, `dt/stage3c.py` (DT_NEW=1), `dt/new/` caches cleared first
- [ ] Tuning score: stage 3c's comparison on the tuning splits -> verify: inner flags at a fitting floor fall on at least 3 of 4 test folds' inner totals; if not, the batch goes back to Task 1 (counts toward the stop rule)
- [ ] Test score, once: `stage3c.py` -> verify: the bar (design 8) per set, written to `.kit/reports/deciding-test-2026-11-08.md` as "Step 3 batch 1", with the test-look count
- [ ] Stop rule (design 9) -> verify: pass -> Task 6; else batch 2 (Tasks 1-2 again), at most 3 batches; two failed tuning scores in a row or 3 batches -> stop and report to the owner

### Task 3: unit row for the `--tuning` switch (should, carry-over from PR #9)

**Files:** Modify `web/scripts/exportDataset.ts` (export `main` or a pure `planExport(args)`), Test `web/scripts/exportDataset.test.ts`
- [ ] Failing test `main writes only the tuning sets with --tuning`: with `--tuning`, the writer called is the tuning writer and the default writer is not; without it, the reverse -> verify: red on the assertion first
- [ ] Make it pass with the smallest seam (inject the two writers) -> verify: `npm --prefix web run test -- exportDataset` passes
- [ ] Commit `test: cover the export's tuning switch`

### Task 4: PR 5 carry-overs T2-4, T2-6, T2-7, T2-8 (should)

**Files:** as named in `.kit/sweeps/2026-11-06-pr5-desk.md` (T2-4 note row, T2-6 follow:113 comment, T2-7 rows for five lines, T2-8 cut report.test:198, :106, review:272)
- [ ] Read each finding's evidence in the sweep report, re-check it still holds on the branch -> verify: one line per item, holds or gone
- [ ] One commit per item that holds, each with the test it adds or the cut it proves (rule:test-value) -> verify: the touched suite passes

### Task 5: PR 4 carry-overs H9, H10, H11, H12, H6b (stretch)

- [ ] Same as Task 4 from `.kit/sweeps/2026-11-04-pr4-page.md` -> verify: per item, holds or gone, then its commit

### Task 6: land the passing batch (must; needs the owner twice)

**Files:** Modify `web/src/generator/templates.ts`, `web/src/model/model.json`, `web/public/models/fold_<k>.json`, `ml/reports/eval.json`, `web/scripts/measurePipeline.ts` (START_POINT), `web/src/history/history.json`
- [ ] Append the passing batch to `templates.ts` exactly as scored -> verify: `diff` against the scratch copy's file is empty; `npm --prefix web run test -- generator` passes
- [ ] `npm --prefix web run export-data`, then retrain: `$env:PYTHONPATH = "ml"; ml\.venv\Scripts\python.exe -m triage.export_model --folds-out web/public/models` -> verify: `check_model` on a second fresh retrain matches the committed files
- [ ] Measure `model.json` bytes -> verify: under 3,850,000, else the shared-vocabulary `perf:` commit with parity re-proved first
- [ ] `python -m triage.evaluate`, `npm --prefix web run parity` -> verify: eval written, parity passes
- [ ] Run `measurePipeline --folds web/public/models` (no `--check`) and show the owner old START_POINT vs new numbers side by side -> **STOP: the owner's yes on START_POINT** (design M3)
- [ ] History row as the owner decided (design 10) -> **STOP if not yet decided**
- [ ] Commit `feat: widen the ticket wording so fewer tickets go to a person` with the model, numbers and history together
- [ ] Full gate and e2e: `npm --prefix web run gate`, `npm --prefix web run e2e` -> verify: exit 0; a failing test is read against the new output first, never edited to pass
- [ ] Push early for a Linux CI run (L-08): the owner's go -> verify: `gh run watch <id> --exit-status` (L-11)

### Task 7: sweep and PR (must)

- [ ] Pre-PR sweep at the feature tier (pre-pr-sweep skill; contract to the owner, auto-approval paused) -> verify: report in `.kit/sweeps/`
- [ ] Findings through the finding pipeline; PR body (pr-body skill) shown to the owner -> verify: the owner's go on the PR

## Parking Lot
- A stale agent worktree sits at `.claude/worktrees/agent-a970fbf71b4c549e5` (seen in a search on 2026-11-08); list and clean with the owner's yes.

## Execution Notes & Deviations
