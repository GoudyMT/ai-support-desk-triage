import { CATEGORIES, PRIORITIES } from '../domain/labels';
import type { HeadName, Prediction } from '../model/scorer';
import type { Predict } from './run';

// One ticket's answer as a model wrote it outside the page: a probability for
// every category and every priority.
export interface SavedAnswer {
  id: string;
  category_probs: Record<string, number>;
  priority_probs: Record<string, number>;
}

const CLASSES: Record<HeadName, readonly string[]> = { category: CATEGORIES, priority: PRIORITIES };
const FIELD: Record<HeadName, 'category_probs' | 'priority_probs'> = { category: 'category_probs', priority: 'priority_probs' };

function toPrediction(probabilities: Record<string, number>, classes: readonly string[]): Prediction {
  const complete = classes.every((name) => typeof probabilities[name] === 'number') && Object.keys(probabilities).length === classes.length;
  if (!complete) {
    throw new Error('E_ANSWER_SHAPE');
  }
  let label = classes[0] ?? '';
  for (const name of classes) {
    if ((probabilities[name] ?? 0) > (probabilities[label] ?? 0)) {
      label = name;
    }
  }
  // A saved answer carries no word weights, so there are no top terms to show.
  return { label, confidence: probabilities[label] ?? 0, probabilities, topTerms: [] };
}

/**
 * Builds a scorer that answers each ticket from a table of saved answers, so the
 * rules and the review step can be measured on a model that does not run here.
 *
 * @param answers One saved answer per ticket.
 * @returns A scorer for `RunDeps.predict`.
 * @throws Error('E_ANSWER_SHAPE') for an answer that leaves a class out or an id given twice; the returned scorer
 *   throws Error('E_ANSWER_MISSING') for a ticket the table does not hold.
 */
export function tablePredict(answers: readonly SavedAnswer[]): Predict {
  const table = new Map<string, Record<HeadName, Prediction>>();
  for (const saved of answers) {
    if (table.has(saved.id)) {
      throw new Error('E_ANSWER_SHAPE');
    }
    table.set(saved.id, {
      category: toPrediction(saved.category_probs, CLASSES.category),
      priority: toPrediction(saved[FIELD.priority], CLASSES.priority),
    });
  }
  return (head, _maskedText, id) => {
    const known = table.get(id);
    if (known === undefined) {
      throw new Error('E_ANSWER_MISSING');
    }
    return known[head];
  };
}
