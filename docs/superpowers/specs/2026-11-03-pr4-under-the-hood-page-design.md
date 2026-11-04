# PR 4: The Under the Hood Page - Design

Parent design: `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` (sections 5.1, 5.4, 5.5, 6, 7, 8,
10.3). PR 3 design: `docs/superpowers/specs/2026-10-31-pr3-pipeline-design.md`. This doc adds only what PR 4
needs on top of them; it does not restate them.

**Status:** approved by the owner 2026-11-03.

Locked wireframe: https://claude.ai/artifact/LC8C8ggtnybnGDzrCe1QKY, page "Chosen layout" (locked 2026-11-04). It
replaces https://claude.ai/artifact/BzA8iShtJu6v2ULGKA4w1K; the owner's decisions are in section 5.

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
3. Play / Pause, Step, the real speed button, Why this choice and Review all work by keyboard alone, and reduced
   motion is respected.
4. A run replays exactly from its seed.

## 3. Non-goals and anti-goals

- **Non-goals:** the landing page, Try it yourself, the end report and the value assumptions panel (PR 5);
  the deploy (PR 6); retraining or tuning any model (the pre-screener is cut from a fold model, not trained); the
  manual-versus-assisted queue view, the capacity test and the value saved number (PR 5, section 12).
- **Anti-goals:** a number from a model that saw the ticket's templates; narration that calls a rule or the
  simulated reviewer "AI" (parent anti-goal); motion that ignores reduced motion; any network request other
  than the page's own files; a hidden miss (every miss shows in the closed list and the count).

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
- 2026-11-03: learn-speed pacing (about 30 tickets in about 2 minutes leaves under a second per stage): the
  first 3 tickets show each stage for about 5 seconds with full narration (about 90 seconds); the other 27 take
  about 1 second each with one sentence per ticket; Pause and Explain give full narration at any point.
- 2026-11-03: browser tests use `@playwright/test` in Chromium, Firefox and WebKit (a dev dependency; the page
  gains no runtime dependency).
- 2026-11-03 (owner, on the built page's screenshots): too much is on screen at once. Some viewers want all of
  it, others do not. The important things go front stage, plain and easy to pick out; the curious expand for
  more, like the live status feed of a tool working in the background: glance at what is happening now, open it
  to watch the real-time detail, ignore it if not interested. The redesign uses the latest kit's UI/UX skills
  and gets a real test. Size limits wait for the redesign's build. Everything behind the page (engine, schedule,
  word spans, narration, live numbers, fold models) stands.
- 2026-11-03 (owner, replacing the line above on the engine): three columns - tickets coming in, the ticket being
  worked with its stage and details, tickets going out (open ones on top by priority, closed ones collapsed and
  grayed) - with live stats on top, and critical tickets moving up the incoming column. The run engine may change
  so the cards move and are easy to follow. Build order: static first, to show it works; card movement and other
  motion come after.
- 2026-11-04 (owner): wide center (version 2 of the canvas https://claude.ai/artifact/LC8C8ggtnybnGDzrCe1QKY),
  with a brief section of each card shown in the left column; a colored tag system for priority from the
  pre-screener; an optional expandable explanation of the ticket's choices at learn speed, off at real speed; the
  right column collapses and shows a count of tickets pending human review.
- 2026-11-04 (owner): the simulated reviewer closes one ticket a second, shown as an assumption. A Live test runs the
  same tickets with no pacing and shows the software's real speed (43-64 ms for 130 tickets on the owner's PC, in Node).
- 2026-11-04 (owner): real speed and the live test are one thing: a single text call to action. Details and value
  numbers expand from the top stats. The chosen layout is locked.
- 2026-11-04 (owner, on the real-data screens): Privacy, Classify and Guardrails rows show from Intake, with small waiting
  dots until each result is there; each row names what it is (rules, trained model); the team shows on the Classify row
  and on each open card; open cards are short, with Review beside the reason and clear of the tag (6 of 13 fit at
  1280x800, measured); Why this choice carries a note on the highlighted words: "The highlighted words moved the model
  most. It counts words and does not read meaning, so small words can show up."; All numbers has the same arrow as Why
  this choice; the center takes the room when Going out folds.
- 2026-11-04 (owner, after the page check): real speed finishes the run, and its number comes from a fresh unpaced pass of
  all 130 tickets, because a late press timed tickets already run ("24 tickets in 0 ms"). The phone layout applies below
  1024 px, because at 768 px the center was the narrowest column at 184 px. Narration: every stage for the first three
  tickets, one sentence per ticket after that, none on the busy day while playing; Pause always shows the current
  stage's sentence. A caption under Coming in names the tags: "Tags are a quick first guess from a small model." A
  priority a rule raised is labeled "raised by a rule" in the review form.
- 2026-11-04 (owner): the reviewer's pace changes to one ticket every 1.5 seconds, the center stays at about 1 second
  per ticket. Measured on the real engine, 8 seeds: at one close a second the open list never holds more than 1 ticket,
  so the right column has nothing to show; at 1.5 s it peaks at 17-25 and a run takes about 4:15.
