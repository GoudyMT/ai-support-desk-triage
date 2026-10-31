import { describe, expect, it } from 'vitest';
import { intake, MAX_TICKET_CHARS } from './intake';

describe('intake', () => {
  it('rejects an empty or whitespace-only ticket before any later stage sees it', () => {
    expect(() => intake('', 't1', 0)).toThrow('E_EMPTY_TICKET');
    expect(() => intake('   \n\t', 't2', 0)).toThrow('E_EMPTY_TICKET');
  });

  it('rejects a ticket one character over the cap but accepts one exactly at it', () => {
    expect(() => intake('a'.repeat(MAX_TICKET_CHARS + 1), 't3', 0)).toThrow('E_TICKET_TOO_LONG');
    expect(intake('a'.repeat(MAX_TICKET_CHARS), 't4', 0).text).toHaveLength(MAX_TICKET_CHARS);
  });

  it('keeps the given id, time and text unchanged', () => {
    const text = '  My invoice is wrong.\n';
    expect(intake(text, 'ticket-7', 1234)).toEqual({ id: 'ticket-7', receivedAt: 1234, text });
  });
});
