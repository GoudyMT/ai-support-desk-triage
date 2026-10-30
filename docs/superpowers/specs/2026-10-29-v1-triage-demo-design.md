# AI Support Desk v1: Live Triage Demo - Design

**Date:** 2026-10-29
**Owner:** Max Goudy
**Status:** approved by the owner 2026-10-29; amended 2026-10-30 (see Revision History)
**Repo:** `GoudyMT/ai-support-desk-triage` (public), baseline tag `v0` at `d9563c2`

## 1. Intent and why

v0 is a one-shot course prototype: one HTML file, keyword rules, 5 of 8 sample tickets right, and a known-limits
list longer than its feature list (see `README.md`, "Known limits"). v1 rebuilds it to the standard a hiring
reviewer or a support lead would expect from a real AI system: a trained model, guardrails that actually run,
a human in the loop, and numbers that are measured rather than claimed.

The demo is the product. A visitor presses one button and, in 2 to 5 minutes, watches a stream of generated
support tickets move through the system, with visuals that show real understanding to an engineer and teach a
non-technical viewer at the same time. The end report shows how well it did, against v0 on the same tickets.

The build is also a test of the owner's methodology kit: most of the code is written by Sonnet builder agents,
with Opus used sparingly to check the risky parts, so the kit's agent canary is exercised on less capable models.

## 2. Goals, non-goals, anti-goals

**Goals**
1. A landing page with two clear actions: **Start demo** and **Try it yourself**.
2. **Start demo** opens the Under the Hood page and runs a live, procedurally generated ticket stream for 2 to 5
   minutes, ending in a report.
3. Every stage of the system is visible as an agent with its guardrails, with the "why" behind each decision.
4. The viewer can pause at any time and get a plain-words explanation of the current step, with technical detail
   one click away.
5. Real measurement: generated tickets carry their true answers, so accuracy, missed high-risk tickets and the
   v0 comparison are computed, not written in.
6. Free to host, private by design: runs entirely in the browser on GitHub Pages; no data leaves the page.

**Non-goals (v1)**
- Real customer data, live language model calls, API keys, accounts, a backend or a database.
- Connecting to a real help desk (Zendesk, Intercom); the at-scale design in the README stays a proposal.
- A pretrained language model in the browser (kept as the gated stretch tier, section 9).

**Anti-goals (a failure even if it works)**
- A number on screen that is invented: every figure is measured live or derived from an assumption the viewer
  can see, with its source, and change.
- Calling plain rules "AI": each stage is labeled for what it is (model, rule, simulated person).
- A demo that only an engineer can follow, or only a beginner can respect.
- A demo that hides its mistakes: misses and overrides are shown, not filtered out.

## 3. Constraints

- Static site on GitHub Pages; works offline once loaded; no network calls after load.
- No secrets anywhere (AGENTS.md hard constraint).
- Runs on a mid-range phone and a laptop browser (current Chrome, Edge, Firefox, Safari).
- Keyboard operable; respects reduced motion; text contrast to WCAG 2.2 AA.
- ASCII-only source; the owner's coding standards (global CLAUDE.md) apply to Python and TypeScript.
- The v0 link in the README (`capstone/prototype/...`) must keep working after v1 ships.
- Every PR goes through the kit: branch first, tests first, a sweep at its tier, the owner's go to push and merge.

## 4. Decisions the owner locked (2026-10-29)

| # | Decision | Locked choice |
|---|---|---|
| D1 | Order | v0 pushed first as the "before" snapshot; v1 built on top |
| D2 | The brain | A small model trained on generated tickets, running in the browser, with keyword rules as guardrails |
| D3 | Model | Word-weight model: TF-IDF features plus logistic regression (scikit-learn), quick to train, nothing exotic |
| D4 | Languages | Python for training and evaluation; TypeScript for the site |
| D5 | Human reviewer | A simulated reviewer handles flagged tickets by default and sometimes overrides the model, showing why; the viewer can press **Take over** and decide flagged tickets themselves |
| D6 | Tickets | Generated live and procedurally, never a canned list; each run is random |
| D7 | Speeds | Starts at **learn speed** (about one ticket every few seconds, narrated); then **real speed**: realistic arrivals on a simulated clock, processing time measured live, plus a labeled capacity test (section 10, item 3) |
| D8 | Value shown | Time and value saved, computed only from on-screen assumptions with a source, which the viewer can edit |
| D9 | Layout | "D, the blend": the six-stage row across the top; below it the ticket feed, the current ticket, and live numbers; Pause or Explain switches to plain narration of the current step |
| D10 | Build style | A roadmap of several small PRs, mostly built by Sonnet builder agents, Opus checking the risky units |
| D11 | Process | One step at a time, decisions locked with the owner, plain words; the kit is pulled before work (done: 1.5.0) |

