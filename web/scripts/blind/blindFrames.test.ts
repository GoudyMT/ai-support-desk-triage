import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../src/domain/labels';
import { DESK_WORDING } from '../../src/generator/deskFrames';
import { EXTRA_WORDING } from '../../src/generator/extraFrames';
import { BUILT_IN_WORDING, generateTickets } from '../../src/generator/generate';
import { sharedTexts, wordingProblems } from '../../src/generator/wordingTestKit';
import { BLIND_SEED } from '../exportBlind';
import { BLIND_WORDING } from './blindFrames';

// Every check here reports a list and a position, never the sentence: the blind
// wording is only a fair test while the people and tools that shape the model
// have not read it.
const STREAM_SIZE = 3000;

describe('the blind wording', () => {
  it('keeps every rule the generator needs to label its tickets correctly', () => {
    expect(wordingProblems(BLIND_WORDING)).toEqual([]);
  });

  it.each([
    ['the built-in wording', BUILT_IN_WORDING],
    ['the extra training wording', EXTRA_WORDING],
    ['the desk wording', DESK_WORDING],
  ] as const)('shares no sentence with %s, greetings aside', (_name, other) => {
    expect(sharedTexts(BLIND_WORDING, other)).toEqual([]);
  });

  it('builds a full stream without an error and with every category and priority in it', () => {
    const tickets = generateTickets(BLIND_SEED, STREAM_SIZE, 'all', BLIND_WORDING);
    expect(new Set(tickets.map((ticket) => ticket.label.category)).size).toBe(CATEGORIES.length);
    expect(new Set(tickets.map((ticket) => ticket.label.priority))).toEqual(new Set(['Low', 'Medium', 'High', 'Urgent']));
  });
});
