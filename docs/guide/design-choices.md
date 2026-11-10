# Design Choices

Six decisions shaped the desk. Each card shows the question, the options, the pick, and what was measured once it was
built. Green is the path taken. Amber is what it cost.

## 1. Keywords or a trained model?

The course prototype sorted tickets with keyword rules. The question was whether a model trained on examples would
do better on wording it had never seen.

```mermaid
flowchart TD
    Q["<b>The question</b><br/>How should the desk decide<br/>what a ticket is about?"]
    Q --> A["<b>Keyword rules</b><br/>The course prototype.<br/>Misses any wording<br/>it has no rule for."]
    Q --> B["<b>A small trained model</b><br/>Learns word patterns from examples.<br/>Keyword rules stay on as guardrails."]
    A --> RA["<b>Measured</b><br/>33.6% right on unseen wording<br/>14 of 48 hand-written tickets"]
    B --> RB["<b>Measured</b><br/>57.3% right on unseen wording<br/>39 of 48 hand-written tickets"]
    RB --> C["<b>Cost</b><br/>a 1.4 MB download<br/>and a training step"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A,RA off
    class B,RB pick
    class C cost
```

**Outcome:** about 1.7 times as many right answers. The model is a simple, well known type (word counts into logistic
regression) because it is quick to train, runs in a browser and can show which words drove each answer. Numbers:
[`MODEL_CARD.md`](../../ml/MODEL_CARD.md#results-against-v0).

## 2. In the browser, or on a server?

```mermaid
flowchart TD
    Q["<b>The question</b><br/>Where should the model run?"]
    Q --> A["<b>A server calling a<br/>large language model</b><br/>Could read new wording better."]
    Q --> B["<b>In the visitor's browser</b><br/>A small model file,<br/>no server at all."]
    A --> RA["<b>Would need</b><br/>an API key, a running cost,<br/>and visitors' text sent away"]
    B --> RB["<b>Result</b><br/>no keys, no cost,<br/>nothing typed leaves the page"]
    RB --> C["<b>Cost</b><br/>a model that counts words<br/>instead of reading meaning"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A,RA off
    class B,RB pick
    class C cost
```

**Outcome:** the site is static and free to host. The model file's size is checked on every change so the page stays
quick on a phone ([`size-budgets.json`](../../web/size-budgets.json)). A small pretrained sentence model in the
browser was kept as a later option; it would add about 23 MB.

## 3. Hide personal details before the model reads them?

```mermaid
flowchart TD
    Q["<b>The question</b><br/>Should the model ever see<br/>emails, phones or card numbers?"]
    Q --> A["<b>Let it read the raw text</b><br/>Nothing to build."]
    Q --> B["<b>Mask first</b><br/>Pattern rules swap common forms<br/>for labels like [CARD_NUMBER]."]
    B --> RB["<b>Result</b><br/>the model and its training data<br/>never hold the forms it catches"]
    RB --> C["<b>Limit</b><br/>names and street addresses are not hidden;<br/>unusual forms slip through"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A off
    class B,RB pick
    class C cost
```

**Outcome:** the same masker runs on training data and on anything a visitor types. Its known misses are listed in the
[model card](../../ml/MODEL_CARD.md#limits), not hidden.

## 4. Who decides when a ticket needs a person?

This is the choice with the biggest trade-off. Sending more tickets to a person is safer but saves less work.

```mermaid
flowchart TD
    Q["<b>The question</b><br/>What sends a ticket to a person?"]
    Q --> A["<b>The model alone</b><br/>Flag only when it is unsure."]
    Q --> B["<b>Rules first, then the model</b><br/>Six safety rules, three must-review<br/>categories, and a 50% floor."]
    B --> RB["<b>Result</b><br/>0 of 24 high-risk tickets missed<br/>on the set written blind"]
    RB --> C["<b>Cost</b><br/>about 9 in 10 live tickets<br/>still go to a person"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A off
    class B,RB pick
    class C cost
```

**Outcome:** safety came first, with a known gap. The blind set is small: 24 high-risk tickets. On the four larger test
rounds, 72 of 5,856 high-risk tickets (1.2%) got past every check
([design spec, section 6](../superpowers/specs/2026-10-29-v1-triage-demo-design.md#6-success-charter)), and across 40
full live runs, 30 did, in 17 of the runs ([`MODEL_CARD.md`](../../ml/MODEL_CARD.md#on-the-desk)). Cutting
the share sent to a person without losing safety became the next version's goal. That story is in
[The version that did not ship](the-version-that-did-not-ship.md).

## 5. How do we know the numbers are honest?

```mermaid
flowchart TD
    Q["<b>The question</b><br/>How should the model be tested?"]
    Q --> A["<b>Test on tickets like<br/>the ones it trained on</b><br/>Easy, and flattering."]
    Q --> B["<b>Test on wording it never saw</b><br/>Four rounds, plus 60 tickets<br/>written blind and frozen first."]
    A --> RA["<b>Would show</b><br/>a high score that<br/>real tickets would not match"]
    B --> RB["<b>Result</b><br/>57.3%, the number we report.<br/>CI retrains and re-checks it<br/>on every change."]
    RB --> C["<b>Limit</b><br/>each test set can only be<br/>read so many times"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A,RA off
    class B,RB pick
    class C cost
```

**Outcome:** the published numbers come from a file CI rebuilds on every push, and the check fails if anyone edits
them by hand ([`ci.yml`](../../.github/workflows/ci.yml)). The limit matters: every time a test set guides a choice,
it becomes a little less of a fair test. The update that did not ship read the test rounds six times, so the next try
needs a new test stream.

## 6. A perfect reviewer, or a realistic one?

```mermaid
flowchart TD
    Q["<b>The question</b><br/>How should the simulated<br/>person behave?"]
    Q --> A["<b>Always right</b><br/>Simple, and every flagged<br/>ticket ends up correct."]
    Q --> B["<b>Right 95% of the time</b><br/>Closer to a real person."]
    A --> RA["<b>Would show</b><br/>every flagged ticket fixed,<br/>which no desk can promise"]
    B --> RB["<b>Result</b><br/>94.5% right after review<br/>over 40 full runs"]
    RB --> C["<b>Limit</b><br/>the 95% is an assumption,<br/>not a measured person"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class A,RA off
    class B,RB pick
    class C cost
```

**Outcome:** the after-review number is labelled as resting on that assumption wherever it appears
([`reviewer.ts`](../../web/src/pipeline/reviewer.ts), [`MODEL_CARD.md`](../../ml/MODEL_CARD.md#on-the-desk)).
