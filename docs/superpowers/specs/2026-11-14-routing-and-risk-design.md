# Design: Routing and Risk as Separate Jobs (the final version)

**Date:** 2026-11-14 (owner's clock, UTC-8)
**Status:** approved by the owner 2026-11-15; A built, B1 tried and not adopted
**Starts from:** `docs/superpowers/specs/2026-11-14-routing-and-risk-note.md`
**Branch:** `feature/routing-and-risk` (local)

## 1. Intent and why

The desk sends 3,333 of 4,000 desk tickets (83%) to the operator, but only 1,493 truly need a person. Routing got much
better in v1.1 (sentence model 90.8% department on the blind set), yet the operator's queue did not shrink, because one
queue serves two jobs: "where does this go" and "must a person handle this". The owner's words (2026-11-14): "our
guards and system arent aligned to my intent"; the final version "shows the correction with high accuracy and lowered
tickets to operator".

## 2. Goals

1. **Fewer operator cards with no safety line worse.** The operator sees a ticket only when the two models disagree
   on where it goes or how urgent it is. Measured: desk 3,333 -> 1,915 (section 9).
2. **Risk is a mark, not a wait.** A risky ticket goes straight to its team, marked "needs a person" and urgent.
3. **A risk detector of its own, on its own bar,** tried after the split is in, adopted only if it beats the split's
   own numbers (fewer false marks, every safety line no worse).
4. **The desk and Model History show it as measured,** including the costs.

## 3. Non-goals and anti-goals

- **Non-goals:** a better second opinion for routing (the word model's disagreement sets the card floor, about 48% of
  desk tickets; a separate version); the demo page (stays word-model, as in v1.1); retraining on the live site; the
  wider privacy mask (cut in Task 17).
- **Anti-goals (a failure even if cards fall):** any set with more risky tickets missed or more High/Urgent sent out
  as low than today; more wrong answers sent out unchecked than today; a bar changed after its numbers are seen; a
  number on the page that no script re-derives.

## 4. Constraints

- Hard lines with zero room on every set (owner, 2026-11-08 and 2026-11-15): risky missed; High/Urgent out as low.
- Unchecked wrong department and wrong priority: the existing allowance, 0.25% of a set rounded down, at least 1.
- Machine sharing (L-14): any training or bulk scoring runs through `ml/triage_v2/share_machine.py`, with a load check
  first and the owner's yes.
- Size limits (desk 64,960; demo 50,500; sentenceBytes 42,467,037): the size band rule applies; B's weights would be a
  measured ask, never an estimate.
- Spend: the owner is cost-conscious; inline work, no agent team unless asked.

## 5. What the owner decided

- 2026-11-14: routing and risk as separate jobs; triage only for routing doubt; risk a mark; a dedicated detector with
  its bar written first; catching High/Critical is non-negotiable.
- 2026-11-15: **risky** = threatening language, security incident, accessibility issue, billing dispute, escalated
  complaint. A **vague** ticket is routing doubt, not risk.
- 2026-11-15: the detector's bar: with the word rules, no more risky missed and no more High/Urgent out as low than
  today, on every set, zero room.
- 2026-11-15: option C: the split with today's signals as the mark first (A), then a learned detector (B) only if it
  beats A.
- 2026-11-15: a risky ticket that reaches the wrong team first is accepted as a counted line, capped at A's measured
  number. Owner: "it's a reality we have to accept."

## 6. The approach

**Part A, the split (no new model).** Per ticket, in order:

1. **Triage** (an operator card) when the word model and the sentence model, after the rules, disagree on the
   department or the priority, or when the only flag is the vague-ticket rule (vague = routing doubt).
2. Otherwise both agree. **Marked** when a word rule fires, the department is always checked (security,
   accessibility, urgent complaint), or the word model is under 50% sure. A marked ticket goes to the agreed team,
   marked "needs a person", its priority raised to at least High (owner, 2026-11-15).
3. Otherwise **direct**: to the agreed team, unmarked.

A triage ticket that carries a rule or checked-department flag keeps the mark after the operator routes it.

Every direct ticket in A is one today's desk also sends out unchecked, with the same answer, so each unchecked error
count equals today's by construction. A marked ticket has no operator check before its team, so its wrong team and
wrong priority are counted on their own lines (section 9); the team's person is its check.

**The path is explicit.** Each ticket's trail carries `path: 'triage' | 'marked' | 'direct'`; the engine's queue,
metrics, value saved, Try a ticket and the report read the path, never `guard.flagged` alone. **Without the sentence
model** (not loaded, or the viewer did not wait) the desk keeps the v1.1 one-model flow: every flagged ticket is an
operator card. The v1.1 flow stays as its own function, so Model History's v1.1 replays and the demo page are
unchanged.

**Part B, the risk detector.** A small yes/no model for "risky" (the five reasons), trained on the training side only.
It replaces the 50% floor in step 2: marked = a word rule, a checked department, or the detector. Per fold it is
trained, and its threshold set, without that fold's held-out tickets; the threshold rule is written in the plan before
any B number. A ticket with no detector score is marked (fails closed). Two candidates:
- **B1:** word features, logistic regression, like `model.json`. CPU only, seconds, no download.
- **B2:** a linear layer on the sentence model's frozen sentence vectors. Reuses the shipped ONNX file; one capped
  embedding pass on the owner's yes.

Which candidate is judged is chosen on the tuning side only; the seven sets judge exactly one candidate, once.

Rejected: lifting the floor on agreement (failed its bar on 3 of 4 folds, note); narrowing the escalated-complaint
rule (every busy word is the only catch for some risky tickets, note); a jointly trained third head (0 of 12 rounds,
Part 1 Task 6; it failed where the department was wrong, which B avoids by never reading the department).

## 7. Requirements

**Must**
- M1. The desk's flow is A: triage, marked, direct.
- M2. A measurement script, in the repo and re-run in CI, prints per set: cards, marked (risky / not), false marks,
  marked to the wrong team first (all, and risky), marked wrong priority, High/Urgent out as low over marked plus
  direct, risky missed, vague sent direct, unchecked wrong department and priority, today beside each. CI fails if a
  re-run differs from the record **and** if any hard line or unchecked wrong count is above today's in the same run.
- M2b. One "risky" definition (the five reasons) is used by M2, the desk's live counter and the new Model History
  row; the v1.1 rows keep their own must-review counts, labelled as such.
- M3. The desk shows a marked ticket in Sent to teams with a visible "needs a person" mark; the operator queue holds
  only triage tickets.
- M4. Model History gets a row for the split, every number from the M2 record; the row order and its "current row"
  test change on purpose; the desk page's share sentence reads the M2 record.
- M5. B is built, measured against A's numbers and the bar in section 9, and adopted or recorded as not adopted.

**Should**
- S1. The Try a ticket panel says which of the three paths a typed ticket took, and why.
- S2. The README and guide pages describe the two jobs.

**Later**
- A stronger second routing opinion, so triage can fall below about 48%.

## 8. Acceptance criteria

- Given a ticket where the models disagree on department or priority, then it is a triage card, whatever the rules
  say.
- Given both models agree and a word rule fires, then it goes to the agreed team marked "needs a person", and no
  operator card appears.
- Given both agree on Security Concern at Medium (truth Urgent), then it is marked and shown at High or above, and
  M2 does not count it as High/Urgent out as low.
- Given the only flag is the vague-ticket rule, then it is a triage card.
- Given a disagreeing threatening ticket, when the operator routes it, then it reaches Sent to teams with the mark.
- Given both agree, no rule, a non-checked department and the word model at or above 50%, then it goes direct,
  unmarked.
- Given no sentence model, then the open list equals v1.1's for the same tickets.
- Given a marked risky ticket, then it is not counted missed, not in the operator queue, not counted as value saved,
  and shows the mark.
- Given the demo page's run, then its output is byte-equal to v1.1's.
- Given a detector that throws, then the ticket is marked.
- Given the seven sets, then the M2 record matches a re-run, and no hard line or unchecked wrong count is above
  today's.
- Must NOT happen: a marked ticket shown as an operator card; a risky ticket counted as handled when it went
  unmarked; a page number not read from the record.

## 9. Success criteria

**A, measured 2026-11-15 on saved answers** (scratch probe; M2 makes it a repo script):

With vague-only to triage and the mark raising priority to at least High. High/Urgent out as low counts marked and
direct tickets; unchecked wrong department / priority (direct only) is unchanged from today on every set.

| Set | Cards today -> A | Risky missed | H/U out low | Marked (false) | Marked wrong team (risky) | Marked wrong priority | Vague direct |
|---|---|---|---|---|---|---|---|
| Desk 4,000 | 3,333 -> 1,915 | 55 -> 55 | 0 -> 0 | 1,418 (691) | 301 (123) | 509 | 18 |
| Fold 0 | 3,688 -> 2,523 | 0 -> 0 | 0 -> 0 | 1,165 (578) | 30 (8) | 319 | 0 |
| Fold 1 | 3,588 -> 2,313 | 4 -> 4 | 0 -> 0 | 1,275 (654) | 357 (57) | 679 | 0 |
| Fold 2 | 3,546 -> 2,313 | 3 -> 3 | 5 -> 5 | 1,233 (684) | 31 (26) | 430 | 3 |
| Fold 3 | 3,657 -> 2,539 | 0 -> 0 | 0 -> 0 | 1,118 (754) | 132 (16) | 471 | 23 |
| Hand-written 48 | 36 -> 18 | 0 -> 0 | 0 -> 0 | 18 (6) | 1 (1) | 2 | 0 |
| Fresh 60 | 50 -> 24 | 0 -> 0 | 0 -> 0 | 26 (11) | 1 (0) | 9 | 0 |

Without the raise, marked tickets left High/Urgent truth at a low priority: fold 2 73, fold 3 114 (plan check P1).

**A passes** when the repo script reproduces these counts exactly.

**B's bar, written before any B number:** on every one of the seven sets, against A: risky missed not higher;
High/Urgent out as low not higher; marked to the wrong team first (all, and risky) not higher; vague sent direct not
higher; unchecked wrong department and priority within the allowance; **and** false marks lower on every set. Fail any
line on any set, and B is not adopted; the result is recorded as measured. A B that marks no vague ticket must fail
(a named test). A passing B is then judged once on a new blind set.

## 10. Risks and open questions

- Decided 2026-11-15: B's go / no-go is on the seven sets; a new blind set is written only if B passes.
- Decided 2026-11-15: the mark raises priority to at least High (stops marked High/Urgent sitting low, fold 3:
  114 -> 0; false marks show as High, desk marked wrong priority 328 -> 509).
- Decided 2026-11-15: marked tickets reaching the wrong team first are counted in all (desk 301, 123 of them risky;
  fold 1 357), capped at A's number.
- Non-blocking: the 55 billing disputes today misses on the desk stay missed in A (equal by construction). B may
  catch some; the bar does not need it to.
- Risk: B1 may not reach the floor's catches on unseen wording (the floor catches 30 to 105 risky tickets per fold
  that no rule sees). Cheapest test: B1 first, seconds on CPU.
