import { describe, expect, it } from 'vitest';
import type { Predict } from '../src/pipeline/run';
import { measureDirectRouting, whySent } from './measureDirectRouting';
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

  // The routing note's table comes from these counts: each ticket sent to a person is named once, by its first reason.
  it('names each ticket sent to a person by its first reason, and counts the ones that did not need one', () => {
    const calm: LabeledRow = { id: 'T-3', text: 'Hello, the settings page shows the wrong time zone.', label: { category: 'Technical Issue', priority: 'Low', mustReview: false } };
    const risky: LabeledRow = { ...calm, id: 'T-4', label: { ...calm.label, mustReview: true } };
    const ruled = whySent([ANGRY], says('Shipping/Order Issue', 'High', 0.9), says('Shipping/Order Issue', 'High', 1));
    expect(ruled).toMatchObject({ sent: 1, mustReview: 1, rule: { sent: 1, notNeeded: 0 }, escalated: { fires: 1, notNeeded: 0 } });
    const department = whySent([calm], says('Accessibility Support', 'Low', 0.9), says('Accessibility Support', 'Low', 1));
    expect(department).toMatchObject({ sent: 1, department: { sent: 1, notNeeded: 1 } });
    const unsure = whySent([calm, risky], says('Technical Issue', 'Low', 0.3), says('Technical Issue', 'Low', 1));
    expect(unsure).toMatchObject({ sent: 2, unsure: { sent: 2, notNeeded: 1, riskyOnlyHere: 1 } });
    const split = whySent([calm], says('Technical Issue', 'Low', 0.9), says('Billing', 'Low', 1));
    expect(split).toMatchObject({ sent: 1, disagree: 1 });
    expect(whySent([calm], says('Technical Issue', 'Low', 0.9), says('Technical Issue', 'Low', 1)).sent).toBe(0);
  });

  // No rule cue: only the always-checked department sent it to a person, so a wrong route is the department's.
  it('counts a wrong direct route flagged only by its department as the department', () => {
    const quiet: LabeledRow = { id: 'T-2', text: 'Hello, the settings page shows the wrong time zone.', label: { category: 'Technical Issue', priority: 'High', mustReview: false } };
    const c = measureDirectRouting([quiet], says('Accessibility Support', 'High', 0.9), says('Accessibility Support', 'High', 1));
    expect(c).toMatchObject({ direct: 1, directRight: 0, wrongByRule: 0, wrongByDepartment: 1 });
  });
});
