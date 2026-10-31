# PR 3: The Pipeline - Implementation Plan

## Progress
- Current task: 8 (close out)
- Done (with evidence): Tasks 0-7 (commits 66cc63f..cd7c2a5; start point and gate in Execution Notes); sweep
  run, 34 findings, 28 real, fixes 9040112..cd7c2a5 (`.kit/sweeps/2026-10-31-pr3-pipeline.md`)
- Next: sweep report dispositions, full gate, fix check, short re-sweep, PR body; push and PR on the owner's go
- Branch: feat/v1-pipeline (from main @ c0a2b7c)
- Open questions: none

**Goal:** every ticket passes through the six stages with a record per stage, no high-risk ticket is missed on
any held-out fold or the hand-written set, and the run's numbers are computed from real outcomes.
> SUPERSEDED (2026-10-31): zero missed on the hand-written sets, each fold held at its start point - see
> Execution Notes and design section 5.
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
      > SUPERSEDED (2026-10-31): `--check` takes no floor (it uses `CONFIDENCE_FLOOR`) and fails a set that
      > breaks its start point - see Execution Notes.
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
> SUPERSEDED (2026-10-31): the commit hook refuses the `ci:` type, so it landed as `chore:` (b796a68); the step
> runs `npm exec --no -- tsx scripts/measurePipeline.ts --folds "$RUNNER_TEMP/folds" --check` (eb4ceb7).

### Task 8 (lead): close out

- [ ] Full gate (both CI jobs' commands) green; parking-lot triage; sweep at the tier above; PR body; the
      owner's go for push and PR.

## Parking Lot

- PR 4: a rule's reported `words` are list entries, not always text in the ticket (a slipped spelling reports the
  list word; the short-ticket signal reports a label). Chip highlighting must find the written word, not the entry.
- PR 5: the privacy copy names exactly what is masked (emails, phones, order and card numbers); names, addresses
  and passwords are not masked (parent 5.1 scope).

## Execution Notes & Deviations

- 2026-10-31 Task 0: `maskText` on fake-data tickets padded to size, median (max) of 20 runs after warm-up,
  owner's PC, Node 20.11.0 (the shell's default, not fnm's 22.22.3; the margin below makes the difference moot):
  2,000 chars 0.05 ms (0.06); 5,000 0.14 (0.19); 10,000 0.26 (0.27); 20,000 0.50 (0.53). Every size is far
  under the 5 ms bar, so `MAX_TICKET_CHARS = 20000`, the largest size measured.
- 2026-10-31 Task 6 measurement (`measurePipeline.ts`, fold models from `export_model --folds-out`, rules frozen
  at 9a33526, 18.9 s). Flagged % / high-risk missed, second check off:
  floor 0.0: folds 48.9/274, 61.4/220, 46.6/156, 54.0/200; hand-written 45.8/2.
  floor 0.5: 89.6/20, 88.5/7, 87.9/10, 89.3/46; hand-written 64.6/1.
  floor 0.6: 93.0/1, 94.6/2, 92.8/2, 94.5/1; hand-written 79.2/1.
  floor 0.7: 95.6/1, 98.0/0, 95.9/2, 98.2/1; hand-written 87.5/0.
  floor 0.9: 99.6/0, 99.9/0, 100.0/0, 100.0/0; hand-written 95.8/0 (the only floor with zero everywhere).
  Second check on, floor 0.7: 77.0/85, 74.3/78, 69.9/53, 76.8/45; hand-written 64.6/0. It adds no miss on
  the hand-written set (the locked keep rule) but adds 45-85 per fold.
  Misses by reason at floor 0 (folds): vague 443 of 944; escalated complaint 123 of 864; accessibility 145 of
  736; security 111 of 1,632; threatening 22 of 644; billing dispute 6 of 68 (typos only). At floor 0.6 the 6
  fold misses are two-issue and typo tickets; hand-written H-32 (a billing dispute with typos) is missed up
  to floor 0.6.
  Design section 10 stop condition met (no floor under 0.9 reaches zero): HARD STOP, brought to the owner.
