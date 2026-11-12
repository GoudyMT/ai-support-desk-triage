import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ticket } from '../src/generator/generate';
import { normalizeText } from './exportDataset';
import { V2_SEEDS, buildV2, writeV2, type V2Data, type V2HeldOut } from './exportV2';

const SMALL = { trainPerWording: 300, heldoutPerWording: 60, desk: 80 };
const DATA = buildV2(SMALL);
const NOTHING_HELD: V2HeldOut = { blind: [], handwritten: [], fresh: [] };
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
      const written = writeV2(dir, DATA, NOTHING_HELD);
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
      writeV2(dir, DATA, { ...NOTHING_HELD, fresh });
      const line = JSON.parse(readFileSync(join(dir, 'v2_handwritten_fresh.jsonl'), 'utf8').trim()) as Record<string, unknown>;
      expect(line).toMatchObject({ id: 'F-x', category: 'Other', maskedText: 'Write to me at [EMAIL_ADDRESS] please' });
      expect(readdirSync(dir).sort()).toEqual([...EXPECTED_FILES, 'v2_handwritten_fresh.jsonl'].sort());
    });
  });

  // One row per held-out set and per place its text could hide. Each planted
  // text differs from the ticket it copies by case only. The bundle is scored
  // on the first hand-written set too, and settings are picked on the practice
  // held-out files, so both are covered, not only the training lists.
  const trainText = (DATA.train[0]?.text ?? '').toUpperCase();
  const tuneText = (DATA.tuning[0]?.train[0]?.text ?? '').toUpperCase();
  const heldoutText = (DATA.heldout[1]?.tickets[0]?.text ?? '').toUpperCase();
  it.each([
    ['a fresh hand-written text is in the training file', { fresh: [{ id: 'F-y', text: trainText }] }, 'E_HANDWRITTEN_IN_TRAIN'],
    ['a first-set hand-written text is in the training file', { handwritten: [{ id: 'H-y', text: trainText }] }, 'E_HANDWRITTEN_IN_TRAIN'],
    ['a hand-written text is in a practice held-out file', { handwritten: [{ id: 'H-z', text: heldoutText }] }, 'E_HANDWRITTEN_IN_TRAIN'],
    ['a blind text is in a tuning file', { blind: [{ text: tuneText }] }, 'E_BLIND_IN_TRAIN'],
    ['a blind text is in a practice held-out file', { blind: [{ text: heldoutText }] }, 'E_BLIND_IN_TRAIN'],
  ])('stops before any file is written when %s', (_name, held, code) => {
    expect(trainText.length * tuneText.length * heldoutText.length).toBeGreaterThan(0);
    scratchDir((dir) => {
      const target = join(dir, 'out');
      expect(() => writeV2(target, DATA, { ...NOTHING_HELD, ...held })).toThrow(code);
      expect(existsSync(target)).toBe(false);
    });
  });

  it.each([
    ['the training file', (leaked: Ticket): V2Data => ({ ...DATA, train: [...DATA.train, leaked] })],
    [
      'a practice held-out file',
      (leaked: Ticket): V2Data => ({ ...DATA, heldout: DATA.heldout.map((set, index) => (index === 3 ? { ...set, tickets: [...set.tickets, leaked] } : set)) }),
    ],
  ])('stops before any file is written when a desk text is in %s', (_name, withLeak) => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const leaked = DATA.desk[0];
      expect(leaked).toBeDefined();
      expect(() => writeV2(target, withLeak(leaked as Ticket), NOTHING_HELD)).toThrow('E_DESK_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    });
  });

  // A model trains on the masked text, where every email address reads the
  // same, so these two are one ticket to it.
  it('counts a blind text as leaked when it differs from a training text only in a made-up email address', () => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const base = DATA.train[0];
      expect(base).toBeDefined();
      const trained = { ...(base as Ticket), text: 'Please send the invoice copy to pat@mail.example.net today' };
      const blind = [{ text: 'Please send the invoice copy to sam@post.example.org today' }];
      expect(() => writeV2(target, { ...DATA, train: [...DATA.train, trained] }, { ...NOTHING_HELD, blind })).toThrow('E_BLIND_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    });
  });

  it('stops before any file is written when a practice model would be scored on a ticket it trained on', () => {
    scratchDir((dir) => {
      const target = join(dir, 'out');
      const first = DATA.tuning[0];
      const scored = DATA.heldout[first?.leftOut[0] ?? 0]?.tickets[0];
      expect(first).toBeDefined();
      expect(scored).toBeDefined();
      const tuning = DATA.tuning.map((set, index) => (index === 0 ? { ...set, train: [...set.train, scored as Ticket] } : set));
      expect(() => writeV2(target, { ...DATA, tuning }, NOTHING_HELD)).toThrow('E_TUNE_OVERLAP');
      expect(existsSync(target)).toBe(false);
    });
  });
});
