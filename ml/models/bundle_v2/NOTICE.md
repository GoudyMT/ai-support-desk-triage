# Notice for the sentence model bundle

The files in this folder are a trained copy of the sentence model
[`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2),
which its authors publish under the Apache License, Version 2.0
(<https://www.apache.org/licenses/LICENSE-2.0>).

## What was changed

- The model's weights were trained further on this project's generated support tickets
  (`ml/triage_v2/train_sentence.py`), then stored with 8-bit weights in ONNX form
  (`model_quantized.onnx`, written by `ml/triage_v2/export_onnx.py`).
- `tokenizer.json` is the original model's tokenizer with its length settings changed: it cuts a
  ticket at 256 tokens and pads a batch to its longest ticket, where the published file cuts and pads
  at 128. The word list is the original's.
- `heads.json` and `manifest.json` are this project's own: the weights that turn a sentence vector
  into a category and a priority, and the token limit.

The exact published version trained from is revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41` of the
model above. A copy of the license is in `LICENSE` beside this file.

The training tickets are generated and fictional; no customer data was used.
`ml/reports/bundle_v2.json` records the bundle's fingerprint, its training settings and its scores.
