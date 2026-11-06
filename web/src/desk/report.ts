// What the after action report says, worked out from the closed tickets and the two assumptions. Pure: no DOM, so a
// test reads it directly. It reads `state.done` only, and nothing in it comes from a viewer's note.
import type { TicketLabel } from '../domain/labels';
import { computeMetrics } from '../pipeline/metrics';
import { REVIEWER_ERROR_RATE } from '../pipeline/reviewer';
import type { RunState } from '../run/engine';
import { dollarsText, minutesText, valueSaved } from '../run/valueSaved';
import { estimate, type Assumptions } from './panel';
import { flaggedCount, msText, percent, sentText } from './view';

const NO_MISSES = 'No misses in these tickets.';

export interface ReportView {
  heading: string;
  lead: string;
  // Category then Priority, each as the old keyword method, the model alone, and after review.
  table: string[];
  // In the order the list shows them.
  rows: string[];
  // One line each; a miss with nothing more to say has an empty detail.
  misses: { text: string; detail: string }[];
  // What the numbers rest on, with the assumptions in force.
  footer: string;
}

function leadOf(missed: number, modelRight: number, flagged: number, closed: number): string {
  const risk =
    missed === 0
      ? 'No high-risk ticket got past review.'
      : `${missed} high-risk ticket${missed === 1 ? '' : 's'} got past review.`;
  return `${risk} The model alone got the category right ${percent(modelRight)} of the time, and the simulated reviewer checked ${flagged} of ${closed} tickets.`;
}

/**
 * @param state The run as it stands; its closed tickets (at least one) are the report.
 * @param truthOf The true answer for a ticket id.
 * @param total How many tickets the run will have in all.
 * @throws Error('E_EMPTY_RUN') when no ticket has closed.
 */
export function reportView(
  state: RunState,
  truthOf: (id: string) => TicketLabel,
  total: number,
  assumed: Assumptions,
): ReportView {
  const closed = state.done.length;
  const m = computeMetrics(state.done, truthOf);
  const { minutes, dollars } = estimate(valueSaved(state, truthOf).counted, assumed);
  const quick = state.viewerReviews.filter((review) => review.quick);
  const flagged = flaggedCount(state.done);
  const trail = (id: string): string => state.done.find((t) => t.id === id)?.maskedText ?? '';
  return {
    heading:
      closed < total ? `After action report so far: ${closed} of ${total} tickets` : `After action report: ${total} tickets`,
    lead: leadOf(m.highRiskMissed, m.categoryAccuracy.model, flagged, closed),
    table: [
      percent(m.v0.category),
      percent(m.categoryAccuracy.model),
      percent(m.categoryAccuracy.system),
      percent(m.v0.priority),
      percent(m.priorityAccuracy.model),
      percent(m.priorityAccuracy.system),
    ],
    rows: [
      sentText(flagged, m.flagRate),
      percent(m.overrideRate),
      String(m.handledWithoutReview),
      msText(m.msPerTicket),
      minutesText(minutes),
      dollarsText(dollars),
      `${quick.filter((review) => !review.correct).length} of ${quick.length}`,
    ],
    misses:
      m.instructiveMisses.length === 0
        ? [{ text: NO_MISSES, detail: '' }]
        : m.instructiveMisses.map((miss) => ({
            text: trail(miss.id),
            detail: `Said ${miss.predicted}, truly ${miss.truth}. Words that misled it: ${miss.topTerms.map((t) => t.term).join(', ')}`,
          })),
    footer:
      `Made-up tickets. After review uses a simulated reviewer that is wrong ${percent(REVIEWER_ERROR_RATE)} of the time. ` +
      `Estimates assume ${assumed.minutes} minutes per ticket and $${assumed.pay} an hour. ` +
      'A live run uses different tickets from the test sets, so these numbers differ.',
  };
}
