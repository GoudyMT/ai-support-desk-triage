# PR 5: The Operator Desk - Design

Parent design: `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` (sections 2, 5.6, 5.8, 5.9, 6, 7, 10.3).
PR 4 design: `docs/superpowers/specs/2026-11-03-pr4-under-the-hood-page-design.md`. This doc adds only what PR 5 needs.

**Status:** approved by the owner 2026-11-05.

Locked wireframe: https://claude.ai/artifact/BEoWx61b892xzw1sfT9t2f (locked 2026-11-05, seven screens).
Owner's words: `docs/brainstorms/2026-11-05-pr5-operator-landing.brainstorm.md`.

## 1. Intent and why

Under the Hood shows how a ticket gets decided. Nothing yet shows the other end: the desk where tickets arrive sorted
to a team or held for a person. PR 5 builds that desk as the page a visitor sees first. It also gives the visitor a
way to test a ticket, a live report, and a record of the model improving over time.

Evidence that shapes it (measured 2026-11-05):

| Measurement | Result |
|---|---|
| Manual sorting at 100 tickets a day, 2 minutes each | 200 minutes of work, so one person never falls behind |
| Flagged tickets, 40 runs, seeds 2000 to 2039 | 4,610 of 5,200 (89%), about 115 a run |
| Flagged tickets under 50% sure | 85% |
| Flagged tickets at 70% sure or more | 258, 6 to 7 a run; category right 93%, category and priority right 83% |
| Page size now | 48,201 of 48,500 bytes |
| Shipped model file | 3,825,909 bytes against a 3,600,000 limit |

## 2. Goals

1. In the first ten seconds, a first-time visitor can say what the page is and has a clear way to start.
2. During a run, a viewer can follow each ticket: it arrives, sorts by severity, and leaves for a team.
3. A visitor can type a ticket and see its category, priority, team and whether a person is needed (the course's
   example interface, Track 3 Module 4).
4. Every number traces to a measurement or a visible assumption (parent section 6).
5. When a later model ships, one added data row shows the change against the baseline.

## 3. Non-goals and anti-goals

- **Non-goals:** the manual versus assisted queues and the capacity test (cut by the owner, supersedes parent 10.3);
  automatic replies (the owner: a massive undertaking, not this project); new model training; the Get the model path
  (PR 6); slide-in motion on the phone beyond what the desktop has.
