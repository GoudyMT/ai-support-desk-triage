# Model Card: Ticket Triage Models

The desk runs two models. The **word model** decides what may leave without a person; it is unchanged from the first
release and is described first. The **sentence model** gives the suggestion a person sees on every ticket sent to
them, and checks the word model: a ticket leaves unchecked only when both give the same answer. It is described in
[The sentence model](#the-sentence-model).

The word model's accuracy numbers are quoted from `ml/reports/eval.json`, written by `python -m triage.evaluate`;
CI re-derives that file on every push and fails if it changes. The parity, size and row counts come from the
commands named beside them.

## What it is

Two small classifiers that read a support ticket and suggest its **category** (9 classes) and **priority**
(4 classes). Each is a TF-IDF word and word-pair count fed to logistic regression (scikit-learn 1.9.1). The
fitted weights are exported to `web/src/model/model.json` and scored in TypeScript by
`web/src/model/scorer.ts`, which agrees with Python on every evaluation ticket (`npm --prefix web run parity`:
16,048 rows, largest probability gap 1.22e-15 when measured on 2026-10-30).

It is a suggestion for a human reviewer, not a decision. The live desk adds rules and a review step around it.

## Data

- **Training and test tickets are generated, not real.** A seeded generator (`web/src/generator/`) writes
  tickets from sentence templates, with obviously fake personal data in some of them. No customer data is used.
- **Masked before the model sees it.** Emails, phone numbers, order numbers and card numbers are replaced by
  `[EMAIL_ADDRESS]`, `[PHONE_NUMBER]`, `[ORDER_NUMBER]` and `[CARD_NUMBER]` (`web/src/privacy/mask.ts`). The
  live desk runs the same masker on what a visitor types.
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
model has no review flag of its own: the rules and confidence floor in the pipeline decide what goes to a person.

**The bar.** The project's bar is that the model beats v0 on category accuracy on every fold and on the
hand-written set: it does (`beats_v0_every_fold` and `beats_v0_handwritten` are true). The owner set this first
run as the floor: later changes may not lower any fold's category accuracy by more than 1 point or drop the
hand-written set below 39 of 48. Any later tuning should be judged on a separate tuning split, so the folds
stay a fair test of it.

## On the desk

Counted over 40 full desk runs, seeds 2000 to 2039, with no one stepping in: the model alone gets the category right
58.2% of the time, and 94.5% after review. That second figure rests on a simulated reviewer assumed right 95% of the
time, not on people. 88.7% of tickets go to a person, and 30 high-risk tickets went out without one, in 17 of the runs.

On the 60-ticket set written blind and frozen before measuring, 0 of 24 high-risk tickets are missed. Two of its tickets
are near-matches, recorded rather than removed: F-19 shares an opening with a training template (word overlap 0.67), and
F-48 rewords seen ticket H-07. The first 48-ticket hand-written set shaped the rules, so it counts as seen for them.

## Limits

- **Unseen wording is hard.** About 4 in 10 held-out tickets get the wrong category, because a fold model has
  never seen its fold's sentence patterns. Fold 1 is the weakest at 48.6%.
- **Generated data.** The tickets come from templates, so real customers will phrase things the generator
  does not. The 48 hand-written tickets are the closest check, and 48 is a small sample.
- **The hand-written score is not explained yet.** The shipped model gets 39 of 48 (81%) hand-written tickets
  right against a 57.3% held-out mean. It has seen every template, the hand-written set shares an author with
  them, and 48 rows is a small sample; any of these could account for the gap, and none has been measured.
- **Words, not meaning.** The model counts words and word pairs; it does not understand negation or context.
- **Masking is pattern-based.** Some forms are still missed, for example an email spelled out
  ("jane at example dot com"), a phone written with "_", a short order reference ("order 123"), or a phone that
  looks like a year-first date ("2010-12-31"). Long digit runs, slash-written date ranges and 7+ digit ids are masked even when they are not
  personal data, and in text without spaces (Chinese, Japanese) the words joined to an email are masked with it.
- **Size.** `model.json` is 3,825,908 bytes (about 1.4 MB gzipped).

## The sentence model

Numbers in this part are quoted from the report files named beside them; CI works the two-model counts and the blind
reading out again from recorded answers on every push.

### What it is

A small sentence encoder, `sentence-transformers/all-MiniLM-L6-v2` (revision `1110a243`, Apache 2.0), trained on
20,000 generated tickets with two answer heads, category and priority: 2 epochs, learning rate 0.00002, batch 64, up to
256 word pieces (`ml/reports/bundle_v2.json`). It ships as an 8-bit ONNX file of 22,843,709 bytes with its tokenizer
(711,649 bytes) and heads (110,533 bytes), and runs in the visitor's browser; nothing is sent anywhere. The browser
downloads it only when the desk starts, and the desk can run on the word model alone.

### How the two models work together

The word model, its rules and its confidence floor decide first. A ticket they would let out leaves only if the sentence
model gives the same category and priority; otherwise it goes to a person. Every ticket sent to a person shows the
sentence model's answer, after the same safety rules, as the suggestion. When the two disagree, the card says so and
offers no quick Approve. So the second model can only send more tickets to a person, never fewer.

### Results

| | Word model | Sentence model | Source |
|---|---|---|---|
| Category right on wording it never saw (mean of 4 folds) | 57.3% | 83.9% (92.2, 81.2, 83.9, 78.3) | `eval.json`, `sentence_folds.json` |
| Priority right, same folds | 57.8% | 75.4% | `eval.json`, `sentence_folds.json` |
| Category right, hand-written set | 39 / 48 | 45 / 48 | `eval.json`, `bundle_v2.json` |
| Category right, blind set (2,000 tickets, read once) | 69.6% | 90.8% | `blind_reading.json` |

The fold numbers repeat the word model's test: each fold's sentence model trains on the other three folds' wording with
the shipped settings and is scored on its own (`python -m triage_v2.sentence_folds`).

**The blind reading** (`ml/reports/blind_reading.json`). 2,000 tickets in wording no model trained or was tuned on,
scored once after every model was frozen. The bar, written before the reading: on the tickets sent to a person, the
suggestion is right on category at least 10 points more often than the word model's answer, and no safety count is
worse. It was met:

| On the blind set | Word model alone | Both models |
|---|---|---|
| Suggestion right on category, tickets sent to a person | 1,031 / 1,640 (62.9%) | 1,456 / 1,640 (88.8%) |
| High-risk tickets out without a person | 61 | 38 |
| High or Urgent tickets out as Low or Medium | 36 | 0 |
| Out unchecked with the wrong category | 2 | 0 |
| Out unchecked with the wrong priority | 83 | 3 |
| Sent to a person | 1,556 | 1,640 |

Six blind templates share many 4-word runs with the training wording; without their 53 tickets the sentence model is
right on 90.5% and the word model on 68.7%.

**On the 60-ticket set written blind** (`ml/reports/two_model_sets.json`): 0 of 24 high-risk tickets missed, as
before, and 50 of 60 sent to a person, up from 47. **On the desk's own wording** (4,000 tickets): 83.3% sent to a
person, up from 79.6%; high-risk tickets out without a person 73, down from 83. **Cards with Approve**: 5.2 per desk
run, down from 6.8, since a card offers it only when both models agree (`sentence_folds.json`, worked out by
`web/src/history/sources.test.ts`).

### The 90-day runs

Two simulated 90-day runs retrained the sentence model each week on what a simulated reviewer fixed, judged by a mark
written before each run (`ml/reports/ninety_day.json`, `ml/reports/ninety_day_fair.json`). Neither passed. The last 30
days beat the stream's own first 30 days on 2 of 4 streams in the first run, and on 1 of 4 in the fair run, which kept
repeated wording out of the later weeks. The shipped model is not retrained live.

### Limits

- **More work for people.** The second model checks the first, so more tickets go to a person, not fewer. Whether a
  ticket needs a person is still decided by word rules and the word model's confidence, not by the better model. Four
  ways to cut those tickets were measured and not adopted: three let more high-risk tickets through, and one sent too
  many to the wrong team first:
  [`2026-11-14-routing-and-risk-note.md`](../docs/superpowers/specs/2026-11-14-routing-and-risk-note.md).
- **High-risk tickets still get through.** On the blind set 38 high-risk tickets left without a person, down from 61.
  The 0 of 24 on the 60-ticket set is a small sample.
- **Priority is weaker than category.** 75.4% on unseen wording; the safety rules, not the model, keep High and Urgent
  tickets from leaving as Low or Medium.
- **Generated data.** As with the word model, the tickets come from templates.
- **Typed control words are read as control words.** A ticket that contains "[SEP]", "[CLS]", "[PAD]", "[UNK]" or
  "[MASK]" passes them to the model as its own markers, as the Python tokenizer does, so the browser and Python agree.
  It can only change the answer on a visitor's own Try a ticket; generated tickets never hold them.
- **Machines can differ on near ties.** The browser's runtime gives a different answer from Python on Windows on 23 of
  4,000 desk tickets, each a close call; CI holds the browser to its own recorded answers
  (`ml/reports/bundle_v2_answers_web.json`). Python itself differs between Windows and Linux on 13 of the 4,000, as
  `NOTICE.md` beside the model records.
- **Size.** About 38.5 MB to download: the model files plus the browser runtime's 14.8 MB engine
  (`web/src/desk/sentenceLoader.ts`). In a simulated phone (Chromium with a Pixel 7 profile, not a real
  device), the desk took 38.5 s from Start to the run on fast 4G with the CPU slowed 4 times, and 80.2 s on slow 4G with
  it slowed 6 times.
