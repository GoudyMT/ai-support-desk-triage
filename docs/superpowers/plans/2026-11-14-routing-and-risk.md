# Routing and Risk Plan

## Progress
- Current task: 3
- Done (with evidence): design approved 2026-11-15 with the plan gap check folded in (design section 13); plan approved 2026-11-15 ("Lets see how far we get!"); Task 0 - fair run plan Progress closed with #14 (150f9e4), `tracking-check.mjs progress` PASS on this plan; Task 1 - `splitFlow.test.ts` 8 tests, 8 red on the stub, green after; 10 breaks (department only, vague as risk, no raise, raise to exactly High, mark lost after triage, floor dropped, pass-through review kept, marked sent to the operator, everything marked) each turned a row red, file restored; lint and typecheck exit 0; Task 2 - `measureSplit.test.ts` 7 tests, red on stubs, green after; 10 breaks each turned a row red (one first stayed green, marked tickets left out of the hard line, and got its row); `split_flow.json` written: every count equals the design 9 table on all 7 sets; `--check` exit 1 on an edited record, exit 0 restored; ci.yml parses
- Next: Task 3 (wireframe for the owner first)
- Branch: `feature/routing-and-risk` (local, not pushed)
- Open questions: none

**Goal:** the operator sees a ticket only when the two models disagree on where it goes or how urgent it is; risky
tickets go straight to their team marked "needs a person"; no safety line worse than today.
**Record:** the owner's words in the design's section 5 (no brainstorm sheet; every lock was taken in the thread
2026-11-14 to 2026-11-15). Goals 1-4 come from the owner's direction of 2026-11-14; Task 5's B1-before-B2 is the
planner's idea.
**Design:** `docs/superpowers/specs/2026-11-14-routing-and-risk-design.md`
**Approach:** A new desk flow puts each ticket on one of three paths (triage, marked, direct) using today's signals,
with the path carried on the trail and read by every consumer. A repo script measures it on seven sets and CI holds
it to today's safety lines. Then a small risk detector (B1, word features) is tried against A's numbers and adopted
only if it passes the written bar.
**Stack:** TypeScript (vitest, Playwright), Python (scikit-learn) for B1, the existing scorer and records.

## Global Constraints
- Hard lines, zero room, every set: risky missed (risky = threatening language, security incident, accessibility
  issue, billing dispute, escalated complaint); High/Urgent out as low, over marked plus direct tickets.
- Unchecked (direct) wrong department and wrong priority: never above today's on any set (A meets it with 0 room).
- Marked tickets to the wrong team first: capped at A's measured numbers (desk 301, fold 1 357; table in design 9).
- A marked ticket's priority is raised to at least High.
- Never change a bar after its numbers are seen; B's bar is design section 9.
- Training, embedding or bulk scoring runs: `ml/triage_v2/share_machine.py`, a load check first, the owner's yes.
- Size limits: desk 64,960; demo 50,500; sentenceBytes 42,467,037 (size band rule; any raise is a measured ask).
- ASCII only; errors throw static codes; tests derive expected model numbers from their records, never typed (L-12).
- The demo page's output and the v1.1 Model History rows stay byte-equal.

## Files first
- Create `web/src/run/splitFlow.ts`: the three-path flow `routeTicket`; one job.
- Modify `web/src/pipeline/types.ts`: `TicketTrail.path?: 'triage' | 'marked' | 'direct'` and `marked?: boolean`.
- Keep `web/src/run/twoModels.ts` unchanged (v1.1 replays and the one-model fallback depend on it).
- Modify `web/src/run/engine.ts`, `web/src/pipeline/metrics.ts`, `web/src/run/valueSaved.ts`, `web/src/desk/view.ts`,
  `web/src/desk/tryTicket.ts`, `web/src/desk/report.ts`, `web/src/run/narrate.ts`, `web/src/desk/deskRun.ts`: read
  the path.
- Create `web/scripts/measureSplit.ts` + test; record `ml/reports/split_flow.json`; npm script `measure-split`.
- Modify `web/src/history/history.json`, `web/src/history/sources.test.ts`: the new row.
- Create `ml/triage_v2/risk_detector.py` + `ml/tests/test_risk_detector.py` (Task 5); record `ml/reports/risk_detector.json`.

## Tasks

### Task 0: records (must)
- [ ] Close the Progress block of `docs/superpowers/plans/2026-11-12-fair-run-and-desk.md` with the merge of #14
      (150f9e4) -> verify: its Progress names no open task
- [ ] Commit the design and this plan `docs: plan routing and risk as separate jobs` -> verify: commit-msg hook passes

### Task 1: the three-path flow (must)
**Files:** Create `web/src/run/splitFlow.ts` | Modify `web/src/pipeline/types.ts` | Test `web/src/run/splitFlow.test.ts`
**Interfaces:** Consumes `runTicket`, `runTicketWith`, `RunDeps` (`web/src/pipeline/run.ts`), `TwoModelDeps`
(`twoModels.ts`). Produces `routeTicket(text: string, id: string, deps: TwoModelDeps): TicketTrail` with `path` set;
`MARK_FLOOR_PRIORITY = 'High'`.
- [ ] Failing tests, one per design 8 criterion: disagreement on department or priority -> `triage` whatever the
      rules; only flag the vague rule -> `triage`; agreed + rule -> `marked`, no operator card; agreed Security Concern
      at Medium -> `marked`, final priority `High`; agreed Urgent stays `Urgent`; agreed, no rule, non-checked
      department, word >= 0.5 -> `direct`; a disagreeing threatening ticket -> `triage` with `marked: true` after
      the reviewer -> verify: red on assertions
