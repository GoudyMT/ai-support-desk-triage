import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../domain/labels';
import { DESK_WORDING } from './deskFrames';
import { EXTRA_WORDING } from './extraFrames';
import { BUILT_IN_WORDING, generateTickets } from './generate';
import { FOLDS, type Split } from './templates';
import type { Wording } from './wording';
import { sharedTexts, wordingProblems } from './wordingTestKit';

const STREAM_SIZE = 3000;
const SPLIT_STREAM_SIZE = 800;
const PRIORITIES = new Set(['Low', 'Medium', 'High', 'Urgent']);

// The extra wording takes its closers and polite requests from the built-in
// lists on purpose: politeness must look the same in every stream, or a model
// could tell the streams apart by their manners.
const SHARED_ON_PURPOSE = /^(?:closers|requests)\[/;

describe.each([
  ['extra', EXTRA_WORDING],
  ['desk', DESK_WORDING],
] as [string, Wording][])('the %s wording', (_name, wording) => {
  it('keeps every rule the generator needs to label its tickets correctly', () => {
    expect(wordingProblems(wording)).toEqual([]);
  });

  it('builds a full stream with every category and priority in it', () => {
    const tickets = generateTickets(31, STREAM_SIZE, 'all', wording);
    expect(new Set(tickets.map((ticket) => ticket.label.category)).size).toBe(CATEGORIES.length);
    expect(new Set(tickets.map((ticket) => ticket.label.priority))).toEqual(PRIORITIES);
  });
});

describe('wording kept apart', () => {
  it('gives the desk no sentence a model trains on', () => {
    expect(sharedTexts(DESK_WORDING, BUILT_IN_WORDING)).toEqual([]);
    expect(sharedTexts(DESK_WORDING, EXTRA_WORDING)).toEqual([]);
  });

  it('adds only new ticket sentences to training', () => {
    expect(sharedTexts(EXTRA_WORDING, BUILT_IN_WORDING).filter((name) => !SHARED_ON_PURPOSE.test(name))).toEqual([]);
  });
});

describe('practice rounds on the extra wording', () => {
  const sides: Split[] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    sides.push({ fold, side: 'heldout' }, { fold, side: 'train' }, { fold, side: 'train', alsoHeldOut: (fold + 1) % FOLDS });
  }

  // Each list is cut into four folds by kind. A kind with fewer than four
  // templates would leave some fold with nothing to draw, and the stream would
  // stop on the first ticket that needs it.
  it.each(sides)('builds a stream with every category for %o', (split) => {
    const tickets = generateTickets(32, SPLIT_STREAM_SIZE, split, EXTRA_WORDING);
    expect(new Set(tickets.map((ticket) => ticket.label.category)).size).toBe(CATEGORIES.length);
  });
});
