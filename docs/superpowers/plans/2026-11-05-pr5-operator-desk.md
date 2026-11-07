# PR 5: The Operator Desk - Implementation Plan

## Progress
- Current task: none; complete
- Done (with evidence): merged as PR #7 at 2e8c18d, CI green on 3dcf338; deploy merged at e02a94c; v1.0.0 published; live site checked in a browser
- Next: none here
- Branch: `feature/operator-desk`, merged
- Open questions: none

**Goal:** a visitor lands on an operator's desk, watches tickets arrive sorted, can step in, try their own ticket, read a
live report, and see how the model compares with its baseline.
**Record:** `docs/brainstorms/2026-11-05-pr5-operator-landing.brainstorm.md` (local only).
**Design:** `docs/superpowers/specs/2026-11-05-pr5-operator-desk-design.md`; locked wireframe
https://claude.ai/artifact/BEoWx61b892xzw1sfT9t2f. Builders read the design in full.
**Approach:** batch mode. One pure view layer per concern in `web/src/desk/`, the same engine and pipeline as the demo,
static first, the owner's look at real data after the first visual unit, motion after that.
**Stack:** adapter A6, A11. No new dependency.

## Global Constraints

- PR 2 to PR 4 Global Constraints hold. No behaviour change in `web/src/pipeline/`, `web/src/model/`, `web/src/privacy/`,
  `web/src/generator/`.
- Under the Hood keeps its behaviour exactly; only its address changes, to `under-the-hood.html`.
- Quick approve cutoff `QUICK_APPROVE_PERCENT = 70`, from `category.confidence`. Below it, no button in the page.
- Open list order stays `compareOpen`. Text enters the page with `textContent` only.
- Budget: the demo stays at 48,500. Never raise a limit in a unit; report the measured number.
- Every layout test reads settled boxes, reduced motion on (L-08). Local scripts run with plain `node` or
  `npm exec --no --` (L-06).

## Review Focus

1. A ticket typed with an email and a card-like number: nothing unmasked on screen, in the DOM or the report.
2. Approve pressed on a card as the reviewer closes it: no double close, no lost ticket.
3. Review opened on a card at the end of the run: run finishes correctly after hand back.
4. Report generated with one closed ticket, then again at the end: numbers match `computeMetrics` both times.
5. A wider system font on Linux: bar buttons wrap, nothing overlaps at 375 and 1280.

## Execution approach

| Phase | Approach | Why, and the source | Time | Cost |
|---|---|---|---|---|
| Deploy PR | Lead directly | One job in one file; under three units (agent-team-build, Choose a mode) | Done, waiting on review | small |
| Build | Batch: main session leads, Sonnet builders in worktrees, Opus checker on U2 and U6, Haiku scanner for wide lists | Nine units points to orchestrated, but its readiness bar and project brief are not in place here, and three PRs ran well in batch. The owner's split: Claude overview, Sonnet builds, Haiku retrieves | Several hours of agent time, over more than one sitting | No measured baseline in this project; ask the meter after U1 and report |
| Review | Feature tier under a Swarm Contract, plus one short re-sweep; the owner clears it while auto-approval is paused | rule:sweep-tiers | About an hour | Reported from the meter |

**Machine use:** browser tests in three engines are the heavy step. Before any run expected over 30 minutes, the owner gets
the measured time and CPU first, with workers capped (L-07). Unit tests run per builder; three-browser runs only at
integration.

## Sweep tier

Launch gate, since version 1.0 is a public major version (rule:milestone-sweep trigger 3); modifier: public text (privacy copy, cited assumptions). A screen change adds the ui-review role.

## Units

