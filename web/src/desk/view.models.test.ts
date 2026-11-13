import { describe, expect, it } from 'vitest';
import type { TicketTrail } from '../pipeline/types';
import { trailOf, withState } from '../page/viewTestKit';
import { deskCards, deskReview } from './view';

// What a person sees of the two models (the locked wireframe, 2026-11-12): a card whose
// models disagree says so in "why it came to you", shows no "sure" percent and offers no
// quick approve; the review card lists each model's own answer.

const SURE = 0.99;

function twoModelTrail(word: { category: 'Billing' | 'Account Access'; priority: 'High' | 'Medium' }, reasons: TicketTrail['guard']['reasons'] = []): TicketTrail {
  const trail = trailOf({ model: 'Billing', priority: 'High', reasons });
  return { ...trail, category: { ...trail.category, confidence: SURE }, models: { word, sentence: { category: 'Billing', priority: 'High' } } };
}

describe('the desk with two models', () => {
  it('says the models disagree, with no percent and no quick approve', () => {
    const [card] = deskCards(withState({ open: [twoModelTrail({ category: 'Account Access', priority: 'High' })] }));
    expect(card?.why).toBe('The two models gave different answers.');
    expect(card?.leaning).toBe(`Leaning ${card?.team}.`);
    expect(card?.showApprove).toBe(false);
  });

  it('puts the disagreement after the rules that also flagged it', () => {
    const reasons = [{ kind: 'rule' as const, reason: 'billing dispute' as const, words: ['charged twice'] }];
    const [card] = deskCards(withState({ open: [twoModelTrail({ category: 'Billing', priority: 'Medium' }, reasons)] }));
    expect(card?.why).toBe('A rule caught "charged twice". The two models gave different answers.');
  });

  it('shows a card the models agree on as before, percent and quick approve included', () => {
    const reasons = [{ kind: 'category' as const, category: 'Billing' as const }];
    const [card] = deskCards(withState({ open: [twoModelTrail({ category: 'Billing', priority: 'High' }, reasons)] }));
    expect(card?.why).toBe('Billing tickets always go to a person.');
    expect(card?.leaning).toBe(`Leaning ${card?.team}, 99% sure.`);
    expect(card?.showApprove).toBe(true);
  });

  it("lists each model's own answer on the review card, and nothing on a one-model run", () => {
    const review = deskReview(withState({ reviewing: twoModelTrail({ category: 'Account Access', priority: 'Medium' }) }));
    expect(review?.models).toEqual({ word: 'Account Access, Medium', sentence: 'Billing, High' });
    expect(deskReview(withState({ reviewing: trailOf({ model: 'Billing', priority: 'High' }) }))?.models).toBeUndefined();
  });
});
