import type { Priority } from '../domain/labels';
import { score, type Model } from '../model/scorer';
import { RULE_PRIORITY, matchRules } from '../pipeline/rules';

// The small model keeps this many words of the priority head: few enough to score a
// ticket the moment it arrives, enough to still catch most urgent ones.
export const PRESCREEN_WORDS = 3000;

export interface Tag {
  priority: Priority;
  critical: boolean;
}

type Head = Model['heads']['priority'];

const URGENT: Priority = 'Urgent';
// Urgent tickets are the ones the mark exists for, so their words count double.
const URGENT_WEIGHT = 2;

// How much a word is worth keeping: its strongest pull toward any class (Urgent
// doubled) times how rare it is.
function worth(head: Head, column: number): number {
  let strongest = 0;
  for (const [c, name] of head.classes.entries()) {
    const pull = Math.abs(head.coef[c]?.[column] ?? 0) * (name === URGENT ? URGENT_WEIGHT : 1);
    strongest = Math.max(strongest, pull);
  }
  return strongest * (head.idf[column] ?? 0);
}

// A new head with only the most worthy words, in the original word order. The head
// it is made from is read, never changed.
function cutHead(head: Head): Head {
  const ranked = head.vocabulary
    .map((_, column) => ({ column, worth: worth(head, column) }))
    .sort((a, b) => b.worth - a.worth || a.column - b.column)
    .slice(0, PRESCREEN_WORDS)
    .map((word) => word.column)
    .sort((a, b) => a - b);
  const vocabulary = ranked.map((column) => head.vocabulary[column] ?? '');
  return {
    classes: [...head.classes],
    vocabulary,
    index: new Map(vocabulary.map((term, i) => [term, i] as const)),
    idf: ranked.map((column) => head.idf[column] ?? 0),
    coef: head.coef.map((row) => ranked.map((column) => row[column] ?? 0)),
    intercept: [...head.intercept],
  };
}

/**
 * Builds the quick check that tags a ticket on arrival.
 *
 * @param model The run's fold model; it is read once and not changed.
 * @returns A function from masked ticket text to its tag: critical when a rule word
 *   of Urgent priority is present or the small model says Urgent, and then the
 *   priority is Urgent; otherwise the small model's priority.
 */
export function createPrescreener(model: Model): (maskedText: string) => Tag {
  const small = cutHead(model.heads.priority);
  const smallModel: Model = { heads: { category: small, priority: small } };
  return (maskedText) => {
    const label = score(smallModel, 'priority', maskedText).label as Priority;
    const ruleUrgent = matchRules(maskedText).some((hit) => RULE_PRIORITY[hit.reason] === URGENT);
    const critical = ruleUrgent || label === URGENT;
    return { priority: critical ? URGENT : label, critical };
  };
}
