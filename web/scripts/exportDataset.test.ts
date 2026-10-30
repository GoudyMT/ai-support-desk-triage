import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/domain/labels';
import { HARD_CASE_SHARES, generateTicket, generateTickets, type HardCase } from '../src/generator/generate';
import {
  HELDOUT_COUNT,
  HELDOUT_SEED,
  TRAIN_SEED,
  buildDatasets,
  exportHeldout,
  exportTickets,
  isRunAsCommand,
  normalizeText,
  toJsonl,
} from './exportDataset';

const SEED = 7;
const HARD_CASES = Object.keys(HARD_CASE_SHARES) as HardCase[];

describe('toJsonl', () => {
  // The Python trainer reads these lines; a missing or renamed key would break
  // it, or silently train on the wrong column.
  it('writes one line per ticket with all eight keys, null for absent fields', () => {
    const tickets = generateTickets(SEED, 400);
    const plain = tickets.find((t) => t.label.secondary === undefined && t.hardCase === undefined);
    const rich = tickets.find((t) => t.label.secondary !== undefined && t.label.reviewReason !== undefined && t.hardCase !== undefined);
    if (plain === undefined || rich === undefined) {
      throw new Error('E_TEST_SAMPLE');
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

describe('the exported sets', () => {
  const { train, heldout } = buildDatasets();

  // A model scored on a text it trained on looks better than it is. Ids can
  // never collide (the seed is in them), so the words are what is compared.
  it('gives the training and held-out sets no text in common', () => {
    const trained = new Set(train.map((ticket) => normalizeText(ticket.text)));
    const repeated = heldout.filter((ticket) => trained.has(normalizeText(ticket.text)));
    expect(repeated.map((ticket) => ticket.text)).toEqual([]);
  });

  it('holds exactly 4,000 held-out rows, every category and every hard case among them', () => {
    expect(train).toHaveLength(20_000);
    expect(heldout).toHaveLength(HELDOUT_COUNT);
    expect(HELDOUT_COUNT).toBe(4_000);
    for (const category of CATEGORIES) {
      expect(heldout.some((ticket) => ticket.label.category === category), category).toBe(true);
    }
    for (const hardCase of HARD_CASES) {
      expect(heldout.some((ticket) => ticket.hardCase === hardCase), hardCase).toBe(true);
    }
  });

  // A training file built from every template would hand the held-out wording
  // to the model.
  it('builds the training set from the train pool, seed 1', () => {
    const FIRST = 200;
    expect(train.slice(0, FIRST)).toEqual(generateTickets(TRAIN_SEED, FIRST, 'train'));
  });

  // The held-out ids come from the indices that were kept, so a skipped index
  // leaves a gap and an id still points at the ticket that has it.
  it('names each held-out row T-2-<index> and rebuilds it from that index', () => {
    for (const ticket of heldout.slice(0, 50)) {
      expect(ticket.id).toBe(`T-${HELDOUT_SEED}-${ticket.index}`);
      expect(generateTicket(HELDOUT_SEED, ticket.index, 'heldout')).toEqual(ticket);
    }
  });
});

describe('exportHeldout', () => {
  const NO_TEXTS: ReadonlySet<string> = new Set();

  // The first held-out ticket is stood in for a training text: it must go, and
  // the next index must take its place.
  it('skips a ticket whose text is in the training set and keeps the id of the index it came from', () => {
    const first = generateTicket(HELDOUT_SEED, 0, 'heldout');
    const kept = exportHeldout(HELDOUT_SEED, new Set([normalizeText(first.text)]), 3);
    expect(kept.map((ticket) => ticket.index)).not.toContain(0);
    expect(kept).toHaveLength(3);
    expect(kept[0]?.id).toBe(`T-${HELDOUT_SEED}-${kept[0]?.index}`);
  });

  it('matches a training text that differs only in case, spacing and punctuation', () => {
    const first = generateTicket(HELDOUT_SEED, 0, 'heldout');
    const reworded = ` ${first.text.toUpperCase().replace(/ /g, '   ')}!! `;
    const kept = exportHeldout(HELDOUT_SEED, new Set([normalizeText(reworded)]), 1);
    expect(kept[0]?.index).not.toBe(0);
  });

  // Walking the whole allowance without enough tickets must stop the export,
  // not write a short held-out file.
  it('throws E_HELDOUT_SHORT when the walk ends before the count is reached', () => {
    expect(() => exportHeldout(HELDOUT_SEED, NO_TEXTS, 5, 4)).toThrow('E_HELDOUT_SHORT');
    expect(exportHeldout(HELDOUT_SEED, NO_TEXTS, 4, 4)).toHaveLength(4);
  });

  it.each([1000, 0])('refuses seed %s outside 1 to 999', (seed) => {
    expect(() => exportHeldout(seed, NO_TEXTS, 1)).toThrow('E_SEED_RANGE');
  });
});

describe('exportTickets', () => {
  // Seeds from 1000 up belong to live demo runs and must never feed training.
  it.each([1000, 0, 1.5])('refuses seed %s outside 1 to 999', (seed) => {
    expect(() => exportTickets(seed, 1)).toThrow('E_SEED_RANGE');
  });

  it('accepts the edges of the training range', () => {
    expect(exportTickets(1, 1)).toHaveLength(1);
    expect(exportTickets(999, 1)).toHaveLength(1);
  });
});

// The repo is often reached through a junction or symlink; then the command
// line holds the link's path and the module URL the real one.
describe('isRunAsCommand', () => {
  const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
  const SCRIPT_URL = new URL('./exportDataset.ts', import.meta.url).href;

  it('is true for the script reached directly and false for any other file or no file', () => {
    expect(isRunAsCommand(join(SCRIPT_DIR, 'exportDataset.ts'), SCRIPT_URL)).toBe(true);
    expect(isRunAsCommand(join(SCRIPT_DIR, 'exportDataset.test.ts'), SCRIPT_URL)).toBe(false);
    expect(isRunAsCommand(undefined, SCRIPT_URL)).toBe(false);
  });

  // A temp folder with its own script, linked from a second folder: the module
  // URL names the real file and the command line names the link.
  it('is true when the script is reached through a junction to its folder', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'export-junction-'));
    try {
      const real = join(scratch, 'real');
      mkdirSync(real);
      writeFileSync(join(real, 'command.ts'), '');
      const link = join(scratch, 'scripts-link');
      symlinkSync(real, link, 'junction');
      expect(isRunAsCommand(join(link, 'command.ts'), pathToFileURL(join(real, 'command.ts')).href)).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
