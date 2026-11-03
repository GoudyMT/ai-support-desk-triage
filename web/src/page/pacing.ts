import type { Schedule } from '../run/clock';
import type { RunState } from '../run/engine';

// The first tickets are shown slowly enough to read the full narration of each stage.
export const LEARN_DEEP_TICKETS = 3;
export const LEARN_DEEP_STAGE_MS = 5000;
// Every other ticket at learn speed, and any Act 1 ticket after the viewer switches to
// real speed, takes about this long from intake to the next ticket.
export const QUICK_TICKET_MS = 1000;
export const REAL_STAGE_MS = 100;

// Moves a ticket makes from intake until the next ticket enters: four on the way to done
// and one to leave it; a flagged ticket also passes through review.
const UNFLAGGED_MOVES = 5;
const FLAGGED_MOVES = 6;
const MS_PER_SECOND = 1000;

const TICKET_ID_END = /-(\d+)$/;

/**
 * Reads a ticket's position in the run from its id (`T-<seed>-<i>`).
 *
 * @param id A run ticket id.
 * @returns The ticket's index in the schedule.
 * @throws Error('E_TICKET_ID') when the id does not end in a number.
 */
export function ticketIndex(id: string): number {
  const found = TICKET_ID_END.exec(id);
  if (found?.[1] === undefined) {
    throw new Error('E_TICKET_ID');
  }
  return Number(found[1]);
}

/**
 * How long the page waits before it calls `advance()` again.
 *
 * @param state The run's state now.
 * @param schedule The run's arrival times, used to hold Act 2 tickets until they arrive.
 * @returns Milliseconds, or null when the timer must not run: paused, waiting for the
 *   viewer's review, or the run is complete.
 */
export function nextDelayMs(state: RunState, schedule: Schedule): number | null {
  const { current } = state;
  if (!state.playing || current === undefined || current.waitingForViewer) {
    return null;
  }
  const index = ticketIndex(current.trail.id);
  const moves = current.trail.guard.flagged ? FLAGGED_MOVES : UNFLAGGED_MOVES;
  const quickMs = QUICK_TICKET_MS / moves;
  if (state.speed === 'learn') {
    return index < LEARN_DEEP_TICKETS ? LEARN_DEEP_STAGE_MS : quickMs;
  }
  const stageMs = schedule.act(index) === 2 ? REAL_STAGE_MS : quickMs;
  const next = index + 1;
  if (current.stage !== 'done' || next >= schedule.total || schedule.act(next) !== 2) {
    return stageMs;
  }
  // Simulated seconds run 1:1 with wall seconds in Act 2: the next ticket enters when its
  // arrival is reached, counted from this ticket's own arrival less the time its stages took.
  const gapMs = (schedule.arrivesAt(next) - schedule.arrivesAt(index)) * MS_PER_SECOND;
  return Math.max(stageMs, gapMs - (moves - 1) * stageMs);
}
