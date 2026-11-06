import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTES, type Category } from '../domain/labels';
import { loadModel, score } from '../model/scorer';
import { MAX_TICKET_CHARS } from '../pipeline/intake';
import { MASK_TOKENS, maskText } from '../privacy/mask';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { RunState } from '../run/engine';
import { refusal, tryTicket } from './tryTicket';
import { deskCards } from './view';

const MODEL = loadModel(JSON.parse(readFileSync(new URL('../model/model.json', import.meta.url), 'utf8')));

const EMAIL = 'jordan@mail.example.net';
const CARD = '4111-1111-1111-1111';
const PERSONAL = `Please write to ${EMAIL} about the charge on card ${CARD}.`;
const SAFETY = 'Someone hacked my account and I cannot get in.';
const ONE_RULE = 'I would like a refund for my subscription fee this month.';
// The priority head says Medium and the escalated-complaint rule raises it to High.
const RAISED_BY_RULE = 'The desk lamp I ordered is awful, please help';
// No rule matches it and the model is sure of its category.
const PLAIN = 'Where is my package? The tracking number shows no update for a week.';

describe('tryTicket privacy', () => {
  // A visitor types a real address and card number into the box; what is shown back must not hold them.
  it('shows the ticket with the address and card number hidden behind their mask words', () => {
    const view = tryTicket(PERSONAL, MODEL);
    expect(view.text).not.toContain(EMAIL);
    expect(view.text).not.toContain('jordan');
    expect(view.text).not.toContain('4111');
    expect(view.text).toContain(MASK_TOKENS.email);
    expect(view.text).toContain(MASK_TOKENS.card);
  });
});

describe('tryTicket answer', () => {
  it('names the person needed and why, for a ticket a safety rule catches', () => {
    const view = tryTicket(SAFETY, MODEL);
    expect(view.person).toMatch(/^Yes: A rule caught "hacked"/);
  });

  // One reason is enough to need a person.
  it('names a person needed when a single rule is the only reason', () => {
    expect(tryTicket(ONE_RULE, MODEL).person).toBe('Yes: A rule caught "refund".');
  });

  // The visitor must see the priority the guard settled on, not the model's own pick.
  it('shows the priority after the rules, which is higher than the model alone picked', () => {
    const picked = score(MODEL, 'priority', maskText(RAISED_BY_RULE).text).label;
    expect(picked).toBe('Medium');
    expect(tryTicket(RAISED_BY_RULE, MODEL).priority).toBe('High');
  });

  // The reason is worded by a copy of the cards' sentence rule, so a change to the cards' wording must show here.
  it('gives the reason in the words the desk cards use', () => {
    const trail = runTicket(SAFETY, 'T-1', {
      model: MODEL,
      reviewer: { decide: ({ suggestion }) => ({ ...suggestion, route: ROUTES[suggestion.category] }) },
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: () => 0,
    });
    const [card] = deskCards({ open: [trail] } as unknown as RunState);
    expect(tryTicket(SAFETY, MODEL).person).toBe(`Yes: ${card?.why ?? ''}`);
  });

  it('says Urgent as the desk does, Critical', () => {
    expect(tryTicket(SAFETY, MODEL).priority).toBe('Critical');
  });

  it('says No when nothing flags the ticket', () => {
    const view = tryTicket(PLAIN, MODEL);
    expect(view.person).toBe('No');
  });

  it('sends the ticket to the team its category belongs to', () => {
    for (const text of [PLAIN, SAFETY, RAISED_BY_RULE, PERSONAL]) {
      const view = tryTicket(text, MODEL);
      expect(view.team, text).toBe(ROUTES[view.category as Category]);
    }
  });
});

describe('refusal', () => {
  it('refuses a box that is empty or only spaces', () => {
    expect(refusal('')).toBe('empty');
    expect(refusal('   \n\t ')).toBe('empty');
  });

  it('accepts the longest ticket intake takes and refuses one more character', () => {
    expect(refusal('a'.repeat(MAX_TICKET_CHARS))).toBeUndefined();
    expect(refusal('a'.repeat(MAX_TICKET_CHARS + 1))).toBe('long');
  });
});
