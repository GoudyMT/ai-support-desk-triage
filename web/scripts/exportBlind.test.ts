import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTickets } from '../src/generator/generate';
import { BLIND_SEED, buildBlind, writeBlind } from './exportBlind';
import {
  HELDOUT_SEED,
  TRAIN_SEED,
  assertBlindIsolated,
  normalizeText,
  writeDatasets,
  writeTuningSets,
  type FoldDataset,
} from './exportDataset';

const SMALL_BLIND = 300;
const FOLDS_SMALL: FoldDataset[] = [0, 1, 2, 3].map((fold) => ({
  fold,
  train: generateTickets(TRAIN_SEED, 3, { fold, side: 'train' }),
  heldout: generateTickets(HELDOUT_SEED, 2, { fold, side: 'heldout' }),
}));
const TRAIN_ALL = generateTickets(TRAIN_SEED, 4);

// The same words as a training ticket, as a person would call them, with other
// case, spacing and punctuation.
function disguised(text: string): string {
  return `  ${text.toUpperCase().replace(/[.,!?]/g, ' ;')}  `;
}

describe('the blind test set', () => {
  it('is the same tickets every time it is built, with no text twice', () => {
    const first = buildBlind(SMALL_BLIND);
    expect(buildBlind(SMALL_BLIND)).toEqual(first);
    expect(first).toHaveLength(SMALL_BLIND);
    expect(new Set(first.map((ticket) => normalizeText(ticket.text))).size).toBe(SMALL_BLIND);
    expect(first.every((ticket) => ticket.seed === BLIND_SEED)).toBe(true);
  });

  it('uses a seed no training or test export uses', () => {
    expect([TRAIN_SEED, HELDOUT_SEED]).not.toContain(BLIND_SEED);
  });

  it('writes the file and a fingerprint that matches its bytes, and never writes over a frozen set', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'blind-'));
    try {
      const written = writeBlind(scratch, buildBlind(20));
      const bytes = readFileSync(join(scratch, 'blind.jsonl'));
      expect(written.rows).toBe(20);
      expect(readFileSync(join(scratch, 'blind.sha256'), 'utf8').trim()).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(() => writeBlind(scratch, buildBlind(21))).toThrow('E_BLIND_EXISTS');
      expect(readFileSync(join(scratch, 'blind.jsonl')).equals(bytes)).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('keeping the blind set out of training', () => {
  const leakedText = TRAIN_ALL[0]?.text ?? '';
  const blind = [{ text: 'a blind ticket nothing trains on' }, { text: disguised(leakedText) }];

  it('throws E_BLIND_IN_TRAIN for a blind text that differs from a training text only by case, spacing or punctuation', () => {
    expect(leakedText).not.toBe('');
    expect(() => assertBlindIsolated(blind, [TRAIN_ALL])).toThrow('E_BLIND_IN_TRAIN');
    expect(() => assertBlindIsolated([{ text: 'a blind ticket nothing trains on' }], [TRAIN_ALL])).not.toThrow();
  });

  it('stops the training export before any file is written', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'blind-guard-'));
    try {
      const target = join(scratch, 'out');
      expect(() => writeDatasets(target, FOLDS_SMALL, TRAIN_ALL, [], blind)).toThrow('E_BLIND_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('stops the tuning export before any file is written', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'blind-tune-'));
    try {
      const sets = [{ leftOut: [0, 1] as [number, number], train: TRAIN_ALL }];
      expect(() => writeTuningSets(scratch, sets, FOLDS_SMALL, [], blind)).toThrow('E_BLIND_IN_TRAIN');
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
