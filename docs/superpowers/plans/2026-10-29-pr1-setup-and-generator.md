# PR 1: TypeScript Setup and Ticket Generator - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: the owner chose the kit's agent-team-build (Sonnet builders,
> Opus checkers on the risky units). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested TypeScript project that generates realistic, labeled support tickets (with hard cases at fixed
shares) and exports labeled datasets for training, plus the frozen hand-written test set.

**Architecture:** One TypeScript package in `web/` (Vite, Vitest, ESLint). The labeling rules live in one module
that the generator, and later the report, read. The generator is deterministic per `(seed, index)` so a run can
be replayed. A Node script exports JSONL datasets for the Python side (PR 2).

> SUPERSEDED (2026-10-30): Node 22.22.3 and npm 10.9.8 (Vite 6 and Vitest 5 need Node 22), Vitest 5.0.5 (4.1.x
> crashed npm's installer), @types/node 22.19.21 added; CI runs Node 22.22.3. See Progress.

**Tech Stack:** Node 20.11 (installed), npm 10.4, TypeScript 5.9.3, Vite 6.4.4, Vitest 3.2.7, ESLint 9.39.5,
typescript-eslint 8.71.2, tsx (for the export script; version picked by the same rule). Every version is pinned
exactly and was released at least 14 days before 2026-10-29.

**Spec:** `docs/superpowers/specs/2026-10-29-v1-triage-demo-design.md` (sections 5.1, 5.2, 9 C1, C3, 10.1).

## Global Constraints

- ASCII only in every source, data and doc file (owner's global rule).
- No `Math.random()`, `Date.now()` or any clock or environment input inside the generator: same `(seed, index)`
  gives the same ticket on every machine.
- No network calls at runtime; no secrets anywhere.
- Categories exactly: Billing, Technical Issue, Account Access, Security Concern, Accessibility Support, Product
  Question, Urgent Complaint, Shipping/Order Issue, Other. Priorities exactly: Low, Medium, High, Urgent.
- All personal data in tickets is fake and recognizably so: emails at `example.com` / `example.org`, phone numbers
  `555-0100` to `555-0199`, card-like numbers that fail the Luhn check, order numbers `ORD-` plus 6 digits.
- Ticket text: 1 to 2000 characters.
- Seed ranges: datasets for training and evaluation use seeds 1 to 999; live demo runs use seeds >= 1000.
- Dependencies: exact pins; resolve with `npm install --package-lock-only` first, show the lockfile diff, and
  download only after the owner's yes (kit rule "Downloads resolve first").
- One-line commit messages, `type: subject`, no body, no trailer.

## Review Focus

1. Replay on another machine: seed 42, index 0 to 2 must give byte-identical tickets everywhere -> Task 3 pins a
   snapshot.
2. A text a hard case claims must actually look like that case: a "vague" ticket must contain no category trigger
   word; a "threatening" one must contain a threat phrase; a "keyword-trap" must contain a trap word -> Task 4.
3. Fake personal data that looks real (a valid card number, a real email domain) would leak into a public demo ->
   Task 4 asserts the fake formats over 5,000 tickets.
4. Shares drift: over 20,000 tickets each category and hard-case share stays within 1.5 points of its target ->
   Task 4.
5. A two-issue ticket labeled by the wrong issue silently corrupts every accuracy number -> Task 2 pins the risk
   order for every pair.

---

### Task 0 (lead, before any builder): project adapter and owner locks

Not a builder unit. The lead fills `standards/project-adapter.md` with the owner (stack, gate command
`npm --prefix web run gate`, test devices, deploy model, branch and release conventions, and whether size budgets
apply), writes the local skill-cases file with the owner, and gets the owner's yes for the dependency
download. Builders start only after this.

### Task 1: Project setup

**Files:**
- Create: `web/package.json`, `web/package-lock.json`, `web/tsconfig.json`, `web/eslint.config.js`,
  `web/vitest.config.ts`, `web/src/smoke.test.ts`, `.gitignore` (root: `node_modules/`, `web/dist/`,
  `ml/data/generated/`), `.github/workflows/ci.yml`
- Modify: `.kit/tracking.json` (lead only: add `web/`, `ml/data/handwritten.jsonl`, `.gitignore`,
  `.github/workflows/`, `docs/superpowers/plans/`)

**Interfaces:**
- Produces: npm scripts `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `gate` (lint, then
  typecheck, then test; fails on the first failure).

> SUPERSEDED (2026-10-30): the smoke test was cut in 27f1ddf (it passed with no project code; every other test proves
> the toolchain).
- [ ] **Step 1:** Write `web/src/smoke.test.ts`: `expect(1 + 1).toBe(2)` and a second test that imports nothing
  and asserts `typeof structuredClone === 'function'` (proves the Node target).
- [ ] **Step 2:** Resolve dependencies lockfile-only; show the lead the lockfile; install after the owner's yes.
- [ ] **Step 3:** Configure `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`,
  `module: "ESNext"`, `target: "ES2022"`, `moduleResolution: "Bundler"`.
- [ ] **Step 4:** Run `npm --prefix web run gate`. Expected: lint clean, typecheck clean, 2 tests pass.
- [ ] **Step 5:** Break check: change `toBe(2)` to `toBe(3)`, run the gate, see it fail on that assertion,
  restore.
- [ ] **Step 6:** CI: `ci.yml` runs on push and pull_request, Node 22.22.3 (superseded from Node 20, 2026-10-30), `npm ci` and `npm run gate` in `web/`.
- [ ] **Step 7:** Commit: `chore: set up the web TypeScript project with lint, tests and CI`

### Task 2: Labels and labeling rules (Opus checker)

**Files:**
- Create: `web/src/domain/labels.ts`, `web/src/domain/labelRules.ts`, `web/src/domain/labelRules.test.ts`

**Interfaces:**
- Produces (in `labels.ts`):
  - `CATEGORIES` (readonly tuple, order as in Global Constraints), `type Category`
  - `PRIORITIES` (`Low`, `Medium`, `High`, `Urgent`), `type Priority`
  - `RISK_ORDER: readonly Category[]` = Security Concern, Accessibility Support, Urgent Complaint, Billing,
    Account Access, Technical Issue, Shipping/Order Issue, Product Question, Other
  - `type ReviewReason` = `'security incident' | 'accessibility issue' | 'billing dispute' |
    'threatening language' | 'escalated complaint' | 'vague ticket'`
  - `ROUTES: Record<Category, string>`: Billing Team, Technical Support, Account Support, Security Team,
    Accessibility Team, Product Specialists, Escalations Team, Fulfillment Team, General Support (in category
    order; the first four and Accessibility match v0)
  - `interface TicketLabel { category: Category; secondary?: Category; priority: Priority; mustReview: boolean;
    reviewReason?: ReviewReason }`
- Produces (in `labelRules.ts`):
  - `interface TicketFacts { issues: Category[]; threatening: boolean; vague: boolean; billingDispute: boolean;
    severe: boolean; statusQuestion: boolean }` (`issues` has 1 or 2 entries, never `Urgent Complaint` from a
    threat; the threat is the `threatening` flag)
  - `primaryCategory(issues: Category[]): Category` (first in `RISK_ORDER`)
  - `labelTicket(facts: TicketFacts): TicketLabel`

Rules (spec 9 C1, in precedence order):
1. `threatening` -> Urgent Complaint, Urgent, review `threatening language`; `secondary` = primary of `issues`, left out when that topic is
   itself Urgent Complaint (amended 2026-10-30, commit 3ea560d).
2. `vague` -> Other, Medium, review `vague ticket`.
3. Otherwise category = `primaryCategory(issues)`; `secondary` = the other issue when there are two.
4. Priority by category: Security Concern Urgent; Accessibility Support High; Account Access High; Urgent
   Complaint High; Billing and Technical Issue Medium, or High when `severe`; Shipping/Order Issue Medium, or Low
   when `statusQuestion`; Product Question Low; Other Low.
5. Must-review: Security Concern (`security incident`), Accessibility Support (`accessibility issue`), Billing
   with `billingDispute` (`billing dispute`), Urgent Complaint (`escalated complaint`); else no review.

Plan note: "Urgent Complaint without a threat is High with reason `escalated complaint`" and "Other (not vague)
is Low" extend spec C1, which is silent on them; the owner checks them at plan review.

> SUPERSEDED (2026-10-30): 27f1ddf replaced the 72-pair table with the 16 neighbouring pairs in both orders and cut the
> RISK_ORDER constant row (second proofs); aef3607 restored a ROUTES row pinning every route name (design C3).
- [ ] **Step 1:** Write tests: one per rule above with exact expected labels; a table test over all 72 ordered
  pairs of distinct categories asserting `primaryCategory([a, b])` is whichever comes first in `RISK_ORDER`;
  threatening beats vague when both are true; `ROUTES` has exactly 9 keys.
- [ ] **Step 2:** Run `npm --prefix web test -- labelRules`. Expected: fail (module missing).
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run the tests. Expected: all pass. Break check: swap two entries in `RISK_ORDER`, see the pair
  test fail, restore.
- [ ] **Step 5:** Commit: `feat: add ticket labels and the labeling rules`

### Task 3: Seeded random numbers

**Files:**
- Create: `web/src/generator/rng.ts`, `web/src/generator/rng.test.ts`

**Interfaces:**
- Produces: `interface Rng { next(): number; int(min: number, max: number): number; pick<T>(items: readonly
  T[]): T; chance(p: number): boolean; weighted<T extends string>(weights: Record<T, number>): T }` and
  `createRng(seed: number): Rng` (mulberry32; `int` inclusive on both ends; `pick` and `weighted` throw on empty
  input).
- Produces: `ticketSeed(seed: number, index: number): number` (mixes the two into one 32-bit seed, so each
  ticket is independent of the ones before it).

> SUPERSEDED (2026-10-30): the same-seed first-5 replay row and the ticketSeed stability row were cut in 88d576c
> (second proofs of the pinned createRng(42) values); see Progress.
- [ ] **Step 1:** Tests: same seed gives the same first 5 `next()` values; different seeds differ; `int(1, 3)`
  over 3,000 draws hits 1, 2 and 3 and nothing else; `weighted({a: 0, b: 1})` never returns `a`; `pick([])`
  throws; a snapshot of `createRng(42)` first 3 values (Review Focus 1).
- [ ] **Step 2:** Run; expect failure. **Step 3:** Implement. **Step 4:** Run; expect pass.
- [ ] **Step 5:** Commit: `feat: add the seeded random number generator`

### Task 4: Templates and the ticket generator (Opus checker)

**Files:**
- Create: `web/src/generator/templates.ts`, `web/src/generator/hardCases.ts`, `web/src/generator/fakeData.ts`,
  `web/src/generator/generate.ts`, `web/src/generator/generate.test.ts`

**Interfaces:**
- Consumes: Task 2 (`labelTicket`, `TicketFacts`, `TicketLabel`, `CATEGORIES`), Task 3 (`createRng`,
  `ticketSeed`).
- Produces:
  - `type HardCase = 'vague' | 'threatening' | 'two-issues' | 'typos' | 'keyword-trap' | 'polite-security'`
  - `CATEGORY_SHARES: Record<Category, number>` = Technical Issue 0.22, Billing 0.18, Account Access 0.14,
    Product Question 0.12, Shipping/Order Issue 0.12, Other 0.06, Security Concern 0.06, Accessibility Support
    0.05, Urgent Complaint 0.05 (sum 1.00; Claude's assumption, stated in the README later)
  - `HARD_CASE_SHARES: Record<HardCase, number>` = vague 0.06, threatening 0.04, two-issues 0.08, typos 0.10,
    keyword-trap 0.04, polite-security 0.04 (fixed now, before any training, per spec 10.1; at most one hard
    case per ticket; the remaining 0.64 are plain tickets)
  - `FAKE_DATA_SHARE = 0.15` (tickets that carry fake personal data, for the PR 3 privacy stage)
  - `CATEGORY_TRIGGER_WORDS: readonly string[]` (the words a vague ticket must avoid; exported for tests)
  - `interface Ticket { id: string; seed: number; index: number; text: string; label: TicketLabel; hardCase?:
    HardCase; hasFakeData: boolean }` (`id` = `T-<seed>-<index>`)
  - `generateTicket(seed: number, index: number): Ticket`
  - `generateTickets(seed: number, count: number): Ticket[]`

Approach: each template declares its text with slots and its `TicketFacts`; the label always comes from
`labelTicket(facts)`, never written by hand. Hard cases are applied after the base template: `vague` replaces the
text with a vague template; `threatening` adds a threat sentence and sets the flag; `two-issues` joins two
templates of different categories; `typos` swaps or drops letters in about 1 word in 8 (labels unchanged);
`keyword-trap` uses a template whose text contains a trap word (Canada, ADA-unrelated "Ada", "charge my phone",
"account for") while its true category is something else; `polite-security` is a Security Concern template with
none of the words hacked, unauthorized, breach, stolen. At least 6 templates per category and 5 per hard case.

- [ ] **Step 1:** Tests (exact values from the interfaces above):
  - determinism: `generateTicket(42, 7)` deep-equals itself on a second call; seeds 42 and 43 differ (superseded 2026-10-30: the texts of seeds 1 and 2 are the same at no more than 5 of 50
    positions, so a generator that ignores its seed fails).
  - shares over `generateTickets(1, 20000)`: each base-template category share (before a hard case changes the
    label) and each hard-case share within 0.015 of its target; fake-data share within 0.015 of 0.15 (Review
    Focus 4). The base category is exposed on the same test-only path as the facts.
  - labels: for every ticket, `label` equals `labelTicket` applied to the facts the generator used (expose facts
    on a test-only path or recompute from template id; the builder picks, the checker verifies).
  - hard-case text: every `vague` ticket contains no word from `CATEGORY_TRIGGER_WORDS`; every `threatening`
    ticket has `label.category === 'Urgent Complaint'`; every `keyword-trap` text contains a trap word and its
    category is not the one the trap word suggests; every `polite-security` ticket is Security Concern and
    contains none of the four banned words (Review Focus 2).
  - text over 5,000 tickets: ASCII only, 1 to 2000 characters, emails only at example.com or example.org,
    phones only 555-0100 to 555-0199, every 13 to 19 digit run fails the Luhn check (Review Focus 3).
  - every one of the 9 categories and 6 hard cases appears in 20,000 tickets (superseded 2026-10-30: cut in
    06cd5d8 as a second proof of the share rows).
- [ ] **Step 2:** Run; expect failure. **Step 3:** Implement. **Step 4:** Run; expect pass. Break check: set
  `HARD_CASE_SHARES.vague` to 0.2, see the share test fail, restore.
- [ ] **Step 5:** Commit: `feat: add the procedural ticket generator with labeled hard cases`

### Task 5: Dataset export

**Files:**
- Create: `web/scripts/exportDataset.ts`, `web/scripts/exportDataset.test.ts`
- Modify: `web/package.json` (script `export-data`)

**Interfaces:**
- Consumes: Task 4 (`generateTickets`, `Ticket`).
> SUPERSEDED (2026-10-30): the export now writes one training and one held-out file per template fold,
> `train_0..3.jsonl` (20,000 each) and `heldout_0..3.jsonl` (4,000 each, text overlap dropped), each row with a
> `fold` key; generation takes a split argument (design 5.2; e76e3d9, e5c5d9c, aef3607).
- Produces: `toJsonl(tickets: Ticket[]): string` (one JSON object per line: `id`, `text`, `category`,
  `secondary`, `priority`, `mustReview`, `reviewReason`, `hardCase`), and the command
  `npm --prefix web run export-data` writing `ml/data/generated/train.jsonl` (seed 1, 20,000 tickets) and
  `ml/data/generated/heldout.jsonl` (seed 2, 4,000 tickets). Both stay out of git (regenerable).

- [ ] **Step 1:** Tests: `toJsonl` of 2 tickets gives 2 lines that parse back to the same fields; train and
  held-out ids never overlap (superseded 2026-10-30: ids can never collide, so the rows now check that no
  text, template, slot value or fake-data frame is shared between a fold's two files); a seed >= 1000 passed to the export throws (training range only).
- [ ] **Step 2:** Run; fail. **Step 3:** Implement. **Step 4:** Run; pass; run the command and check line counts
  (20,000 and 4,000).
- [ ] **Step 5:** Commit: `feat: add the labeled dataset export for training`

### Task 6 (lead, owner reviews): the frozen hand-written test set

Not a builder unit. The lead writes `ml/data/handwritten.jsonl`: the 8 README tickets plus 40 new tickets written
in plain everyday language without looking at any template or model, covering every category at least 3 times
and every hard case at least 2 times, labeled by the C1 rules (same fields as Task 5, plus `source:
"readme" | "handwritten"`). The owner reviews the labels. Once approved it is frozen: a test in
`web/src/domain/handwritten.test.ts` checks its sha256 against a value recorded in the test, so any edit fails
the gate.

- [ ] Write the 48 tickets; validate every line against the label types (a small test reads the file).
- [ ] Owner review and approval; record the hash; commit: `test: add the frozen hand-written evaluation set`

### Task 7 (lead): close out PR 1

- [ ] Full gate green; first CI run green on the branch (after the owner's go to push).
- [ ] Sweep at the feature tier under a Swarm Contract cleared by the sweep approval script (the owner decides only
  when the script asks); report in `.kit/sweeps/`.
- [ ] PR body from the pr-body skill, shown to the owner before the PR command.

## Progress

- Task 0 (setup and adapter): done 2026-10-29, with the owner.
- Task 1 (web project, lint, tests, CI): e1b755a.
- Task 2 (labels and rules): 129425f, 3ea560d.
- Task 3 (seeded random numbers): c7215d1.
- Task 4 (ticket generator): 236d13c, 323d266; owner rulings d9f902f.
- Task 5 (dataset export): c1f1d76.
- Task 6 (hand-written set, frozen by the owner): 6252562.
- Task 7 (close out): feature sweep 2026-10-30 found 2 high and 6 medium roots; fixes 5d9e22b, 835e29e, 5a64b09,
  27f1ddf, 88d576c, 401d03e, 06cd5d8, d63a222, e76e3d9, e5c5d9c. Owner rulings 2026-10-30: the held-out set is
  built from held-out templates (design 5.2), and a repeated crash counts as blocking (design 9 C1). Full gate green
  at e5c5d9c (165 tests). The re-sweep found one fixed held-out set too noisy (up to 45 points per category by fold
  choice); owner rulings 2026-10-30 (later): 4 template folds with grouped cross-validation, lost work counts as
  loss, general price questions are Product Question (design c2e2e94); built in aef3607 (235 tests).
  Test cuts in this task: the smoke test, the 72-pair table, the RISK_ORDER constant row, the all-categories row,
  the polite-templates length line, two rng replay rows (each a second proof or no real use).
  Deferred: PR 2 trains and scores on text after the privacy masking step, because the kind of fake data
  (a card number, an order number) points at a category; PR 2 reports hand-written slices as k of n; PR 3 or 4
  decides which split the live stream scores against; PR 4 renders ticket text with textContent and
  white-space: pre-line, adds an XSS check, and passes text to string replace only through a function; bump Vite
  to 6.4.5 on or after 2026-11-04 (advisory GHSA-8g5g-mxqh-grgj, dev server only); after merge the owner adds a
  branch rule on main requiring the gate check.
