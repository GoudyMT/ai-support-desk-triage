# Technical Guide

These pages explain how the support desk works, why it was built the way it was, and what each choice led to. They are
written for anyone, not only engineers. Each big decision has a small diagram: the question, the options, the pick, and
what was measured afterwards.

| Page | Read it to learn |
|---|---|
| [How it works](how-it-works.md) | One ticket's trip from arrival to its team, and where the model comes from |
| [Design choices](design-choices.md) | The six decisions that shaped the desk, each with its measured result |
| [The version that did not ship](the-version-that-did-not-ship.md) | A model update we tested hard and chose not to release, and why |
| [Reading the numbers and upkeep](reading-the-numbers.md) | What each number on the desk means, where it comes from, and the routine checks |

## How to read the diagrams

```mermaid
flowchart LR
    Q["Blue: the question"] --> O["Grey: an option not taken"]
    Q --> P["Green: the option taken"]
    P --> R["Amber: a cost or a limit"]
    classDef q fill:#ddf4ff,stroke:#0969da,color:#1f2328
    classDef off fill:#f6f8fa,stroke:#8c959f,color:#57606a
    classDef pick fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328
    classDef cost fill:#fff8c5,stroke:#9a6700,color:#1f2328
    class Q q
    class O off
    class P pick
    class R cost
```

Every number in these pages links to the file it comes from. When a number changes, that file changes first.