- 2026-10-31 owner ruling (option A): one recorded rule revision by a fresh isolated builder, told only the
  aggregate shortfall by reason and hard-case kind (never ticket texts), before / after numbers logged here,
  then re-measure; a narrower second pass only if the new numbers call for it. The second check is dropped
  (adds 45-85 misses per fold): `secondCheckOn` stays false; its code stays, off.
- 2026-10-31 rule revision 2c09c64 (picked as 2106ea7; isolated builder, about 560 entries added, a one-slip
  spelling rule for words of 6+ letters, a short-vague-ticket signal). After, flagged % / missed:
  floor 0.0: 54.4/103, 64.3/133, 46.7/154, 54.1/196; hand-written 47.9/1.
  floor 0.3: 72.4/85, 73.0/99, 67.0/106, 72.0/112; hand-written 52.1/0.
  floor 0.5: 89.9/9, 88.5/6, 87.9/10, 89.3/46; hand-written 66.7/0.
  floor 0.6: 93.0/0, 94.7/1, 92.9/2, 94.5/1; hand-written 81.3/0.
  floor 0.8: 97.3/0, 99.8/0, 99.6/0, 99.5/0; hand-written 91.7/0.
  Left at floor 0 (folds): vague 292 of 944, accessibility 137 of 736, escalated complaint 96 of 864, polite
  security 41 of 576. Brought to the owner: change the bar (zero on hand-written, stated fold miss rate) and
  pick floor 0.5 (recommended) or 0.3.
- 2026-10-31 unrecorded change after the freeze, found by the sweep: 9a33526 changed `REVIEW_RULES` after the
  freeze commit 7bb3eb1 (bare 'contrast', 'manager', 'cancelling', 'canceling', 'switching to' replaced by
  phrases; 'charged twice', 'double charged', 'paid twice' added) with no before / after numbers. The first
  measurement above already ran on it ("rules frozen at 9a33526"), so every recorded number includes it.
- 2026-10-31 owner ruling: floor 0.5, the first measured result is the start point, and the bar is zero missed
  on the hand-written set with no fold getting worse (328704d, b796a68).
- 2026-10-31 owner ruling after the sweep (yes to all four): narrow the rule false flags; a fresh hand-written
  set written blind; hold each set's flag rate and must-review count too; the second check stays off.
- 2026-10-31 rule revision 2 (0dbbbe2..d293319): word lists moved to `ruleWords.ts`; everyday sign-in and
  settings words narrowed; a slipped spelling after a comma or colon read; the slip rules indexed (about 6 ms
  at 20,000 chars); "charge" and "lawsuit" read only as a dispute or a threat.
- 2026-10-31 fresh hand-written set (52f16e3): 60 tickets, 24 must-review, written by an isolated builder blind
  to the rules, the model, the generator and the first set; reviewed and frozen by the owner before any
  measurement on it. The first set is reported as "seen" from here on.
- 2026-10-31 start point (cd7c2a5), floor 0.5, second check off, `--check` exit 0:

  | Set | Tickets | Must-review | Flagged | Missed |
  |---|---|---|---|---|
  | fold 0 | 4,000 | 1,461 | 89.7% | 10 |
  | fold 1 | 4,000 | 1,461 | 88.4% | 6 |
  | fold 2 | 4,000 | 1,461 | 87.7% | 10 |
  | fold 3 | 4,000 | 1,473 | 89.3% | 46 |
  | hand-written (seen) | 48 | 22 | 66.7% | 0 |
  | hand-written (fresh) | 60 | 24 | 78.3% | 0 |

  Fold 0 went from 9 to 10 missed with the narrowing (fewer false flags, one more miss); the owner's ruling
  holds each set at this point, not at the earlier run. The second check at 0.5 adds 2 / 35 / 49 / 44 misses
  per fold and 1 on the fresh set, so it stays off.