| Id | Title | Files | Tests first, and the failure each must show | Done when | Runs | By |
|---|---|---|---|---|---|---|
| U1 | Two pages | `web/vite.config.ts`, `web/index.html` (new desk stub), `web/under-the-hood.html` (moved), `web/scripts/checkSizes.ts`(+test), `web/size-budgets.json`, `web/e2e/**` | Size test: per-page numbers from the manifest, red on the old single sum. E2E: stub at `/`, demo at `/under-the-hood.html` | gate and e2e green; demo number unchanged within its limit; `models/shipped.json` in `dist`, within 3,850,000 | alone, first | builder |
| U2 | Engine options | `web/src/run/engine.ts`, `engineTypes.ts`, `engineParts.ts`, `clock.ts` (+tests) | `closeEveryMs`, `deepTickets: 0`, `createDeskSchedule` (130 tickets, seeded, replayable), `quick` on `viewerReviews`; each red first. Defaults leave every existing engine test green | engine suite green, no demo change | after U1 | builder, Opus check |
| U3 | Desk view layer | `web/src/desk/view.ts` (+test) new | Pure: state to cards (tag, Leaning line, `showApprove` at 69/70), sent rows, panel numbers | suite green | parallel with U2 | builder |
| U4 | Desk at rest and in a run | `web/src/desk/main.ts`, `desk.css`, `web/index.html`, `web/e2e/desk.spec.ts` new | E2E: Start fills lists from seed 1001, Stop holds, Start again draws a new seed, model load failure shows Retry | first real-data screens to the owner; desk size measured | after U2, U3 | builder |
| U5 | Review card, Approve, number fades, card movement | `web/src/desk/review.ts`, `motion.ts`, e2e | Approve closes with `quick: true`; focus returns; fade skipped under reduced motion | suite and e2e green | after owner's look | builder |
| U6 | Try a ticket and privacy copy | `web/src/desk/tryTicket.ts` (+test), `web/src/page/fetchModel.ts`, `desk/copy.ts` | Masked text only; empty and 20,001 chars refused with no model fetch; the model fetched once; failure gives Retry; stub keeps the suggestion | suite and e2e green | parallel with U5 | builder, Opus check |
| U7 | This run panel, assumptions, report | `web/src/desk/report.ts` (+test), `panel.ts`, print styles | Report equals `computeMetrics` on `done`; off until one ticket closed; "so far" mid-run; wrong quick approvals counted; bad input keeps last good value | suite and e2e green; report code loads on demand | after U5 | builder |
| U8 | Model History | `web/history.html` -> `web/model-history.html` new, `web/src/history/history.json`, `view.ts` (+test), `web/scripts/measurePipeline.ts` | Test holds the current row equal to `ml/reports/eval.json` and the recorded start points, red on one changed number; Approve count on seeds 2000 to 2039 | suite and e2e green; CI check added | parallel with U5 | builder |
| U9 | Info icons and phone layout | `web/src/desk/tips.ts`, css, e2e | Opens on hover, focus and tap; Escape closes; no layout shift at 375 and 1280 (settled boxes); one list at a time on the phone with the four-button bar | full e2e green | after U7, U8 | builder |

## Collision list (searched 2026-11-05)

| Unit | Change | Search | Hits and handling |
|---|---|---|---|
| U1 | Demo address | `goto\(` in `web/e2e`; `index.html` in `web/e2e`, `web/scripts`, `web/src`, `.github`, `README.md` | Page opens live in `helpers.ts` `openLearn` plus `page`, `server`, `motion.flight`, `smoke`, `rows`, `load`, `focus`, `copy` specs: one constant for the demo path. `server.spec.ts`, `checkSizes.test.ts` name `index.html`: updated |
| U1 | Size check | `MODEL_FILE`, `pageGzipBytes` | `checkSizes.ts:26,84,90` and its test |
| U2 | Constants | `CLOSE_EVERY_MS`, `DEEP_TICKETS`, `DEEP_STAGE_MS` | `copy.ts` `reviewerNote`, engine tests: defaults keep them |
| U6 | Fetcher | `fetchModel` | `main.ts`, `fetchModel.test.ts`; `fetchShipped` added beside it |

## Settled at plan time

