# PR 4: The Under the Hood Page - Design

Parent design: `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` (sections 5.1, 5.4, 5.5, 6, 7, 8,
10.3). PR 3 design: `docs/superpowers/specs/2026-10-31-pr3-pipeline-design.md`. This doc adds only what PR 4
needs on top of them; it does not restate them.

**Status:** approved by the owner 2026-11-03.

Locked wireframe: https://claude.ai/artifact/BzA8iShtJu6v2ULGKA4w1K (three screens: running at learn speed,
paused with Explain open, Take over on a flagged ticket).

## 1. Intent and why

PRs 1-3 built everything the demo computes and nothing a visitor can see. PR 4 builds the page that runs a live
ticket stream through the six stages (parent 5.5, layout D) and shows each decision and the run's numbers as
they happen.

Evidence that shapes it (measured 2026-11-01 and 2026-11-03, scripts in the plan's Execution Notes):

| Live stream, 20,000 tickets per row, floor 0.5 | Must-review missed | Flagged | Model category accuracy | Same text as training |
|---|---|---|---|---|
| Shipped model, all templates (what parent 5.2 planned) | 696 of 7,253 (9.6%) | 34% | 99.7% | 23% |
| Fold 0 model, fold 0 held-out templates | 66 of 7,240 (0.9%) | 89% | 57% | 0% |
| Fold 1 model, fold 1 held-out templates | 21 of 7,240 (0.3%) | 88% | 50% | 0% |
| Fold 2 model, fold 2 held-out templates | 35 of 7,240 (0.5%) | 88% | 62% | 0% |
| Fold 3 model, fold 3 held-out templates | 299 of 7,310 (4.1%) | 89% | 60% | 0% |

The shipped model trained on every template, so on the live stream its accuracy is memory, and its confidence
lets 686 vague tickets through unflagged. A model scored on templates it never saw gives the same honest
numbers CI already holds (parent section 6 start point).

## 2. Goals

1. A first-time visitor at learn speed can say, for the current ticket, which stage it is in and why it was or
   was not sent to a person (the narration and the stage trail carry this).
2. Every number on the page is computed from the run's own trails, on tickets the scoring model never saw.
3. Play / Pause, Step, the speed switch, Explain and Take over all work by keyboard alone, and reduced motion
   is respected.
4. A run replays exactly from its seed.

## 3. Non-goals and anti-goals

- **Non-goals:** the landing page, Try it yourself, the end report and the value assumptions panel (PR 5);
  the deploy (PR 6); retraining or tuning any model; the manual-versus-assisted queue view and the capacity
  test (moved to PR 5, section 12).
- **Anti-goals:** a number from a model that saw the ticket's templates; narration that calls a rule or the
  simulated reviewer "AI" (parent anti-goal); motion that ignores reduced motion; any network request other
  than the page's own files; a hidden miss (every miss shows in the feed and the count).

## 4. Constraints

- Tier 0 (adapter A2-A4): fictional data only; nothing typed leaves the page; the only fetches are the page's
  own static files, same origin.
- Stack (adapter A6): TypeScript and Vite as pinned; no new runtime dependency (section 12).
- Size budgets start here (adapter A12): the built page's code and styles gzipped, and the model file. Limits
  are set from the first real build's measurement with the owner and live in `web/size-budgets.json`, checked
  in the full gate.
- Accessibility and devices: parent section 3 and section 6; check set adapter A21 (375 / 768 / 1280, light and
  dark, forced colors); owner device test on the Samsung S26 (adapter A20).

## 5. What the owner decided

- 2026-11-01: option A - the live stream is scored by a model that never saw its templates: a fold model on
  that fold's held-out templates (measurement in section 1).
- 2026-11-01: the wireframe above is locked as drawn, with "High-risk tickets missed so far" added to the live
  numbers.
- 2026-11-03: the fold rotates by seed (fold = seed mod 4) across all four fold models; each run loads only its
  own fold's file. One fixed fold was rejected: any single pick looks chosen for its numbers.
- 2026-11-03: browser tests use `@playwright/test` in Chromium, Firefox and WebKit (a dev dependency; the page
  gains no runtime dependency).

## 6. The approach

A **run engine** (pure TypeScript, tested in Node) owns the run: it picks the fold from the seed, generates
ticket i with `generateTicket(seed, i, { fold, side: 'heldout' })`, passes it through the PR 3 `runTicket`
unchanged, and emits one event per stage so the page can light the stage row in order. A **clock** drives it:
learn speed steps one stage at a time on a fixed interval; real speed releases tickets on a simulated business
day. The **page** is plain TypeScript modules, one per panel, that render the engine's state; it holds no
pipeline logic.

**Take over** keeps the pipeline untouched (PR 3 section 6 seam): the engine runs the ticket with the simulated
reviewer to learn the trail up to the guardrails; when the ticket is flagged and the viewer has taken over, it
waits, then runs the ticket again with a reviewer that returns the viewer's choice. Both passes are
deterministic, so the trail shown is the trail scored.

**Fold models** are committed under `web/public/models/fold_<k>.json`, one per fold, and the CI model job
checks each against its fresh retrain the way it checks `model.json` today. The page fetches only the file its
run needs.

Rejected, one line each: the shipped model (its live numbers are memory, section 1); a UI framework (no view
here needs one, and it costs a dependency and bytes against a budget set this PR); a web worker (the pipeline
takes at most 27 ms per ticket on the owner's PC, PR 3 Execution Notes; revisit for the capacity test).

## 7. Requirements

**Must**
1. **Fold models:** the four fold models are committed and CI fails if any differs from its retrain beyond the
   existing tolerance; `measurePipeline --check` keeps running on the CI retrain.
2. **Run engine:** a random seed of 1000 or more (parent 5.2's live range), shown on the page; a `?seed=` in the
   address replays that run; the fold is the seed mod 4 (section 5); Act 1 at learn speed, about
   30 tickets in about 2 minutes, then Act 2 at real speed, one simulated business day in about 90 seconds with
   more arrivals mid-morning (parent 10.3); the run ends with a "Run complete" state that keeps the final numbers.
3. **Controls:** Play / Pause, Step (one stage at a time, paused), the speed switch (the viewer may skip to real
   speed), Explain, Take over; each a real button with a visible focus ring and a 44 px target.
4. **Layout D** as locked: the stage row with a live count per stage and the current stage lit; the feed, latest
   first, with an Auto / Flagged / Overridden pill; the current ticket with its masked text, word chips, rule
   word and stage trail; the live numbers.
5. **Live numbers:** tickets done, tickets per second (measured at real speed), the model's category accuracy
   so far beside v0's category accuracy on the same tickets (the parent C2 comparison), share flagged, reviewer
   overrides as a count, and high-risk tickets missed so far (must-review tickets that reached Done without
   review). All from `computeMetrics` over the trails done so far.
6. **Word chips:** each top term is highlighted where it is written in the masked text, found with the model's
   own tokenizer (a word pair is two adjacent tokens, so "so cannot" spans "so I cannot"); a rule word is found
   the same way (PR 3 Parking Lot); a term with no written span appears only in the technical detail.
7. **Narration:** at learn speed and on Pause or Explain, one or two plain sentences for the current stage,
   built from the trail; "Show technical detail" lists confidence, the floor, each reason that fired, the top
   words and what was masked. Rules, the model and the simulated reviewer are named for what they are.
8. **Take over:** available at both speeds; the run and its clock stop on each flagged ticket (parent 10.3);
   the viewer picks category, priority and team (defaults: the model's picks; the team follows the category
   until the viewer changes it); Confirm continues; "Hand back to the reviewer" returns to the simulated
   reviewer. A review counts as correct when category and priority both match the truth; the team is shown
   but not scored (parent C3).
9. **Loading and failure:** a loading state while the fold model loads; if it fails to load or parse, a plain
   error with a Retry button, and no run starts.
10. **Accessibility:** keyboard-only from Play to Run complete; reduced motion = no sliding, stages change by
    color and text only; a polite live region announces each stage at learn speed only (real speed would flood
    it); contrast WCAG 2.2 AA; works at 375, 768 and 1280 px.
11. **Size budgets:** `web/size-budgets.json` with the two A12 budgets; `npm run gate` gains a production
    build and the size check after its tests (today it has no build step); limits set with the owner from the
    first real build.
12. **Time:** the trail's `receivedAt` is simulated-clock time and `ms` is measured wall time; the page's
    "tickets per second" reads `ms`. Replay equality covers every field except `ms`.

**Should**
- Shared vocabulary in the model file (parked item), only if the first build shows the model budget needs it.

**Later (seams only)**
- The end report and its link from "Run complete", the assumptions panel and the time-saved number, the
  manual-versus-assisted queues and the capacity test (PR 5); Try it yourself on the shipped model (PR 5). The
  engine exposes the arrivals and per-ticket times so PR 5 adds the queues without changing it.

## 8. Acceptance criteria

- Given seed S, two runs produce the same tickets, folds, trails (every field but `ms`) and numbers (all but
  tickets per second), step for step.
- Given seed S, every ticket comes from fold `S mod 4`'s held-out templates and is scored by that fold's model;
  no other model file is fetched.
- Given a committed fold model that differs from its retrain, the CI model job fails.
- Given a flagged ticket in Take over, the run does not advance until Confirm or Hand back; the viewer's pick is
  the trail's final answer and is scored against the truth.
- Given a must-review ticket that reaches Done unflagged, "High-risk tickets missed so far" goes up by one and
  the feed shows it; a flagged ticket still in Review does not count.
- Given each live number, it equals a hand count on a fixed small fixture run.
- Given the top term "so cannot" and the text "so I cannot follow", the chip spans "so I cannot"; given a rule
  word that is a list entry not written in the text, no span is highlighted and the detail still lists it.
- Given `prefers-reduced-motion: reduce`, no element moves position during a run.
- Given keyboard only, a person can start, pause, step, explain, take over, confirm and finish a run.
- Given a fold model that fails to load, the page shows the error and Retry, and no ticket is generated.
- Given a viewport of 375 px, no content is cut off and the page does not scroll sideways.

## 9. Success criteria

Parent section 6, unchanged. PR 4 owns: the keyboard-only run and reduced motion; "the demo completes on a
mid-range phone at learn speed without dropped frames being noticeable" (owner device test); and "every number
on screen traces to a measurement" for the numbers it shows.

## 10. Risks and open questions

- **Blocking, the owner (at the first build):** the two size-budget limits.
- **Non-blocking, a probe:** a fold model is 3.32-3.39 MB of JSON (measured 2026-11-03); load time on the phone is measured at the
  first build, and the shared vocabulary is the first lever if it is too slow.
- **Non-blocking, the owner:** narration wording (parent 8) is reviewed on the built page.
- **Non-blocking:** fold 3 shows about 2 misses per run (section 1); that is the honest number, not a defect of
  this PR; it is already the start point PR 3 recorded.

## 11. Left to the builder

Module layout under `web/src/page/` and `web/src/run/`; CSS structure and tokens within the craft floor;
animation timing inside the reduced-motion rule; the exact stage interval at learn speed within "about 30
tickets in about 2 minutes".

## 12. Your calls (Claude, for the owner to check)

- **Fold models committed** (reverses the PR 3 call "fold models in CI, not committed"): the page needs them at
  run time, and a committed file must be proven equal to its retrain, as `model.json` already is.
- **Live stream from one fold's held-out templates** (supersedes parent 5.2's "live tickets use every fold"
  and the PR 3 call "live stream split: all folds"), following option A.
- **No UI framework:** plain TypeScript and the DOM; four panels and a control bar do not need one, and the
  page-size budget starts this PR.
- **Replay by `?seed=`:** the seed is shown and the address replays it; no input field.
- **Live numbers shown:** model accuracy beside v0, as the "beats v0" gate compares them (parent C2); the
  accuracy after review goes to the PR 5 report.
- **Viewer review scoring:** correct = category and priority both right; team not scored (parent C3).
- **Arrival volume:** Act 2 uses a fixed default of 100 tickets per business day (500 a week, read from the
  course's "hundreds of tickets a week"), shown on screen as an assumption; its presets come with the
  PR 5 assumptions panel, as do the time-saved number, the manual queue and the capacity test, because each
  needs an assumption with a cited source that PR 5 adds. Until then the wireframe's "Time saved" row is not
  shown rather than shown empty.
- **"High-risk missed so far"** counts must-review tickets that reached Done unflagged, the same rule as
  `computeMetrics`, so the live count and the report agree.
- **Live region at learn speed only,** so a screen reader is not flooded at real speed.
