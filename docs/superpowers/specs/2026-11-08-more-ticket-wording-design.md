# More Ticket Wording - Design (step 3 of the first model version)

**Date:** 2026-11-08. **Status:** approved by the owner in outline ("Yes this is good. Approved lets continue", 2026-11-08); this file writes that outline down.
**Evidence:** `.kit/reports/deciding-test-2026-11-08.md` (the deciding test, its diagnosis), `.kit/reports/model-paths-research-2026-11-07.md` (P-B), `.kit/reports/model-paths-skeptic-2026-11-07.md` (F1, F2, F4).

## 1. Intent and why

The first model version aims to send fewer tickets to a person without trading accuracy or high-risk misses. The deciding test tried 36 candidates; none passed the bar. One change cut flags at all: a batch of new ticket wording (-259 fold flags at today's floor, category accuracy up on every fold). It regressed on two folds for reasons now found: one mislabelled template, and confident categories exposing the priority head's existing mistakes. This step adds wording in batches, each checked on the tuning sets before any test set, until a batch passes the bar or the stop rule fires.

## 2. Goals

1. A generator wording change that passes the bar on the same files today's model is scored on: fewer fold flags, and per set no more misses or unchecked wrong answers and no lower accuracy (section 9).
2. Every template in the generator says what its label says: a check on the tuning sets catches a template whose wording reads as another category before a test set is scored.
3. The repo's committed model, numbers and gate move to the new wording together, so CI holds the new start point.

## 3. Non-goals

- **Changing the model type or adding two-tier.** The deciding test showed neither cuts flags; two-tier stays on the shelf as a safety add-on (owner's pick, 2026-11-08).
- **Re-picking the floor, the wider mask, the Model History "what changed" copy beyond the required row.** Step 4 of the roadmap.
- **Committing the measurement scripts.** The owner: "Test scripts stay out of the repo for sure". They live in the session scratchpad.
- **Touching the fresh hand-written set or tuning anything on it.**

**Anti-goals** (failure even if flags fall): a template copied or steered from a fresh-set ticket; a rise in high-risk misses on any set; a test weakened to let the new numbers pass.

## 4. Constraints

- Model file budget: 3,850,000 bytes (`web/size-budgets.json`); `web/src/model/model.json` is 3,825,909 bytes today (24,091 bytes of room). The scratch batch grew the shipped vocabulary from 11,439 to 11,676 terms. Over budget -> the size-budget rule: trim first (the parked shared vocabulary, measured at 342,831 bytes), then ask.
- Every generated file, the committed fold models, `model.json`, `ml/reports/eval.json`, parity predictions, `START_POINT` and the history's current row change together; CI checks each against a fresh retrain.
- Templates stay ASCII; four per kind, appended at the end of their list, so `foldsOf` gives one per fold and no existing template changes fold (measured 0 moved in the scratch batch).

## 5. What the owner decided

- 2026-11-07: the goal: fewer tickets sent to a person, never trading accuracy or high-risk misses.
- 2026-11-07: "0 high-risk missed" = 0 on both hand-written sets; folds held at their start point.
- 2026-11-08: deciding test approach B; stage 3 aimed at priority; test scripts stay out of the repo.
- 2026-11-08: step 3 = wording first, with a per-template check on the tuning sets; the plan outline in this file.

## 6. The approach

**Batch loop** (at most 3 batches):
1. Write 4 templates per chosen kind, without reading the fresh set or any held-out ticket text.
2. **Template check (tuning sets only):** for each new template, find its tickets in the tuning held-out files (heldout_j scored by the tune_<min>_<max> models) by a distinctive phrase, and measure how often the model reads them as each category and priority. A template whose tickets are read as one other category more often than as its own label is rewritten or dropped.
3. **Tuning score:** the stage 3c comparison on the tuning splits: flags at a floor that fits the inner budget must fall on at least 3 of 4 test folds' inner totals.
4. **Test score, once per batch:** the stage 3c comparison on the test folds and both hand-written sets. Record the number of test looks.

**Batch 1 content** (chosen from the tuning splits' own error counts, re-measured there before writing): the 19 scratch templates that pass the template check; priority cues that separate routine Billing admin (Medium) from disputes and outages (High); vague tickets that stay Medium; severe Technical wording that does not lean on generic words like "all" and "through".

**Definitions the scoring uses:**
- **Today's model** = the committed model type and settings trained on the OLD wording (`train_<k>` and `train_all` of the current generator), scored on the NEW held-out files at floor 0.5. The candidate = the same model type trained on the new wording, scored on the same new files.
- **Floor:** the candidate is scored at 0.5 and at the floor its tuning splits pick (the stage 3c rule); it passes if either passes, and the floor it passed at is what ships. Any flag cut counts; the size of the cut is reported.
- **The 19 scratch templates** are in the deciding test's scratch script (`add_wording.py`, listed in the plan's Task 1); the mislabelled one ("How many people can share one {plan}...") is not one of the repo's templates, so dropping or rewriting it before it is appended moves nothing.
- **Size:** the shared vocabulary (parked, measured 342,831 bytes) leaves every prediction the same, so a batch that passes the bar but lands over the model budget gets that trim first (a separate `perf:` commit, parity re-proved), without re-scoring. Raising the budget stays the owner's.

Rejected: two-tier now (no flag cut, section 3); priority fixed by category (worse priority on folds 2-3); more tickets of the same wording (research P8: no gain).

## 7. Requirements

**Must**
- M1. The template check runs on the tuning sets before each batch's test score, and its output is kept in the batch log.
- M2. A passing batch lands as: templates appended (4 per kind), data re-exported, models retrained and committed, eval, parity, `START_POINT` and the history's current row updated, the full gate and e2e green.
- M3. `START_POINT` changes only with the owner's yes, with old and new numbers shown side by side on the same new files.
- M4. Existing tests keep their assertions; a test whose fixture is generated content is re-read against what the code now produces before anything about it changes (rule:test-integrity).

**Should**
- S1. A unit row for the `--tuning` switch in `exportDataset.ts` main (carry-over from PR #9).
- S2. The PR 5 and PR 4 carry-overs that touch nothing this change touches (T2-4, T2-6, T2-7, T2-8, H9-H12, H6b), each as its own commit.

**Later**
- Two-tier as a safety add-on; a second blind hand-written set (skeptic, "What would change my mind").

## 8. Acceptance criteria

- **Template check:** Given a batch, when the check runs, then every new template has a row (tickets found, own-label rate, top other category) and no template is kept whose top other category beats its own label.
- **Bar:** Given the batch's new files, when each fold is scored once, then fold flags total below today's model on the same files, and per fold missed, silent category and silent priority are at or under today's model, and category and priority accuracy at or above; both hand-written sets have 0 missed, silent errors at or under `START_POINT`, accuracy not lower.
- **Fold stability:** no existing template changes fold (the scratch check, re-run per batch).
- **CI:** the gate, e2e, the model and fold model checks, the eval check, parity and `measurePipeline --check` all pass on the branch's Linux CI run.
- **Must NOT:** any fresh-set ticket text appear in a template; any assertion weakened or skipped.

## 9. Success criteria

The bar above, decided per batch and recorded. Stop rule: stop and report to the owner after a passing batch, or after two batches in a row whose tuning score fails to cut flags on 3 of 4 folds (skeptic F2's test), or after 3 batches.

## 10. Risks and open questions

- **Test-set reuse (non-blocking, recorded):** the test folds were read once for the scratch batch, and the diagnosis read fold 2 and 3 tickets. Each further test look is counted in the batch log; the fresh hand-written set has not been read.
- **Easier new files (non-blocking):** the new files are a little easier for today's model; every comparison is on the same files.
- **Model size (blocking at retrain):** measured after each passing batch; the size rule applies.
- **History row (blocking before the PR, the owner):** CI requires the history's first row to match the new numbers. Update the "Baseline model (current)" row in place, or add a new current row and keep the baseline below it? The second is roadmap step 4's row; its name and wording are the owner's. The build stops and asks before the PR; nothing is defaulted.
- **Fold model tests (non-blocking):** e2e and unit tests that build tickets from seeds may pin wording; found by a repo-wide search before the first template edit.

## 11. Left to the builder

The distinctive phrase per template; the exact wording of each template within its kind and label; the order of commits; the measurement script's layout in the scratchpad.

## 12. Your calls (Claude's, for the owner to check)

- Branch `feature/more-ticket-wording`, not the harness's suggested name, because the branch rule forbids tool prefixes (`.claude/rules/git-and-release.md`).
- At most 3 batches, and the stop rule in section 9.
- The 19 kept scratch templates go through the template check like any new one.
- Execution inline by the lead, not an agent team: the loop is judgment-heavy and sequential.
