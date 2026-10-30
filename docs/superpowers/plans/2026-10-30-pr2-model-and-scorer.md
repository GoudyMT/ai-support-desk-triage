# PR 2: Masker, v0 Port, Model Training and TypeScript Scorer - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: the execution method is the owner's pick (see the hand-off
> message; PR 1 used the kit's agent-team-build). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** one shared privacy masker, an exact TypeScript port of v0, a word-weight model trained and scored per
template fold against v0, exported as JSON, and a TypeScript scorer that agrees with Python on every evaluation row.

**Architecture:** TypeScript owns everything the browser will run: the masker, the v0 port, the scorer. The
export script writes masked text plus v0's answers for the Python side. Python (`ml/`) trains and evaluates per
fold, refits the shipped model on all wording, writes the model JSON into `web/` and a predictions file for the
parity test. CI regenerates the data, retrains, proves the committed model is reproduced, then runs parity.

**Tech Stack:** TypeScript 5.9.3, Vitest 5.0.5, Node 22.22.3 (adapter A6, A11). Python 3.12.2 (`C:\Python312`)
in a venv at `ml/.venv`; scikit-learn, numpy, scipy, pytest pinned exactly in `ml/requirements.txt`, each released
at least 14 days before the pin date, resolved and shown to the owner before download (Q1).

**Spec:** `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` sections 5.1 (Privacy row), 5.2, 5.3,
5.7, 6, 9 C2; revision history 2026-10-30 (PR 2 planning).

## Owner locks (2026-10-30)

| # | Choice | Locked |
|---|---|---|
| Q1 | Python setup | A: project venv, exact pins, CI uses the same file |
| Q2 | Where training runs | A: train here, commit the model JSON; CI retrains and fails if predictions differ |
| Q3 | Masking before training | A: TypeScript masker now (moved from PR 3), shared by training and the live page |
| Q4 | v0 comparison | A: v0 port moved into PR 2; model and v0 measured on the same tickets |
| Q5 | "Beats v0" bar | B: category accuracy beats v0 on every one of the 4 folds and on the hand-written set |

**Decided alone (reported):** the shipped model is refit on all wording (a 20,000-ticket seed-1 export with
split `all`), because live tickets use every fold (spec 5.2); the 4 fold models exist only to measure. No tuning
before the owner sets the raw-accuracy bar (spec 6). Hand-written results reported as k of n.

## Test-set isolation (owner, 2026-10-30)

The owner asked that the model be kept apart from every test set, and that the write-ups show how.
- **Fold models (the measured numbers):** each trains only on the other three folds' wording; held-out text
  that also appears in training is dropped at export (PR 1) and checked again before training (Task 4).
- **Hand-written set:** never used for training by any model; Task 3 checks that no hand-written normalised
  text is in `train_all.jsonl` or any `train_k.jsonl`, and fails the export if one is.
- **Shipped model:** trained on all wording, so it has seen the held-out templates. It is used for parity and
  the live page only; no accuracy number is ever reported for it except on the hand-written set.
- **Write-up:** `ml/MODEL_CARD.md` (Task 8) states these three rules, the data, the numbers from
  `ml/reports/eval.json` and the limits; the README links it in PR 6. `eval.json` carries an `isolation` block
  naming, for each number, the model and the rows it was scored on.

