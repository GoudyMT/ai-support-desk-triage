import type { Category, TicketLabel } from '../domain/labels';
import type { FlagReason, TicketTrail } from './types';

export interface RunMetrics {
  categoryAccuracy: { model: number; system: number };
  priorityAccuracy: { model: number; system: number };
  highRiskMissed: number;
  flagRate: number;
  flagsByReason: Record<string, number>;
  secondCheckCleared: number;
  overrideRate: number;
  v0: { category: number; priority: number; flag: number };
  handledWithoutReview: number;
  msPerTicket: number;
  instructiveMisses: {
    id: string;
    predicted: string;
    truth: Category;
    confidence: number;
    topTerms: { term: string; weight: number }[];
  }[];
}

const MAX_INSTRUCTIVE_MISSES = 5;

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function countWhere<T>(items: readonly T[], test: (item: T) => boolean): number {
  return items.filter(test).length;
}

function reasonName(reason: FlagReason): string {
  return reason.kind === 'rule' ? reason.reason : reason.kind;
}

/**
 * Computes the run's numbers from the trails and the true answers.
 *
 * @param trails One trail per ticket of the run.
 * @param truthOf The true answer for a ticket id.
 * @returns The accuracies, flag counts, v0 comparison and instructive misses.
 * @throws Error('E_EMPTY_RUN') when there are no trails.
 */
export function computeMetrics(trails: TicketTrail[], truthOf: (id: string) => TicketLabel): RunMetrics {
  if (trails.length === 0) throw new Error('E_EMPTY_RUN');
  const total = trails.length;
  const rows = trails.map((trail) => ({ trail, truth: truthOf(trail.id) }));
  const rate = (test: (row: (typeof rows)[number]) => boolean) => share(countWhere(rows, test), total);

  const flaggedRows = rows.filter(({ trail }) => trail.guard.flagged);
  const flagsByReason: Record<string, number> = {};
  for (const { trail } of flaggedRows) {
    for (const reason of trail.guard.reasons) {
      const name = reasonName(reason);
      flagsByReason[name] = (flagsByReason[name] ?? 0) + 1;
    }
  }

  const reviewed = rows.filter(({ trail }) => trail.final.by === 'reviewer');
  const overridden = countWhere(reviewed, ({ trail }) => trail.final.category !== trail.category.label);

  const instructiveMisses = rows
    .filter(({ trail, truth }) => trail.category.label !== truth.category)
    .sort((a, b) => b.trail.category.confidence - a.trail.category.confidence || (a.trail.id < b.trail.id ? -1 : 1))
    .slice(0, MAX_INSTRUCTIVE_MISSES)
    .map(({ trail, truth }) => ({
      id: trail.id,
      predicted: trail.category.label,
      truth: truth.category,
      confidence: trail.category.confidence,
      topTerms: trail.category.topTerms,
    }));

  return {
    categoryAccuracy: {
      model: rate(({ trail, truth }) => trail.category.label === truth.category),
      system: rate(({ trail, truth }) => trail.final.category === truth.category),
    },
    priorityAccuracy: {
      model: rate(({ trail, truth }) => trail.priority.label === truth.priority),
      system: rate(({ trail, truth }) => trail.final.priority === truth.priority),
    },
    highRiskMissed: countWhere(rows, ({ trail, truth }) => truth.mustReview && !trail.guard.flagged),
    flagRate: share(flaggedRows.length, total),
    flagsByReason,
    secondCheckCleared: countWhere(trails, (trail) => trail.guard.clearedBySecondCheck),
    overrideRate: share(overridden, reviewed.length),
    v0: {
      category: rate(({ trail, truth }) => trail.v0.category === truth.category),
      priority: rate(({ trail, truth }) => trail.v0.priority === truth.priority),
      flag: rate(({ trail, truth }) => trail.v0.mustReview === truth.mustReview),
    },
    handledWithoutReview: countWhere(trails, (trail) => trail.final.by === 'model'),
    msPerTicket: trails.reduce((sum, trail) => sum + trail.ms, 0) / total,
    instructiveMisses,
  };
}
