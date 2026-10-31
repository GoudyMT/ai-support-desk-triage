# PR 3: The Pipeline - Implementation Plan

## Progress
- Current task: 1
- Done (with evidence): design approved by the owner 2026-10-31 (second check = rule A); Task 0 cap 20,000
  chars (Execution Notes)
- Next: Tasks 1 and 2 in parallel, on the owner's yes to this plan
- Branch: feat/v1-pipeline (from main @ c0a2b7c)
- Open questions: none until Task 6 (floor and flag-rate target, the owner's)

**Goal:** every ticket passes through the six stages with a record per stage, no high-risk ticket is missed on
any held-out fold or the hand-written set, and the run's numbers are computed from real outcomes.
**Design:** `docs/superpowers/specs/2026-10-31-pr3-pipeline-design.md` (approved 2026-10-31); parent
`docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` sections 5.1, 5.4, 5.6, 6, 9, 10.2. Builders read
the PR 3 design in full; Task 2's builder reads only parent section 9 C1 and the PR 3 design.
**Approach:** pure stage functions in `web/src/pipeline/`, one `runTicket` that calls them in order and returns
the trail, metrics as pure functions over trails, and the reviewer passed in. A measurement script runs the
real pipeline per fold with fold models; CI repeats it as a gate.
**Stack:** TypeScript 5.9.3, Vitest 5.0.5, Node 22.22.3, tsx; Python 3.12 venv `ml/.venv` (adapter A6, A9).

## Global Constraints

- PR 2's Global Constraints hold unchanged (`docs/superpowers/plans/2026-10-30-pr2-model-and-scorer.md`).
- Errors are static codes: `E_EMPTY_TICKET`, `E_TICKET_TOO_LONG`; no input text in any error or log.
- After the privacy stage, no record, rule hit, reviewer input or trail field holds raw text. Only v0 reads the
  raw text (parent C2), inside `runTicket`, and only its answer is stored.
- Must-review categories: Security Concern, Accessibility Support, Urgent Complaint. The floor tests the
  category head's confidence only. Rules never change the model's category and never lower a priority.
- Rule priorities: security incident Urgent, threatening language Urgent, accessibility issue High, escalated
  complaint High, billing dispute Medium, vague ticket Medium.
- Reviewer error rate `0.05`; on an error the category is a different one (seeded), the priority stays true.
- Every random choice takes a seed; the same seed gives the same run.

## Review Focus

1. A rule word inside a mask token or a longer word: `[CARD_NUMBER]` must not fire a billing rule, "charger"
   must not match "charge", "hackathon" must not match "hack" -> Task 2 tests (word boundaries on masked text).
2. A priority the model set higher than the rule's: model Urgent, rule billing dispute (Medium) -> final Urgent
   -> Task 3 test.
3. A ticket exactly at the intake cap and one character over -> Task 1 tests; the cap's masking time -> Task 0.
4. A low-confidence flag that also has a rule reason must never be cleared by the second check -> Task 3 test.
5. Two rules on one ticket (a threat inside a billing dispute): both reasons recorded, the higher priority
   wins -> Task 3 test.

## Execution approach

Agent-team batch, as PR 2 (adapter: agent-teams fields 1-11): the lead runs Tasks 0, 6 and 8; Sonnet builders
build Tasks 1-5 and 7 test-first in their own worktrees; Opus checkers on Task 2 (rules), Task 3 (guardrails
and second check) and Task 5 (privacy wiring through `runTicket`). Tasks 1 and 2 run in parallel; 3 needs 2;
4 is independent; 5 needs 1, 3 and 4; 7 needs 6. Reason: seven units with clear interfaces, and the riskiest
(rules, guardrails, privacy) get an independent check. Expected: one working session plus the owner stop at
Task 6.

## Sweep tier

Feature tier with the security modifier (personal-data handling in the privacy wiring; parent section 7:
"Opus checker + security sweep"). Swarm Contract through `approve.mjs` first (L-01). Every changed workflow
file parsed with a YAML parser before the push (L-02).

## Files

| File | Job |
|---|---|
| `web/src/pipeline/types.ts` | Stage records, flag reasons, the trail, the reviewer interface |
| `web/src/pipeline/intake.ts` | Intake stage and `MAX_TICKET_CHARS` |
| `web/src/pipeline/rules.ts` | The frozen keyword rules and their priorities |
| `web/src/pipeline/guard.ts` | Guardrails, the floor, the second check |
| `web/src/pipeline/reviewer.ts` | The simulated reviewer |
| `web/src/pipeline/run.ts` | `runTicket`, `runTickets` |
| `web/src/pipeline/metrics.ts` | The run's numbers |
| `web/scripts/measurePipeline.ts` | Per-fold measurement and the CI check |
| `ml/triage/export_model.py` | Add `--folds-out` (fold models as JSON) |
| `.github/workflows/ci.yml` | Fold export and the pipeline check in the model job |
| Tests beside each file (`*.test.ts`, `ml/tests/`) | |

---

### Task 0 (lead): masker speed and the intake cap

- [ ] Time `maskText` on fake-data tickets padded to 2,000 / 5,000 / 10,000 / 20,000 characters, median of 20
      runs each, on the owner's PC -> verify: a table in this plan's Execution Notes.
- [ ] Set `MAX_TICKET_CHARS` = the largest size measured under 5 ms; record it in the design's section 12.

### Task 1: Types and intake

**Files:** Create `web/src/pipeline/types.ts`, `intake.ts`, `intake.test.ts`.
**Interfaces (produces):**
- `type FlagReason = { kind: 'rule'; reason: ReviewReason; words: string[] } | { kind: 'category';
  category: Category } | { kind: 'low confidence'; confidence: number }`
- `interface IntakeRecord { id: string; receivedAt: number; text: string }`
- `interface GuardResult { flagged: boolean; reasons: FlagReason[]; priority: Priority; clearedBySecondCheck:
  boolean }`
- `interface ReviewInput { id: string; maskedText: string; suggestion: { category: Category; priority:
  Priority }; reasons: FlagReason[] }`
- `interface ReviewDecision { category: Category; priority: Priority; route: string; reason?: string }`
- `interface Reviewer { decide(input: ReviewInput): ReviewDecision }`
- `interface TicketTrail { id: string; receivedAt: number; maskedText: string; found: MaskKind[];
  category: Prediction; priority: Prediction; guard: GuardResult; review?: ReviewDecision; final: { category:
  Category; priority: Priority; route: string; by: 'model' | 'reviewer' }; v0: V0Result; ms: number }`
- `MAX_TICKET_CHARS` (from Task 0); `intake(text: string, id: string, now: number): IntakeRecord`

- [ ] Tests: `''`, `'   \n'` throw `E_EMPTY_TICKET`; `MAX_TICKET_CHARS + 1` characters throws
      `E_TICKET_TOO_LONG`; exactly `MAX_TICKET_CHARS` passes; the record keeps id and time -> verify: red on an
      assertion
- [ ] Implement -> verify: `npm --prefix web test -- intake` passes
- [ ] Commit `feat: add the pipeline record types and the intake stage`

### Task 2: Keyword rules (fresh builder, isolation brief; Opus checker)

**Brief limits:** the builder reads only parent C1, the PR 3 design and `web/src/domain/labels.ts`; it must not
open `web/src/generator/`, `ml/data/`, `ml/tests/` or any `.jsonl`. It writes the word lists from the plain
meaning of each review reason. The checker confirms the commit touched only the files below.
**Files:** Create `web/src/pipeline/rules.ts`, `rules.test.ts`.
**Interfaces (produces):** `REVIEW_RULES: Record<ReviewReason, readonly string[]>`; `RULE_PRIORITY:
Record<ReviewReason, Priority>` (values in Global Constraints); `matchRules(maskedText: string): { reason:
ReviewReason; words: string[] }[]` (case-insensitive, whole words or phrases, every reason that fires).

- [ ] Tests: one plain sentence per reason fires that reason only; Review Focus 1 cases do not fire; two
      reasons in one text return both -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- rules` passes
- [ ] Commit `feat: add the keyword review rules written from the review list` (this commit is the freeze;
      any later change to `REVIEW_RULES` is a recorded owner decision with before / after hand-written numbers)

### Task 3: Guardrails and the second check (Opus checker)

**Files:** Create `web/src/pipeline/guard.ts`, `guard.test.ts`.
**Interfaces:** consumes `matchRules`, `RULE_PRIORITY`, `Prediction`; produces `MUST_REVIEW_CATEGORIES`;
`guard(category: Prediction, modelPriority: Priority, maskedText: string, floor: number): GuardResult`;
`secondCheck(result: GuardResult, category: Prediction): GuardResult` (clears only when the only reason is
`low confidence` and the top two classes of `category.probabilities` are both outside
`MUST_REVIEW_CATEGORIES`; sets `clearedBySecondCheck`).

- [ ] Tests: each reason kind flags; confident, non-sensitive, no rule -> not flagged; Review Focus 2, 4, 5;
      priority never below the model's or any fired rule's -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web test -- guard` passes
- [ ] Commit `feat: add the guardrails stage with the confidence floor and second check`

### Task 4: Simulated reviewer

**Files:** Create `web/src/pipeline/reviewer.ts`, `reviewer.test.ts`.
**Interfaces:** `REVIEWER_ERROR_RATE = 0.05`; `createSimulatedReviewer(seed: number, truthOf: (id: string) =>
TicketLabel, errorRate?: number): Reviewer` (uses `createRng`; the route from `ROUTES`; `reason` in plain words
whenever its category differs from the suggestion).

- [ ] Tests: same seed, same decisions; error rate within 1 point of 0.05 over 10,000 decisions; an error never
      returns the true category and keeps the true priority; a disagreement always has a reason -> verify: red
- [ ] Implement -> verify: `npm --prefix web test -- reviewer` passes
- [ ] Commit `feat: add the simulated reviewer with a stated error rate`

### Task 5: runTicket and the run's numbers (Opus checker on privacy)

**Files:** Create `web/src/pipeline/run.ts`, `run.test.ts`, `metrics.ts`, `metrics.test.ts`.
**Interfaces:** `runTicket(text: string, id: string, deps: RunDeps): TicketTrail`; `interface RunDeps { model:
Model; reviewer: Reviewer; floor: number; secondCheckOn: boolean; now: () => number }`; `runTickets(tickets: {
id: string; text: string }[], deps: RunDeps): TicketTrail[]`; `computeMetrics(trails: TicketTrail[], truthOf:
(id: string) => TicketLabel): RunMetrics` with: `categoryAccuracy` and `priorityAccuracy` each `{ model, system
}`; `highRiskMissed`; `flagRate`; `flagsByReason`; `overrideRate`; `v0` `{ category, priority, flag }`;
`handledWithoutReview`; `msPerTicket`; `instructiveMisses` (up to 5 trails where the model's category was
wrong, with its top words).

- [ ] Tests: a ticket with each fake-data kind leaves no raw value in any trail field (JSON of the trail
      searched); unflagged -> `final.by === 'model'`; flagged -> reviewer called with masked text only; every
      metric equals a hand count on a fixed 12-ticket fixture -> verify: red on an assertion
- [ ] Implement -> verify: `npm --prefix web run gate` exit 0
- [ ] Commit `feat: run each ticket through the six stages and compute the run's numbers`

### Task 6 (lead, then the owner): measurement, floor and flag-rate target

- [ ] Add `--folds-out DIR` to `export_model.py` (writes `fold_k.json` from `fit_fold_models`, same JSON shape
      as `model.json`) with a pytest that the files load and match the fold count -> verify: `pytest ml/tests`
- [ ] Write `web/scripts/measurePipeline.ts`: for floors 0.0 to 0.9 by 0.1, second check off and on, prints
      flag rate and high-risk missed per fold (fold model) and on the hand-written set (`model.json`);
      `--check <floor>` exits 1 on any miss -> verify: a run on this PC, table pasted in Execution Notes
- [ ] HARD STOP: the owner sets the floor and the flag-rate target from the table; the second check is kept
      only if it lowers the flag rate with zero added misses on the hand-written set. If no floor up to 0.9
      gives zero misses, stop and bring the misses (design section 10).
- [ ] Set `CONFIDENCE_FLOOR` and `SECOND_CHECK_ON` in `run.ts` defaults; add the target to parent section 6
      and its revision history -> verify: `--check` exit 0
- [ ] Commit `feat: set the confidence floor from the per-fold measurement`

### Task 7: CI gate for zero misses

**Files:** Modify `.github/workflows/ci.yml` (model job).
- [ ] After the existing export step: `python -m triage.export_model --model-out "$RUNNER_TEMP/model.json"
      --folds-out "$RUNNER_TEMP/folds"`, then `npx tsx scripts/measurePipeline.ts --check <floor> --folds
      "$RUNNER_TEMP/folds"` in `web` -> verify: the workflow parses with a YAML parser (L-02) and the full
      model job's commands pass locally
- [ ] Commit `ci: fail the model job on any high-risk ticket missed`

### Task 8 (lead): close out

- [ ] Full gate (both CI jobs' commands) green; parking-lot triage; sweep at the tier above; PR body; the
      owner's go for push and PR.

## Parking Lot

## Execution Notes & Deviations

- 2026-10-31 Task 0: `maskText` on fake-data tickets padded to size, median (max) of 20 runs after warm-up,
  owner's PC, Node 20.11.0 (the shell's default, not fnm's 22.22.3; the margin below makes the difference moot):
  2,000 chars 0.05 ms (0.06); 5,000 0.14 (0.19); 10,000 0.26 (0.27); 20,000 0.50 (0.53). Every size is far
  under the 5 ms bar, so `MAX_TICKET_CHARS = 20000`, the largest size measured.
