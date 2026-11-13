# Desk with Two Models - Wireframe (for the owner's lock)

**Date:** 2026-11-12. **Status:** LOCKED by the owner on 2026-11-12 ("Lets go with no border - lets go with the desk design"), from real screenshots of the desk now and with the change drawn in. **Part 2 design:** section 3.2. A real-data screenshot follows after the first visual unit is built (lesson L-05).

## What was locked (supersedes the choice at the end of this file)
- **A loading panel when Start is pressed** (the owner's idea): real download progress; the run starts once the sentence model has loaded, so every ticket of a run uses both models and the run's live numbers describe one rule. The intro and Try a ticket stay usable meanwhile. "Start now with the smaller model only" covers a slow link; a failed load says so and offers Retry and the same button. The model downloads only when Start is pressed, never on page open.
- **No border and no pulse:** the new parts use the desk's existing styles. The dashed outline in the screenshots only marked what was new.
- **The status phrase, the review card's added sentence and "Show both models' answers", and Try a ticket's "Person needed"** as drawn below.

## The job
The desk is a place to **operate**: a reviewer clears tickets. The new model changes one thing they act on: the suggested answer on the review card. Everything else stays as it is.

## Front stage vs on demand
| Front stage (seen at a glance) | On demand (one click) |
|---|---|
| The suggested category and priority, marked "(model's pick)" as today | Each model's own answer, behind "Show both models' answers" |
| Why the ticket came to you, one sentence, now also "The two models gave different answers." | |
| One short phrase after the run status saying which model suggests | |

## 1. The status line (bottom of the desk)
```
 130 made-up tickets, about 5 minutes   Suggestions: loading the larger model...
 130 made-up tickets, about 5 minutes   Suggestions: sentence model
 130 made-up tickets, about 5 minutes   Suggestions: word model only (the larger model did not load)
```
The run starts at once on the word model, as today.

> SUPERSEDED (2026-11-12): the run waits behind the loading panel, so the "loading" line never shows during a run; the "word model only" line shows after "Start now with the smaller model only" or a failed load - see "What was locked".

## 2. The review card (a ticket sent to you)
```
+--------------------------------------------------------------+
| Review this ticket                              [ High ]     |
| "I was charged twice for my plan this month and the second   |
|  charge is still pending..."                                 |
|                                                              |
| Why it came to you                                           |
| The ticket disputes a charge. The two models gave different  |
| answers.                                                     |
|   > Show both models' answers                                |
|       Word model:     Billing, Medium                        |
|       Sentence model: Billing, High   <- the suggestion      |
|                                                              |
| Category [ Billing (model's pick)  v]                        |
| Priority [ High (model's pick)     v]                        |
| Team     [ Billing team (model's pick) v]                    |
| Note for the team (optional) [                          ]    |
|                                                              |
| [ Looks good, send it ]  [ Hand back to the reviewer ]       |
+--------------------------------------------------------------+
```
- "(model's pick)" is the sentence model's answer once it has loaded; before that, the word model's, as today.
  > SUPERSEDED (2026-11-12): with the loading panel, every card of a two-model run shows the sentence model's pick; the word model's shows only in a "smaller model only" run - see "What was locked".
- An open card never changes under the reviewer.

## 3. Try a ticket
```
 Category        Billing
 Priority        High
 Team            Billing team
 Person needed   Yes (the two models gave different answers)
```
The Sort button reads "Loading..." the first time, while the larger model loads, as it does today for the word model.

> SETTLED (the owner, 2026-11-13, "Yes, I'm both"): Sort may start the larger model's download; it is still never downloaded on page open.

## The choice: what happens to tickets that arrive while the larger model loads
> SUPERSEDED (2026-11-12): the owner's loading panel replaces A, B and C - see "What was locked" at the top.

- **A. Switch at the next ticket (recommended).** Tickets that came in before it loaded run as today, word model only. From the first ticket after, both models run. Nothing on screen changes under the reviewer. Small.
- **B. Hold tickets that need a person until it loads.** Every card shows the new suggestion, but the start of the run can stall on a slow link. Moderate.
- **C. Fill an open card when the model arrives.** Shown for contrast only: it changes what the reviewer is reading, which the card's own rule forbids.
