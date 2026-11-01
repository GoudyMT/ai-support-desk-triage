import { describe, expect, it } from 'vitest';
import type { Category, Priority } from '../domain/labels';
import type { Prediction } from '../model/scorer';
import { guard, MUST_REVIEW_CATEGORIES, secondCheck } from './guard';

const FLOOR = 0.5;
const SURE = 0.9;
const UNSURE = 0.3;
const PLAIN_TEXT = 'What sizes does the standard desk lamp come in?';

function prediction(
  label: string,
  confidence: number,
  probabilities: Record<string, number> = { [label]: confidence },
): Prediction {
  return { label, confidence, probabilities, topTerms: [] };
}

// Low confidence with a chosen runner-up, the way a model that is torn between two classes looks.
function torn(first: string, second: string): Prediction {
  return prediction(first, UNSURE, { [first]: UNSURE, [second]: 0.28, Other: 0.1 });
}

describe('guard reasons', () => {
  it('flags a keyword hit with its reason and the words that matched', () => {
    const result = guard(prediction('Technical Issue', SURE), 'Low', 'My account was hacked', FLOOR);
    expect(result.flagged).toBe(true);
    expect(result.reasons).toEqual([
      { kind: 'rule', reason: 'security incident', words: ['hacked'] },
    ]);
    expect(result.clearedBySecondCheck).toBe(false);
  });

  it('flags a must-review category the model predicted, without touching the priority', () => {
    const mustReview: Category[] = ['Security Concern', 'Accessibility Support', 'Urgent Complaint'];
    expect(MUST_REVIEW_CATEGORIES).toEqual(mustReview);
    for (const category of mustReview) {
      const result = guard(prediction(category, SURE), 'Low', PLAIN_TEXT, FLOOR);
      expect(result.flagged).toBe(true);
      expect(result.reasons).toEqual([{ kind: 'category', category }]);
      expect(result.priority).toBe('Low');
    }
  });

  it('does not flag Billing by category: only the dispute rule can see a dispute', () => {
    const result = guard(prediction('Billing', SURE), 'Medium', PLAIN_TEXT, FLOOR);
    expect(result.flagged).toBe(false);
  });

  it('flags confidence below the floor but not confidence exactly at it', () => {
    const below = guard(prediction('Product Question', FLOOR - 0.01), 'Low', PLAIN_TEXT, FLOOR);
    expect(below.flagged).toBe(true);
    expect(below.reasons).toEqual([{ kind: 'low confidence', confidence: FLOOR - 0.01 }]);

    const atFloor = guard(prediction('Product Question', FLOOR), 'Low', PLAIN_TEXT, FLOOR);
    expect(atFloor.flagged).toBe(false);
    expect(atFloor.reasons).toEqual([]);
  });

  it('leaves a confident, non-sensitive ticket with no rule hit unflagged at the model priority', () => {
    const result = guard(prediction('Product Question', SURE), 'Medium', PLAIN_TEXT, FLOOR);
    expect(result).toEqual({
      flagged: false,
      reasons: [],
      priority: 'Medium',
      clearedBySecondCheck: false,
    });
  });

  it('records rule hits first, then the category, then low confidence', () => {
    const result = guard(prediction('Security Concern', UNSURE), 'Low', 'My account was hacked', FLOOR);
    expect(result.reasons.map((reason) => reason.kind)).toEqual([
      'rule',
      'category',
      'low confidence',
    ]);
  });
});

describe('guard priority', () => {
  it('keeps a model priority that is higher than the rule priority', () => {
    const result = guard(prediction('Billing', SURE), 'Urgent', 'I was charged twice', FLOOR);
    expect(result.reasons).toEqual([
      { kind: 'rule', reason: 'billing dispute', words: ['was charged', 'charged twice'] },
    ]);
    expect(result.priority).toBe('Urgent');
  });

  it('raises a Low model priority to Urgent when a security rule fires', () => {
    const result = guard(prediction('Technical Issue', SURE), 'Low', 'My account was hacked', FLOOR);
    expect(result.priority).toBe('Urgent');
  });

  it('records both rules for a threat inside a billing dispute and takes the higher priority', () => {
    const result = guard(
      prediction('Billing', SURE),
      'Low',
      'I was charged twice and I will sue you',
      FLOOR,
    );
    expect(result.reasons).toEqual([
      { kind: 'rule', reason: 'billing dispute', words: ['was charged', 'charged twice'] },
      { kind: 'rule', reason: 'threatening language', words: ['will sue', 'sue you'] },
    ]);
    expect(result.priority).toBe('Urgent');
  });

  it('keeps the Urgent of a security rule when a lower billing rule is reported after it', () => {
    const result = guard(
      prediction('Billing', SURE),
      'Low',
      'My account was hacked and I was charged twice',
      FLOOR,
    );
    expect(result.reasons.map((reason) => (reason.kind === 'rule' ? reason.reason : reason.kind))).toEqual([
      'security incident',
      'billing dispute',
    ]);
    expect(result.priority).toBe('Urgent');
  });

  it('never lowers a priority the model set, whatever the rules say', () => {
    const priorities: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];
    const order = (priority: Priority): number => priorities.indexOf(priority);
    for (const modelPriority of priorities) {
      const result = guard(prediction('Billing', SURE), modelPriority, 'I was charged twice', FLOOR);
      expect(order(result.priority)).toBeGreaterThanOrEqual(order(modelPriority));
    }
  });
});

