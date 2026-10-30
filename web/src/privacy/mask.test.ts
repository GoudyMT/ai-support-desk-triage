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
    const checkedPerKind = new Map<MaskKind, number>();
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
          checkedPerKind.set(kind, (checkedPerKind.get(kind) ?? 0) + 1);
        }
      }
    }
    expect(fake).toBeGreaterThan(0);
    // A shape that stopped matching would skip its check without a sound.
    for (const [kind] of GENERATED_SHAPES) {
      expect(checkedPerKind.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
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

// The model reads text as lowercase words of two or more characters.
const WORD = /\b\w\w+\b/g;

describe('mask tokens', () => {
  it('each read as one word that no ticket uses on its own', () => {
    const ticketWords = new Set(sample.flatMap((ticket) => ticket.text.toLowerCase().match(WORD) ?? []));
    for (const token of Object.values(MASK_TOKENS)) {
      const pieces = token.toLowerCase().match(WORD) ?? [];
      expect(pieces, token).toHaveLength(1);
      expect(ticketWords.has(pieces[0] ?? ''), token).toBe(false);
    }
  });
});

describe('maskText on formats the generator never makes', () => {
  // Built at run time so this file stays ASCII: e with a diaeresis, u with an umlaut.
  const E_DIAERESIS = String.fromCharCode(0xeb);
  const U_UMLAUT = String.fromCharCode(0xfc);

  const cases: { kind: MaskKind; value: string; sentence: string }[] = [
    { kind: 'email', value: 'jordan@mail.example.net', sentence: 'Please write to jordan@mail.example.net about it.' },
    { kind: 'phone', value: '(212) 555-0147', sentence: 'You can call me on (212) 555-0147 today.' },
    { kind: 'phone', value: '+1 212 555 0147', sentence: 'My number is +1 212 555 0147 for now.' },
    { kind: 'phone', value: '212.555.0147', sentence: 'Ring 212.555.0147 after lunch.' },
    { kind: 'card', value: '4111-1111-1111-1111', sentence: 'I paid with 4111-1111-1111-1111 last week.' },
    { kind: 'card', value: '4111111111111111', sentence: 'The card 4111111111111111 was charged twice.' },
    { kind: 'order', value: '48213', sentence: 'This is about Order #48213 from May.' },
    { kind: 'order', value: '482130', sentence: 'I mean order number 482130 please.' },
    // Longer runs and looser spacing: every run of 13 or more digits is a card.
    { kind: 'card', value: '41111111111111111111', sentence: 'The card 41111111111111111111 was charged.' },
    { kind: 'card', value: '0123456789012345678901', sentence: 'My acct 0123456789012345678901 is wrong.' },
    { kind: 'card', value: '12345 4111 1111 1111 1111', sentence: 'The invoice 12345 4111 1111 1111 1111 was paid.' },
    { kind: 'card', value: '4111.1111.1111.1111', sentence: 'I paid with 4111.1111.1111.1111 last week.' },
    { kind: 'card', value: '4111  1111  1111  1111', sentence: 'I paid with 4111  1111  1111  1111 last week.' },
    { kind: 'card', value: '4111 - 1111 - 1111 - 1111', sentence: 'I paid with 4111 - 1111 - 1111 - 1111 last week.' },
    { kind: 'phone', value: '212 - 555 - 0147', sentence: 'Ring 212 - 555 - 0147 after lunch.' },
    // Four-two-two(-two) groups are not dates: the date rule must not swallow them.
    { kind: 'phone', value: '0475-12-34-56', sentence: 'Call me on 0475-12-34-56.' },
    { kind: 'phone', value: '5550-12-34', sentence: 'My number is 5550-12-34.' },
    { kind: 'phone', value: '0475.12.34.56', sentence: 'Ring 0475.12.34.56 after lunch.' },
    // Each of these starts like a date and fails one date test: a year outside
    // 19xx and 20xx, a fourth group, a month past 12, a day past 31.
    { kind: 'phone', value: '0475-12-31', sentence: 'Reach me on 0475-12-31 please.' },
    { kind: 'phone', value: '2012-10-11-12', sentence: 'Reach me on 2012-10-11-12 please.' },
    { kind: 'phone', value: '2012-13-10', sentence: 'Reach me on 2012-13-10 please.' },
    { kind: 'phone', value: '2012-10-45', sentence: 'Reach me on 2012-10-45 please.' },
    { kind: 'card', value: '4111/1111/1111/1111', sentence: 'Card 4111/1111/1111/1111' },
    { kind: 'card', value: '4111_1111_1111_1111', sentence: 'Card 4111_1111_1111_1111' },
  ];

  it.each(cases)('masks $value as a $kind', ({ kind, value, sentence }) => {
    const { text, found } = maskText(sentence);
    expect(text).toContain(MASK_TOKENS[kind]);
    expect(text).not.toContain(value);
    // No digit of the value may survive as a fragment.
    expect(text).not.toMatch(/\d/);
    expect(found).toEqual([kind]);
  });

  // Names and domains with accented letters. The whole address must go: a mask
  // that starts after the accented letter still shows the name's first part.
  it.each([
    { label: 'accented local part', address: `zo${E_DIAERESIS}.smith@example.com` },
    { label: 'accented domain', address: `max@m${U_UMLAUT}ller.de` },
  ])('masks the whole address with an $label', ({ address }) => {
    expect(maskText(`Write to ${address} soon.`)).toEqual({ text: `Write to ${MASK_TOKENS.email} soon.`, found: ['email'] });
  });

  it.each([
    { sentence: 'My order number is 482130.', numbers: ['482130'] },
    { sentence: 'Order number: 482130', numbers: ['482130'] },
    { sentence: 'Order: 48213', numbers: ['48213'] },
    { sentence: 'Order no. 48213', numbers: ['48213'] },
    { sentence: 'Order No: 48213', numbers: ['48213'] },
    { sentence: 'order ID 48213', numbers: ['48213'] },
    { sentence: 'order # 48213', numbers: ['48213'] },
    { sentence: 'my order is 48213', numbers: ['48213'] },
    { sentence: 'Order ref 48213', numbers: ['48213'] },
    { sentence: 'ORD 123456', numbers: ['123456'] },
    { sentence: 'order 48213 and 48214', numbers: ['48213', '48214'] },
    { sentence: 'order #48213, #48214', numbers: ['48213', '48214'] },
    { sentence: 'My orders 48213 and 48214 never came', numbers: ['48213', '48214'] },
    { sentence: 'Orders #48213, #48214', numbers: ['48213', '48214'] },
    { sentence: 'order numbers 48213 and 48214', numbers: ['48213', '48214'] },
    { sentence: 'Order reference 48213', numbers: ['48213'] },
    { sentence: 'order 48213 or 48214', numbers: ['48213', '48214'] },
    { sentence: 'order 48213/48214', numbers: ['48213', '48214'] },
  ])('masks every order number in: $sentence', ({ sentence, numbers }) => {
    const { text, found } = maskText(sentence);
    expect(text).toContain(MASK_TOKENS.order);
    for (const number of numbers) {
      expect(text).not.toContain(number);
    }
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((kind) => kind === 'order')).toBe(true);
  });

  // A phone number written right after another number must not be read as a
  // continuation of it.
  it.each([
    { sentence: 'Order #48213 555-0142', found: ['order', 'phone'] },
    { sentence: 'ORD-123456 555-0142', found: ['order', 'phone'] },
    // 16 digits of card plus the phone digits make one run of 13 or more
    // digits, which is masked whole as a card.
    { sentence: '4111 1111 1111 1111 555-0142', found: ['card'] },
    // Two phone numbers close together are 14 or more digits in one run, which
    // is masked whole; no tail of the second may be left behind.
    { sentence: 'call 555-0142 (312) 867-5309 ok', found: ['card'] },
    { sentence: 'call 555-0142. (312) 867-5309', found: ['card'] },
    { sentence: 'call 555-0142  (312) 867-5309', found: ['card'] },
  ])('masks the phone after another number in: $sentence', ({ sentence, found }) => {
    const result = maskText(sentence);
    expect(result.text).not.toMatch(/\d/);
    expect(result.found).toEqual(found);
  });

  it('stays fast on very long input with nothing to mask', () => {
    const LONG = 50000;
    const BUDGET_MS = 200;
    for (const input of ['a'.repeat(LONG), ' '.repeat(LONG), `order${' '.repeat(LONG)}`]) {
      const start = performance.now();
      maskText(input);
      expect(performance.now() - start).toBeLessThan(BUDGET_MS);
    }
  });

  it.each([
    'This broke in version 2.4.1 for me.',
    'It failed 3 times today.',
    'Since 2026-10-30 nothing loads.',
    '2026-10-30',
    'Shipped on 2026.10.30 as planned.',
    'Due 10/30/2026 at noon.',
    'I keep getting error 404 on the page.',
    'The meeting is at 10:45 sharp.',
  ])('leaves ordinary numbers alone in: %s', (sentence) => {
    expect(maskText(sentence)).toEqual({ text: sentence, found: [] });
  });

  it('reports what it found in order of appearance', () => {
    expect(maskText('Call 555-0142 about ORD-123456').found).toEqual(['phone', 'order']);
  });
});
