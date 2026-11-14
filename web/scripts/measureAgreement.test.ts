import { describe, expect, it } from 'vitest';
import type { Predict } from '../src/pipeline/run';
import { judge, measureAgreement } from './measureAgreement';
import type { LabeledRow } from './measurePipeline';

// A plain question the rules leave alone, and a hacked account the security rule always sends to a person.
const PLAIN: LabeledRow = { id: 'T-1', text: 'Where can I change the email on my invoices?', label: { category: 'Billing', priority: 'Low', mustReview: false } };
const SECURITY: LabeledRow = { id: 'T-2', text: 'Someone hacked my account and changed my password', label: { category: 'Security Concern', priority: 'Urgent', mustReview: true } };

// A scorer that answers one department and priority, as sure as told.
function says(category: string, priority: string, confidence: number): Predict {
  return (head) => {
    const label = head === 'category' ? category : priority;
    return { label, confidence, probabilities: { [label]: confidence }, topTerms: [] };
  };
}

describe('lifting the floor when both models agree', () => {
  // The point of the change: an unsure word model no longer sends a ticket both models answer the same way.
  it('lets out a ticket only the floor flagged, when both models agree', () => {
    const { today, lifted } = measureAgreement([PLAIN], says('Billing', 'Low', 0.3), says('Billing', 'Low', 1));
    expect(today.flagged).toBe(1);
    expect(lifted.flagged).toBe(0);
  });

  it('still sends it to a person when the models disagree', () => {
    const { lifted } = measureAgreement([PLAIN], says('Billing', 'Low', 0.3), says('Product Question', 'Low', 1));
    expect(lifted.flagged).toBe(1);
  });

  // A safety rule is never lifted, however sure and however agreed.
  it('never lets out a ticket a rule flags', () => {
    const { lifted } = measureAgreement([SECURITY], says('Billing', 'Low', 0.3), says('Billing', 'Low', 1));
    expect(lifted.flagged).toBe(1);
    expect(lifted.highRiskMissed).toBe(0);
  });
});

describe('the bar', () => {
  const counts = (flagged: number, missed: number, wrong: number) => ({
    tickets: 1000, flagged, mustReview: 100, highRiskMissed: missed, highUrgentOutLow: 0, silentCategory: wrong, silentPriority: 0,
  });

  it('is met with fewer to a person, no hard line worse, and wrong answers within the allowance', () => {
    expect(judge({ today: counts(800, 2, 10), lifted: counts(780, 2, 13) }).met).toBe(true);
  });

  // 0.25% of 1,000 tickets rounds up to 3; a fourth extra wrong answer breaks the bar.
  it('fails past the allowance, on a worse hard line, or with no fewer tickets', () => {
    expect(judge({ today: counts(800, 2, 10), lifted: counts(780, 2, 14) }).accuracy).toBe(false);
    expect(judge({ today: counts(800, 2, 10), lifted: counts(780, 3, 10) }).hardLines).toBe(false);
    expect(judge({ today: counts(800, 2, 10), lifted: counts(800, 2, 10) }).fewer).toBe(false);
  });
});
