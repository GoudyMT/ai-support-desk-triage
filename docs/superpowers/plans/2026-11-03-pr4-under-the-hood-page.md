# PR 4: The Under the Hood Page - Implementation Plan

## Progress
- Current task: 7 (fix round from the Opus check), then 9
- Done (with evidence): design and plan approved 2026-11-03 (447d07d); Task 0 - 0c15366 - owner's yes on the
  lockfile (`@playwright/test` 1.64.1, 3 packages, no audit finding of its own), browsers 1.26 GB, smoke spec red
  on the missing `index.html`, workflow parsed with js-yaml, gate 733 tests green; Task 1 - 2d9d2ec - fold
  test red then green, break check (fold 1's file as fold_0) red on `assert 1 == 0`, each fold SAME on 16,048
  rows, one weight +0.01 DIFFERENT exit 1, pytest 120 passed; Tasks 2-5 merged with lead break checks
  (Execution Notes); Task 6 first build merged UNCHECKED (1733545..a984c9b): lint, typecheck, 948 unit tests,
  build and 42 e2e green on the branch, `sizes` exit 1 on E_NO_LIMIT as designed; the Opus check was stopped
  when the owner asked for the redesign; redesign Task 6 - d6c738e, 5de0485; Task 7 - fc8e5da, c5dea90, Opus check
  FIX (no engine defect, test gaps); Task 8 - f4a856f, lead break check red, 969 unit tests green
- Next: Task 7 fix round, then 9 to the real-data screen for the owner
- Branch: feat/under-the-hood-page (from main @ 524e34d)
- Open questions: none

**Goal:** a visitor presses Play and watches live tickets move through the six stages, with plain narration,
word chips, Take over and live numbers, all scored by a model that never saw the tickets' templates.
**Design:** `docs/superpowers/specs/2026-11-03-pr4-under-the-hood-page-design.md` (approved 2026-11-03); parent
`docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` sections 5.4, 5.5, 6, 10.3 and C1-C3; the locked
wireframe https://claude.ai/artifact/LC8C8ggtnybnGDzrCe1QKY, page "Chosen layout". Builders read the PR 4 design
in full.
**Approach:** a pure run engine in `web/src/run/` holds an incoming line, a center and outgoing lists, and steps
through a timed list of events; the PR 3 `runTicket` stays unchanged. Plain TypeScript panels in `web/src/page/`
render the engine's state, static first, motion after the owner sees it. Fold models are
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
- Pacing (owner, 2026-11-03 and 2026-11-04): tickets 0-2 show each center stage for about 5 s with full narration;
  every other ticket takes about 1 s in the center. Arrivals follow the schedule in seconds (Act 1 every 4 s; Act 2,
  100 tickets over 90 s, more mid-morning). The simulated reviewer closes one ticket every 1.5 s. Pause and an open
  review form stop the clock.
- Accessibility: WCAG 2.2 AA contrast; every control a real `<button>`; 44 px targets; visible focus; reduced
  motion = no sliding; a tag is a word plus a color; polite live region during Act 1 only; no sideways scroll at 375 px.
- A Content-Security-Policy meta tag with `default-src 'self'` (adapter A3).
- Copy names each stage for what it is: the model, a rule, the pre-screener, the simulated reviewer, you. Never "AI"
  for a rule or the reviewer.
- Errors are static codes: `E_MODEL_LOAD`, `E_MODEL_SHAPE` (from `loadModel`), `E_SEED_RANGE`.
- Commits one line, `type: subject`, no AI trailer (project rule).

## Review Focus

1. `?seed=abc`, `?seed=999`, `?seed=1.5`, `?seed=99999999999`: each falls back to a fresh random seed and the
   page says so, never throws -> Task 2 test.
2. Pause pressed mid-stage, then Step: the next event runs, and Play resumes from it -> Task 7 test.
3. Review pressed on the ticket the simulated reviewer closes next: the form holds it; the reviewer takes the next
   open ticket after Confirm or Hand back -> Task 7 test.
4. A top term that is a word pair split by a one-letter word or by a mask token (`"me on"` in "me on
   [PHONE_NUMBER]") -> Task 4 tests.
5. The real speed button with a ticket open and the form closed, and again on the last ticket: every ticket closes,
   Run complete shows, nothing is counted twice -> Task 7 test.

## Execution approach

Agent-team batch, as PRs 2 and 3 (adapter: agent-teams fields 1-11). Sonnet builders build Tasks 6-9 test-first in
their own worktrees, from this branch; the lead runs Tasks 10 and 11. Opus checker on Task 7 (replay, Review and the
event order carry the design's guarantees) and Task 9 (accessibility and the single-fetch rule). Order: 6 and 7 in
parallel (the engine takes the pre-screener as an argument), then 8, then 9. Reason: four units with clear interfaces;
the engine and the page are where a mistake reaches a visitor. Owner stops: the real-data screen in Task 9, budgets,
and Task 11.

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
| `web/src/run/prescreen.ts` | The small model cut from the fold model, and the tag it gives (Task 6) |
| `web/index.html`, `web/vite.config.ts`, `web/src/page/*.ts`, `web/src/page/page.css` | The page (Tasks 8, 9) |
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

### Task 6: Pre-screener

**Files:** Create `web/src/run/prescreen.ts`, `prescreen.test.ts`.
**Interfaces (produces):** `PRESCREEN_WORDS = 3000`; `interface Tag { priority: Priority; critical: boolean }`;
`createPrescreener(model: Model): (maskedText: string) => Tag`. Critical when `matchRules` hits a reason whose
`RULE_PRIORITY` is Urgent, or the small model's priority is Urgent; `priority` is Urgent then, else the small model's
label. The cut keeps the 3,000 words with the largest `max over classes |coef| * idf`, the Urgent class counted double
(measured form: the scratch script in Execution Notes 2026-11-04). A small export from `scorer.ts` is allowed if the
cut needs one, with no change to scoring.
- [ ] Tests: a rule word gives critical with the small model saying otherwise; a Low text gives priority Low, not
      critical; the cut keeps exactly 3,000 words and leaves the source model's scores unchanged; on seeds 3000-3011
      with each fold's own model, at least 70% of truly urgent tickets are critical (a seed set not used to choose the
      cut) -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- prescreen` passes
- [ ] Commit `feat: add the pre-screener cut from the fold model`

### Task 7: The run engine as timed events (Opus checker)

**Files:** Modify `web/src/run/engine.ts`, `engine.test.ts`, `web/src/run/liveNumbers.ts`, `liveNumbers.test.ts`.
**Interfaces (produces):**
- `createRun(opts: { seed; model; schedule; wallClock; prescreen: (maskedText: string) => Tag }): Run`
- `interface Waiting { id: string; maskedText: string; tag?: Tag }`
- `RunState`: `seed, fold, act, playing, simTime`; `incoming: Waiting[]` (next on top); `current?: { trail: TicketTrail;
  stage: 'intake' | 'privacy' | 'classify' | 'guardrails'; tag?: Tag }`; `open: TicketTrail[]` (the hide rule applied:
  no `review`, `final` is the model's suggestion; highest `guard.priority` first, then lowest index); `done: TicketTrail[]`
  (closed, oldest first; `liveNumbers` keeps reading it); `reviewing?: TicketTrail` (hidden the same way);
  `viewerReviews`; `realSpeed?: { tickets: number; ms: number }`
- `Run`: `state(); nextDelayMs(): number | null` (null when paused, reviewing or complete); `advance()` fires the next event when
  playing; `step()` fires it when paused; `play(); pause(); review(id: string); confirm(d); handBack();
  finishNow()` (fires every event at once, measures with `wallClock`, fills `realSpeed`); `truthOf; onChange`
- Removed: `Speed`, `setSpeed`, `setTakeOver`, `takeOver`, `waitingForViewer`.
- Events, in run time ms: `arrive` at `schedule.arrivesAt(i) * 1000`, with ticket 0 at 0; `tag` 400 ms later; center stage
  steps of 5000 ms for tickets 0-2 and 250 ms for the rest; `close` every 1500 ms while `open` is not empty. Ties break
  in a fixed order: `close`, `stage`, `tag`, `arrive`.
- A Critical ticket moves ahead of every waiting ticket that is not Critical and behind earlier Critical ones.
- `runTicket` runs when a ticket enters the center. The run is complete when every ticket is closed.

- [ ] Tests: same seed gives identical `state()` sequences except `ms`; a critical ticket jumps as above; the center takes
      a ticket whose tag has not come yet; open order; one close every 1.5 s, and none while the form is open; Review Focus
      2, 3 and 5; `finishNow` gives the same trails as a paced run of that seed; a flagged ticket's hidden fields stay hidden
      until it closes; a correct viewer review needs category and priority right, route ignored; `receivedAt` equals the
      schedule's time -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- run/` passes
- [ ] Commit `feat: run the engine as timed events with incoming and outgoing lists`

### Task 8: The view model

**Files:** Modify `web/src/page/view.ts`, `view.test.ts`.
**Interfaces (produces):** pure functions over `RunState`: `statsView` (four: Tickets done, Flagged for a person, Pending
review, High-risk missed), `moreNumbersView`, `incomingView` (id, first 60 characters of masked text, tag word), `centerView`
(id, tag, stage name, six-step track, text segments, lines reached, plain sentence, Why this choice rows), `outgoingView`
(open cards with priority word and reason; closed rows with the pill), `controlsView`, `reviewDefaults`, `statusView`.
Tag words: Critical, High, Medium, Low. Keep the Missed pill and the stage gating; the Why this choice rows show only
what the stage has reached (today they show the result at Intake).
- [ ] Tests: each view on a fixed small run; at Intake the rows hold no confidence or flag; a Missed row; the review view
      shows no reviewer answer; the real speed label counts the tickets left -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- view` passes
- [ ] Commit `feat: rebuild the view model for the three columns`

### Task 9: The static page (Opus checker)

**Files:** Modify `web/index.html`, `web/src/page/main.ts`, `page.css`, `controls.ts`, `takeOverForm.ts` (rename `reviewForm.ts`);
Replace `stageRow.ts`, `feed.ts`, `currentTicket.ts`, `numbers.ts` with `stats.ts`, `incoming.ts`, `center.ts`, `outgoing.ts`;
Delete `pacing.ts`, `pacing.test.ts` (`main.ts` imports them until this task, and the engine now holds their values); Rewrite
`web/e2e/page.spec.ts` where behaviour changed, keeping specs whose behaviour survives.
- [ ] Playwright specs, each in all three engines: keyboard-only from Play through a review to Run complete with `?seed=`
      fixed and the real speed button; with `reducedMotion: 'reduce'` no element has a running transition; at 375 px
      `scrollWidth <= clientWidth` and the tabs work; exactly one request under `models/`, and it is `fold_<seed mod 4>.json`;
      a routed 404 shows the error and Retry and no ticket; the review form defaults to the model's picks; collapse shows
      the pending count; no CSP violation in the console -> verify: `npm --prefix web run e2e` red first, for the right reason
- [ ] Build the top stats and the three columns to the locked canvas, tag colors as tokens in light and dark, with the
      CSP meta tag -> verify: unit tests and e2e pass
- [ ] HARD STOP (L-05): the lead shows the owner one real-data screen at 1280 and 375, light and dark, before the rest of
      the states are polished -> verify: the owner's answer in Execution Notes
- [ ] Commit `feat: rebuild the page as three columns`

### Task 10 (lead, after the owner's yes on the static screen): motion

- [ ] Cards slide between places and up the line, timed so a person can follow; nothing moves under reduced motion ->
      verify: e2e reduced-motion spec green; the owner's look on the running page
- [ ] Commit `feat: animate the cards`

### Task 11 (lead, then the owner): close out

- [ ] HARD STOP: the owner sets the two budget limits from the measured build (adapter A12) -> verify:
      `npm --prefix web run gate` exit 0 with the limits in `size-budgets.json`
- [ ] Owner review on the built page: narration wording (parent 8) and the device test on the Samsung S26 at
      learn speed (parent 6) -> verify: the owner's answers in Execution Notes
- [ ] ui-review; full gate (both CI jobs' commands); parking-lot triage; sweep at the tier above; PR body;
      the owner's go for push and PR.

## Parking Lot

- Bump ESLint and typescript-eslint once a release with the fixed `minimatch` is at least 14 days old (11
  moderate audit findings, lint tools only, never shipped; seen 2026-11-03).

## Execution Notes & Deviations

- 2026-11-04 redesign: the owner locked the three-column layout, the small-model pre-screener and one review close a
  second (design section 5). This replaces the first page build's panels and the old Take over and speed switch; the
  old Task 6 and 7 are now Tasks 6-11. Measured: on seeds 1000-1011 the incoming line peaks at 22-28 with 1 s per ticket
  in the center; fresh seeds 2000-2011 as in design section 5. CORRECTED the same day: an open-list peak of 13-21 quoted
  here was for a 0.6 s center, not 1 s. On the real engine, 8 seeds, center / reviewer: 1 s / 1 s gives open peak 1;
  1 s / 1.5 s gives 17-25 (the owner's pick); 1 s / 2 s gives 32-41; 0.6 s / 1 s gives 13-21. The
  cut's measured form: rank words by `max over classes |coef| * idf`, Urgent class doubled, keep 3,000. Plain-score
  rate: 6-11 microseconds per ticket in Node. A cut under 3,000 words flags far too many tickets (100 words: 44%).

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
- 2026-11-03 Task 5 (9232012, 72d685b -> fb5a45f, cf2b24d; blobs match; lead break check: current ticket added
  to the count, 2 red, restored). `overrides` mirrors computeMetrics' category-only rule so panel and report agree.
- 2026-11-03 Task 6 first build (89de640..722d2a5 -> 1733545..a984c9b; blobs match). Measured: page 33,782 bytes
  gzipped; largest model 3,392,790 raw, 1,224,534 gzipped. `size-budgets.json` limits null. Owed to the rework:
  the Review stage says "1 reviewed" while a ticket waits for the viewer (a false count); the builder's
  `npm --prefix web exec -- node <script>` made npm fetch and run a package named `node` (27.0.0-alpha) - never
  use that form (reported to the owner); the Opus check never finished, so nothing in `web/src/page/` beyond
  spans.ts is checked yet. Keep in the rework: the Missed pill, the stage gating in view.ts (every
  field gated by stage), the focus moves and the e2e specs where the behaviour survives.