- **Sources:** 2 minutes and $21.53, as cited on the page today (`valueSaved.ts:5-7`, `copy.ts`).
- **Size budgets:** demo 48,201 of 48,500 by `npm --prefix web run sizes`; U1 must keep it. Desk limit: hard stop after U4.
- **Claims checked on the base:** `compareOpen` sorts as asked (`engineParts.ts:47`); the run holds during review
  (`engine.ts:237`); intake limit 20,000 (`intake.ts:7`); masks are email, phone, order, card (`mask.ts:1`).

## Team

| Agent | Role | Model | Job | Runs |
|---|---|---|---|---|
| Lead | main session | Opus | Briefs, judges, integrates, full gate, reports | throughout |
| Builders | `builder`, one per unit | Sonnet | U1 to U9 | as the Units table says |
| Checkers | `checker` | Opus | U2 (the contract other units build on), U6 (visitor text) | after those units |
| Scanner | `scanner` | Haiku | Wide lists for briefs and copy, re-checked by the lead | when a list spans many files |

## Hard-stop questions for the owner

Items 1 and 3 approved with the plan, 2026-11-05.

1. **Privacy copy line.** "Before the model reads a ticket, we hide common forms of email addresses, phone numbers, order numbers and
   card-like numbers. Names and street addresses are not hidden. Nothing you type is saved or sent." Recommendation: use it.
2. **Desk size limit:** after U4, from the measured number plus headroom. Comes to the owner then.
3. **Model limit:** 3,600,000 to 3,850,000 for the shipped model (the owner's Q6 pick). Recommendation: confirmed by approving.

## Integration

- **Order:** U1, U2 and U3, U4, then the owner's look, U5, U6 and U8, U7, U9.
- **Full gate:** adapter field 2, both CI jobs. **Early Linux check:** ask the owner to push after U4 (L-08).
- **Visual check with the owner:** after U4, and at the end.

## Parking Lot

## Execution Notes & Deviations

- 2026-11-05 (owner): one public release. The deploy PR stays open and unmerged until PR 5 is ready; PR 5 merges first, then the Pages source switch and the deploy PR, so the site changes once.
- 2026-11-05 (drift, design 80-83): Approve uses a new `Run.approve`, not `review` then `confirm`; both settle through `settleReview`, so scoring is the same.
- 2026-11-05 (drift, design 24): 272 cards reach the printed 70% cutoff on seeds 2000 to 2039, not 258; 258 was raw `>= 0.7`. Counts use `canQuickApprove`.
- 2026-11-05 (lead): Try a ticket stays inline at rest, as the wireframe shows; during a run the bar button opens it over the desk and the run holds, the same as a review card.
- 2026-11-05 (owner): the report loads with the page, not on demand, and the desk limit is 47,000. Measured: on demand 45,784, with the page 44,702, because the report is about 1,000 bytes and loading it on demand adds about 1,080. Supersedes design section 5 "report loaded on demand" and plan U7 "report code loads on demand".
- 2026-11-06 (owner): the privacy line reads "common forms of"; widening the mask goes with the next model version, since masked text feeds the model and needs re-measuring.
- 2026-11-06 (owner, after the launch review): the screens say a trained model sorts and a simulated reviewer clears, with a line that live runs are harder than the test set; "a person agreed" and "people checked" change to the simulated reviewer, superseding the wireframe's words. The reviewer pauses while the pointer or keyboard is in Needs a person. A sent row gets the brief new-card outline and shows the team it changed from. Model History and Under the Hood open in a new tab during a run; Under the Hood gains a Back to the desk button, superseding "keeps its behaviour exactly". Desk limit 49,000.
- 2026-11-06 (owner): the README is rewritten in this PR with a GIF, how it works and its value on the current model.
- Recorded late: the reviewer pace is 2,500 ms, not the design's 2,000: runs take 273 to 311 s on seeds 2000 to 2039 and the open list peaks at 17 to 31 cards. The demo limit is 50,000, raised with the owner's yes when the page split moved shared code; the design's 48,500 is superseded.
- 2026-11-06 (drift, design): the "N more" line, the four-card cap and one-line Sent rows were not built. The owner hears it at the PR.