- 2026-11-04 (owner): the pre-screener is a small version of the first-stage model, beside the keyword rules. It is a
  second set of eyes that moves higher-value tickets along at high volume; it need not be perfect, and the main check
  never waits for its label. Measured on fresh seeds 2000-2011 (1,560 tickets, 226 truly urgent; one ticket per second
  in the center; waits are Act 2): no pre-screener, urgent wait 12.6 s; rules only, 96 marks, 89% right, 38% caught, 8.7 s;
  rules plus the small model (top 3,000 words of the fold model's priority head, cut when the fold model loads, so no
  new file or download), 379 marks, 47% right, 80% caught, 4.2 s. Average wait for all tickets stays 11.9 s.

## 6. The approach

A **run engine** (pure TypeScript, tested in Node) owns the run as a timed list of events, so a replay is exact and
the page only decides when to fire the next one. Three things hold tickets: the **incoming line**, the **center**
(one ticket at a time, one stage per event), and the **outgoing lists** (open, then closed). A ticket arrives, the
**pre-screener** tags it, and a Critical tag moves it up the line behind any earlier Critical ticket. When the center
is free it takes the top of the line. Guardrails sends a flagged ticket to the open list, kept highest priority
first, then oldest first; an unflagged ticket goes straight to closed. The **simulated reviewer** closes the top open
ticket every 1.5 seconds. The PR 3 `runTicket` stays unchanged and runs when the ticket enters the center; the engine
only decides when each result is shown.

The **pre-screener** reads masked text only. A ticket is Critical when a keyword rule of Urgent priority matches or
the small model says Urgent; otherwise its tag is the small model's priority. The small model is the fold model's
priority head cut to its 3,000 most useful words when the page loads: no new file, no download, no training. Nothing
waits for it, and its tag never changes the pipeline's answer.

**Review:** the viewer may press Review on any open ticket. The clock stops while the form is open, the simulated
reviewer's answer stays hidden, and Confirm runs that ticket again with a reviewer that returns the viewer's choice,
so the trail shown is the trail scored (PR 3 section 6 seam). Hand back returns it to the open list.

**Real speed** is one text button, "Run the last N tickets at real speed": the engine finishes the run with no pacing
and no cards drawn, then times a fresh unpaced pass of every ticket, and the page shows that measured time. The final numbers then stand as Run complete.

The **page** is plain TypeScript modules, one per panel, that render the engine's state; it holds no pipeline logic.
It ships static first: cards change column and order with no sliding. Motion comes after the owner has seen the
static screen (section 5).

**Fold models** are committed under `web/public/models/fold_<k>.json`, one per fold, and the CI model job
checks each against its fresh retrain the way it checks `model.json` today. The page fetches only the file its
run needs.