**Getting the model (owner's idea, 2026-10-30):** `web/src/model/model.json` is a plain file in the repo and
on the site. A "get the model" path (download link on the site, the model card beside it, how to load it in
Python or TypeScript) is a design call for PR 5 or 6; parked in the Roadmap.

## Global Constraints

- ASCII only in every source, data and doc file. One-line commit messages `type: subject`, no body, no trailer.
- Categories and priorities exactly as in `web/src/domain/labels.ts` (`CATEGORIES`, `PRIORITIES`).
- `RANDOM_STATE = 113` in Python (global standards); Python config constants UPPERCASE at module top; scripts
  wrap logic in `def main():` with the `__main__` guard; step markers `# Step N:` and `[N/M]`; dividers `"=" * 60`.
- No network calls at runtime; no secrets. Dependencies pinned exactly; downloads only after the owner's yes.
- Training data uses seeds 1 to 999 only (existing `checkExportSeed`).
- v0 is ported exactly, quirks included, and never fixed (spec 5.7). v0 runs on raw text, the model on masked text
  (spec 9 C2).
- Tests never skip; a missing generated file fails with a message naming the command that makes it.
- Generated files stay in `ml/data/generated/` (gitignored). Committed outputs: `web/src/model/model.json` and
  `ml/reports/eval.json`.

## Review Focus

1. Tokenizer drift between Python and TypeScript on text the generator never makes (non-ASCII letters, digits
   glued to words, underscores): the model must split it the same way on both sides -> Task 6 parity cases.
2. A placeholder that collides with a real word (`[CARD]` reads as the word "card") would teach the model a fake
   cue -> Task 1 placeholder choice and test.
3. Real-looking personal data in formats the generator does not use ("(212) 555-0147", "4111-1111-1111-1111",
   "Order #48213") must still be masked before the model sees it (the PR 3 privacy promise) -> Task 1 cases.
4. Leakage: a fold model scored on wording it trained on inflates every number -> Task 4 asserts no held-out
   normalised text is in that fold's training file before training.
5. Run-to-run drift: the same data must give the same model; CI on Linux and this PC on Windows must predict the
   same classes -> Task 7 determinism check.

---

### Task 0 (lead, with the owner): track list, venv, pins

Not a builder unit.
- [x] Add to `.kit/tracking.json` track: `ml/` (the never list and `.gitignore` still keep `ml/.venv/` and
  `ml/data/generated/` out; add `ml/.venv/` to `.gitignore`). Owner's yes.
- [x] Write `ml/requirements.txt` (exact pins, each at least 14 days old); show the resolved list; on the owner's
  yes create the venv: `C:\Python312\python.exe -m venv ml\.venv`, then `ml\.venv\Scripts\python.exe -m pip
  install -r ml\requirements.txt`. Record versions in adapter A6, the Python test command in A8 and A9.
- [x] Kit 1.9.0 update before the first builder starts, in a fresh session (owner, 2026-10-30):
  `/methodology-kit update`, then `/methodology-kit status`.

### Task 1: Privacy masker (Opus checker)

**Files:** Create `web/src/privacy/mask.ts`, `web/src/privacy/mask.test.ts`.

**Interfaces:**
- Produces: `type MaskKind = 'email' | 'phone' | 'order' | 'card'`;
  `MASK_TOKENS: Record<MaskKind, string>` = email `[EMAIL_ADDRESS]`, phone `[PHONE_NUMBER]`, order
  `[ORDER_NUMBER]`, card `[CARD_NUMBER]` (underscored, so the model's tokenizer reads `card_number`, never the
  word `card`); `interface MaskResult { text: string; found: MaskKind[] }` (`found` in order of appearance, for
  the PR 3 privacy stage display); `maskText(text: string): MaskResult`.

Approach: card-like runs first (13 to 19 digits, single spaces or dashes allowed between groups), then emails,
then order numbers (`ORD-` plus digits, and `order` / `order #` / `order number` followed by 4 or more digits),
then phones (7 to 15 digits with optional `+`, parentheses, spaces, dots or dashes, at least 7 digits).

- [x] **Step 1: Tests**
  - `maskText` over `generateTickets(1, 5000)`: every ticket with `hasFakeData` has no `@`, no `ORD-`, no
    `555-01`, no run of 13 or more digits left; every ticket without fake data is returned unchanged.
  - Formats the generator does not make (Review Focus 3), each masked to its token: `jordan@mail.example.net`,
    `(212) 555-0147`, `+1 212 555 0147`, `212.555.0147`, `4111-1111-1111-1111`, `4111111111111111`,
    `Order #48213`, `order number 482130`.
  - Left alone: `version 2.4.1`, `3 times`, `2026-10-30`, `error 404`, `10:45`.
  - `found` for `"Call 555-0142 about ORD-123456"` equals `['phone', 'order']`.
  - Masking is idempotent: `maskText(maskText(x).text).text === maskText(x).text` on the 5,000 tickets.
- [x] **Step 2:** Run `npm --prefix web test -- mask`; expect fail. **Step 3:** Implement. **Step 4:** Pass.
  Break check: remove the card rule, see the generated-ticket test fail, restore.
- [x] **Step 5:** Commit `feat: add the privacy masker shared by training and the live page`

### Task 2: v0 port with equality to the original page (Opus checker)

**Files:** Create `web/src/baseline/v0.ts`, `web/src/baseline/v0.test.ts`.

**Interfaces:**
- Consumes: `Category`, `Priority` from `web/src/domain/labels.ts`.
- Produces: `interface V0Result { category: Category; priority: Priority; mustReview: boolean }`;
  `v0Triage(text: string): V0Result` (trims and lower-cases like the original; empty text returns
  `{ category: 'Other', priority: 'Medium', mustReview: false }`, where the original showed an alert).

Approach: copy the four `if` blocks of `analyze()` in `capstone/prototype/AI_Support_Desk_Triage_Prototype.html`
(lines 141 to 217) in the same order, same substrings, same overwrite behaviour.

- [x] **Step 1: Tests**
  - Oracle: the test reads the HTML file, takes the `<script>` text, runs it in `node:vm` with a stub `document`
    (`getElementById('ticket').value` = the ticket, `getElementById('output')` captures `innerHTML`) and a stub
    `alert`, calls `analyze()`, and parses category, priority and review Yes or No from the captured HTML.
  - `v0Triage` equals the oracle on all 48 rows of `ml/data/handwritten.jsonl` (8 README + 40) and on
    `generateTickets(3, 2000)` texts.
  - Pinned quirks: `"I moved to Canada"` is Accessibility Support (the `ada` substring); `"billing error"` is
    Technical Issue with `mustReview` true (a later rule overwrites the category, the billing flag stays).
- [x] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass. Break check: swap the order of two blocks, see
  the oracle test fail, restore.
- [x] **Step 5:** Commit `feat: port the v0 keyword rules exactly as the original page runs them`

### Task 3: Export with masked text and v0 answers

**Files:** Modify `web/scripts/exportDataset.ts`, `web/scripts/exportDataset.test.ts`.

**Interfaces:**
- Consumes: Task 1 `maskText`, Task 2 `v0Triage`.
- Produces: every exported row gains `maskedText: string` and `v0: { category, priority, mustReview }` (v0 on
  the raw `text`). New files in `ml/data/generated/`: `train_all.jsonl` (seed 1, 20,000, split `all`, fold `null`)
  and `handwritten.jsonl` (the 48 frozen rows plus `maskedText` and `v0`; the frozen source file is not edited).

- [x] **Step 1: Tests:** a row's `maskedText` equals `maskText(text).text` and its `v0` equals `v0Triage(text)`;
  `train_all` rows have `fold: null`; the hand-written output keeps all 48 ids and every original field unchanged;
  the export throws `E_HANDWRITTEN_IN_TRAIN` when a hand-written normalised text is in any training file (break
  check: add one hand-written text to a toy training list, see it throw).
- [x] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; run `npm --prefix web run export-data`, expect
  4 x 20,000 + 4 x 4,000 + 20,000 + 48 rows printed.
- [x] **Step 5:** Commit `feat: export masked text and v0 answers for training and evaluation`

### Task 4: Python training and per-fold evaluation (Opus checker)

**Files:** Create `ml/triage/__init__.py`, `ml/triage/data.py`, `ml/triage/features.py`, `ml/triage/train.py`,
`ml/triage/evaluate.py`, `ml/tests/test_data.py`, `ml/tests/test_features.py`, `ml/tests/test_evaluate.py`,
`ml/pytest.ini`.

**Interfaces:**
- Consumes: the Task 3 files.
- Produces:
  - `data.load_rows(path: Path) -> list[dict]` (raises `FileNotFoundError` naming `npm --prefix web run
    export-data` when a file is missing).
  - `features.TOKEN_PATTERN = r"(?a)\b\w\w+\b"` (ASCII word characters, so Python and the TypeScript scorer split
    identically); `features.make_vectorizer() -> TfidfVectorizer` with `lowercase=True`,
    `token_pattern=TOKEN_PATTERN`, `ngram_range=(1, 2)`, `min_df=2`, `sublinear_tf=True`, `norm="l2"`,
    `smooth_idf=True`.
  - `train.fit_pipeline(texts: list[str], labels: list[str]) -> Pipeline` (vectorizer +
    `LogisticRegression(C=1.0, max_iter=2000, random_state=RANDOM_STATE)`); one pipeline for category, one for
    priority, both on `maskedText`.
  - `evaluate.fold_scores(...)` and the command `ml\.venv\Scripts\python.exe -m triage.evaluate` (run from `ml/`)
    writing `ml/reports/eval.json`: per fold and for hand-written, model and v0 category accuracy, priority
    accuracy, v0 review-flag accuracy; mean and standard deviation over the 4 folds; hand-written as `k` and `n`;
    `beats_v0_every_fold: bool` and `beats_v0_handwritten: bool` (Q5).
- [ ] **Step 1: Tests:** leakage guard - for each fold, no normalised held-out `maskedText` (same rule as
  `normalizeText` in the export) is in that fold's training set, and training raises if one is (Review Focus 4);
  `load_rows` on a missing path raises with the command in the message; on a 30-row toy set the pipeline
  predicts its own training rows and `fold_scores` counts k of n exactly; the vectorizer tokenizes
  `"caf\u00e9 x_y 4o [CARD_NUMBER]"` to the expected list.
- [ ] **Step 2:** Fail (`ml\.venv\Scripts\python.exe -m pytest ml/tests`). **Step 3:** Implement. **Step 4:** Pass.
- [ ] **Step 5:** Commit `feat: train and score the word-weight model per fold against v0`

### Task 5 (lead, with the owner): first honest run and the bar

Not a builder unit. The deciding measurement (spec 6, Q4).
- [x] Before running, write in this plan the placeholder check: train fold models once as is and once with every
  `[..._NUMBER]` / `[EMAIL_ADDRESS]` token replaced by one `[PERSONAL_DATA]` token; if kind tokens raise category
  accuracy on held-out rows that carry personal data by more than 2 points, the model is leaning on a generator
  artifact and Task 1's tokens collapse to one (owner told).
  Written before any run (2026-10-30): "rows that carry personal data" = held-out rows whose `maskedText` differs
  from `text`; the 2-point bar applies to the mean over the 4 folds, per-fold values reported beside it; the check
  is a one-off scratch script over `triage.train.fit_models` and `triage.evaluate.score_rows`, not committed.
- [ ] Run the evaluation; post the numbers (per fold, mean and spread, hand-written k of n, v0 beside each).
- [ ] The owner sets the raw-accuracy bar and the flag-rate target note (spec 10.2) before any tuning. If the
  model misses Q5 on any fold: stop, Re-Plan on Failure, options to the owner.
- [ ] Commit `ml/reports/eval.json`: `feat: record the first per-fold evaluation against v0`

### Task 6: Model export and TypeScript scorer with parity (Opus checker)

**Files:** Create `ml/triage/export_model.py`, `ml/tests/test_export_model.py`, `web/src/model/model.json`
(generated), `web/src/model/scorer.ts`, `web/src/model/scorer.test.ts`, `web/src/model/scorer.parity.test.ts`,
`web/vitest.parity.config.ts`. Modify `web/vitest.config.ts` (exclude `*.parity.test.ts`), `web/package.json`
(script `parity`).

**Interfaces:**
- Consumes: Task 4 `fit_pipeline`, `TOKEN_PATTERN`; Task 3 `train_all.jsonl`.
- Produces:
  - Command `python -m triage.export_model`: fits category and priority on `train_all.jsonl`, writes
    `web/src/model/model.json` = `{ version: 1, tokenPattern, ngramRange: [1, 2], sublinearTf: true,
    heads: { category: Head, priority: Head } }`, `Head = { classes: string[], vocabulary: string[] (index
    order), idf: number[], coef: number[][] (classes x vocabulary), intercept: number[] }`, floats at full
    precision (Python `repr`), and `ml/data/generated/parity_predictions.jsonl` (`id`, category and priority
    class plus probabilities from sklearn) for every held-out and hand-written row.
  - `scorer.ts`: `interface Prediction { label: string; confidence: number; probabilities: Record<string,
    number>; topTerms: { term: string; weight: number }[] }`; `loadModel(json: unknown): Model` (throws
    `E_MODEL_SHAPE` on a bad shape); `score(model: Model, head: 'category' | 'priority', maskedText: string):
    Prediction` (top 5 terms by contribution to the predicted class, for the word chips, spec 5.3).
    Probabilities are a softmax over the class scores (scikit-learn's multinomial form for lbfgs); term
    frequency is `1 + ln(count)` (sublinear), then idf, then L2 normalisation, as scikit-learn does.
- [ ] **Step 1: Tests:** Python - the JSON round-trips to the same predictions as the fitted pipeline on 200
  rows. TypeScript unit - tokenizer equals the Python list for `"caf\u00e9 x_y 4o [CARD_NUMBER]"` and
  `"Its 2fa isn't working!!"` (Review Focus 1); bigrams join with one space; an unknown word changes nothing;
  `loadModel` rejects a model missing `idf`. Parity (`npm --prefix web run parity`) - for every row of
  `parity_predictions.jsonl`, TypeScript's class equals Python's (100%, spec 6) and each probability is within
  1e-9; a missing file fails naming the two commands that make it.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass; record `model.json` size in this plan (size
  budget A12 is set in PR 4). Break check: drop `sublinear_tf` on the TypeScript side, see parity fail, restore.
- [ ] **Step 5:** Commit `feat: export the model and score it in TypeScript with a parity test`

### Task 7: CI job for the model

**Files:** Modify `.github/workflows/ci.yml`; Create `ml/triage/check_model.py`, `ml/tests/test_check_model.py`.

**Interfaces:**
- Produces: command `python -m triage.check_model <fresh.json> <committed.json>`: exits 0 when both models give
  the same category and priority class on every held-out and hand-written row, else exits 1 naming the first
  differing id (Q2, Review Focus 5).
- New CI job `model` (ubuntu, Python 3.12.2 via `actions/setup-python` pinned to a full commit, Node 22.22.3):
  `npm ci`, export, venv + `pip install -r ml/requirements.txt`, `pytest ml/tests`, export the model to a temp
  path, `check_model` against the committed file, then `npm run parity`.
- [ ] **Step 1: Tests:** `check_model` on two equal models exits 0; with one coefficient sign flipped so a
  row's class changes, exits 1 and names that row.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Pass locally; the CI run itself is seen after the
  owner's go to push.
- [ ] **Step 5:** Commit `ci: retrain the model in CI and check it matches the committed one`

### Task 8 (lead): close out

- [ ] Write `ml/MODEL_CARD.md` (test-set isolation section above, data, numbers from `eval.json`, limits);
  every number in it quoted from `eval.json`.
- [ ] Full gate green: `npm --prefix web run gate`, `ml\.venv\Scripts\python.exe -m pytest ml/tests`,
  `npm --prefix web run parity`; adapter A9 updated with all three.
- [ ] Feature-tier sweep: write the Swarm Contract, run approve.mjs first; APPROVED -> short start notice to the
  owner, then findings; report in `.kit/sweeps/`. Canary counts into the scoreboard.
- [ ] Tracking files at the milestone; PR body from the pr-body skill shown to the owner; push and PR on the
  owner's go only. Kit 1.9.0 check (owner, 2026-10-30): the PR body passes the audit with no explained failures.
- [ ] Next closeout: run `audit.mjs <handoff.md> --send` and paste the printed text to the coordinator.

## Progress

- 2026-10-30: owner locked Q1-Q5; design amended (spec 6, section 7, revision history). Owner approved the
  plan, with test-set isolation and the write-up added, and chose the PR 1 team (Sonnet builders, Opus checkers
  on Tasks 1, 2, 4, 6). Build starts in a fresh session after the kit 1.9.0 update.
- 2026-10-30: kit 1.9.0, status current. Task 0 done (0484a81): ml/ tracked, `ml/.venv/`, `__pycache__/`,
  `.pytest_cache/` ignored; 13 exact pins (cloudpickle 3.1.2 added, joblib needs it), `pip check` clean.
- 2026-10-30: Task 2 done (0e6e381, 6ff578c): 27 tests; checker FIX round 1 added one oracle row per keyword
  (4 of 22 were unguarded). Lead break check: `credentials` misspelled -> 1 red row, restored.
- 2026-10-30: Task 1 done (93b0260, 264e881, 9c2b937): 50 tests; checker FIX rounds 1 and 2 closed order-wording,
  plural-list, phone-after-number and 20+ digit leaks (checker fuzz: 320 of 3,510 sentences leaked before round 1,
  3 after); lead ruling: every 13+ digit run masks as a card (no 19 cap). Lead break check: card cap {12,18} -> 4
  red rows, restored. Full gate 312 tests, exit 0. Known limits, for PR 3's privacy copy: dotted numbers like
  "0475.12.34.56", a no-break space between card groups, an en dash in a phone; 7+ digit ids (build numbers, IPs)
  mask as phones; the variable-length lookbehind needs Safari 16.4+ (PR 4 browser targets).
- 2026-10-30: Task 3 done (00798ba): 317 tests; builder added a raw-vs-masked v0 test (an "ada" email) after its
  own break check went uncaught. Lead break check: guard without train_all -> 1 red, restored; gate exit 0;
  export wrote 4 x 20,000 + 4 x 4,000 + 20,000 + 48 rows. The builder's edit-fence file list could not be written
  (the Write tool refused the shared git path), so the fence was not active for this unit; the diff touched only
  its two files.
