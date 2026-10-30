import { describe, expect, it } from 'vitest';
import { generateTickets } from '../generator/generate';
import { MASK_TOKENS, maskText, type MaskKind } from './mask';

const SEED = 1;
const TICKET_COUNT = 5000;
const sample = generateTickets(SEED, TICKET_COUNT);

// A card-length run of digits, allowing single spaces or dashes between them.
const LONG_DIGIT_RUN = /\d(?:[ -]?\d){12,}/;

// The shape the generator gives each kind of fake data.
const GENERATED_SHAPES: readonly (readonly [MaskKind, RegExp])[] = [
  ['email', /@example\./],
  ['phone', /\b555-01\d\d\b/],
  ['order', /\bORD-\d{6}\b/],
  ['card', /\d{4} \d{4} \d{4} \d{4}/],
];

describe('maskText on generated tickets', () => {
  it('leaves no email, order number, phone or card digits in a ticket that carries fake data', () => {
    let fake = 0;
    for (const ticket of sample.filter((t) => t.hasFakeData)) {
      fake += 1;
      const { text, found } = maskText(ticket.text);
      expect(text, ticket.id).not.toContain('@');
      expect(text, ticket.id).not.toContain('ORD-');
      expect(text, ticket.id).not.toContain('555-01');
      expect(text, ticket.id).not.toMatch(LONG_DIGIT_RUN);
      // Checked by kind: masking only part of a card as a phone number would
      // pass the checks above but still leak digits.
      for (const [kind, shape] of GENERATED_SHAPES) {
        if (shape.test(ticket.text)) {
          expect(found, ticket.id).toContain(kind);
        }
      }
    }
    expect(fake).toBeGreaterThan(0);
  });

  it('returns a ticket without fake data unchanged', () => {
    let clean = 0;
    for (const ticket of sample.filter((t) => !t.hasFakeData)) {
      clean += 1;
      expect(maskText(ticket.text), ticket.id).toEqual({ text: ticket.text, found: [] });
    }
    expect(clean).toBeGreaterThan(0);
  });

  it('is idempotent, so masking already masked text changes nothing', () => {
    for (const ticket of sample) {
      const once = maskText(ticket.text);
      expect(maskText(once.text).text, ticket.id).toBe(once.text);
    }
  });
});

describe('maskText on formats the generator never makes', () => {
  const cases: { kind: MaskKind; value: string; sentence: string }[] = [
    { kind: 'email', value: 'jordan@mail.example.net', sentence: 'Please write to jordan@mail.example.net about it.' },
    { kind: 'phone', value: '(212) 555-0147', sentence: 'You can call me on (212) 555-0147 today.' },
    { kind: 'phone', value: '+1 212 555 0147', sentence: 'My number is +1 212 555 0147 for now.' },
    { kind: 'phone', value: '212.555.0147', sentence: 'Ring 212.555.0147 after lunch.' },
    { kind: 'card', value: '4111-1111-1111-1111', sentence: 'I paid with 4111-1111-1111-1111 last week.' },
    { kind: 'card', value: '4111111111111111', sentence: 'The card 4111111111111111 was charged twice.' },
    { kind: 'order', value: '48213', sentence: 'This is about Order #48213 from May.' },
    { kind: 'order', value: '482130', sentence: 'I mean order number 482130 please.' },
  ];

  it.each(cases)('masks $value as a $kind', ({ kind, value, sentence }) => {
    const { text, found } = maskText(sentence);
    expect(text).toContain(MASK_TOKENS[kind]);
    expect(text).not.toContain(value);
    expect(found).toEqual([kind]);
  });

  it.each([
    'This broke in version 2.4.1 for me.',
    'It failed 3 times today.',
    'Since 2026-10-30 nothing loads.',
    'I keep getting error 404 on the page.',
    'The meeting is at 10:45 sharp.',
  ])('leaves ordinary numbers alone in: %s', (sentence) => {
    expect(maskText(sentence)).toEqual({ text: sentence, found: [] });
  });

  it('reports what it found in order of appearance', () => {
    expect(maskText('Call 555-0142 about ORD-123456').found).toEqual(['phone', 'order']);
  });
});
