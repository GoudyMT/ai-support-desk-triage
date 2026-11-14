import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEEKS, type Difficulty } from '../src/generator/weeks';
import { normalizeText } from './exportDataset';
import { FAIR_NAME, buildFairWeekStream, buildWeekData, readStartRows, startPair, startRowsOf, writeWeeks } from './exportWeeks';

const SMALL = { perDay: 2, trainPerWording: 200 };

describe('startPair', () => {
  it('names the practice pair that leaves the stream out, low fold first', () => {
    expect(startPair(0)).toEqual([0, 1]);
    expect(startPair(2)).toEqual([2, 3]);
    expect(startPair(3)).toEqual([0, 3]);
  });
});

describe('writeWeeks', () => {
  const data = buildWeekData(SMALL);
  const none = { blind: [], handwritten: [], fresh: [], desk: [] };

  it('writes one file per stream whose rows carry their week and day', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    writeWeeks(dir, data, none);
    expect(readdirSync(dir).sort()).toEqual(['v2_weeks_0.jsonl', 'v2_weeks_1.jsonl', 'v2_weeks_2.jsonl', 'v2_weeks_3.jsonl']);
    const rows = readFileSync(join(dir, 'v2_weeks_1.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { week: number; day: number; fold: number; maskedText: string });
    expect(rows).toHaveLength(WEEKS * 7 * SMALL.perDay);
    expect(new Set(rows.map((row) => row.week)).size).toBe(WEEKS);
    expect(rows.every((row) => row.day >= 1 && row.day <= 7 && row.fold === 1 && row.maskedText.length > 0)).toBe(true);
  });

  it('stops before writing when a blind text is among the week tickets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const leaked = data.streams[0]?.weeks[0]?.[0]?.ticket.text ?? '';
    expect(() => writeWeeks(dir, data, { ...none, blind: [{ text: leaked }] })).toThrow('E_BLIND_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops before writing when a desk text is among the week tickets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const leaked = data.streams[2]?.weeks[5]?.[0]?.ticket.text ?? '';
    expect(() => writeWeeks(dir, data, { ...none, desk: [{ text: leaked }] })).toThrow('E_DESK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each(['handwritten', 'fresh'] as const)('stops before writing when a %s evaluation text is among the week tickets', (source) => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const leaked = data.streams[1]?.weeks[7]?.[0]?.ticket.text ?? '';
    expect(() => writeWeeks(dir, data, { ...none, [source]: [{ text: leaked }] })).toThrow('E_HANDWRITTEN_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops before writing when a week text is in the start model training set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const stream = data.streams[3];
    const leaked = stream?.weeks[1]?.[0]?.ticket;
    const tampered = {
      streams: data.streams.map((s) => (s === stream && leaked ? { ...s, startRows: [...s.startRows, { text: leaked.text.toUpperCase() }] } : s)),
    };
    expect(() => writeWeeks(dir, tampered, none)).toThrow('E_WEEK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  // The other guards also match on the masked text; so does this one now, so a
  // start ticket that differs from a week ticket only in its fake data is caught.
  it('stops when a start ticket matches a week ticket once personal data is masked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const withEmail = data.streams.flatMap((s) => s.weeks.flat().map((row) => ({ s, text: row.ticket.text }))).find(({ text }) => /\S+@example\.(com|org)/.test(text));
    expect(withEmail).toBeDefined();
    const variant = (withEmail?.text ?? '').replace(/\S+@example\.(com|org)/, 'someone.else7@example.org');
    expect(normalizeText(variant)).not.toBe(normalizeText(withEmail?.text ?? ''));
    const tampered = { streams: data.streams.map((s) => (s === withEmail?.s ? { ...s, startRows: [...s.startRows, { text: variant }] } : s)) };
    expect(() => writeWeeks(dir, tampered, none)).toThrow('E_WEEK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('readStartRows', () => {
  it('refuses a missing start file instead of checking against nothing', () => {
    expect(() => readStartRows(mkdtempSync(join(tmpdir(), 'weeks-')), 0)).toThrow('E_START_MISSING');
  });

  it('reads the texts of the file the driver trains on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    writeFileSync(join(dir, 'v2_tune_0_3.jsonl'), `${JSON.stringify({ id: 'a', text: 'First.' })}\n${JSON.stringify({ id: 'b', text: 'Second.' })}\n`);
    expect(readStartRows(dir, 3)).toEqual([{ text: 'First.' }, { text: 'Second.' }]);
  });
});

describe('fair week files', () => {
  const none = { blind: [], handwritten: [], fresh: [], desk: [] };
  const stream = 2;
  const difficulty: Difficulty = {};
  const fair = { streams: [buildFairWeekStream(stream, difficulty, startRowsOf(stream, SMALL.trainPerWording), SMALL.perDay)] };

  it('writes the fair file only, each row with its teaching copy and template names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    writeWeeks(dir, fair, none, FAIR_NAME);
    expect(readdirSync(dir)).toEqual(['v2_fair_weeks_2.jsonl']);
    const rows = readFileSync(join(dir, 'v2_fair_weeks_2.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { text: string; teachText: string; templates: string[] });
    expect(rows).toHaveLength(WEEKS * 7 * SMALL.perDay);
    expect(rows.every((row) => typeof row.teachText === 'string' && row.templates.length > 0)).toBe(true);
    expect(rows.some((row) => row.teachText !== row.text)).toBe(true);
  });

  it('stops before writing when a blind text equals a teaching copy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const row = fair.streams[0]?.weeks.flat().find((candidate) => candidate.teachText !== candidate.ticket.text);
    expect(() => writeWeeks(dir, fair, { ...none, blind: [{ text: row?.teachText ?? '' }] }, FAIR_NAME)).toThrow('E_BLIND_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });
});
