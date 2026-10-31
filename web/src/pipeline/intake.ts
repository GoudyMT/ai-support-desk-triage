import type { IntakeRecord } from './types';

// At 20,000 characters the whole pipeline takes 5 to 20 ms on English text (more
// when many words sit one letter from a rule word) and up to 27 ms on Chinese (no
// spaces, so the address rule reads furthest), under the 50 ms at which a browser
// task counts as long; longer text is refused rather than slowed.
export const MAX_TICKET_CHARS = 20000;

export function intake(text: string, id: string, now: number): IntakeRecord {
  if (text.trim() === '') throw new Error('E_EMPTY_TICKET');
  if (text.length > MAX_TICKET_CHARS) throw new Error('E_TICKET_TOO_LONG');
  return { id, receivedAt: now, text };
}
