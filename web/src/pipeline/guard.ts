import { CATEGORIES, PRIORITIES, type Category, type Priority } from '../domain/labels';
import type { Prediction } from '../model/scorer';
import { matchRules, RULE_PRIORITY } from './rules';
import type { FlagReason, GuardResult } from './types';

// Billing is left out on purpose: the model cannot see a dispute, so it reads
// one as plain "Billing". The billing dispute rule is what flags it.
export const MUST_REVIEW_CATEGORIES: readonly Category[] = [
  'Security Concern',
  'Accessibility Support',
  'Urgent Complaint',
];

const TOP_CLASS_COUNT = 2;

function isMustReview(label: string): boolean {
  return (MUST_REVIEW_CATEGORIES as readonly string[]).includes(label);
}

function higher(a: Priority, b: Priority): Priority {
  return PRIORITIES.indexOf(b) > PRIORITIES.indexOf(a) ? b : a;
}

// The rules and the confidence floor may only add flags and raise the priority;
// the model's category is never changed here and no priority is ever lowered.
export function guard(
  category: Prediction,
  modelPriority: Priority,
  maskedText: string,
  floor: number,
): GuardResult {
  const reasons: FlagReason[] = [];
  let priority = modelPriority;
  for (const hit of matchRules(maskedText)) {
    reasons.push({ kind: 'rule', reason: hit.reason, words: hit.words });
    priority = higher(priority, RULE_PRIORITY[hit.reason]);
  }
  if (isMustReview(category.label)) {
    reasons.push({ kind: 'category', category: category.label as Category });
  }
  if (category.confidence < floor) {
    reasons.push({ kind: 'low confidence', confidence: category.confidence });
  }
  return { flagged: reasons.length > 0, reasons, priority, clearedBySecondCheck: false };
}

// Position in CATEGORIES, so equal probabilities always sort the same way;
// a key that is not a category sorts after every real one.
function categoryRank(label: string): number {
  const index = (CATEGORIES as readonly string[]).indexOf(label);
  return index === -1 ? CATEGORIES.length : index;
}

// A stricter rule, not a second model: a flag that came only from low
// confidence is cleared when the model's two best guesses are both ordinary
// categories, so nothing risky hides in its doubt. A rule or category flag is
// never cleared.
export function secondCheck(result: GuardResult, category: Prediction): GuardResult {
  const [only] = result.reasons;
  if (!result.flagged || result.reasons.length !== 1 || only?.kind !== 'low confidence') {
    return result;
  }
  const topClasses = Object.entries(category.probabilities)
    .sort(([labelA, a], [labelB, b]) => b - a || categoryRank(labelA) - categoryRank(labelB))
    .slice(0, TOP_CLASS_COUNT);
  if (topClasses.length < TOP_CLASS_COUNT || topClasses.some(([label]) => isMustReview(label))) {
    return result;
  }
  return { ...result, flagged: false, clearedBySecondCheck: true };
}
