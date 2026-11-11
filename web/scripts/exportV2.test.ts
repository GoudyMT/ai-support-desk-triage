import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText } from './exportDataset';
import { V2_SEEDS, buildV2, writeV2, type V2Data } from './exportV2';

const SMALL = { trainPerWording: 300, heldoutPerWording: 60, desk: 80 };
const DATA = buildV2(SMALL);
const EXPECTED_FILES = [
  'v2_desk.jsonl',
  'v2_heldout_0.jsonl',
  'v2_heldout_1.jsonl',
  'v2_heldout_2.jsonl',
  'v2_heldout_3.jsonl',
  'v2_train.jsonl',
  'v2_tune_0_1.jsonl',
  'v2_tune_0_2.jsonl',
  'v2_tune_0_3.jsonl',
  'v2_tune_1_2.jsonl',
  'v2_tune_1_3.jsonl',
  'v2_tune_2_3.jsonl',
];

function texts(tickets: readonly { text: string }[]): Set<string> {
  return new Set(tickets.map(({ text }) => normalizeText(text)));
}

function scratchDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'export-v2-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the second model data', () => {
  it('trains on both wordings in equal parts, each ticket with its own id', () => {
    const fromBuiltIn = DATA.train.filter((ticket) => ticket.seed === V2_SEEDS.builtInTrain).length;
    const fromExtra = DATA.train.filter((ticket) => ticket.seed === V2_SEEDS.extraTrain).length;
    expect([fromBuiltIn, fromExtra]).toEqual([SMALL.trainPerWording, SMALL.trainPerWording]);
    expect(new Set(DATA.train.map((ticket) => ticket.id)).size).toBe(DATA.train.length);
  });

  it('scores every practice round on tickets its model never trained on', () => {
    for (const { leftOut, train } of DATA.tuning) {
      const trained = texts(train);
      for (const fold of leftOut) {
        const heldout = DATA.heldout[fold]?.tickets ?? [];
        expect(heldout).toHaveLength(2 * SMALL.heldoutPerWording);
        expect(heldout.filter((ticket) => trained.has(normalizeText(ticket.text)))).toEqual([]);
      }
    }
  });

  it('keeps every desk ticket out of every training list, with no desk text twice', () => {
    const desk = texts(DATA.desk);
    expect(desk.size).toBe(SMALL.desk);
    for (const list of [DATA.train, ...DATA.tuning.map(({ train }) => train)]) {
      expect(list.filter((ticket) => desk.has(normalizeText(ticket.text)))).toEqual([]);
    }
  });

  it('writes one file per set with every row', () => {
    scratchDir((dir) => {
      const written = writeV2(dir, DATA, []);
      expect(readdirSync(dir).sort()).toEqual(EXPECTED_FILES);
      expect(written.find(({ target }) => target.endsWith('v2_train.jsonl'))?.rows).toBe(2 * SMALL.trainPerWording);
      const firstRow = JSON.parse(readFileSync(join(dir, 'v2_heldout_2.jsonl'), 'utf8').split('\n')[0] ?? '{}') as { fold: number };
      expect(firstRow.fold).toBe(2);
    });
  });

  // The second model is scored on the fresh hand-written set by a scorer outside
  // the page, which needs each ticket masked the way the page masks it.
  it('writes the fresh hand-written tickets with their masked text when it is given them', () => {
    scratchDir((dir) => {
      const fresh = [{ id: 'F-x', text: 'Write to me at pat@mail.example.net please', category: 'Other', priority: 'Low', mustReview: false }];
      writeV2(dir, DATA, [], fresh);
      const line = JSON.parse(readFileSync(join(dir, 'v2_handwritten_fresh.jsonl'), 'utf8').trim()) as Record<string, unknown>;
      expect(line).toMatchObject({ id: 'F-x', category: 'Other', maskedText: 'Write to me at [EMAIL_ADDRESS] please' });
      expect(readdirSync(dir).sort()).toEqual([...EXPECTED_FILES, 'v2_handwritten_fresh.jsonl'].sort());
    });
  });

  it('stops before any file is written when a training list holds a fresh hand-written text', () => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const fresh = [{ id: 'F-y', text: (DATA.train[0]?.text ?? '').toUpperCase() }];
      expect(() => writeV2(target, DATA, [], fresh)).toThrow('E_HANDWRITTEN_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    });
  });

  it('stops before any file is written when a training list holds a blind text', () => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const blind = [{ text: (DATA.tuning[0]?.train[0]?.text ?? '').toUpperCase() }];
      expect(() => writeV2(target, DATA, blind)).toThrow('E_BLIND_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    });
  });

  it('stops before any file is written when a training list holds a desk text', () => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const leaked = DATA.desk[0];
      expect(leaked).toBeDefined();
      const withLeak: V2Data = { ...DATA, train: leaked === undefined ? DATA.train : [...DATA.train, leaked] };
      expect(() => writeV2(target, withLeak, [])).toThrow('E_DESK_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    });
  });
});
