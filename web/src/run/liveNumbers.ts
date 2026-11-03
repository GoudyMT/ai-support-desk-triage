import type { TicketLabel } from '../domain/labels';
import { computeMetrics } from '../pipeline/metrics';
import type { RunState } from './engine';

export interface LiveNumbers {
  done: number;
  perSecond: number | null;
  modelAccuracy: number | null;
  v0Accuracy: number | null;
  flaggedShare: number | null;
  overrides: number;
  highRiskMissed: number;
  viewerCorrect: { correct: number; total: number };
}

const MS_PER_SECOND = 1000;

/**
 * The numbers the page shows while a run goes on, from the tickets that reached Done only.
 * A ticket at stage done is already the last entry of `state.done`, so `state.current` is
 * never counted; a flagged ticket still in review is not counted anywhere.
 *
 * @param state The run's state now.
 * @param truthOf The true answer for a ticket id.
 * @returns Counts, and ratios that are null until a ticket is done; `perSecond` is null
 *   outside real speed or when the measured time adds up to zero.
 */
export function liveNumbers(state: RunState, truthOf: (id: string) => TicketLabel): LiveNumbers {
  const viewerCorrect = {
    correct: state.viewerReviews.filter((review) => review.correct).length,
    total: state.viewerReviews.length,
  };
  if (state.done.length === 0) {
    return {
      done: 0,
      perSecond: null,
      modelAccuracy: null,
      v0Accuracy: null,
      flaggedShare: null,
      overrides: 0,
      highRiskMissed: 0,
      viewerCorrect,
    };
  }
  const metrics = computeMetrics(state.done, truthOf);
  // The count behind computeMetrics' overrideRate (reviewed tickets whose category the reviewer
  // changed), mirrored here because the metrics expose only the rate; priority-only changes are
  // left out so the live number agrees with the end report.
  const overrides = state.done.filter(
    (trail) => trail.final.by === 'reviewer' && trail.final.category !== trail.category.label,
  ).length;
  const seconds = state.done.reduce((sum, trail) => sum + trail.ms, 0) / MS_PER_SECOND;
  return {
    done: state.done.length,
    perSecond: state.speed === 'real' && seconds > 0 ? state.done.length / seconds : null,
    modelAccuracy: metrics.categoryAccuracy.model,
    v0Accuracy: metrics.v0.category,
    flaggedShare: metrics.flagRate,
    overrides,
    highRiskMissed: metrics.highRiskMissed,
    viewerCorrect,
  };
}
