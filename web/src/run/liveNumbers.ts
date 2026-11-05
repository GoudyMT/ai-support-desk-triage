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

// Only the real speed run is a rate: a paced run waits between tickets. A zero reading (a coarse
// browser timer) gives no rate rather than Infinity.
function perSecondOf(realSpeed: RunState['realSpeed']): number | null {
  if (realSpeed === undefined || realSpeed.ms <= 0) {
    return null;
  }
  return (realSpeed.tickets / realSpeed.ms) * MS_PER_SECOND;
}

/**
 * The numbers the page shows while a run goes on, from the tickets that reached Done only.
 * The center, the open list and the review form are never counted: a ticket counts once
 * it is closed.
 *
 * @param state The run's state now.
 * @param truthOf The true answer for a ticket id.
 * @returns Counts, and ratios that are null until a ticket is done; `perSecond` is null
 *   until a real speed run was measured or when its measured time is zero.
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
  // Tickets whose category the simulated reviewer changed. A ticket the viewer reviewed is left out
  // (their pick is recorded as a reviewer decision, but it is not the simulated reviewer's), and so
  // are priority-only changes.
  const viewerIds = new Set(state.viewerReviews.map((review) => review.id));
  const overrides = state.done.filter(
    (trail) =>
      trail.final.by === 'reviewer' && trail.final.category !== trail.category.label && !viewerIds.has(trail.id),
  ).length;
  return {
    done: state.done.length,
    perSecond: perSecondOf(state.realSpeed),
    modelAccuracy: metrics.categoryAccuracy.model,
    v0Accuracy: metrics.v0.category,
    flaggedShare: metrics.flagRate,
    overrides,
    highRiskMissed: metrics.highRiskMissed,
    viewerCorrect,
  };
}