- **Anti-goals:** too much on screen at once (owner's wince); a visitor who cannot test it themselves; no easy way to
  Under the Hood; a number from a model that saw the ticket's templates; a run that hides a wrong quick approval;
  anything typed leaving the page.

## 4. Constraints

Parent section 3 applies: static site, no calls after load, ASCII source, keyboard operable, reduced motion, WCAG 2.2 AA,
content security policy `default-src 'self'`. No UI framework (PR 4). The demo keeps its 48,500 byte limit.

## 5. What the owner decided (2026-11-05)

- The landing page is an operator's desk, the receiving end of the process. It has Start and Stop at the bottom.
- Page buttons (Try a ticket, Model History, Under the Hood) sit on the bottom bar. No underlined links.
- Before Start, the page shows fixed measured numbers. During a run, live numbers. (The first half is the owner's pick;
  the split is Claude's reading, shown on the wireframe and not corrected.)
- Live stats sit at the side and expand to Generate report, with a time frame (only "This run" for now).
- The manual queue view and the capacity button are cut.
- The simulated reviewer keeps clearing pending tickets, as a slow trickle. The viewer can step in on any ticket.
- **Sort:** by severity: Critical, High, Medium, Low. The same severity goes oldest first. A new ticket joins at its
  place, so a lower one starts at the bottom and a higher one moves up.
- **Number updates:** the old number fades out and the new one fades in. No highlight.
- **Quick approve:** each card reads "Leaning <team>, N% sure". At 70% or more an Approve button shows. Below 70% it is
  not there and the viewer opens the card with Review. Approve means: send to the team shown, at the priority shown. The
  cutoff is raised once a better model exists.
- **Review card:** the ticket, why it came to you, Category, Priority and Team at the model's picks, an optional note,
  "Looks good, send it", and "Hand back to the reviewer".
- **Model History:** named by the owner. Newest model on top, each row showing its change as an arrow and a number (green
  up, no extra words), with a current against baseline block.
- **Info icons:** small icons explain what is not obvious to a less technical viewer.
- Own file for the landing page and the report loaded on demand; the shipped model for Try it; a small deploy PR first.

## 6. The approach

**Two pages from one build.** Vite gets two entries. The desk is the site root. Under the Hood moves from `index.html` to
`under-the-hood.html`, and its address and browser tests move with it. Shared code (generator, pipeline, scorer, engine)
is one shared chunk. Rejected: one file with a raised limit (a first-time phone visitor downloads the whole demo);
cutting features (loses what the owner asked for).

**Reuse the run engine.** The desk calls `createRun` with a desk schedule. The engine gains two options instead of new
logic: `closeEveryMs` (default `CLOSE_EVERY_MS`) and `deepTickets` (default `DEEP_TICKETS`; the desk passes 0). The
sort the owner asked for already exists (`compareOpen`: `guard.priority` high to low, then oldest first). Quick approve
uses the existing `review(id)` then `confirm(...)` path, so the viewer's choice is scored as any review is. The fold
model and seed rules stay as PR 4 set them.

**Try a ticket** runs the same `runTicket` on the shipped model, loaded the first time Sort this ticket is pressed. Its
reviewer is a stub that returns the suggestion unchanged, with `ROUTES[category]` as the team, because a typed ticket has
no true answer. No accuracy is shown for it.

**Model History reads one data file**, `web/src/history/history.json`: one row per model, with the four measured numbers
and the lit-card count. A test holds the current row equal to the numbers CI measures, so the page cannot drift.

### Details for the builder

- **Run model:** Start draws `randomSeed()` (or `?seed=`) and fetches that fold's model with `fetchModel`. The page itself
  loads no model. The Start button shows loading, and a failure shows a message and Retry.
- **Shipped model:** the build copies `web/src/model/model.json` to `models/shipped.json`, so the file stays single-source.
  `checkSizes` learns that name and the model limit becomes 3,850,000 (owner, Q6).
- **Size check:** per page, from Vite's build manifest. A page's number is the gzip of the code and styles it loads at
  start, shared chunks included. Parts loaded on demand (the report) are listed and held to the same page's limit
  together with its start load.
- **Desk schedule:** `createDeskSchedule(seed)` in `clock.ts`: the same 130 tickets, arrivals seeded around every 1.8
  seconds, one act, so `act(i)` returns 2. `closeEveryMs` is 2,000.
- **Card numbers:** the tag is `guard.priority`. "N% sure" and the 70% cutoff read `category.confidence`, as measured in
  section 1. Cards show the suggestion only (`hideAnswer`).
- **Review open:** the run holds while a review card is open, as it does today (`engine.ts` `tick`). The bar says so.
- **Quick approvals:** `viewerReviews` entries gain `quick: boolean`. The report counts entries with `quick` and not
  `correct`.
- **Report:** covers `state.done`. Generate report is off until one ticket has closed, works mid-run and is headed "so far",
  and does not open by itself at the end (owner, Q7).
- **Assumptions:** the existing 2 minutes and $21.53 with the sources PR 4 cites on the page (`valueSaved.ts`, `copy.ts`).
- **Numbers before Start and in `history.json`:** read from `ml/reports/eval.json` and the start points the CI measure
  script holds. A row holds: held-out category accuracy, hand-written right, high-risk missed, share sent to a person, and
  Approve cards per run. `measurePipeline` gains the Approve count on seeds 2000 to 2039.

## 7. Requirements

**Must**
1. Desk at rest: sentence, three measured numbers, Try a ticket, Start, bar buttons (screen 1).
2. Desk during a run: Needs a person, Sent to teams, This run, Stop, severity sort, fading numbers (screen 2).
3. Card: team, priority tag, ticket text, why, "Leaning <team>, N% sure", Approve at 70% or more, Review.
4. Review card (screen 6), keyboard operable, focus returns to the list.
5. Try a ticket with the warning that a person must check suggestions before anything reaches a customer. Masked text
   only is shown back. A failed model load shows a retry.
6. This run panel expands to more numbers, the two editable assumptions and Generate report (screen 3). Report covers
   parent 5.6, plus wrong quick approvals. Print or save as PDF uses the browser's print.
7. Model History page (screen 4), including how many cards get Approve, measured the same way as the other numbers.
8. Info icons on the screens in the wireframe, opening on hover, focus and tap, closing with Escape.
9. Phone layout (screen 5): the same desk, one list at a time, the four-button bar.
10. Privacy copy naming exactly what is masked and what is not (Roadmap carried item).

**Should**
- Cards slide between lists like the demo's cards. Reduced motion: position changes only.

**Later (seams only)**
- A better model adds a row; more time frames in Generate report; second review area; changelog area.

## 8. Acceptance criteria

- Given a run, when a ticket is flagged, then it lands in Needs a person at its severity, oldest first in its level.
- Given a Critical arrives while Highs wait, then it is first in the list.
- Given a card at 69%, then no Approve button exists in the page. Given a card at 70%, it does.
- Given Approve pressed, then that ticket closes to the shown team and priority, counts as the viewer's, and a wrong one
  appears in the report's wrong quick approvals.
- Given a change of a count, then the old number fades and the new one shows, and with reduced motion it just changes.
- Given a typed ticket with an email address, then the address never appears on screen and no network request is made
  except the model file itself on first use.
- Given an empty ticket or one over `MAX_TICKET_CHARS` (20,000), then the box says what is wrong and what to do, and no model loads for it.
- Given the model file fails to load, then a message and Retry show, and the desk still works.
- Given Stop, then no card moves until Start. Given Start again after a finished run, then a new seed runs.
- Given a report, then each number equals `computeMetrics` on the same trails.
- Given edited assumptions, then the estimate updates and stays labeled an estimate. An empty or non-number input keeps
  the last good value and says so.
- Given `history.json`, then the current row equals the CI measurement, or CI fails.
- Keyboard only: Start to report works. Text contrast meets AA at 1280 and at the phone width.
- The v0 prototype link still loads after the build (deploy PR check).
- Sizes: the demo stays under 48,500 bytes; the desk stays under the limit set in section 10.

## 9. Success criteria

The parent section 6 gates still hold. A person who has never seen the desk can follow one ticket from arrival to its
team on a first run (the owner checks this on the real build, per L-05, after the first visual unit, not at the end).

## 10. Risks and open questions

- **Blocking, owner, after the first build:** the desk's size limit. It cannot be set from a guess (no fake numbers), so
  the first visual unit measures it and the owner sets the limit.
- **Non-blocking, measure:** the trickle pace. Start at one arrival every 1.8 seconds and one reviewer close every 2
  seconds, so a run is about 4 minutes. Check the Needs a person count stays readable on 8 seeds, then show the owner.
- **Non-blocking:** with 89% flagged, Needs a person is the busy list. Severity sort and the reviewer keep it moving.
- **Risk:** moving Under the Hood changes its address. Every browser test and link moves in one change (graduated #1).
- **Risk:** the first Linux CI run finds what Windows hides (L-08). Push the branch early, with the owner's go.
- **Risk:** a note could hold personal data. It stays in memory for the run, is not in the report, and is gone on reload.

## 11. Order of work

1. **Deploy PR first (owner's pick).** Pages today is the old setting: it serves the repo as it is, and its last status
   is `errored`. Under that setting `web/index.html` is unbuilt and cannot run. The deploy PR adds an Actions workflow
   that builds `web/` and publishes it with `capstone/prototype/` kept at its link, then the owner switches the Pages
   source to GitHub Actions. Site root shows Under the Hood until PR 5 replaces it.
2. **PR 5**, built from its plan. The owner chose one public release: PR 5 merges first, then the source switch and the
   deploy PR, so the site changes once.

## 12. Left to the builder

File layout inside `web/src/desk/`, exact timings of fades, tag and icon details inside the wireframe.

## 13. Your calls (Claude's, for the owner to check)

- Under the Hood's new address `under-the-hood.html`.
- No separate Deny button: Review is the deny path.
- Quick approve is allowed on tickets a safety rule flagged: accuracy was about the same (83%), and locking them leaves
  about 2 lit cards a run. A person still presses the button.
- Try a ticket's result shows no accuracy, because a typed ticket has no true answer.
- The note is new, and it is not scored or printed.
- Print or save as PDF, and the report opens from Generate report rather than by itself.
- The trickle starting pace in section 10.
- The run holds while a review card is open, as the demo does, so the viewer is not chasing a moving list.
- A report can be generated mid-run, headed "so far".
