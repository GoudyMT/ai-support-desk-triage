import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEEKS } from '../src/generator/weeks';
import { normalizeText } from './exportDataset';
import { buildWeekData, startPair, writeWeeks } from './exportWeeks';

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

  it('stops before writing when a week text is in the start model training set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    const stream = data.streams[3];
    const leaked = stream?.weeks[1]?.[0]?.ticket;
    const tampered = {
      streams: data.streams.map((s) => (s === stream && leaked ? { ...s, startTexts: new Set([...s.startTexts, normalizeText(leaked.text)]) } : s)),
    };
    expect(() => writeWeeks(dir, tampered, none)).toThrow('E_WEEK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });
});
