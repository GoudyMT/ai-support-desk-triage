# The Version That Did Not Ship

After version 1.0, the next goal was simple to say: **send fewer tickets to a person.** About 9 in 10 live tickets
were going to a person, so the desk saved little work. We tested many ways to cut that share. None of them met the
safety rule we set first, so we kept the current model. This page explains how we got to that decision.

## The rule

Fewer tickets for a person is only worth it if the risky ones still reach a person. So, before the first test, we
wrote the bar down. On every test set, a new model must not:

- miss more high-risk tickets (the ones a person must see),
- give more wrong answers that nobody checks,
- be right less often.

After the first wording results, one more line was added, and it is never traded away:

- never send more High or Urgent tickets out unchecked as Low or Medium.

A model that cut flags but broke any line on any one set would fail. The full plan:
[`2026-11-08-fewer-flags-plan.md`](../superpowers/specs/2026-11-08-fewer-flags-plan.md).

## The path, step by step

```mermaid
flowchart TD
    S["<b>Goal</b><br/>fewer tickets to a person,<br/>safety rule written first"] --> G["<b>Step 1: a stricter check</b><br/>CI now counts unchecked wrong<br/>answers on every set"]
    G --> D["<b>Step 2: the deciding test</b><br/>36 candidates: other model types,<br/>two models working together,<br/>new settings, new guards"]
    D --> DR["None passed the rule"]
    DR --> W["<b>More ticket wording</b><br/>teach the model more ways<br/>people phrase things"]
    W --> WR["Much safer, but no fewer flags.<br/>With a High/Urgent guard added:<br/>4% more flags, and the High/Urgent<br/>count slipped on two sets."]
    WR --> L["<b>A learning loop</b><br/>retrain on the answers<br/>a person checked"]
    L --> LR["51% fewer tickets to a person<br/>in a first simulation"]
    LR --> C["<b>The deciding check</b><br/>Does it learn new wording,<br/>or only remember checked tickets?"]
    C --> CR["It only remembered.<br/>It passed on 0 of 4 streams."]
    CR --> E["<b>Decision</b><br/>keep the current model,<br/>release nothing"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    classDef stop fill:#ffebe9,stroke:#cf222e,color:#1f2328
    class S,D,W,L,C q
    class G,E pick
    class LR cost
    class DR,WR,CR stop
```

Red marks a result that failed the rule. Amber marks a result that looked good but still had to pass a check. Green marks what we kept: the stricter check (it shipped and now guards every
change) and the final decision.

## What each step found

### Step 2: a better model gave fewer wrong answers, not fewer flags

We tried 36 candidates in three rounds. Before any of them, we checked that our test setup gave exactly today's numbers
when run on today's model. It did. Then:

| What we tried | What happened |
|---|---|
| Other model types (naive Bayes, ridge, linear SVM) | Some were right more often, but each broke the rule on at least one set |
| Two models working together, each handling the categories it is best at | Far fewer unchecked wrong answers (77 to 15 on one set), but more tickets to a person |
| New settings for today's own model | Failed by one missed ticket on one set |

The last row matters. Even today's own model, with only its settings moved, failed the rule by a single ticket. A rule
with zero room on every set punishes any change, including a harmless one.

### More wording: safer, not leaner

Writing more ways to phrase each kind of ticket made the model much safer: on the four test rounds, missed high-risk
tickets fell from 71 to 16. But it sent about as many tickets to a person as before, it broke the rule on one round
and on the hand-written set, and it let one more High or Urgent ticket out low on two sets.

Adding a guard for High and Urgent tickets fixed that last problem: misses fell further and the High/Urgent line held
on every set. The cost was 4% more tickets to a person, the opposite of the goal. And when the final version of the
wording was scored once more, the guard's chosen setting let more High or Urgent tickets out low on two rounds. That
broke the rule.

### The learning loop: memory, not learning

The most promising idea was to let the desk learn from the person who checks it. Every flagged ticket gets a correct
answer from a person; a model that keeps retraining on those answers should need a person less over time.

```mermaid
flowchart LR
    T["Tickets arrive"] --> F["Model flags<br/>the unsure ones"]
    F --> P["A person checks<br/>and corrects them"]
    P --> N["Every 500 tickets the model<br/>retrains on those answers"]
    N --> T
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    class T,F,N q
    class P pick
```

In a first simulation on practice tickets (kept apart from the test sets), tickets sent to a person fell by 51% and
every safety count improved. That looked like the answer. But the generator repeats its wording, so the model might
only be remembering sentences it had already seen checked. We wrote a check for that, with its pass mark, before
building anything: teach the model from half the ticket templates, then measure it only on the other half.

| Practice stream | Tickets to a person, model never learns | Model learns from the other half |
|---|---|---|
| Fold 0 | 1,133 | 1,143 |
| Fold 1 | 934 | 940 |
| Fold 2 | 895 | 912 |
| Fold 3 | 1,213 | 1,183 |

On new wording it flagged more on three of the four streams. The one that flagged less sent one more High or Urgent
ticket out low. So no stream passed, and the 51% was memory of checked wording, not learning. By the pass mark written
before the check, the plan stopped there.

## What we kept, and what comes next

- **Kept:** the current model, and the stricter CI check from Step 1. Every future change is held to the same counts.
- **Learned:** a better word-counting model buys fewer wrong answers, not fewer flags. The next lever is a model that
  reads new wording better, such as a small pretrained sentence model.
- **Needed first:** a fresh test stream. These test sets were read six times while choosing, so they are no longer a
  fair test for the next try.

Stopping here is the result, not a failure to finish. Each bar was written down before the numbers it judged came in,
and the numbers did not meet it.
