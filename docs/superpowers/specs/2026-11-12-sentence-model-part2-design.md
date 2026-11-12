# Sentence Model, Part 2 - Design

**Date:** 2026-11-12. **Status:** approved by the owner on 2026-11-12 ("Yes"), with the 90-day pass mark of section 4 and the calls of section 7. **Builds on:** [`2026-11-10-sentence-model-design.md`](2026-11-10-sentence-model-design.md) and its Revision 1 (two models). Part 1 (offline: blind set, wording, bundle, two-model measurement) merged as PR #12.

## 1. Goal

The owner's words (2026-11-12): "I just want the model scores to go up, as well as the numbers going up". Part 2 puts the two-model rule on the desk, shows real growth over a simulated 90 days, reads the blind set once, and ships the model as a download. The two hard lines (High/Urgent sent out as low, high-risk missed) are never worse on any set.

## 2. What the owner locked for Part 2

| Date | Decision |
|---|---|
| 2026-11-12 | The 90-day run retrains the sentence model once per simulated week (13 retrains per stream, 52 in all). The CPU and GPU load is checked before every long run. |
| 2026-11-12 | The desk and Try a ticket switch to desk-only wording: the shipped word model is the gate, the sentence bundle gives the suggestion (as Part 1 measured). The demo page stays as it is (word model, fold wording); the fold files stay. |
| 2026-11-12 | The demo page moves to the new model in a later release, not this one. |

## 3. The parts

