import { ROUTES, type TicketLabel } from '../domain/labels';
import type { RunState } from './engine';

// An estimate, not a measurement: less than the lowest figure vendors of IT desk tools publish for sorting one
// ticket (3 to 12 minutes), and the US median hourly pay of a customer service representative.
export const MINUTES_PER_TICKET = 2;
export const HOURLY_PAY_USD = 21.53;

const MINUTES_PER_HOUR = 60;

export interface ValueSaved {
  counted: number;
  minutes: number;
  dollars: number;
}

/**
 * What the run has saved so far: a closed ticket that no person touched and that the system sorted correctly is
 * time nobody spent. A ticket sent to the wrong team, or one the truth says needed a person and did not get one,
 * saves nothing: someone would have to find it and do it again.
 *
 * Only `state.done` is read. The open list and the review form hold trails with the reviewer's answer
 * hidden, so a ticket there must not count, and a ticket the viewer reviewed carries the viewer's
 * decision in its stored trail, so it is a touched ticket as well.
 *
 * @param truthOf The true answer for a ticket id.
 */
export function valueSaved(state: RunState, truthOf: (id: string) => TicketLabel): ValueSaved {
  const counted = state.done.filter((trail) => {
    if (trail.review !== undefined) return false;
    const truth = truthOf(trail.id);
    return !truth.mustReview && trail.final.route === ROUTES[truth.category];
  }).length;
  const minutes = counted * MINUTES_PER_TICKET;
  return { counted, minutes, dollars: (minutes / MINUTES_PER_HOUR) * HOURLY_PAY_USD };
}

// A number the page showed before and that is now higher. With nothing shown before there is nothing to rise from.
export function rose(before: number | undefined, after: number): boolean {
  return before !== undefined && after > before;
}

export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function dollarsText(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}
