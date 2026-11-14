---
license: apache-2.0
language:
  - en
base_model: sentence-transformers/all-MiniLM-L6-v2
pipeline_tag: text-classification
library_name: onnx
tags:
  - support-tickets
  - triage
  - onnx
  - int8
---

# Support Ticket Triage (sentence model)

A small model that reads a support ticket and suggests its **category** (9 classes) and **priority** (Low, Medium,
High, Urgent). It is the suggestion half of a two-model support desk demo: a simple word model and safety rules decide
what may leave without a person, and this model checks them and suggests an answer for every ticket a person sees.

- Source, method and every measurement: [GitHub repository](https://github.com/GoudyMT/ai-support-desk-triage)
- Live demo: [the support desk](https://goudymt.github.io/ai-support-desk-triage/)
- Full model card, with limits: [`ml/MODEL_CARD.md`](https://github.com/GoudyMT/ai-support-desk-triage/blob/main/ml/MODEL_CARD.md)

## What is in this repository

| File | What it is |
|---|---|
| `model_quantized.onnx` | The sentence encoder, fine-tuned and saved as 8-bit ONNX (22.8 MB) |
| `tokenizer.json` | The encoder's tokenizer |
| `heads.json` | Two linear heads, category and priority, applied to the sentence vector |
| `manifest.json` | The token limit (256) |

The base model is `sentence-transformers/all-MiniLM-L6-v2` (revision `1110a243`), under the Apache 2.0 license. It was
trained here on 20,000 generated tickets for 2 epochs.

## Use

Mask personal data first (emails, phone, order and card numbers): the model was trained on masked text.

```python
import json

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

folder = "bundle_v2"  # the downloaded model folder
manifest = json.load(open(f"{folder}/manifest.json"))
heads = json.load(open(f"{folder}/heads.json"))
tokenizer = Tokenizer.from_file(f"{folder}/tokenizer.json")
tokenizer.enable_truncation(max_length=manifest["max_length"])
session = ort.InferenceSession(f"{folder}/model_quantized.onnx", providers=["CPUExecutionProvider"])


def triage(text):
    """Returns the suggested category and priority for one ticket, with each one's probability."""
    encoded = tokenizer.encode(text)
    feeds = {
        "input_ids": np.array([encoded.ids], dtype=np.int64),
        "attention_mask": np.array([encoded.attention_mask], dtype=np.int64),
        "token_type_ids": np.array([encoded.type_ids], dtype=np.int64),
    }
    wanted = {item.name for item in session.get_inputs()}
    hidden = session.run(None, {k: v for k, v in feeds.items() if k in wanted})[0]
    # Mean of the token vectors, then unit length: the sentence vector the heads were trained on.
    vector = hidden[0].mean(axis=0)
    vector /= max(np.linalg.norm(vector), 1e-12)
    answer = {}
    for field, head in heads.items():
        scores = np.array(head["weight"], dtype=np.float32) @ vector + np.array(head["bias"], dtype=np.float32)
        probs = np.exp(scores - scores.max())
        probs /= probs.sum()
        answer[field] = (head["classes"][int(probs.argmax())], round(float(probs.max()), 3))
    return answer


print(triage("I was charged twice for my subscription this month and need a refund."))
# {'category': ('Billing', 0.209), 'priority': ('Medium', 0.358)}
```

The probabilities are flat: read the top answer, not the percent. In the demo, confidence comes from the word model.

## Results

All tickets below are in wording the model never trained on.

| Test | Word model | This model |
|---|---|---|
| Category right, 4 held-out folds of wording (mean) | 57.3% | 83.9% |
| Category right, 2,000 blind tickets read once | 69.5% | 90.8% |
| Category right, 48 tickets written for the project | 39 of 48 | 45 of 48 |

Used as a check beside the word model on the blind tickets, the suggestion a person sees was right on the category
88.8% of the time (62.9% before), and High or Urgent tickets sent out as Low or Medium fell from 36 to 0. More tickets
went to a person (1,640 of 2,000, up from 1,556), and 38 high-risk tickets still got past both models.

## Limits

- **Generated data.** Every training and test ticket comes from templates; real customers write differently.
- **Not a decision maker.** It is built to suggest, with a person and safety rules in charge.
- **Priority is weaker than category:** 75.4% right on held-out wording.
- **English only, 256 word pieces;** a longer ticket is cut.
