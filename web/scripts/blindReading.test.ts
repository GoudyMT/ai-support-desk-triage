import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESK_WORDING } from '../src/generator/deskFrames';
import { generateTickets } from '../src/generator/generate';
import { loadModel, score } from '../src/model/scorer';
import type { Predict } from '../src/pipeline/run';
import { maskText } from '../src/privacy/mask';
import { BAR_POINTS, nearMatchIds, nearMatchTemplates, readBlind, type AnswersFile } from './blindReading';

// The blind reading and its release bar, checked on stand-in tickets (desk wording, never the blind set) and
// stand-in answers, so the arithmetic is proven before the one real reading.

const MODEL = loadModel(JSON.parse(readFileSync(new URL('../src/model/model.json', import.meta.url), 'utf8')));
const GATE: Predict = (head, maskedText) => score(MODEL, head, maskedText);
const TICKETS = generateTickets(77, 300, 'all', DESK_WORDING);
const ROWS = TICKETS.map((ticket) => ({ id: ticket.id, text: ticket.text, label: ticket.label }));
const SHA = 'stand-in';
// The Part 1 check found 6 blind templates over the share (plan notes, 2026-11-10).
const NEAR_TEMPLATES_RECORDED = 6;

function answersFrom(pick: (row: (typeof ROWS)[number]) => [string, string]): AnswersFile {
  return { blind_sha256: SHA, models: { sentence: { fingerprint: 'f', answers: ROWS.map((row) => [row.id, ...pick(row)]) } } };
}

const truth = answersFrom((row) => [row.label.category, row.label.priority]);
const wordOwn = answersFrom((row) => {
  const masked = maskText(row.text).text;
  return [score(MODEL, 'category', masked).label, score(MODEL, 'priority', masked).label];
});

describe('the blind reading', () => {
  it('finds the 6 near-match templates the Part 1 check found, and the tickets built from them', () => {
    const near = nearMatchTemplates();
    expect(near.size).toBe(NEAR_TEMPLATES_RECORDED);
    const ids = nearMatchIds(near);
    expect(ids.size).toBeGreaterThan(0);
    expect(ids.size).toBeLessThan(2_000);
  });

  it('meets the bar when the suggestion is right far more often than the word model and the counts hold', () => {
    const reading = readBlind(ROWS, SHA, truth, GATE, new Set(), 0);
    expect(reading.bar.counts_held).toBe(true);
    expect(reading.bar.gain_points).toBeGreaterThanOrEqual(BAR_POINTS);
    expect(reading.bar.met).toBe(true);
    expect(reading.models['sentence']?.all.alone.category).toBe(ROWS.length);
  });

  it('misses the bar when the suggestion is only the word model again', () => {
    const reading = readBlind(ROWS, SHA, wordOwn, GATE, new Set(), 0);
    expect(reading.bar.gain_points).toBe(0);
    expect(reading.bar.met).toBe(false);
    // The word model alone reads the masked text, as on the desk.
    const right = ROWS.filter((row, at) => wordOwn.models['sentence']?.answers[at]?.[1] === row.label.category).length;
    expect(reading.word.all.category).toBe(right);
  });

  it('reads the tickets without the near matches apart from all of them', () => {
    const near = new Set(ROWS.slice(0, 40).map((row) => row.id));
    const reading = readBlind(ROWS, SHA, truth, GATE, near, 1);
    expect(reading.models['sentence']?.all.tickets).toBe(ROWS.length);
    expect(reading.models['sentence']?.without.tickets).toBe(ROWS.length - 40);
    expect(reading.near_match_tickets).toBe(40);
  });

  it('refuses answers made on another blind file, or not one per ticket in order', () => {
    expect(() => readBlind(ROWS, 'other', truth, GATE, new Set(), 0)).toThrow('E_BLIND_CHANGED');
    const short: AnswersFile = { ...truth, models: { sentence: { fingerprint: 'f', answers: truth.models['sentence']?.answers.slice(1) ?? [] } } };
    expect(() => readBlind(ROWS, SHA, short, GATE, new Set(), 0)).toThrow('E_ANSWER_SET');
  });
});