describe('secondCheck', () => {
  it('leaves a low confidence flag that also has a rule reason flagged', () => {
    const category = torn('Product Question', 'Shipping/Order Issue');
    const flagged = guard(category, 'Low', 'My account was hacked', FLOOR);
    expect(secondCheck(flagged, category)).toBe(flagged);
    expect(secondCheck(flagged, category).flagged).toBe(true);
  });

  it('leaves a low confidence flag that also has a category reason flagged', () => {
    const category = torn('Security Concern', 'Product Question');
    const flagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(flagged.reasons.map((reason) => reason.kind)).toEqual(['category', 'low confidence']);
    expect(secondCheck(flagged, category).flagged).toBe(true);
    expect(secondCheck(flagged, category).clearedBySecondCheck).toBe(false);
  });

  it('keeps a category flag even when the top two classes are both ordinary', () => {
    const tiedOrdinary = prediction('Accessibility Support', 0.25, {
      'Accessibility Support': 0.25,
      Billing: 0.25,
      'Technical Issue': 0.25,
      Other: 0.25,
    });
    // The tie puts Billing and Technical Issue first, so only the "only reason" rule can keep the flag.
    const flagged = guard(tiedOrdinary, 'Low', PLAIN_TEXT, FLOOR);
    expect(flagged.reasons.map((reason) => reason.kind)).toEqual(['category', 'low confidence']);
    const after = secondCheck(flagged, tiedOrdinary);
    expect(after.flagged).toBe(true);
    expect(after.clearedBySecondCheck).toBe(false);

    const priorityShaped = prediction('Accessibility Support', 0.25, {
      Low: 0.25,
      Medium: 0.25,
      High: 0.25,
      Urgent: 0.25,
    });
    const flaggedAgain = guard(priorityShaped, 'Low', PLAIN_TEXT, FLOOR);
    const afterAgain = secondCheck(flaggedAgain, priorityShaped);
    expect(afterAgain.flagged).toBe(true);
    expect(afterAgain.clearedBySecondCheck).toBe(false);
  });

  it('clears a low-only flag when the top two classes are both outside the must-review list', () => {
    const category = torn('Product Question', 'Shipping/Order Issue');
    const flagged = guard(category, 'Medium', PLAIN_TEXT, FLOOR);
    expect(flagged.reasons.map((reason) => reason.kind)).toEqual(['low confidence']);

    const cleared = secondCheck(flagged, category);
    expect(cleared.flagged).toBe(false);
    expect(cleared.clearedBySecondCheck).toBe(true);
    expect(cleared.reasons).toEqual(flagged.reasons);
    expect(cleared.priority).toBe('Medium');
    expect(flagged.flagged).toBe(true);
  });

  it('does not clear a low-only flag when the runner-up is a must-review class', () => {
    const category = torn('Product Question', 'Security Concern');
    const flagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(secondCheck(flagged, category)).toBe(flagged);
    expect(secondCheck(flagged, category).flagged).toBe(true);
  });

  it('breaks a probability tie by the order of the category list', () => {
    // Security Concern comes before Product Question and Shipping/Order Issue in that list.
    const category = prediction('Product Question', UNSURE, {
      'Shipping/Order Issue': UNSURE,
      'Product Question': UNSURE,
      'Security Concern': UNSURE,
    });
    const flagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(secondCheck(flagged, category).flagged).toBe(true);
  });

  // loadModel does not check class names against CATEGORIES, so a model whose class names drift must not count as must-review.
  it('counts a key that is not a category as outside the must-review list', () => {
    const category = prediction('Product Question', UNSURE, {
      'Product Question': UNSURE,
      'Not A Category': 0.28,
    });
    const flagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(secondCheck(flagged, category).flagged).toBe(false);
  });

  it('does not clear when the model gave fewer than two classes', () => {
    const category = prediction('Product Question', UNSURE);
    const flagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(secondCheck(flagged, category).flagged).toBe(true);
  });

  it('returns an unflagged result unchanged', () => {
    const category = prediction('Product Question', SURE, {
      'Product Question': SURE,
      'Shipping/Order Issue': 0.06,
      Other: 0.04,
    });
    const unflagged = guard(category, 'Low', PLAIN_TEXT, FLOOR);
    expect(secondCheck(unflagged, category)).toBe(unflagged);
  });
});
