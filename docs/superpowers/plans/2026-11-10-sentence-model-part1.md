# Sentence Model, Part 1 Plan: The Test Set, the Tickets and the Offline Model

## Progress
- Current task: 0 and 1 (plan approved by the owner, 2026-11-10: "Plan looks good, lets do it!")
- Done (with evidence): none
- Next: Task 1
- Branch: `feat/sentence-model` (local, from `main` at b889642)
- Open questions: none blocking; the two owner stops are listed under "Owner stops"

**Goal:** a trained sentence model, measured honestly offline, with a blind test set locked away before any of it is trained. The live site does not change in Part 1.
**Record:** `docs/brainstorms/2026-11-10-next-model.brainstorm.md`. Goals trace: accuracy first (Q1, owner's words); hard lines (Q2 and the 2026-11-08 lock); blind set and real-ticket research (Q5); varied tickets (Q6, owner's words); measure both paths (Q4).
**Design:** [`../specs/2026-11-10-sentence-model-design.md`](../specs/2026-11-10-sentence-model-design.md) (approved 2026-11-10). This plan covers its phases 0 to 3. Phases 4 to 6 (the 90-day run, the browser, the release and download) are Part 2, planned in detail at the Part 1 gate, because their shape depends on Part 1's numbers (planner's call).
**Approach:** lock the blind set first. Add varied training wording and desk-only wording without changing any v1 file. Put training, ONNX export and scoring in `ml/triage_v2/`. Feed the new model's answers through the existing TypeScript rules and review step by a table of saved answers, so the pipeline code is measured unchanged.
**Stack:** Python 3.12, PyTorch (CUDA, the owner's GPU), sentence-transformers, ONNX Runtime, scikit-learn 1.9.1; TypeScript, Vitest, tsx.

## Global Constraints
- The two hard lines never get worse on any set: High/Urgent sent out unchecked as Low/Medium; high-risk (must-review) tickets missed.
- Allowance on unchecked wrong department and unchecked wrong priority: at most 0.25% of a set's tickets, rounded down, never less than 1.
- "Today" in every comparison is today's word recipe trained on the same tickets and run through the same rules and review step.
- The blind set is not scored, printed or opened by any task in Part 1. Its only reader is the Part 2 final scoring.
- Every v1 file stays byte-identical in Part 1: `ml/data/generated/*` as exported today, `web/src/model/model.json`, `web/public/models/fold_*.json`, `ml/reports/eval.json`. CI's existing `gate` and `model` jobs stay green unchanged.
- Fictional data only; only obviously fake personal data; no real company or brand names; no course material.
- New packages: exact pins with hashes, each release at least 14 days old. No package is installed into `ml/.venv` or `web/` before its pin is in a requirements or lock file.
- `RANDOM_STATE = 113`. Model: `sentence-transformers/all-MiniLM-L6-v2`, Apache 2.0.
- Every bar below is written here before its numbers are read. A bar may be rewritten before its numbers come in, with a reason, and never after.
- Commits: one line `type: subject`, no body, no trailer, no AI attribution. No push, PR or merge without the owner's go.
- A run expected to hold the owner's GPU or CPU for more than 30 minutes is estimated first and waits for the owner's yes (lesson L-07).

## Review Focus
1. A blind text that differs from a training text only by case, spacing or punctuation must still count as a leak (the existing `normalizeText` rule). Test in Task 1.
2. A ticket longer than the model's 256-token limit is cut, not rejected; the cut must be the same in training and scoring. Test in Task 4.
3. A v1 export run after the new wording lands must write the same bytes as before. Test in Task 2.
4. A saved-answers table missing a ticket id must stop the pipeline measurement with an error, never score that ticket with a default. Test in Task 6.
5. A model file whose hash is not the recorded one must be refused before scoring. Test in Task 4.

## Execution approach
- **Task 1 (blind set):** one fresh agent with no chat history writes the blind wording from the label rules alone, so the wording does not come from the author of the training templates' session. The lead never reads the result; scripts check it. Then one checker (top tier) verifies the isolation tests. Reason: independence is the point of the set.
- **Tasks 2 and 3 (wording):** agent-team batch mode, mid-tier builders, one per category group, each in its own worktree on its own file; the lead integrates. Reason: wide, parallel, low-coupling writing work.
- **Tasks 4 to 7 (model and measurement):** the lead, inline. Reason: each step's result decides the next step's values, and the runs share one GPU.
- **Expected cost:** not measured for this shape of work; the agent work is reported against its token ceilings at the Part 1 gate. GPU time is measured in Task 4 before any long run.

## Sweep tier
Feature tier at the end of Part 1, with the dependency, CI-workflow and public-text modifiers. One sweep for the branch state Part 1 ends in.

## Owner stops
1. **After Task 0:** the report on public real-ticket sets. The owner decides whether one is worth adding as a second test.
2. **The Part 1 gate, after Task 7:** the practice numbers against the bars, and how Part 1 lands: its own PR (site unchanged) before Part 2, or held on the branch until Part 2 is done. The planner recommends its own PR, so the browser work is reviewed apart from the model work.

## Files
| File | Job |
|---|---|
| `.kit/reports/real-ticket-sets-2026-11.md` (local) | Task 0 report |
| `web/scripts/blind/blindFrames.ts` | The blind wording, outside `web/src` so the site never bundles it |
| `web/scripts/exportBlind.ts` | Writes `ml/data/blind.jsonl` once and its hash |
| `ml/data/blind.jsonl`, `ml/data/blind.sha256` | The frozen blind set and its fingerprint |
| `web/src/generator/extraFrames.ts` | New varied training wording, in its own list |
| `web/src/generator/deskFrames.ts` | Desk-only wording that no model trains on |
| `web/src/generator/templates.ts`, `generate.ts` | New `Split` pools `v2-train` and `desk`; v1 pools unchanged |
| `web/scripts/exportDataset.ts` | New `--v2` export; refuses blind or desk text in training |
| `ml/requirements-train.txt` | Pinned training packages (GPU side, not used by CI) |
| `ml/requirements.txt` | Adds pinned `onnxruntime`, `tokenizers`, `numpy` for scoring |
| `ml/triage_v2/train_sentence.py` | Trains the model and both heads |
| `ml/triage_v2/export_onnx.py` | Writes the 8-bit ONNX file, the heads file and a manifest with SHA-256 |
| `ml/triage_v2/score_onnx.py` | Scores a model folder on a jsonl file; writes answers and counts |
| `ml/triage_v2/practice_rounds.py` | Runs the 12 practice rounds; writes `ml/reports/practice_v2.json` |
| `web/src/pipeline/tableScorer.ts` | A scorer that reads saved answers by ticket id |
| `web/scripts/measurePipeline.ts` | New `--answers <file>` mode using the table scorer |
| `ml/reports/practice_v2.json`, `ml/reports/part1-gate.md` | Recorded numbers and the gate summary |

## Tasks

### Task 0 (should): Report on public real-ticket sets
- [ ] Search for public support-ticket datasets; for each, record the licence, size, language, label set and how its labels would map to the 9 categories and 4 priorities. Open every source page. -> verify: the report names each source URL and its licence text as read, and says plainly if none is usable
- [ ] Post the report to the owner (Owner stop 1). Nothing is downloaded without a yes.

### Task 1 (must): The blind test set, locked before any training
**Interfaces:** Produces `ml/data/blind.jsonl` (rows shaped like `heldout_*.jsonl`, `fold: null`), `ml/data/blind.sha256`, error code `E_BLIND_IN_TRAIN`, and `assertBlindIsolated(trainRows, blindRows)` exported from `web/scripts/exportDataset.ts`.
- [ ] A fresh agent writes `web/scripts/blind/blindFrames.ts`: for each category and each hard case, as many frames as one existing fold holds (the count read from `foldsOf`), from `web/src/domain/labelRules.ts` and `labels.ts` only. Its brief forbids reading `web/src/generator/` and any `ml/data` file. -> verify: the agent's report lists the files it read
- [ ] Write the failing test `blind frames share no normalised frame with any v1 or extra frame` -> verify: red on an assertion with a planted copy, green without it
- [ ] Write the failing test `assertBlindIsolated throws E_BLIND_IN_TRAIN, writing no file, for a blind text that differs from a training text only by case, spacing or punctuation` -> verify: red first
- [ ] Implement `exportBlind.ts` (`BLIND_SEED` unused by any other export, 2,000 tickets, drops repeats) and `assertBlindIsolated`; wire the assert into every training and tuning export, v1 and v2 -> verify: `npm --prefix web run test` passes
- [ ] Run the export once; write the hash; add a pytest that recomputes `blind.sha256` -> verify: pytest passes; `git diff --stat` shows only the new files
- [ ] A checker verifies the two isolation tests can fail and that no Part 1 script opens `blind.jsonl` except the hash test -> verify: PASS
- [ ] Commit `feat: add a blind test set locked before training`

### Task 2 (must): Varied training wording and desk-only wording, with v1 untouched
**Interfaces:** Consumes Task 1's `assertBlindIsolated`. Produces `Split` values `{ pool: 'v2-train'; leftOut?: readonly number[] }` and `{ pool: 'desk' }`; export files `ml/data/generated/v2_train.jsonl`, `v2_desk.jsonl`, `v2_tune_<a>_<b>.jsonl`, `v2_heldout_<k>.jsonl`; error code `E_DESK_IN_TRAIN`.
- [ ] Write the failing test `a v1 export writes the same bytes as before`: SHA-256 of every file a v1 export writes equals the values recorded in the test from `main` -> verify: red if a v1 pool changes
- [ ] Write the failing tests: `v2-train draws from the v1 frames and the extra frames and never from a desk frame`; `desk draws only from desk frames`; `no generated v2 training text repeats` -> verify: red first
- [ ] Builders write `extraFrames.ts` and `deskFrames.ts`: frames that vary in length (one line to a long paragraph), in detail (order numbers, dates, device, steps tried) and in case type, per the owner's Q6 answer; the extra frames carry their own fold numbers so practice rounds can leave them out -> verify: the lead reads every frame against the Global Constraints
- [ ] Implement the two pools and the `--v2` export with `assertBlindIsolated` and the desk check -> verify: `npm --prefix web run gate` passes
- [ ] Commit `feat: add varied training wording and desk-only wording`

### Task 3 (must): Measure what the new wording does, before the model changes
- [ ] Bar, written now: the word recipe trained on `v2_tune_*` is not lower than on `tune_*` by more than 1 point of department accuracy on the mean of the 12 practice rounds. If it is lower, stop and report (rule: re-plan on failure).
- [ ] Run the word recipe on the 12 v2 practice rounds -> verify: counts saved to `ml/reports/practice_v2.json` under `word_v2`, with the control (fold 0 = 2,325 of 4,000 on v1 data) run first

### Task 4 (must): Training, ONNX export and scoring in the repo
**Interfaces:** Produces
- `train_sentence.fit(rows, epochs, learning_rate, batch_size, max_length) -> TrainedModel`
- `export_onnx.export(model, out_dir) -> Manifest` writing `model_quantized.onnx`, `heads.json`, `tokenizer.json`, `manifest.json` (`sha256` of each file, class lists, `max_length`, package versions)
- `score_onnx.score(model_dir, rows, expected_sha256) -> list[Answer]` where `Answer = {id, category, priority, category_probs, priority_probs}`; raises `E_MODEL_HASH` when the file's hash differs
- [ ] Add `ml/requirements-train.txt` and the three scoring pins; install from the pinned files only -> verify: `pip install --require-hashes` succeeds in a fresh environment
- [ ] Write the failing tests for `score_onnx` on a tiny ONNX fixture built in the test: hash mismatch raises `E_MODEL_HASH` before any scoring; a text over `max_length` tokens is cut to the same tokens the trainer used; probabilities sum to 1; answers come back in input order -> verify: red first, then `pytest ml/tests` passes
- [ ] Implement the three modules; training tests that need the GPU and the base model carry the marker `local_gpu`, which CI does not select (stated here, not hidden: CI has no GPU) -> verify: `pytest ml/tests -m local_gpu` passes on the owner's PC
- [ ] Reproduce the 2026-11-10 practice result with the repo's code on v1 data -> verify: mean department accuracy over the 12 rounds within 1 point of 81.5%; the measured GPU minutes per training run are recorded
- [ ] Commit `feat: add sentence model training, export and scoring`

### Task 5 (must): Better settings, one change at a time
- [ ] Bar, written now: a setting replaces the current one only if it is right on department more often on at least 9 of 12 rounds and neither raw hard-line count is worse in total. Candidates, in order: 3 and 4 epochs; learning rates 1e-5 and 5e-5; voting with the word model; class weights for priority.
- [ ] Give the owner the time estimate from Task 4's measured minutes before the run -> verify: the owner's yes if over 30 minutes
- [ ] Run; record every candidate, kept or not, in `practice_v2.json` -> verify: the chosen settings are written into `train_sentence.py` as UPPERCASE constants

### Task 6 (must): The rules and review step on top, and the High/Urgent check
**Interfaces:** Consumes `Answer` rows from Task 4. Today `web/src/pipeline/run.ts` takes `RunDeps.model: Model` and calls `score(model, head, maskedText)` itself, so there is no seam yet. Produces the seam `RunDeps.predict?: (head: HeadName, maskedText: string, id: string) => Prediction` (when absent, `run.ts` scores with `deps.model` exactly as today), `tablePredict(answers: ReadonlyMap<string, Answer>): RunDeps['predict']` (throws `E_ANSWER_MISSING` for an unknown id), and `measurePipeline.ts --answers <file> --rows <file>`. This changes a shared interface, so it is shown to the owner in the Task 6 rundown. Part 2 note: browser ONNX scoring is asynchronous and `runTicket` is not; Part 2 decides between scoring before the run starts and an async pipeline.
- [ ] Write the failing tests: `tablePredict returns the saved probabilities for a ticket id`; `tablePredict throws E_ANSWER_MISSING and scores nothing for an id it does not hold`; `runTicket without predict gives the same trail as before` -> verify: red first
- [ ] Implement the seam in `run.ts` and `tableScorer.ts`; add the `--answers` mode -> verify: `npm --prefix web run gate` passes; with the word model's own saved answers the measurement equals today's recorded counts (the control)
- [ ] Bar, written now, per practice round against the word recipe on the same tickets: High/Urgent sent out unchecked as Low/Medium not higher; high-risk missed not higher; unchecked wrong department and priority within the allowance. A round that fails any line fails.
- [ ] Measure the 12 rounds with the existing floor and guard settings -> verify: counts in `practice_v2.json`
- [ ] If a hard line fails on any round: add a check for "High or Urgent?" (first a threshold on the summed High and Urgent probability; then, only if that fails, a third head trained for that one question), tuned on the round's tuning side only -> verify: all 12 rounds pass both hard lines, or stop and report with the failing rounds
- [ ] Commit `feat: measure the pipeline on saved model answers`

### Task 7 (must): The Part 1 gate
- [ ] Write `ml/reports/part1-gate.md`: per round and in total, department and priority accuracy, both hard lines, the allowance lines, and tickets sent to a person, for today's recipe and the new model; every bar above with pass or fail; GPU minutes; what was not measured -> verify: every number in it is read from `practice_v2.json` by a script, not typed
- [ ] Run the full gate (adapter field 2: both CI jobs' commands) -> verify: every step exit 0
- [ ] Parking-lot triage, then the sweep at the feature tier -> verify: the sweep report exists
- [ ] Owner stop 2: post the rundown, the gate file and the choice of how Part 1 lands

## Part 2 (outline; detailed at the Part 1 gate)
- Phase 4: the 90-day run. Open first: its cost. One training run's measured minutes times the number of retrains decides between nightly retrains, weekly retrains, or training only the heads each night.
- Phase 5: the browser. The model loads on demand, the desk works while it loads (wireframe first), the close-match test with its limit, a phone test by the owner.
- Phase 6: one reading of the blind set for every ladder step; Model History, model card, guide pages; the download page; the Hugging Face page (the owner's act); the code carry-overs T2-4, T2-6, T2-7, T2-8, H6b, H9, H10; the wider privacy mask.

## Parking Lot

## Execution Notes & Deviations
