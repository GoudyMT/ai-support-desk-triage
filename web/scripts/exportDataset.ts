import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_TICKETS, generateTicket, generateTickets, type Pool, type Ticket } from '../src/generator/generate';

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

export function exportTickets(seed: number, count: number, pool: Pool = 'all'): Ticket[] {
  checkExportSeed(seed);
  return generateTickets(seed, count, pool);
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

// Held-out tickets come from wording the model never trains on, but the shared
// openers, closers and requests could still rebuild a training text exactly.
// Any ticket whose normalised text is in the training set is skipped (its index
// is not reused), so the score never rewards remembering a training text.
export function exportHeldout(
  seed: number,
  trainTexts: ReadonlySet<string>,
  count: number,
  walkLimit: number = MAX_TICKETS,
): Ticket[] {
  checkExportSeed(seed);
  const kept: Ticket[] = [];
  for (let index = 0; index < walkLimit && kept.length < count; index += 1) {
    const ticket = generateTicket(seed, index, 'heldout');
    if (!trainTexts.has(normalizeText(ticket.text))) {
      kept.push(ticket);
    }
  }
  if (kept.length < count) {
    throw new Error('E_HELDOUT_SHORT');
  }
  return kept;
}

export function buildDatasets(): { train: Ticket[]; heldout: Ticket[] } {
  const train = exportTickets(TRAIN_SEED, TRAIN_COUNT, 'train');
  const trainTexts = new Set(train.map((ticket) => normalizeText(ticket.text)));
  return { train, heldout: exportHeldout(HELDOUT_SEED, trainTexts, HELDOUT_COUNT) };
}

// Every line carries all eight keys, with null for what a ticket lacks, so the
// reader on the Python side never has to guess whether a key is missing.
export function toJsonl(tickets: Ticket[]): string {
  return tickets
    .map((ticket) =>
      JSON.stringify({
        id: ticket.id,
        text: ticket.text,
        category: ticket.label.category,
        secondary: ticket.label.secondary ?? null,
        priority: ticket.label.priority,
        mustReview: ticket.label.mustReview,
        reviewReason: ticket.label.reviewReason ?? null,
        hardCase: ticket.hardCase ?? null,
      }) + '\n',
    )
    .join('');
}

function writeDataset(fileName: string, tickets: Ticket[]): void {
  const target = fileURLToPath(new URL(fileName, OUTPUT_DIR));
  writeFileSync(target, toJsonl(tickets), 'utf8');
  console.log(`wrote ${target} (${tickets.length} rows)`);
}

function main(): void {
  mkdirSync(fileURLToPath(OUTPUT_DIR), { recursive: true });
  const { train, heldout } = buildDatasets();
  writeDataset('train.jsonl', train);
  writeDataset('heldout.jsonl', heldout);
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