Rejected, one line each: the shipped model (its live numbers are memory, section 1); a UI framework (no view
here needs one, and it costs a dependency and bytes against a budget set this PR); a web worker (the pipeline
takes at most 27 ms per ticket on the owner's PC, PR 3 Execution Notes; revisit for the capacity test); a separate
trained pre-screener file (a cut of the loaded model caught 80% with no download, section 5).

## 7. Requirements

**Must**
1. **Fold models:** the four fold models are committed and CI fails if any differs from its retrain beyond the
   existing tolerance; `measurePipeline --check` keeps running on the CI retrain.
2. **Run engine:** a random seed of 1000 or more (parent 5.2's live range), shown on the page; a `?seed=` in the
   address replays that run; the fold is the seed mod 4 (section 5); Act 1 at learn speed, about 30 tickets in about 2
   minutes, then Act 2, the busy day: one simulated business day with about 1 second per ticket in the center and more
   arrivals mid-morning (parent 10.3); the run ends with a "Run complete" state that keeps the final numbers once every
   ticket is closed.
3. **Controls:** Play / Pause, Step (one event at a time, paused), Restart, the real speed text button, All numbers,
   Why this choice, Review, Collapse; each a real button with a visible focus ring and a 44 px target.
4. **Layout as locked:** top: live stats (tickets done, flagged for a person, pending review, high-risk missed) and
   All numbers. Left: Coming in, each card showing the ticket id, its first words and its tag once tagged, next ticket
   on top. Center, the widest: the current ticket, its stage track, its masked text, and a row for each of Privacy, Classify and
   Guardrails, with waiting dots until the stage is reached. Right: Going out, open tickets on top as short cards with the team, the reason and a Review button, highest priority first;
   closed tickets below as one gray line each, newest first. The right column collapses to a rail showing the number
   pending review. Under 1024 px: stats, the current ticket, then Coming in / Going out tabs; the tab shows the pending
   count.
5. **Live numbers:** on top as in Must 4. All numbers expands: the model's category accuracy so far beside v0's on the
   same tickets (the parent C2 comparison), reviewer overrides as a count, tickets per second (after a real speed run),
   and your reviews correct. All from `computeMetrics` over the tickets closed so far; pending review is the open
   list's length; high-risk missed counts must-review tickets that closed without review.
6. **Word chips:** each top term is highlighted where it is written in the masked text, found with the model's
   own tokenizer (a word pair is two adjacent tokens, so "so cannot" spans "so I cannot"); a rule word is found
   the same way (PR 3 Parking Lot); a term with no written span appears only in the technical detail.
7. **Narration:** one or two plain sentences built from the trail: each stage of the first three tickets, one sentence
   per ticket after that at learn speed, none on the busy day while playing, and the current stage on Pause.
   "Why this choice" expands to list confidence, the floor, each reason that fired, the top words and what was masked;
   it is closed by default, offered at learn speed and on Pause, and replaced on the busy day by a line that says to
   pause. It shows only what the current stage has reached. Rules, the model, the pre-screener and the simulated
   reviewer are named for what they are.
8. **Review:** available on any open ticket at either act; the clock stops while the form is open; the viewer picks
   category, priority and team (defaults: the model's picks; the team follows the category until the viewer changes
   it); Confirm closes it; "Hand back to the reviewer" returns it to the open list. A review counts as correct when
   category and priority both match the truth; the team is shown but not scored (parent C3).
9. **Loading and failure:** a loading state while the fold model loads; if it fails to load or parse, a plain
   error with a Retry button, and no run starts.
10. **Accessibility:** keyboard-only from Play to Run complete; reduced motion = no sliding: cards change place at once
    and stages change by color and text only; a tag is a word and a color, never color alone; a polite live region
    announces each stage at learn speed only (the busy day would flood it); contrast WCAG 2.2 AA; works at 375, 768, 1024 and
    1280 px; a Content-Security-Policy meta tag (`default-src 'self'`, adapter A3).
11. **Size budgets:** `web/size-budgets.json` with the two A12 budgets; `npm run gate` gains a production
    build and the size check after its tests (today it has no build step); limits set with the owner from the
    first real build.
12. **Time:** the trail's `receivedAt` is simulated-clock time and `ms` is measured wall time; "tickets per second"
    reads the real speed run's measured time. Replay equality covers every field except `ms`.
13. **Pre-screener:** as in section 6; a test holds it to at least 70% of truly urgent tickets caught and urgent waits at
    least halved against no pre-screener, on a fixed seed set not used to choose it.

**Should**
- Shared vocabulary in the model file (parked item), only if the first build shows the model budget needs it.
- Motion, after the static screen is approved (owner, 2026-11-04): the one big motion is cards moving between sections:
  left incoming, center focused, right completed or pending, and up the line when tagged, timed so a person can follow
  them. The only other movement is the small waiting dots. None of it under reduced motion. A later second review gets
  its own area on the board, so its cards move the same way.

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
- Given Review pressed on an open ticket, the run does not advance until Confirm or Hand back, the simulated reviewer's
  answer is not visible, and the viewer's pick is the trail's final answer, scored against the truth.
- Given a ticket tagged Critical, it moves ahead of every waiting ticket without that tag and behind earlier Critical
  ones; given no tag yet, the center still takes it in its turn.
- Given two open tickets, the higher priority is on top; at equal priority, the older.
- Given the real speed button with N tickets left, the run reaches Run complete with the same trails a paced run of
  that seed gives, and the page shows the measured time.
- Given the right column collapsed, the rail shows the open list's length and every ticket keeps moving.
- Given a must-review ticket that reaches Done unflagged, "High-risk tickets missed so far" goes up by one and
  its closed line shows Missed; a flagged ticket still open does not count.
- Given each live number, it equals a hand count on a fixed small fixture run.
- Given the top term "so cannot" and the text "so I cannot follow", the chip spans "so I cannot"; given a rule
  word that is a list entry not written in the text, no span is highlighted and the detail still lists it.
- Given `prefers-reduced-motion: reduce`, nothing slides: a card changes place in one frame with no transition.
- Given keyboard only, a person can start, pause, step, open Why this choice, review, confirm and finish a run.
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
- **Numbers shown:** model accuracy beside v0, as the "beats v0" gate compares them (parent C2); the accuracy after
  review goes to the PR 5 report.
- **Viewer review scoring:** correct = category and priority both right; team not scored (parent C3).
- **Arrival volume:** Act 2 uses a fixed default of 100 tickets per business day (500 a week, read from the
  course's "hundreds of tickets a week"), shown on screen as an assumption; its presets come with the
  PR 5 assumptions panel, as do the value saved number, the manual queue and the capacity test, because each
  needs an assumption with a cited source that PR 5 adds. Until then All numbers has no value saved row rather than
  an empty or invented one; PR 5 adds it there.
- **Real speed button:** finishes the rest of the run unpaced, since a card cannot be drawn at about 2,000 tickets a
  second; the busy day stays as the paced Act 2.
- **Reviewer pace is wall time:** one close every 1.5 seconds at both acts; shown on the page as an assumption.
- **"High-risk missed so far"** counts must-review tickets that reached Done unflagged, the same rule as
  `computeMetrics`, so the live count and the report agree.
- **Live region at learn speed only,** so a screen reader is not flooded on the busy day.
