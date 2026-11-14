import { describe, expect, it } from 'vitest';
import type { Predict } from '../src/pipeline/run';
import { measureDirectRouting } from './measureDirectRouting';
import type { LabeledRow } from './measurePipeline';

// An angry customer the escalated-complaint rule flags and raises to High.
const ANGRY: LabeledRow = { id: 'T-1', text: 'This is unacceptable, my order never arrived', label: { category: 'Shipping/Order Issue', priority: 'High', mustReview: true } };

function says(category: string, priority: string, confidence: number): Predict {
  return (head) => {
    const label = head === 'category' ? category : priority;
    return { label, confidence, probabilities: { [label]: confidence }, topTerms: [] };
  };
}

describe('direct routing, as evidence for the next design', () => {
  // The point of the flow: a flagged ticket both models place, already urgent, skips triage.
  it('sends an agreed, rule-flagged High ticket straight to its department', () => {
    const c = measureDirectRouting([ANGRY], says('Shipping/Order Issue', 'High', 0.9), says('Shipping/Order Issue', 'High', 1));
    expect(c).toMatchObject({ today: 1, triage: 0, direct: 1, directRight: 1, directRisky: 1 });
  });

  // Doubt about where it goes keeps it in triage: the models disagree, or the word model is unsure.
  it('keeps it in triage when the models disagree or the word model is under 50% sure', () => {
    expect(measureDirectRouting([ANGRY], says('Shipping/Order Issue', 'High', 0.9), says('Billing', 'High', 1)).triage).toBe(1);
    expect(measureDirectRouting([ANGRY], says('Shipping/Order Issue', 'High', 0.3), says('Shipping/Order Issue', 'High', 1)).triage).toBe(1);
  });

  it('counts a wrong direct route by what flagged it', () => {
    const c = measureDirectRouting([ANGRY], says('Billing', 'High', 0.9), says('Billing', 'High', 1));
    expect(c).toMatchObject({ direct: 1, directRight: 0, wrongByRule: 1, wrongByDepartment: 0 });
  });
});
