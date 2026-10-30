import { describe, expect, it } from 'vitest';
import { generateTickets } from '../src/generator/generate';
import { HELDOUT_SEED, TRAIN_SEED, exportTickets, toJsonl } from './exportDataset';

const SEED = 7;

describe('toJsonl', () => {
  // The Python trainer reads these lines; a missing or renamed key would break
  // it, or silently train on the wrong column.
  it('writes one line per ticket with all eight keys, null for absent fields', () => {
    const tickets = generateTickets(SEED, 400);
    const plain = tickets.find((t) => t.label.secondary === undefined && t.hardCase === undefined);
    const rich = tickets.find((t) => t.label.secondary !== undefined && t.label.reviewReason !== undefined && t.hardCase !== undefined);
    if (plain === undefined || rich === undefined) {
      throw new Error('sample has no plain or rich ticket');
    }
    const output = toJsonl([plain, rich]);
    expect(output.endsWith('\n')).toBe(true);
    const lines = output.slice(0, -1).split('\n');
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const KEYS = ['category', 'hardCase', 'id', 'mustReview', 'priority', 'reviewReason', 'secondary', 'text'];
    expect(Object.keys(first ?? {}).sort()).toEqual(KEYS);
    expect(Object.keys(second ?? {}).sort()).toEqual(KEYS);
    expect(first).toEqual({
      id: plain.id,
      text: plain.text,
      category: plain.label.category,
      secondary: plain.label.secondary ?? null,
      priority: plain.label.priority,
      mustReview: plain.label.mustReview,
      reviewReason: plain.label.reviewReason ?? null,
      hardCase: null,
    });
    expect(second).toEqual({
      id: rich.id,
      text: rich.text,
      category: rich.label.category,
      secondary: rich.label.secondary,
      priority: rich.label.priority,
      mustReview: rich.label.mustReview,
      reviewReason: rich.label.reviewReason,
      hardCase: rich.hardCase,
    });
  });
});

describe('exportTickets', () => {
  // A model scored on tickets it trained on looks better than it is.
  it('gives the training and held-out sets no ticket in common', () => {
    const train = new Set(exportTickets(TRAIN_SEED, 300).map((t) => t.id));
    const heldout = exportTickets(HELDOUT_SEED, 300).map((t) => t.id);
    expect(heldout.filter((id) => train.has(id))).toEqual([]);
  });

  // Seeds from 1000 up belong to live demo runs and must never feed training.
  it.each([1000, 0, 1.5])('refuses seed %s outside 1 to 999', (seed) => {
    expect(() => exportTickets(seed, 1)).toThrow('E_SEED_RANGE');
  });

  it('accepts the edges of the training range', () => {
    expect(exportTickets(1, 1)).toHaveLength(1);
    expect(exportTickets(999, 1)).toHaveLength(1);
  });
});
