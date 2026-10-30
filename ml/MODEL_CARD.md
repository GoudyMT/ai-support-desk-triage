# Model Card: Ticket Triage Word-Weight Model

The accuracy numbers on this page are quoted from `ml/reports/eval.json`, written by `python -m triage.evaluate`;
CI re-derives that file on every push and fails if it changes. The parity, size and row counts come from the
commands named beside them.

## What it is

Two small classifiers that read a support ticket and suggest its **category** (9 classes) and **priority**
(4 classes). Each is a TF-IDF word and word-pair count fed to logistic regression (scikit-learn 1.9.1). The
fitted weights are exported to `web/src/model/model.json` and scored in TypeScript by
`web/src/model/scorer.ts`, which agrees with Python on every evaluation ticket (`npm --prefix web run parity`:
16,048 rows, largest probability gap 1.22e-15 when measured on 2026-10-30).

It is a suggestion for a human reviewer, not a decision. The live demo page, built next, will add rules and a
review step around it.

## Data

- **Training and test tickets are generated, not real.** A seeded generator (`web/src/generator/`) writes
  tickets from sentence templates, with obviously fake personal data in some of them. No customer data is used.
- **Masked before the model sees it.** Emails, phone numbers, order numbers and card numbers are replaced by
  `[EMAIL_ADDRESS]`, `[PHONE_NUMBER]`, `[ORDER_NUMBER]` and `[CARD_NUMBER]` (`web/src/privacy/mask.ts`). The
  live demo page will run the same masker on what a visitor types.
- **Hand-written set:** 48 tickets written outside the generator (`ml/data/handwritten.jsonl`): 8 from the
  project README and 40 drafted by Claude for this project, the same author as the generator templates. The set
  was frozen before the first training run and is never trained on. Because of the shared author it is a sanity
  check, not an independent test.

## How it is kept apart from its test sets

1. **Fold models (the measured numbers).** The templates are split into 4 folds. Each fold model trains on
   20,000 tickets from the other three folds' wording and is scored on 4,000 tickets of its own fold's wording.
   A held-out ticket whose text also appears in training is dropped at export, and training stops with an error
   if one is found again.
2. **Hand-written set.** No model trains on it. The export stops with an error if a hand-written text appears
   in any training file, and the evaluation checks again against the shipped model's training file.
3. **Shipped model.** It is fit on all wording (20,000 tickets) because live tickets use every template. It
   has seen the held-out templates, so the only number reported for it is on the hand-written set.

`eval.json` carries an `isolation` block naming, for each number, the model and the rows it was scored on.

## Results against v0

v0 is the original keyword-rule prototype, ported exactly (`web/src/baseline/v0.ts`) and run on the same tickets.

| Category accuracy | Model | v0 |
|---|---|---|
| Fold 0 | 2,325 / 4,000 (58.1%) | 1,312 / 4,000 (32.8%) |
| Fold 1 | 1,942 / 4,000 (48.6%) | 1,467 / 4,000 (36.7%) |
| Fold 2 | 2,496 / 4,000 (62.4%) | 1,193 / 4,000 (29.8%) |
| Fold 3 | 2,405 / 4,000 (60.1%) | 1,404 / 4,000 (35.1%) |
| Mean (population std) | 57.3% (5.3) | 33.6% (2.6) |
| Hand-written (shipped model) | 39 / 48 | 14 / 48 |

| Priority accuracy | Model | v0 |
|---|---|---|
| Mean over folds (population std) | 57.8% (3.8) | 46.3% (1.8) |
| Hand-written (shipped model) | 39 / 48 | 22 / 48 |

v0's review flag matches the gold flag on 67.6% of held-out tickets (mean) and 32 of 48 hand-written ones. The
model has no review flag of its own; the live page's review rules are built in a later step.

**The bar.** The project's bar is that the model beats v0 on category accuracy on every fold and on the
hand-written set: it does (`beats_v0_every_fold` and `beats_v0_handwritten` are true). The owner set this first
run as the floor: later changes may not lower any fold's category accuracy by more than 1 point or drop the
hand-written set below 39 of 48. Any later tuning should be judged on a separate tuning split, so the folds
stay a fair test of it.

## Limits

- **Unseen wording is hard.** About 4 in 10 held-out tickets get the wrong category, because a fold model has
  never seen its fold's sentence patterns. Fold 1 is the weakest at 48.6%.
- **Generated data.** The tickets come from templates, so real customers will phrase things the generator
  does not. The 48 hand-written tickets are the closest check, and 48 is a small sample.
- **The hand-written score is not explained yet.** The shipped model gets 39 of 48 (81%) hand-written tickets
  right against a 57.3% held-out mean. It has seen every template, the hand-written set shares an author with
  them, and 48 rows is a small sample; any of these could account for the gap, and none has been measured.
- **Words, not meaning.** The model counts words and word pairs; it does not understand negation or context.
- **Masking is pattern-based.** Some formats are still missed, for example an email typed with spaces around
  "@", a no-break space between card digits, an en dash in a phone number, a phone written with "/" or "_", or
  a phone that looks like a year-first date ("2010-12-31"). Long digit runs and 7+ digit ids are masked even
  when they are not personal data.
- **Size.** `model.json` is 3,825,908 bytes (about 1.4 MB gzipped).