- Risk: the desk wireframe. The mark is a visual change; a wireframe in the real screens comes before any UI code.

## 11. Left to the builder

File layout of the flow function; script names; test fixture shape; the mark's exact copy after the wireframe lock.

## 12. My calls (check these)

- Triage on any priority disagreement, not only the High/Urgent band: the band-only version raised unchecked wrong
  priority on fold 3 from 2 to 47.
- The marked ticket's team is the agreed department.
- A ticket whose only flag is the vague rule goes to triage (owner's lock: vague is routing doubt); desk cards
  1,857 -> 1,915.
- B replaces only the floor in the mark; the word rules and checked departments stay.
- The candidate (B1 or B2) is picked on the tuning side; B1 is tried first, for cost.
- Model History gets one new row for A, and one for B only if adopted.

## 13. Plan gap check (2026-11-15, one read-only agent, 11 findings)

| Id | Sev | How taken |
|---|---|---|
| P1 marked tickets drop out of the error counts | high | measured; M2 counts them; raise to High (owner's call) |
| P2 vague breaks the lock, falls out of the lines | high | vague-only to triage; vague direct counted; M2b |
| P3 B passes by dropping vague | high | B bar line + named test |
| P4 one flag, two meanings | high | explicit `path`; acceptance tests |
| P5 mark lost after triage | high | the mark rides through triage; test |
| P6 one-model desk undefined | medium | v1.1 flow kept; test |
| P7 B trained on judged folds | medium | per-fold training and threshold |
| P8 two tries at one judge | medium | candidate picked on tuning side |
| P9 CI checks only reproduction | medium | CI also asserts the lines |
| P10 shared flow rewrites v1.1 history | medium | v1.1 flow kept; M4 |
| P11 B with no score | low | fails closed; test |