## 5. How it works

### 5.1 The pipeline (six stages, each shown as an agent)

| Stage | What it does | What it is | Guardrail shown |
|---|---|---|---|
| 1 Intake | Receives the ticket, assigns an id and timestamp | Plain code | Rejects empty or oversized tickets |
| 2 Privacy | Masks emails, phone numbers, order and card-like numbers before any model sees the text | Rules (patterns) | "Personal data never reaches the model" |
| 3 Classify | Predicts category and priority, with confidence and the top words that drove it | Trained model | Low confidence is passed on, never hidden |
| 4 Guardrails | Applies the always-review list (security, accessibility, billing dispute, threatening language, vague) and a confidence floor; can raise priority, never lower it on a sensitive ticket | Rules | "The model can be overruled by the rules, never the reverse" |
| 5 Review | Flagged tickets wait for a human: the simulated reviewer or the viewer (Take over) | Simulated person / the viewer | "Only a human routes, replies or closes" |
| 6 Report | Records the outcome against the ticket's true answer | Plain code | Counts every miss, including the ones the reviewer caught |

The category and priority lists are the ones in Checkpoint 3: nine categories (Billing, Technical Issue, Account
Access, Security Concern, Accessibility Support, Product Question, Urgent Complaint, Shipping/Order Issue,
Other) and four priorities (Low, Medium, High, Urgent).

### 5.2 Ticket generator

- Templates per category with slots (product names, amounts, dates, order numbers, tone, typos), producing
  realistic text and the true category, priority and must-review flag for each ticket.
- Hard cases mixed in on purpose, at a set share of the stream: vague tickets, threatening language, two issues
  in one ticket, typos and slang, words that fool keyword matching ("Canada"), polite tickets about security.
- One generator, written in TypeScript, used by both sides: a script exports a labeled training set for Python,
  and the browser uses the same code for the live stream. Every template, named slot value (product, plan,
  feature, month) and fake-data frame is assigned to one of 4 folds (greetings, requests, sign-offs and numbers
  carry no category and are shared), balanced within each kind of template (grievance, severe, dispute, status). For each
  fold the export writes a training set from the other three folds and a held-out set from that fold alone, with
  any held-out ticket whose text also appears in training dropped. The model is scored on every fold in turn
  (grouped cross-validation), so each template is tested once and each score is reported as a mean and a spread.
  The frozen hand-written set stays the final check. Live tickets use every fold and their own seed range.
- Every run is random; its seed is shown in a corner so a run can be replayed exactly.

### 5.3 The model

- TF-IDF (words and word pairs) plus logistic regression, one model for category and one for priority, trained
  in Python with scikit-learn on each fold's training set; evaluated on that fold's held-out set (mean and spread
  over the 4 folds), then on the frozen hand-written set.
- Exported as a small JSON file (vocabulary, idf weights, coefficients); a TypeScript scorer reproduces the
  Python predictions. A parity test proves the two agree on the held-out set.
- The "why": the top words by contribution for the predicted class, shown as weighted chips on the ticket.

### 5.4 The simulated reviewer

