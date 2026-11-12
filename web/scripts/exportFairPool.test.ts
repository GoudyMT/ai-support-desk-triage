import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOLDS } from '../src/generator/templates';
import { buildPool, dealWeeks, templateRefsOf, type WeekWording } from '../src/generator/weeks';
import { normalizeText } from './exportDataset';
import { buildPoolData, writePool } from './exportFairPool';

// The candidate pool is what the start model scores to learn how hard each
// held-out template is, before the templates are dealt into weeks.
const SMALL = { perWording: 300, trainPerWording: 200 };
const WORDINGS: WeekWording[] = ['built-in', 'extra'];

describe('templateRefsOf', () => {
  it.each(WORDINGS)('gives every %s template one ref, the same on every call', (wording) => {
    const refs = templateRefsOf(wording);
    const values = [...refs.values()];
    expect(new Set(values).size).toBe(values.length);
    expect([...templateRefsOf(wording).entries()]).toEqual([...refs.entries()]);
  });

  it('names every held-out template of a stream', () => {
    const named = new Set([...WORDINGS.flatMap((wording) => [...templateRefsOf(wording).keys()])]);
    for (let stream = 0; stream < FOLDS; stream += 1) {
      for (const template of dealWeeks(stream).keys()) {
        expect(named.has(template)).toBe(true);
      }
    }
  });
});

describe('buildPool', () => {
  it('draws only tickets built from the stream\'s held-out templates, and names them', () => {
    for (let stream = 0; stream < FOLDS; stream += 1) {
      const heldOut = new Set(
        WORDINGS.flatMap((wording) => {
          const refs = templateRefsOf(wording);
          return [...dealWeeks(stream).keys()].flatMap((template) => (refs.has(template) ? [refs.get(template)] : []));
        }),
      );
      const rows = buildPool(stream, SMALL.perWording);
      expect(rows).toHaveLength(SMALL.perWording * WORDINGS.length);
      for (const row of rows) {
        expect(row.templates.length).toBeGreaterThan(0);
        expect(row.templates.filter((ref) => !heldOut.has(ref))).toEqual([]);
      }
    }
  });
});

describe('writePool', () => {
  const data = buildPoolData(SMALL);
  const none = { blind: [], handwritten: [], fresh: [], desk: [] };

  it('writes one pool per stream whose rows carry their template refs, the same bytes every run', () => {
    const one = mkdtempSync(join(tmpdir(), 'pool-'));
    const two = mkdtempSync(join(tmpdir(), 'pool-'));
    writePool(one, data, none);
    writePool(two, buildPoolData(SMALL), none);
    const names = ['v2_fair_pool_0.jsonl', 'v2_fair_pool_1.jsonl', 'v2_fair_pool_2.jsonl', 'v2_fair_pool_3.jsonl'];
    expect(readdirSync(one).sort()).toEqual(names);
    for (const name of names) {
      expect(readFileSync(join(two, name))).toEqual(readFileSync(join(one, name)));
    }
    const rows = readFileSync(join(one, 'v2_fair_pool_2.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; fold: number; maskedText: string; templates: string[] });
    expect(rows).toHaveLength(SMALL.perWording * WORDINGS.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.every((row) => row.fold === 2 && row.maskedText.length > 0 && row.templates.length > 0)).toBe(true);
  });

  it('stops before writing when a blind text is in a pool', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const leaked = data.streams[1]?.rows[3]?.ticket.text ?? '';
    expect(() => writePool(dir, data, { ...none, blind: [{ text: leaked }] })).toThrow('E_BLIND_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops before writing when a desk text is in a pool', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const leaked = data.streams[0]?.rows[9]?.ticket.text ?? '';
    expect(() => writePool(dir, data, { ...none, desk: [{ text: leaked }] })).toThrow('E_DESK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each(['handwritten', 'fresh'] as const)('stops before writing when a %s evaluation text is in a pool', (source) => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const leaked = data.streams[3]?.rows[5]?.ticket.text ?? '';
    expect(() => writePool(dir, data, { ...none, [source]: [{ text: leaked }] })).toThrow('E_HANDWRITTEN_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stops before writing when a pool text is in the start model training set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const stream = data.streams[2];
    const leaked = stream?.rows[0]?.ticket;
    const tampered = {
      streams: data.streams.map((s) => (s === stream && leaked ? { ...s, startTexts: new Set([...s.startTexts, normalizeText(leaked.text)]) } : s)),
    };
    expect(() => writePool(dir, tampered, none)).toThrow('E_WEEK_IN_TRAIN');
    expect(readdirSync(dir)).toEqual([]);
  });
});
