import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v0Triage } from '../src/baseline/v0';
import { MAX_TICKETS, generateTicket, generateTickets, type Split, type Ticket } from '../src/generator/generate';
import { FOLDS } from '../src/generator/templates';
import { maskText } from '../src/privacy/mask';

export const TRAIN_SEED = 1;
export const HELDOUT_SEED = 2;
const TRAIN_COUNT = 20_000;
export const HELDOUT_COUNT = 4_000;
// Seeds from 1000 up are for live demo runs, so a dataset never uses them.
const MIN_EXPORT_SEED = 1;
const MAX_EXPORT_SEED = 999;

// Relative to this file, so the command works from any current folder.
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

function checkExportSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < MIN_EXPORT_SEED || seed > MAX_EXPORT_SEED) {
    throw new Error('E_SEED_RANGE');
  }
}

export function exportTickets(seed: number, count: number, split: Split = 'all'): Ticket[] {
  checkExportSeed(seed);
  return generateTickets(seed, count, split);
}

// Lower case, every run of characters that are not letters or digits as one
// space: two texts that differ only in case, spacing or punctuation read the
// same to a person and to a word-count model.
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A fold keeps its held-out wording apart from its training wording, so no
// held-out text should be in the training set. This is the guard for the day two
// lists come to hold the same sentence: a ticket whose normalised text is in the
// training set is skipped (its index is not reused), so the score never rewards
// remembering a training text.
export function exportHeldout(
  seed: number,
  fold: number,
  trainTexts: ReadonlySet<string>,
  count: number,
  walkLimit: number = MAX_TICKETS,
): Ticket[] {
  checkExportSeed(seed);
  const kept: Ticket[] = [];
  for (let index = 0; index < walkLimit && kept.length < count; index += 1) {
    const ticket = generateTicket(seed, index, { fold, side: 'heldout' });
    if (!trainTexts.has(normalizeText(ticket.text))) {
      kept.push(ticket);
    }
  }
  if (kept.length < count) {
    throw new Error('E_HELDOUT_SHORT');
  }
  return kept;
}

export interface FoldDataset {
  fold: number;
  train: Ticket[];
  heldout: Ticket[];
}

// Fold k trains on the wording of the other three folds and is scored on its own.
export function buildFold(fold: number): FoldDataset {
  const train = exportTickets(TRAIN_SEED, TRAIN_COUNT, { fold, side: 'train' });
  const trainTexts = new Set(train.map((ticket) => normalizeText(ticket.text)));
  return { fold, train, heldout: exportHeldout(HELDOUT_SEED, fold, trainTexts, HELDOUT_COUNT) };
}

export function buildDatasets(): FoldDataset[] {
  return Array.from({ length: FOLDS }, (_, fold) => buildFold(fold));
}

// The frozen hand-written set is only ever read; the exporter writes a copy
// with two more columns beside the generated files.
const HANDWRITTEN_SOURCE = new URL('../../ml/data/handwritten.jsonl', import.meta.url);

export interface HandwrittenRow extends Record<string, unknown> {
  text: string;
}

export function loadHandwritten(): HandwrittenRow[] {
  return readFileSync(HANDWRITTEN_SOURCE, 'utf8')
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as HandwrittenRow);
}

// The hand-written set is the one score the model must never have seen, so a
// hand-written text found in any training list (same normalised wording) stops
// the export before a file is written.
export function assertHandwrittenIsolated(
  handwritten: readonly { text: string }[],
  trainingLists: readonly (readonly { text: string }[])[],
): void {
  const handwrittenTexts = new Set(handwritten.map(({ text }) => normalizeText(text)));
  for (const list of trainingLists) {
    if (list.some(({ text }) => handwrittenTexts.has(normalizeText(text)))) {
      throw new Error('E_HANDWRITTEN_IN_TRAIN');
    }
  }
}

// Every line carries all eleven keys, with null for what a ticket lacks, so the
// reader on the Python side never has to guess whether a key is missing. `fold`
// names the fold the file belongs to, or is null for the file of all wording.
// `maskedText` is what the model trains on; `v0` is the answer of the original
// keyword page on the raw text, so both are scored on identical rows.
export function toJsonl(tickets: Ticket[], fold: number | null): string {
  return tickets
    .map((ticket) =>
      JSON.stringify({
        id: ticket.id,
        text: ticket.text,
        maskedText: maskText(ticket.text).text,
        v0: v0Triage(ticket.text),
        category: ticket.label.category,
        secondary: ticket.label.secondary ?? null,
        priority: ticket.label.priority,
        mustReview: ticket.label.mustReview,
        reviewReason: ticket.label.reviewReason ?? null,
        hardCase: ticket.hardCase ?? null,
        fold,
      }) + '\n',
    )
    .join('');
}

// The hand-written rows keep every frozen field as it was, in order, and gain
// the same two columns the generated rows carry.
function handwrittenToJsonl(rows: HandwrittenRow[]): string {
  return rows
    .map((row) => JSON.stringify({ ...row, maskedText: maskText(row.text).text, v0: v0Triage(row.text) }) + '\n')
    .join('');
}

// Two files per fold, train_<k>.jsonl and heldout_<k>.jsonl, then train_all.jsonl
// (fold null) and handwritten.jsonl. The isolation check runs first, so a leak
// leaves no file behind. Returns each file written with its row count.
export function writeDatasets(
  outputDir: string,
  datasets: FoldDataset[],
  trainAll: Ticket[],
  handwritten: HandwrittenRow[],
): { target: string; rows: number }[] {
  assertHandwrittenIsolated(handwritten, [...datasets.map(({ train }) => train), trainAll]);
  mkdirSync(outputDir, { recursive: true });
  const written: { target: string; rows: number }[] = [];
  const files: [string, string, number][] = [];
  for (const { fold, train, heldout } of datasets) {
    files.push([`train_${fold}.jsonl`, toJsonl(train, fold), train.length]);
    files.push([`heldout_${fold}.jsonl`, toJsonl(heldout, fold), heldout.length]);
  }
  files.push(['train_all.jsonl', toJsonl(trainAll, null), trainAll.length]);
  files.push(['handwritten.jsonl', handwrittenToJsonl(handwritten), handwritten.length]);
  for (const [name, content, rows] of files) {
    const target = join(outputDir, name);
    writeFileSync(target, content, 'utf8');
    written.push({ target, rows });
  }
  return written;
}

function main(): void {
  const trainAll = exportTickets(TRAIN_SEED, TRAIN_COUNT);
  for (const { target, rows } of writeDatasets(fileURLToPath(OUTPUT_DIR), buildDatasets(), trainAll, loadHandwritten())) {
    console.log(`wrote ${target} (${rows} rows)`);
  }
}

// True when this file is the command being run. Both paths are resolved first:
// reached through a junction or symlink, argv[1] keeps the link's path while
// the module URL holds the real one, and comparing them as written would be
// false, so the command would exit 0 and write nothing.
export function isRunAsCommand(entryPath: string | undefined, moduleUrl: string): boolean {
  return entryPath !== undefined && realpathSync(entryPath) === realpathSync(fileURLToPath(moduleUrl));
}

// Run only as a command, never when a test imports the functions above.
if (isRunAsCommand(process.argv[1], import.meta.url)) {
  main();
}