- [ ] Implement `routeTicket` -> verify: `npm --prefix web exec --no -- vitest run src/run/splitFlow.test.ts`
- [ ] Commit `feat: route each desk ticket on one of three paths`

### Task 2: the measurement and its CI check (must)
**Files:** Create `web/scripts/measureSplit.ts`, `web/scripts/measureSplit.test.ts`, `ml/reports/split_flow.json` |
Modify `web/package.json`, the CI workflow that runs `measure-routing` checks
**Interfaces:** Consumes `routeTicket`, `parseRows` (reviewReason added), `chosenTable` pattern from
`measureDirectRouting.ts`. Produces `measureSplit(rows, word, sentence): SplitCounts` with the design 7 M2 fields
for both today and A, and `--write` / `--check`.
- [ ] Failing tests: a fixture where an agreed, marked Security Concern at Medium (truth Urgent) is not counted as
      High/Urgent out as low; a marked risky ticket is not counted missed; `--check` fails when a record line differs
      and when A's risky missed exceeds today's in the same run -> verify: red
- [ ] Implement; write the record -> verify: counts equal design 9 table on all seven sets, exactly
- [ ] Add `--check` to CI; parse the changed workflow with a YAML parser (L-02) -> verify: parse ok, local check green
- [ ] Commit `feat: measure the three-path desk and hold it to today's safety lines`

### Task 3: the desk reads the path (must) - starts with an owner stop
- [ ] **Stop:** wireframe of Sent to teams with the mark and the operator queue, in the real screens, real data
      (L-05) -> verify: the owner locks it
- [ ] Failing tests: engine puts only `path === 'triage'` in `open`; metrics count a marked risky ticket as caught;
      `valueSaved` skips marked tickets; Sent to teams shows the mark and never "Reviewer checked" on a marked ticket;
      Try a ticket says the path and why (S1); with `suggest` unset the open list equals v1.1's; the demo page's run
      output is byte-equal to v1.1 -> verify: red
- [ ] Implement in the files listed above; grep `web/e2e` and `web/src` for every changed sentence first (L-09)
      -> verify: `npm --prefix web run gate` exit 0
- [ ] Commit `feat: show risky tickets as marked in Sent to teams`

### Task 4: Model History and page numbers (must)
- [ ] Failing tests: the new row's numbers equal `split_flow.json`; the row order and current-row test changed on
      purpose; the desk page's share sentence reads the record -> verify: red
- [ ] Implement -> verify: gate green
- [ ] Commit `feat: add the routing and risk row to Model History`

### Task 5: the risk detector, B1 (must to try; adopted only if it passes)
**Threshold rule, written now:** per judged set, B1 is trained on that set's model's training side with 20% of it
held back; its threshold is the highest one at which, on the held-back 20%, rules + checked departments + B1 miss no
more risky tickets than rules + checked departments + the 50% floor. No judged ticket is read to pick it.
- [ ] Failing tests: a B1 that marks no vague ticket fails the bar; a detector that throws marks the ticket; the
      fold B1 never sees its fold's held-out ids (leak check) -> verify: red
- [ ] Implement `ml/triage_v2/risk_detector.py` (CPU, through `share_machine.py`); ask the owner before the run with
      its load -> verify: record written
- [ ] Judge once against design 9 B bar on the seven sets -> verify: verdict per line per set by script (L-15)
- [ ] If B1 fails the held-back check: B2 needs the owner's GPU yes; if B1 or B2 passes: a new blind set, owner stop
- [ ] Commit `feat: try a risk detector against the three-path desk` (adopted or recorded as not adopted)

### Task 6: docs (should)
- [ ] README and guide pages describe the two jobs; every number from a record -> verify: gate green

### Task 7: carry-overs and close (must)
- [ ] Parking-lot triage of the handoff's carry-overs (fair run plan Task 18 rows, PR 4 H6b H9 H10 H11 H12, PR 5
      T2-4 T2-6 T2-7 T2-8, DEFERRED rows in the two sweep reports): each in or cut, listed here
- [ ] Full gate, then the feature-tier sweep; findings through the pipeline -> verify: report exists
- [ ] Owner stops: push (pop-up yes, L-17), PR, merge, release

## Review Focus
- A ticket typed in Try a ticket before the sentence model loads: the one-model flow, said plainly (Task 3 test).
- A run stopped mid-way: marked tickets already sent stay in Sent to teams with their mark (Task 3 test).
- A truly Low ticket falsely marked shows as High: counted in marked wrong priority, not hidden (Task 2 test).
- A risky ticket whose models disagree: it must leave triage marked (Task 1 test).

## Execution approach
Inline by the lead, all tasks: the owner asked for low spend; Tasks 1-4 share the trail type and engine, so builders
would wait on each other. Expected: Tasks 0-4 one to two sessions; Task 5 one session plus one short CPU run.

## Sweep tier
Feature (new data flow, desk behaviour, a model trial).

## Parking Lot

## Execution Notes & Deviations
