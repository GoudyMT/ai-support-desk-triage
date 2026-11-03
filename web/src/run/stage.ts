// The six stages a live ticket passes through, in the order the page lights
// them. The run engine steps through them and the narration speaks for each.
export const STAGES = ['intake', 'privacy', 'classify', 'guardrails', 'review', 'done'] as const;

export type Stage = (typeof STAGES)[number];
