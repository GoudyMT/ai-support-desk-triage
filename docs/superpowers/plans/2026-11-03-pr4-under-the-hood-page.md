# PR 4: The Under the Hood Page - Implementation Plan

## Progress
- Current task: 2-4 (agent-team batch)
- Done (with evidence): design and plan approved 2026-11-03 (447d07d); Task 0 - 0c15366 - owner's yes on the
  lockfile (`@playwright/test` 1.64.1, 3 packages, no audit finding of its own), browsers 1.26 GB, smoke spec red
  on the missing `index.html`, workflow parsed with js-yaml, gate 733 tests green; Task 1 - 2d9d2ec - fold
  test red then green, break check (fold 1's file as fold_0) red on `assert 1 == 0`, each fold SAME on 16,048
  rows, one weight +0.01 DIFFERENT exit 1, pytest 120 passed
- Next: Tasks 2, 3, 4 in parallel, then 5, then 6
- Branch: feat/under-the-hood-page (from main @ 524e34d)
- Open questions: none

**Goal:** a visitor presses Play and watches live tickets move through the six stages, with plain narration,
word chips, Take over and live numbers, all scored by a model that never saw the tickets' templates.
**Design:** `docs/superpowers/specs/2026-11-03-pr4-under-the-hood-page-design.md` (approved 2026-11-03); parent
`docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` sections 5.4, 5.5, 6, 10.3 and C1-C3; the locked
wireframe https://claude.ai/artifact/BzA8iShtJu6v2ULGKA4w1K. Builders read the PR 4 design in full.
**Approach:** a pure run engine in `web/src/run/` drives the PR 3 `runTicket` unchanged, one ticket and one
stage at a time; plain TypeScript panels in `web/src/page/` render the engine's state. Fold models are
committed under `web/public/models/` and CI proves each equals its retrain.
**Stack:** TypeScript 5.9.3, Vite 6.4.4, Vitest 5.0.5, Node 22.22.3, tsx; Python 3.12 venv `ml/.venv`
(adapter A6, A11); `@playwright/test` for browser tests in Chromium, Firefox and WebKit (owner, 2026-11-03).

## Global Constraints

- PR 2 and PR 3 Global Constraints hold unchanged (their plans in `docs/superpowers/plans/`).
- No change to `web/src/pipeline/`, `web/src/model/`, `web/src/privacy/` or `web/src/generator/` behaviour;
  the page consumes them. A needed export is added without changing behaviour, and named in the commit.
- Live seeds: integers from 1000 to 4294967295 (parent 5.2 live range; `generateTicket`'s 32-bit limit);
  fold = seed mod 4; ticket i = `generateTicket(seed, i, { fold, side: 'heldout' })`; scored with
  `CONFIDENCE_FLOOR` and `SECOND_CHECK_ON` from `run.ts`.
- Model files fetched only from `${import.meta.env.BASE_URL}models/fold_<k>.json`; no other request after the
  page's own files.
- Act 1: about 30 tickets in about 2 minutes at learn speed; the page's timer shows each stage of tickets 0-2
  for about 5 s with full narration, then tickets 3-29 at about 1 s each with one sentence per ticket (owner,
  2026-11-03; the schedule's simulated arrival times are unchanged). Act 2: 100 tickets over one simulated business day
  in about 90 seconds, more arrivals mid-morning. Pause and Take over stop the clock.
- Accessibility: WCAG 2.2 AA contrast; every control a real `<button>`; 44 px targets; visible focus; reduced
  motion = no position change; polite live region at learn speed only; no sideways scroll at 375 px.
- Copy names each stage for what it is: the model, a rule, the simulated reviewer, you. Never "AI" for a rule
  or the reviewer.
- Errors are static codes: `E_MODEL_LOAD`, `E_MODEL_SHAPE` (from `loadModel`), `E_SEED_RANGE`.
- Commits one line, `type: subject`, no AI trailer (project rule).

## Review Focus

1. `?seed=abc`, `?seed=999`, `?seed=1.5`, `?seed=99999999999`: each falls back to a fresh random seed and the
   page says so, never throws -> Task 2 test.
2. Pause pressed mid-stage, then Step: the next stage of the same ticket runs, never a new ticket -> Task 2 test.
3. Take over switched on while a flagged ticket is already in Review with the simulated reviewer: that ticket
   finishes with the reviewer; the next flagged one waits for the viewer -> Task 2 test.
4. A top term that is a word pair split by a one-letter word or by a mask token (`"me on"` in "me on
   [PHONE_NUMBER]") -> Task 4 tests.
5. Hand back pressed while the form is open: the open ticket goes to the simulated reviewer, and the viewer's
   count does not change -> Task 2 test.

## Execution approach

Agent-team batch, as PRs 2 and 3 (adapter: agent-teams fields 1-11). The lead runs Tasks 0, 1 and 7; Sonnet
builders build Tasks 2-6 test-first in their own worktrees, from this branch. Opus checker on Task 2 (the
engine: replay, Take over and the clock carry the design's guarantees) and Task 6 (the page: accessibility and
the single-fetch rule). Order: 1 first (the engine's tests load a committed fold model); 2, 3 and 4 in parallel;
5 needs 2 and 3; 6 needs 0 and 2-5. Reason: six units with clear interfaces; the engine and the page are where a
mistake reaches a visitor. Expected: two working sessions, with owner stops at Task 0 (the lockfile), Task 6
(budgets) and Task 7.

## Sweep tier

Feature tier with the UI modifier (a new public surface; parent section 7: "Owner wireframe lock first; Sonnet
builders"). The ui-review skill runs before the sweep. Swarm Contract through `approve.mjs` first (L-01).
Every changed workflow file parsed with a YAML parser before the push (L-02).

## Files

| File | Job |
|---|---|
| `web/public/models/fold_0.json` .. `fold_3.json` | The four fold models the page loads (Task 1) |
| `ml/tests/test_committed_folds.py` | Each committed fold model loads and names its own fold (Task 1) |
| `.github/workflows/ci.yml` | Model job: each committed fold model equals its retrain (Task 1) |
| `web/src/run/seed.ts` | Seed parsing, random seed, fold choice (Task 2) |
| `web/src/run/clock.ts` | Act schedule and arrival times (Task 3) |
| `web/src/run/engine.ts` | The run: tickets, stages, pause, step, speed, Take over (Task 2) |
| `web/src/run/liveNumbers.ts` | The live numbers from the trails done so far (Task 5) |
| `web/src/run/narrate.ts` | Plain narration and the technical detail per stage (Task 4) |
| `web/src/page/spans.ts` | Where a term or rule word is written in the masked text (Task 4) |
| `web/index.html`, `web/vite.config.ts`, `web/src/page/*.ts`, `web/src/page/page.css` | The page (Task 6) |
| `web/size-budgets.json`, `web/scripts/checkSizes.ts`, `web/package.json` | Budgets and the gate (Task 6) |
| `web/playwright.config.ts`, `web/e2e/*.spec.ts` | Browser tests against `vite preview` (Tasks 0, 6) |
| Tests beside each file (`*.test.ts`) | |

---

### Task 0 (lead, owner's yes on the lockfile): install Playwright

The design's acceptance criteria for keyboard use, reduced motion, the 375 px width and "no other fetch" are
browser behaviour that Vitest in Node cannot see. The owner chose `@playwright/test` (2026-11-03): real
Chromium, Firefox and WebKit, the engines of the A21 check set.
- [ ] Pick the newest `@playwright/test` release at least 14 days old (adapter A6); resolve it into the
      lockfile only and run `npm audit` -> verify: HARD STOP, the owner sees the version, the lockfile diff and
      the audit before any install
- [ ] Install it and its three browsers; add `web/playwright.config.ts` (projects chromium, firefox, webkit;
      `webServer` = `vite preview` on a fixed port; no retries) and one smoke spec that opens the built page ->
      verify: `npm --prefix web run e2e` runs the smoke spec red (no page yet) for the right reason
- [ ] `package.json`: `e2e` = `playwright test`; `gate` stays lint, typecheck, test, build, sizes; CI gate job
      adds `npx playwright install --with-deps` and `npm run e2e` after the gate -> verify: the workflow parses
      with a YAML parser (L-02)
- [ ] Commit `chore: add Playwright for browser tests of the page`

### Task 1 (lead): commit the fold models and prove them in CI

**Files:** Create `web/public/models/fold_0.json` .. `fold_3.json`, `ml/tests/test_committed_folds.py`; Modify
`.github/workflows/ci.yml` (model job).
- [ ] Write `test_committed_folds.py`: each of the four files loads with `check_model.load_model` and its
      `heldOutFold` equals its file number -> verify: red before the files exist
- [ ] Export with `ml/.venv/Scripts/python.exe -m triage.export_model --folds-out web/public/models` run from
      the project root with `PYTHONPATH=ml` (no `cd`, lesson 7) -> verify: the test passes; sizes recorded
- [ ] CI: after the fold export to `$RUNNER_TEMP/folds`, run `python -m triage.check_model
      "$RUNNER_TEMP/folds/fold_<k>.json" "$GITHUB_WORKSPACE/web/public/models/fold_<k>.json"` for k = 0..3 ->
      verify: the workflow parses with a YAML parser (L-02); each check passes locally; a fold file with one
      weight changed by 0.01 fails it (break check, then restored)
- [ ] Commit `feat: commit the four fold models the live page scores with`

### Task 2: Seed and run engine (Opus checker)

**Files:** Create `web/src/run/seed.ts`, `seed.test.ts`, `engine.ts`, `engine.test.ts`.
**Interfaces (produces):**
- `MIN_LIVE_SEED = 1000`; `parseSeed(search: string): { seed: number; fromAddress: boolean; ignored: boolean }`
  (a valid `?seed=` wins; anything else gives `randomSeed()`, with `ignored` true when a `seed` was given but
  refused); `randomSeed(): number`; `foldOf(seed: number): number`
- `Stage` and `STAGES` from `web/src/run/stage.ts` (the lead adds it before the batch, so Tasks 2 and 4 share it)
- `type Speed = 'learn' | 'real'`
- `interface RunState { seed: number; fold: number; act: 1 | 2 | 'complete'; speed: Speed; playing: boolean;
  takeOver: boolean; current?: { trail: TicketTrail; stage: Stage; waitingForViewer: boolean }; done:
  TicketTrail[]; viewerReviews: { id: string; correct: boolean }[]; simTime: number }`
- `createRun(opts: { seed: number; model: Model; schedule: Schedule; wallClock: () => number }): Run`
- `interface Run { state(): RunState; advance(): void; play(): void; pause(): void; step(): void;
  setSpeed(s: Speed): void; setTakeOver(on: boolean): void; confirm(d: { category: Category; priority:
  Priority; route: string }): void; truthOf(id: string): TicketLabel; onChange(fn: () => void): () => void }`
- `advance()` moves one stage forward when playing or on `step()`; the page's timer calls it (Task 6).
- `runTicket` gets `now: wallClock`, so `ms` is measured time; the engine's copy of each trail then takes
  `receivedAt` from `schedule.arrivesAt(i)` (`runTicket` stamps both from one `now`, and the pipeline is not
  changed).
- Consumes: `generateTicket`, `runTicket`, `createSimulatedReviewer`, `ROUTES`, `Schedule` (Task 3).

- [ ] Tests: same seed gives identical `state()` sequences except `ms`; `foldOf(1001) === 1` and every
      ticket's id starts `T-1001-`; Review Focus 1, 2, 3 and 5; Take over waits on a flagged ticket until
      `confirm`, and the confirmed choice is `final` with `by: 'reviewer'`; an unflagged ticket never waits;
      a correct viewer review needs category and priority right, route ignored; `receivedAt` equals the
      schedule's simulated time -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- run/` passes
- [ ] Commit `feat: add the run engine that drives the pipeline one stage at a time`

### Task 3: Act schedule

**Files:** Create `web/src/run/clock.ts`, `clock.test.ts`.
**Interfaces (produces):** `ACT1_TICKETS = 30`; `ACT1_SECONDS = 120`; `ACT2_TICKETS_PER_DAY = 100`;
`ACT2_SECONDS = 90`; `interface Schedule { act(i: number): 1 | 2; arrivesAt(i: number): number; total:
number }` (simulated seconds); `createSchedule(seed: number): Schedule`.
- [ ] Tests: 130 tickets in all; Act 1 evenly spaced over 120 s; Act 2's 100 arrivals fall within one
      business day mapped to 90 s, non-decreasing, with more in the mid-morning quarter than in any other
      quarter; same seed, same times -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- clock` passes
- [ ] Commit `feat: add the act schedule for learn speed and the simulated business day`

### Task 4: Word spans and narration

**Files:** Create `web/src/page/spans.ts`, `spans.test.ts`, `web/src/run/narrate.ts`, `narrate.test.ts`.
**Interfaces (produces):** `findSpans(maskedText: string, term: string): { start: number; end: number }[]`
(the scorer's token rule, lower-cased; a pair = two adjacent tokens; mask tokens such as `[PHONE_NUMBER]` are
tokens of the text like any other); `narrate(trail: TicketTrail, stage: Stage): { plain: string; detail: {
label: string; value: string }[] }`.
- [ ] Tests: "so cannot" in "so I cannot follow" spans "so I cannot"; a rule word not written in the text
      gives no span; Review Focus 4; each stage gives one or two sentences under 40 words; flagged and not
      flagged guardrails say why in plain words; no narration contains "AI"; the detail lists confidence, the
      floor 0.50, every reason, the top words and the masked kinds -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- spans narrate` passes
- [ ] Commit `feat: add word spans and plain narration for each stage`

### Task 5: Live numbers

**Files:** Create `web/src/run/liveNumbers.ts`, `liveNumbers.test.ts`.
**Interfaces (produces):** `liveNumbers(state: RunState, truthOf: (id: string) => TicketLabel): { done: number;
perSecond: number | null; modelAccuracy: number | null; v0Accuracy: number | null; flaggedShare: number |
null; overrides: number; highRiskMissed: number; viewerCorrect: { correct: number; total: number } }` (null
before the first ticket is done; `perSecond` from `ms`, real speed only).
- [ ] Tests: each value equals a hand count on a fixed 12-ticket fixture; a flagged ticket still in Review
      does not count as missed; empty run gives nulls and zeros -> verify: red on an assertion
- [ ] Implement over `computeMetrics` -> verify: `npm --prefix web test -- liveNumbers` passes
- [ ] Commit `feat: add the live numbers from the tickets done so far`

### Task 6: The page, budgets and the gate (Opus checker)

**Files:** Create `web/index.html`, `web/vite.config.ts`, `web/src/page/main.ts` and one module per panel
(stage row, feed, current ticket, numbers, controls, take-over form), `web/src/page/page.css`,
`web/size-budgets.json`, `web/scripts/checkSizes.ts`; Modify `web/package.json` (`build`, `preview`, `sizes`;
`gate` adds build and sizes after test); Create `web/e2e/page.spec.ts`.
- [ ] Playwright specs, each in all three engines: keyboard-only run from Play to Run complete (`?seed=` fixed,
      real speed to keep it short); with `reducedMotion: 'reduce'` no element's box moves during a stage
      change; at 375 px `scrollWidth <= clientWidth`; exactly one request under `models/`, and it is
      `fold_<seed mod 4>.json`; a routed 404 on the model shows the error and Retry and no ticket; the Take
      over form defaults to the model's picks -> verify: `npm --prefix web run e2e` red first, for the right
      reason
- [ ] Build the panels to the locked wireframe -> verify: unit tests and `e2e` pass; the lead's visual check at 375 /
      768 / 1280, light and dark, forced colors
- [ ] HARD STOP: the owner sets the two budget limits from the measured build (adapter A12) -> verify:
      `npm --prefix web run gate` exit 0 with the limits in `size-budgets.json`
- [ ] Commit `feat: add the Under the Hood page` and `chore: set the page and model size budgets`

### Task 7 (lead, then the owner): close out

- [ ] Owner review on the built page: narration wording (parent 8) and the device test on the Samsung S26 at
      learn speed (parent 6) -> verify: the owner's answers in Execution Notes
- [ ] ui-review; full gate (both CI jobs' commands); parking-lot triage; sweep at the tier above; PR body;
      the owner's go for push and PR.

## Parking Lot

- Bump ESLint and typescript-eslint once a release with the fixed `minimatch` is at least 14 days old (11
  moderate audit findings, lint tools only, never shipped; seen 2026-11-03).

## Execution Notes & Deviations

- 2026-11-01 measurement (shipped model, live tickets from every fold, seeds 1000-1009 x 2,000): 696 of 7,253
  must-review missed, 686 of them vague; flagged 34%; model category accuracy 99.7%; 4,642 tickets with the same
  text as training. Control: the same harness gave the recorded 153 on held-out fold 1.
- 2026-11-03 measurement (each fold model on its own held-out templates, live seeds 1000-1009 x 2,000, models
  trained locally to scratch): missed 66 / 21 / 35 / 299 of about 7,240 must-review; flagged 88-89%; model
  accuracy 57 / 50 / 62 / 60%; v0 32 / 35 / 30 / 34%; no ticket with the same text as its fold's training.
  Fold files 3,324,892 / 3,339,110 / 3,334,378 / 3,392,789 bytes.
- 2026-11-03 Task 4 (fd90433 -> 25d677f, blobs match; lead break check: pair span end -> first.end, 4 red,
  restored, 11 green): `narrate` always names the simulated reviewer at the review stage; a ticket the viewer
  reviewed (its id in `viewerReviews`) needs "you" instead - Task 6 owns that sentence. Rule words of 3+ tokens
  also match as adjacent tokens; an apostrophe splits a token, as in the scorer.
- 2026-11-03 Tasks 2-3 (8ebf714, 03fb6c0, fix dbf3b68 -> 2182762, 2b5f7fd, 6ee455e; blobs match). First Opus
  checker voided by the canary (miss, closed out); fresh checker ESCALATE: 30 of 33 mutants red, 3 surviving
  (confirm's re-run, confirm's notify, completion's playing flag), a wrong comment, one second proof, and the
  waiting ticket carried the simulated reviewer's answer. Lead ruling: the engine hides `review` and shows the
  model's suggestion as `final` while the viewer reviews (a tested guarantee, not a page rule). FIX round 1
  closed all; lead break check (hide rule off) red on `review` "to be undefined"; full gate 887 tests green.
  Done is a resting stage: the ticket at 'done' is also the last entry of `done` (Tasks 5 and 6 count from
  `done` only). One unreproduced suite flake (19 of 20 files, an unhandled error) in the builder's worktree;
  logged per the crash rule, 3 reruns green.
