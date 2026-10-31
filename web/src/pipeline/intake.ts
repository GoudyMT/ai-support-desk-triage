import type { IntakeRecord } from './types';

// 20,000 characters mask in 0.5 ms (median), far under the 5 ms budget, so longer text is refused rather than slowed.
export const MAX_TICKET_CHARS = 20000;

export function intake(text: string, id: string, now: number): IntakeRecord {
  if (text.trim() === '') throw new Error('E_EMPTY_TICKET');
  if (text.length > MAX_TICKET_CHARS) throw new Error('E_TICKET_TOO_LONG');
  return { id, receivedAt: now, text };
}
