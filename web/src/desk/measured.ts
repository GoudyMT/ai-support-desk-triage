// The three numbers the desk shows before Start. Each is a measurement, not a run; a later change moves them to
// a data file the build checks against CI's own measurement.

// The fresh hand-written set: 60 tickets written blind to the rules and the model, 24 of them must-review. Source:
// the parent design (2026-10-29-v1-triage-demo-design.md) section 6, "0 missed of 24 must-review, 78% flagged".
export const HIGH_RISK_MISSED = '0 of 24';
export const SENT_TO_PERSON = '78%';

// The frozen hand-written set of 48 tickets: the model's category right on 39, the old keyword method on 14.
// Source: ml/reports/eval.json, "handwritten" model_category.k and v0_category.k.
export const HAND_WRITTEN_RIGHT = '39 of 48';
export const KEYWORD_RIGHT = 14;