**3.1 The 90-day run (offline, the owner's GPU).** Four streams, one per held-out fold of the practice rounds. Each stream starts from a sentence model trained only on that round's training side, so the stream's wording is new to it.
- The stream's held-out templates are split into 13 weekly batches, spread across departments. Each simulated day brings tickets built only from the current week's batch, so every scored ticket uses wording the model has not been taught.
- Each ticket runs through the real pipeline (word gate, rules, review step). A ticket a person checked gets the reviewer's answer as its label. At the end of each week the model retrains on its training side plus every checked ticket so far.
- **A frozen control:** the same days' tickets are also scored by the stream's start model, never retrained. Weeks differ in difficulty, so growth is read as the gap between the retrained model and the frozen one on the same tickets.
- Every run goes through `ml/triage_v2/share_machine.py`, after a load check, on the owner's yes; the average and peak load are reported after.

> SUPERSEDED in part (2026-11-12): a run no longer starts on the word model while the bundle loads; Start opens a loading panel and the run begins once the bundle has loaded, with a "smaller model only" button and Retry - see [`2026-11-12-desk-two-models-wireframe.md`](2026-11-12-desk-two-models-wireframe.md) "What was locked".

**3.2 Both models on the desk.** The word model loads first, so the desk works at once (as today). The sentence bundle (23 MB model, 27 MB runtime, 0.7 MB tokenizer, measured 2026-11-10) loads only when a visitor starts the desk or types a ticket. How a suggestion that arrives after the gate's answer is shown is decided from a wireframe on the real screen before it is built (lesson L-05). If the bundle fails to load, the desk keeps working on the word model alone and says so in plain words; nothing is sent anywhere. Pages that do not score tickets load no model file.

**3.3 Close-match test.** The browser and Python score the same bundle on the same tickets; the browser's answers match the recorded ones within a limit written in the plan before the first run.

**3.4 One reading of the blind set.** After everything above is frozen, the blind set is scored once for every ladder row: today's word model, the sentence model alone, the two-model rule, and the model at the end of the 90-day run. It is reported with and without the tickets built from the 6 near-match templates. The reading is recorded in the repo and CI checks it, as with the other sets.

**3.5 What people see.** Model History gets the new rows and the 90-day line, from their source files, and says plainly that the share of tickets sent to a person went up. The model card, the matching guide pages and a download page (model file, card, load how-to, the base model's Apache 2.0 notice) follow. The Hugging Face page is prepared; posting it is the owner's act.

**3.6 Carry-overs on this branch.** The Part 1 sweep rows marked "DEFERRED Part 2"; T2-4, T2-6, T2-7, T2-8; H6b, H9, H10; the wider privacy mask.

## 4. Success

- **Release bar (Revision 1, unchanged):** on the blind set, read once, the suggestion is right on department at least 10 points more often than today's word model, and the two-model rule's four error counts are at or under today's on every set.
- **90-day pass mark (locked by the owner 2026-11-12; replaces the mark of the 2026-11-10 design, section 9):** in days 61-90 the retrained model's suggestion is right more often than the frozen control's on the same tickets, on at least 3 of 4 streams, and its own accuracy in days 61-90 is higher than in days 1-30 on at least 3 of 4 streams; neither hard line, counted over all 90 days, is worse than the frozen control's count on the same tickets on any stream. *Why the change:* the approved mark compared days 1-30 with days 61-90 alone; the weekly batches differ in difficulty, so a rise could come from easier late weeks. The control removes that. Written before any number.
- **Desk:** works before the bundle arrives; browser tests green on Linux CI; the owner's phone test passes (speed and memory are not measured yet).

## 5. Non-goals

The demo page's model; fewer tickets to a person (held for later work by the owner's word); retraining in the browser; a bigger model.

## 6. Risks and open questions

| Risk or question | Who settles it |
|---|---|
| Each stream has 93 to 95 held-out department templates (39 to 41 built-in, `templates.ts`; 54 extra, `extraFrames.ts`) plus the hard-case lists, so a weekly batch holds about 7, and not every department appears every week | The control comparison removes the difficulty gap; the plan's first check counts the templates per stream by script |
| The simulated reviewer picks a wrong department on 5% of the tickets it checks, on purpose (`web/src/pipeline/reviewer.ts:6`), so the retrains learn from slightly noisy labels | Kept: a real desk learns from human answers, mistakes included. Scoring is always against the true label |
| The gain over the frozen model may be small: the model may already generalize well | The pass mark, written first; Model History shows whatever comes out |
| Phone speed and memory with a 50 MB download | The owner's phone test, before release |
| The demo page has 16 bytes of size room; this design does not touch it | None needed |

## 7. My calls (say so if any is wrong)

1. Streams are the four practice folds, each starting from a model trained on its round's training side, not the shipped bundle, which has seen every stream's wording.
2. The 90-day end model is reported on the blind set as a ladder row; the shipped bundle on the site stays the Part 1 bundle, because the 90-day models each lack one fold's wording.
3. 100 tickets per simulated day per stream (9,000 per stream); by week 13 the training set holds the round's training side plus up to 9,000 checked tickets.
4. The label a retrain learns from is the simulated reviewer's answer (5% wrong department on purpose, priority always true); only tickets that went to a person are added, because an unchecked ticket has no person's answer. Every score in the run is against the true label.
5. Stream k starts from the practice round trained on `v2_tune_<k>_<k+1 mod 4>`; the other left-out fold's wording is not used in that stream.
6. Each weekly retrain starts again from the base model with the same Part 1 settings and `RANDOM_STATE = 113`, on the round's training side plus every checked ticket so far. Not carrying last week's model on keeps each week's model reproducible from its files.
7. The generator gets a way to build tickets from a chosen list of templates (it takes only a fold and side today, `templates.ts:26`); weeks are split by a seeded deal within each department, as the fold rule deals templates. Slot values (products, months) follow the stream's fold.
8. The TypeScript pipeline writes each week's tickets and answers to a file; Python trains on them; one script drives the 13 weeks per stream and can resume after a stop.
9. "Suggestion right" in the pass mark means the department, as in the release bar; priority and the two hard lines are reported beside it on every row.
10. The 90-day results and the blind reading are stored as report files in `ml/reports/` and checked by CI, as the Part 1 reports are; the exact keys are the plan's.
11. One branch (`feat/sentence-model-part2`), one sweep at the feature tier, one PR, one release.
