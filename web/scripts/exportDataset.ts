import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateTickets, type Ticket } from '../src/generator/generate';

export const TRAIN_SEED = 1;
export const HELDOUT_SEED = 2;
const TRAIN_COUNT = 20_000;
const HELDOUT_COUNT = 4_000;
// Seeds from 1000 up are for live demo runs, so a dataset never uses them.
const MIN_EXPORT_SEED = 1;
const MAX_EXPORT_SEED = 999;

// Relative to this file, so the command works from any current folder.
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

export function exportTickets(seed: number, count: number): Ticket[] {
  if (!Number.isInteger(seed) || seed < MIN_EXPORT_SEED || seed > MAX_EXPORT_SEED) {
    throw new Error('E_SEED_RANGE');
  }
  return generateTickets(seed, count);
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

function writeDataset(fileName: string, seed: number, count: number): void {
  const content = toJsonl(exportTickets(seed, count));
  writeFileSync(fileURLToPath(new URL(fileName, OUTPUT_DIR)), content, 'utf8');
}

function main(): void {
  mkdirSync(fileURLToPath(OUTPUT_DIR), { recursive: true });
  writeDataset('train.jsonl', TRAIN_SEED, TRAIN_COUNT);
  writeDataset('heldout.jsonl', HELDOUT_SEED, HELDOUT_COUNT);
}

// Run only as a command, never when a test imports the functions above.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
