import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { v0Triage } from '../src/baseline/v0';
import { CATEGORIES } from '../src/domain/labels';
import { HARD_CASE_SHARES, generateTicket, generateTickets, type HardCase } from '../src/generator/generate';
import { FOLDS } from '../src/generator/templates';
import { maskText } from '../src/privacy/mask';
import {
  HELDOUT_COUNT,
  HELDOUT_SEED,
  TRAIN_SEED,
  assertHandwrittenIsolated,
  buildDatasets,
  exportHeldout,
  exportTickets,
  isRunAsCommand,
  loadHandwritten,
  normalizeText,
  toJsonl,
  writeDatasets,
  type FoldDataset,
} from './exportDataset';

const SEED = 7;
const HARD_CASES = Object.keys(HARD_CASE_SHARES) as HardCase[];
const FOLD_IDS = Array.from({ length: FOLDS }, (_, fold) => fold);
const HANDWRITTEN_ROWS = 48;
// Read here on its own, not through the exporter, so the comparison is between
// two readings of the frozen file.
const FROZEN_URL = new URL('../../ml/data/handwritten.jsonl', import.meta.url);

function parseJsonl(raw: string): Record<string, unknown>[] {
  return raw
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('toJsonl', () => {
  // The Python trainer reads these lines; a missing or renamed key would break
  // it, or silently train on the wrong column.
  it('writes one line per ticket with all eleven keys, null for absent fields, the fold of the file, and null fold for the all-wording file', () => {
    const tickets = generateTickets(SEED, 400);
    const plain = tickets.find((t) => t.label.secondary === undefined && t.hardCase === undefined);
    const rich = tickets.find((t) => t.label.secondary !== undefined && t.label.reviewReason !== undefined && t.hardCase !== undefined);
    if (plain === undefined || rich === undefined) {
      throw new Error('E_TEST_SAMPLE');
    }
    const output = toJsonl([plain, rich], 2);
    expect(output.endsWith('\n')).toBe(true);
    const lines = output.slice(0, -1).split('\n');
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const KEYS = ['category', 'fold', 'hardCase', 'id', 'maskedText', 'mustReview', 'priority', 'reviewReason', 'secondary', 'text', 'v0'];
    expect(Object.keys(first ?? {}).sort()).toEqual(KEYS);
    expect(Object.keys(second ?? {}).sort()).toEqual(KEYS);
    expect(first).toEqual({
      id: plain.id,
      text: plain.text,
      maskedText: maskText(plain.text).text,
      v0: v0Triage(plain.text),
      category: plain.label.category,
      secondary: plain.label.secondary ?? null,
      priority: plain.label.priority,
      mustReview: plain.label.mustReview,
      reviewReason: plain.label.reviewReason ?? null,
      hardCase: null,
      fold: 2,
    });
    expect(second).toEqual({
      id: rich.id,
      text: rich.text,
      maskedText: maskText(rich.text).text,
      v0: v0Triage(rich.text),
      category: rich.label.category,
      secondary: rich.label.secondary,
      priority: rich.label.priority,
      mustReview: rich.label.mustReview,
      reviewReason: rich.label.reviewReason,
      hardCase: rich.hardCase,
      fold: 2,
    });
    expect(JSON.parse(toJsonl([plain], null)) as { fold: unknown }).toMatchObject({ fold: null });
  });

  // The trainer fits on maskedText, so a ticket with fake personal data must
  // reach the file already masked, while v0 is scored on the raw wording the
  // original page would have read.
  it('masks a ticket that carries fake personal data and runs v0 on the raw text', () => {
    const tickets = generateTickets(SEED, 400);
    const withData = tickets.find((t) => maskText(t.text).text !== t.text);
    if (withData === undefined) {
      throw new Error('E_TEST_SAMPLE');
    }
    const row = JSON.parse(toJsonl([withData], 0)) as { text: string; maskedText: string; v0: unknown };
    expect(row.text).toBe(withData.text);
    expect(row.maskedText).not.toBe(withData.text);
    expect(row.maskedText).toBe(maskText(withData.text).text);
    expect(row.v0).toEqual(v0Triage(withData.text));
  });

  // The original page read the visitor's raw words. An address whose name holds
  // a v0 keyword ("ada") makes raw and masked wording score differently, so a
  // v0 run on the masked text would be measured against the wrong baseline.
  it('gives v0 the answer for the raw text even when masking would change it', () => {
    const [base] = generateTickets(SEED, 1);
    if (base === undefined) {
      throw new Error('E_TEST_SAMPLE');
    }
    const ticket = { ...base, text: 'You can reach me at ada@example.test about the invoice.' };
    expect(v0Triage(maskText(ticket.text).text)).not.toEqual(v0Triage(ticket.text));
    const row = JSON.parse(toJsonl([ticket], 0)) as { v0: unknown };
    expect(row.v0).toEqual(v0Triage(ticket.text));
  });
});

// The command writes the files the Python side trains on, so the names, the
// fold in every row and the old single files all matter.
describe('writeDatasets', () => {
  const SMALL: FoldDataset[] = FOLD_IDS.map((fold) => ({
    fold,
    train: generateTickets(TRAIN_SEED, 3, { fold, side: 'train' }),
    heldout: generateTickets(HELDOUT_SEED, 2, { fold, side: 'heldout' }),
  }));

  const TRAIN_ALL_ROWS = 4;
  const TRAIN_ALL = generateTickets(TRAIN_SEED, TRAIN_ALL_ROWS);
  const HANDWRITTEN = loadHandwritten();

  it('writes train_<k>, heldout_<k>, train_all and handwritten, no train.jsonl or heldout.jsonl, and reports each with its row count', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'export-folds-'));
    try {
      const written = writeDatasets(join(scratch, 'nested'), SMALL, TRAIN_ALL, HANDWRITTEN);
      const expected = [...FOLD_IDS.flatMap((fold) => [`train_${fold}.jsonl`, `heldout_${fold}.jsonl`]), 'train_all.jsonl', 'handwritten.jsonl'];
      expect(readdirSync(join(scratch, 'nested')).sort()).toEqual([...expected].sort());
      expect(written.map(({ target }) => target.split(/[\\/]/).pop())).toEqual(expected);
      expect(written.map(({ rows }) => rows)).toEqual([...FOLD_IDS.flatMap(() => [3, 2]), TRAIN_ALL_ROWS, HANDWRITTEN_ROWS]);
      for (const { target, rows } of written) {
        const lines = readFileSync(target, 'utf8').trimEnd().split('\n');
        expect(lines).toHaveLength(rows);
        const fold = /_(\d)\.jsonl$/.exec(target)?.[1];
        if (target.endsWith('train_all.jsonl')) {
          // The shipped model is fit on all wording, so no row belongs to a fold.
          for (const line of lines) {
            expect((JSON.parse(line) as { fold: unknown }).fold).toBeNull();
          }
        } else if (fold !== undefined) {
          for (const line of lines) {
            expect((JSON.parse(line) as { fold: number }).fold).toBe(Number(fold));
          }
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // The hand-written set is the one score the model never saw in any form, so
  // the file must keep the frozen answers byte for byte and only add columns.
  it('writes the 48 hand-written rows in order with every frozen field unchanged plus maskedText and v0', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'export-hand-'));
    try {
      writeDatasets(scratch, SMALL, TRAIN_ALL, HANDWRITTEN);
      const frozen = parseJsonl(readFileSync(FROZEN_URL, 'utf8'));
      const out = parseJsonl(readFileSync(join(scratch, 'handwritten.jsonl'), 'utf8'));
      expect(out).toHaveLength(HANDWRITTEN_ROWS);
      expect(out.map(({ id }) => id)).toEqual(frozen.map(({ id }) => id));
      for (const [position, row] of out.entries()) {
        const { maskedText, v0, ...original } = row;
        expect(original).toEqual(frozen[position]);
        expect(maskedText).toBe(maskText(String(row.text)).text);
        expect(v0).toEqual(v0Triage(String(row.text)));
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // A hand-written text found in a training list would make the hand-written
  // score a memory test, so the export must stop before it writes anything.
  it('throws E_HANDWRITTEN_IN_TRAIN, writing no file, when a training list holds a hand-written text with other case and punctuation', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'export-guard-'));
    try {
      const [sample] = generateTickets(TRAIN_SEED, 1);
      const handwritten = HANDWRITTEN[0]?.text ?? '';
      if (sample === undefined || handwritten === '') {
        throw new Error('E_TEST_SAMPLE');
      }
      const leaked = [{ ...sample, text: `${handwritten.toUpperCase()}!!` }];
      const target = join(scratch, 'nested');
      expect(() => writeDatasets(target, SMALL, leaked, HANDWRITTEN)).toThrow('E_HANDWRITTEN_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
      const inFold = SMALL.map((dataset) => ({ ...dataset, train: leaked }));
      expect(() => writeDatasets(target, inFold, TRAIN_ALL, HANDWRITTEN)).toThrow('E_HANDWRITTEN_IN_TRAIN');
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('the exported sets', () => {
  const DATASETS = buildDatasets();

  it('builds one dataset per fold, in order', () => {
    expect(DATASETS.map(({ fold }) => fold)).toEqual(FOLD_IDS);
  });

  // The real export must pass its own guard: no hand-written text is in any
  // fold's training list or in the all-wording list the shipped model is fit on.
  it('keeps every hand-written text out of the four fold training sets and the all-wording set', () => {
    const trainingLists = [...DATASETS.map(({ train }) => train), exportTickets(TRAIN_SEED, 20_000)];
    expect(trainingLists).toHaveLength(FOLDS + 1);
    expect(() => assertHandwrittenIsolated(loadHandwritten(), trainingLists)).not.toThrow();
  });

  // A model scored on a text it trained on looks better than it is. Ids can
  // never collide (the seed is in them), so the words are what is compared.
  it.each(FOLD_IDS)('gives the training and held-out sets of fold %i no text in common', (fold) => {
    const { train, heldout } = DATASETS[fold] ?? { train: [], heldout: [] };
    const trained = new Set(train.map((ticket) => normalizeText(ticket.text)));
    const repeated = heldout.filter((ticket) => trained.has(normalizeText(ticket.text)));
    expect(repeated.map((ticket) => ticket.text)).toEqual([]);
  });

  it.each(FOLD_IDS)('holds exactly 4,000 held-out rows in fold %i, every category and every hard case among them', (fold) => {
    const { train, heldout } = DATASETS[fold] ?? { train: [], heldout: [] };
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
  // to the model, and one built from the wrong fold would test the wrong
  // wording.
  it.each(FOLD_IDS)('builds the training set of fold %i from the other folds, seed 1', (fold) => {
    const FIRST = 200;
    expect((DATASETS[fold]?.train ?? []).slice(0, FIRST)).toEqual(generateTickets(TRAIN_SEED, FIRST, { fold, side: 'train' }));
  });

  // The held-out ids come from the indices that were kept, so a skipped index
  // leaves a gap and an id still points at the ticket that has it.
  it.each(FOLD_IDS)('names each held-out row of fold %i T-2-<index> and rebuilds it from that index', (fold) => {
    for (const ticket of (DATASETS[fold]?.heldout ?? []).slice(0, 50)) {
      expect(ticket.id).toBe(`T-${HELDOUT_SEED}-${ticket.index}`);
      expect(generateTicket(HELDOUT_SEED, ticket.index, { fold, side: 'heldout' })).toEqual(ticket);
    }
  });
});

describe('exportHeldout', () => {
  const NO_TEXTS: ReadonlySet<string> = new Set();
  const FOLD = 2;
  const HELDOUT = { fold: FOLD, side: 'heldout' } as const;

  // The first held-out ticket is stood in for a training text: it must go, and
  // the next index must take its place.
  it('skips a ticket whose text is in the training set and keeps the id of the index it came from', () => {
    const first = generateTicket(HELDOUT_SEED, 0, HELDOUT);
    const kept = exportHeldout(HELDOUT_SEED, FOLD, new Set([normalizeText(first.text)]), 3);
    expect(kept.map((ticket) => ticket.index)).not.toContain(0);
    expect(kept).toHaveLength(3);
    expect(kept[0]?.id).toBe(`T-${HELDOUT_SEED}-${kept[0]?.index}`);
  });

  it('matches a training text that differs only in case, spacing and punctuation', () => {
    const first = generateTicket(HELDOUT_SEED, 0, HELDOUT);
    const reworded = ` ${first.text.toUpperCase().replace(/ /g, '   ')}!! `;
    const kept = exportHeldout(HELDOUT_SEED, FOLD, new Set([normalizeText(reworded)]), 1);
    expect(kept[0]?.index).not.toBe(0);
  });

  // Walking the whole allowance without enough tickets must stop the export,
  // not write a short held-out file.
  it('throws E_HELDOUT_SHORT when the walk ends before the count is reached', () => {
    expect(() => exportHeldout(HELDOUT_SEED, FOLD, NO_TEXTS, 5, 4)).toThrow('E_HELDOUT_SHORT');
    expect(exportHeldout(HELDOUT_SEED, FOLD, NO_TEXTS, 4, 4)).toHaveLength(4);
  });

  it('draws from the wording of the fold it is given', () => {
    const [first] = exportHeldout(HELDOUT_SEED, 3, NO_TEXTS, 1);
    expect(first).toEqual(generateTicket(HELDOUT_SEED, first?.index ?? 0, { fold: 3, side: 'heldout' }));
    expect(first?.text).not.toBe(generateTicket(HELDOUT_SEED, first?.index ?? 0, { fold: 0, side: 'heldout' }).text);
  });

  it.each([1000, 0])('refuses seed %s outside 1 to 999', (seed) => {
    expect(() => exportHeldout(seed, FOLD, NO_TEXTS, 1)).toThrow('E_SEED_RANGE');
  });

  it.each([4, -1])('refuses fold %s with E_SPLIT_RANGE', (fold) => {
    expect(() => exportHeldout(HELDOUT_SEED, fold, NO_TEXTS, 1)).toThrow('E_SPLIT_RANGE');
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