- Sees each flagged ticket's text and the model's suggestion, and decides from the ticket's true answer, with a
  small, stated error rate so it behaves like a person rather than an oracle. When it disagrees with the model,
  the reason is shown ("the model said Technical Issue; the ticket threatens staff, so it goes to Urgent
  Complaint").
- **Take over:** the run pauses on each flagged ticket and the viewer picks category, priority and route; their
  choices are scored like the reviewer's.

### 5.5 The Under the Hood page (layout D)

- **Top:** the six-stage row; the current ticket's stage is lit; each stage shows a small live count.
- **Below, left:** the ticket feed (latest first), with a pill per outcome (auto, flagged, overridden).
- **Below, center:** the current ticket, its stage-by-stage trail, the word chips and confidence.
- **Below, right:** live numbers: tickets done, tickets per second, accuracy so far, flagged, overrides, v0 on
  the same tickets, time saved.
- **Controls:** Play/Pause, Step, speed (learn / real), Explain, Take over. All keyboard reachable.
- **Pause or Explain:** switches the center to plain narration of the current step (one or two sentences in
  plain words), with a "Show technical detail" toggle (the numbers and the rule that fired).
- **Learn speed** narrates; **real speed** hides narration and lets the numbers carry the story.
- Reduced motion: no sliding; stages change by color and text only.

### 5.6 The end report

Shown when the run ends (2 to 5 minutes), and exportable as a simple page:
- Accuracy on category and priority, against the true answers.
- **High-risk tickets missed** (true must-review tickets that reached a "done" state without review): the
  headline number; the design goal is zero.
- Flag rate and reviewer override rate.
- v1 against v0 on the same tickets (v0's rules ported exactly, section 5.7).
- Time per ticket (measured) and time and value saved (from the assumptions panel).
- A short list of the run's most instructive misses, each with the words that misled the model.

### 5.7 v0 baseline engine

v0's keyword rules ported to TypeScript exactly as written, quirks included, and proven equal to the original
HTML on the eight README tickets plus generated ones. Used only for the comparison; never "fixed".

### 5.8 Try it yourself

A text box on the landing page: the visitor types any ticket and watches it go through the six stages at learn
speed, with the narration, the word chips and the guardrail outcome. Nothing typed is stored or sent.

### 5.9 Value assumptions panel

Two inputs with defaults and a cited source: minutes a person spends triaging one ticket, and the loaded hourly
cost of a support agent. Time saved = tickets handled without manual triage x minutes per ticket; value =
time saved x hourly cost. The panel states that the savings are an estimate from these inputs, not a
measurement. The builder finds and cites a public source for each default; with no credible source, the
default is left blank for the viewer to fill.

## 6. Success Charter

1. **Expectations.** A visitor understands in the first minute what the system does and where the human
   decides; the demo runs 2 to 5 minutes without help and ends in a report; nothing on screen is invented.
2. **Success criteria (the gate for v1):**
   - The held-out category accuracy (mean over the 4 folds) beats v0 on the same held-out tickets (both measured, numbers recorded in
     the README).
   - High-risk tickets missed on the held-out set, through the full pipeline: 0.
   - TypeScript and Python predictions agree on 100% of the held-out set.
   - The v0 port matches the original HTML on all compared tickets.
   - The demo completes on a mid-range phone at learn speed without dropped frames being noticeable (checked by
     the owner on a real device).
   - Keyboard-only run from Start demo to the report works; reduced motion respected.
   - Every number on screen traces to a measurement or a visible assumption (checked in the launch sweep).
   - The bar for raw model accuracy is not set from a guess: it is written down after the first honest
     training run and before any tuning, with the owner (rule:goal-before-mechanism, deciding measurement first).
3. **Options considered.** Keyword rules only (v0; rejected, the point is growth); word-weight model (chosen);
   pretrained sentence model in the browser (stretch); live language model calls (rejected: keys, cost,
   privacy for a public demo).
4. **Scaling plan.** Trigger: the word-weight model plateaus on hard cases the README must admit. Path: add the
   stretch tier as a second brain, compared side by side. Cost: about a 23 MB download and slower phones.
5. **Ambition tiers.** (a) Functional end goal: everything in sections 5.1 to 5.9. (b) Stretch, gated until (a)
   is met and validated: a small pretrained sentence model (all-MiniLM via Transformers.js) as a second brain,
   with the demo comparing word weights against meaning.

## 7. Proposed roadmap (each line one PR, in order)

| PR | Delivers | Main risk | Check |
|---|---|---|---|
| 1 | TypeScript project setup (Vite, tests, lint, CI) and the ticket generator with labels and hard cases | Generator realism and label correctness | Opus checker |
| 2 | Python training and evaluation, model export, TypeScript scorer with the parity test | Leakage between train and test; parity | Opus checker |
| 3 | The pipeline: intake, privacy, guardrails, simulated reviewer, report metrics, v0 port | Guardrail logic; privacy masking | Opus checker + security sweep |
| 4 | The Under the Hood page: layout D, controls, two speeds, narration, Take over | Visual and accessibility quality | Owner wireframe lock first; Sonnet builders |
| 5 | Landing page, Try it yourself, end report, value assumptions panel | Honest numbers | Content sweep |
| 6 | Deploy to Pages via Actions with v0 kept at its link, README for v1, launch sweep | Breaking the v0 link | Launch-gate sweep |

## 8. Left to the builder

- Template wording and slot lists for the generator (realistic, fictional, varied).
- File and module layout inside the TypeScript project; test runner choice within the Vite ecosystem.
- Exact hyperparameters of the TF-IDF and logistic regression (within "quick to train"; no grid searches beyond
  a small one).
- Narration wording (plain words, reviewed by the owner in PR 4).
- Visual details inside the locked layout, after the owner's wireframe lock in PR 4.

## 9. Calls made by Claude after the builder check (the owner checks these)

- **C1 Labeling rules (the meaning of "correct").** Each generated ticket has one true category, one true
  priority and a must-review flag:
  - Two issues in one ticket: the true category is the higher-risk issue (Security > Accessibility > Urgent
    Complaint > Billing > Account Access > Technical Issue > Shipping/Order Issue > Product Question > Other); the
    second issue is recorded as a secondary label, shown in the report, not scored.
  - Vague ticket: category Other, priority Medium, must-review Yes.
  - Threatening or abusive language: category Urgent Complaint whatever the topic, priority Urgent, must-review Yes.
  - Priority by category and wording: Security Concern is Urgent; Accessibility Support and Account Access are
    High; Billing and Technical Issue are Medium, raised to High for words of loss or blocking ("can't work",
    "charged again"; a duplicate charge such as "charged twice" counts as charged again, and a crash that repeats
    ("keeps crashing", "crashes every time") counts as blocking, owner rulings 2026-10-30; in a two-issue ticket
    such words in either issue count; losing work, such as typing lost to a forced sign-out, counts as loss, owner
    ruling 2026-10-30); Product Question is Low; Shipping/Order Issue is Medium, Low for a status
    question.
  - Price questions: a question about plans and prices in general (what a plan costs, whether adding seats costs
    more) is Product Question; a question about the asker's own bill, charges or invoice is Billing (owner ruling
    2026-10-30).
  - Must-review Yes: Security Concern, Accessibility Support, Billing dispute (a disputed or duplicate charge or a
    refund), Urgent Complaint, vague tickets. This is Checkpoint 6's always-review list.
  - The rules live in one module with tests; the generator and the report both read it.
- **C2 Metrics and the v0 comparison.** Two accuracies are shown: the model alone (category and priority) and
  the system after review. The gate in section 6 uses the model alone for "beats v0" and the full system for
  "high-risk tickets missed". v0 runs on the raw ticket text (as v0 did) and is compared on category, priority
  and the review flag.
- **C3 Routes.** The route is a fixed function of the category (one team per category, extending v0's six teams
  to nine). It is shown and chosen in Take over, but scored only through the category.

## 10. Open items for the owner

1. LOCKED 2026-10-29: independent test set. About 40 hand-written tickets plus the 8 README tickets, drafted by
   Claude without looking at the model, reviewed by the owner, frozen before the first training run. The share of
   each hard case in the stream is also fixed before training. The README reports generated and hand-written
   scores side by side; the section 6 gate applies to both.
2. LOCKED 2026-10-29: a ticket is flagged when a keyword rule fires, when the model predicts a must-review
   category, or when the model's confidence is below the floor. No flag-rate limit now; the flag rate sits beside
   "high-risk missed" on screen; a target flag rate is set with the owner after the first honest training run.
   Owner's idea to explore in PR 3: a second check between the flag and human review that clears false alarms
   (a second model or a stricter script). Proposed safety line: it may clear only flags that came from low
   confidence, never a flag from a hard rule (security, threats, accessibility); its own misses are counted in
   "high-risk missed". Built as an experiment, measured on the frozen hand-written set, kept only if it lowers the
   flag rate with zero added misses.
3. LOCKED 2026-10-29: a run is a script of three acts, about 4 minutes; pause and Take over stop the clock; the
   run advances by itself and the viewer can skip ahead.
   - **Act 1, learn speed:** about 2 minutes, about 30 tickets, narrated.
   - **Act 2, a simulated business day (owner's addition):** tickets arrive at a realistic rate on a simulated
     clock (for example one business day in about 90 seconds), with a daily pattern (busier mid-morning). The
     arrival volume is an on-screen assumption with presets; the default follows the course scenario ("hundreds
     of tickets a week"). Processing time per ticket is measured live. The same arrivals feed two queues side by
     side: AI-assisted (model plus review of flagged tickets only) and fully manual triage (every ticket at the
     assumed minutes per ticket), so the viewer watches the manual backlog grow and the assisted one stay short.
   - **Capacity check (optional, labeled):** a button that pushes 10,000 tickets through at full speed to show
     the system's raw throughput, clearly marked "capacity test, not a real arrival rate".
   - **Act 3:** the report.
   - Reviewer time per flagged ticket is an on-screen assumption, like the other value inputs (section 5.9).

## Revision History

- 2026-10-30: two C1 rulings by the owner (a duplicate charge counts as charged again; a repeated crash counts as
  blocking), and the held-out set moved from a separate seed range to separate templates with text overlap removed,
  after the PR 1 review found that 45% of held-out tickets repeated training text word for word.
- 2026-10-30 (later): after the re-sweep showed one fixed held-out set swings by up to 45 points per category
  with the choice of held-out templates, the owner chose 4 template folds with grouped cross-validation; and two
  more C1 rulings (lost work counts as loss; general price questions are Product Question, own-bill questions
  Billing).
