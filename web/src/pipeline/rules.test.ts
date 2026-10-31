import { describe, expect, it } from 'vitest';
import type { ReviewReason } from '../domain/labels';
import { matchRules, RULE_PRIORITY } from './rules';

// One plain sentence per reason, as a customer would write it. Each must fire
// its own reason and no other, so a rule list that bleeds into a neighbour's
// topic shows up here.
const PLAIN_SENTENCES: [ReviewReason, string, string[]][] = [
  ['security incident', 'someone hacked my account last night', ['hacked']],
  ['accessibility issue', 'the screen reader skips the checkout button', ['screen reader']],
  ['billing dispute', 'i want a refund for this month', ['refund']],
  ['threatening language', 'fix this or i will sue you', ['sue']],
  ['escalated complaint', 'this is unacceptable', ['unacceptable']],
  ['vague ticket', 'something is wrong with it', ['something is wrong']],
];

describe('matchRules', () => {
  it.each(PLAIN_SENTENCES)(
    'a plain %s sentence fires that reason alone, with the words it used',
    (reason, sentence, words) => {
      // The pipeline flags on these; a missed reason is a sensitive ticket nobody reviews.
      expect(matchRules(sentence)).toEqual([{ reason, words }]);
    },
  );

  it('does not read the word "card" inside a masked card number', () => {
    // Masked text carries tokens such as [CARD_NUMBER]; their inner words are
    // the masker's, not the customer's, and must never trigger a rule.
    expect(matchRules('my [CARD_NUMBER] was saved')).toEqual([]);
  });

  it('does not read "charge" inside "charger" as a billing dispute', () => {
    // A customer asking about a phone charger is not disputing a bill.
    expect(matchRules('is my charger covered?')).toEqual([]);
  });

  it('does not read "hack" inside "hackathon" as a security incident', () => {
    // A hackathon event is not a break-in; it would flag as Urgent for nothing.
    expect(matchRules('we are hosting a hackathon')).toEqual([]);
  });

  it('returns both reasons for a threat inside a billing dispute, in union order', () => {
    // Billing comes before threatening language in ReviewReason; the pipeline
    // records every reason and the higher priority must win later.
    expect(matchRules('refund my money or i will sue you')).toEqual([
      { reason: 'billing dispute', words: ['refund'] },
      { reason: 'threatening language', words: ['sue'] },
    ]);
  });

  it('matches regardless of letter case', () => {
    // Customers shout; "HACKED" must flag like "hacked".
    expect(matchRules('SOMEONE HACKED MY ACCOUNT')).toEqual([
      { reason: 'security incident', words: ['hacked'] },
    ]);
  });
});

describe('RULE_PRIORITY', () => {
  it('holds the priority each reason raises a ticket to', () => {
    // These are the owner-set floors shown before a reviewer sees the ticket.
    expect(RULE_PRIORITY).toEqual({
      'security incident': 'Urgent',
      'threatening language': 'Urgent',
      'accessibility issue': 'High',
      'escalated complaint': 'High',
      'billing dispute': 'Medium',
      'vague ticket': 'Medium',
    });
  });
});
