import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_TICKETS, generateTicket, type Ticket } from '../src/generator/generate';
import { BLIND_WORDING } from './blind/blindFrames';
import { isRunAsCommand, normalizeText, toJsonl } from './exportDataset';

// No other export uses this seed, so no blind ticket shares its random draws
// with a training or test ticket.
export const BLIND_SEED = 301;
const BLIND_COUNT = 2_000;
const OUTPUT_DIR = new URL('../../ml/data/', import.meta.url);

// The blind set is written from wording no model trains on. A text that comes
// out twice is kept once, so one sentence never counts as two results.
export function buildBlind(count: number = BLIND_COUNT): Ticket[] {
  const kept: Ticket[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < MAX_TICKETS && kept.length < count; index += 1) {
    const ticket = generateTicket(BLIND_SEED, index, 'all', BLIND_WORDING);
    const key = normalizeText(ticket.text);
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(ticket);
    }
  }
  if (kept.length < count) {
    throw new Error('E_BLIND_SHORT');
  }
  return kept;
}

// Written once and then frozen: a set that could be written again could be
// changed after a model had been scored on it. The fingerprint beside it lets
// any later check prove the file is still the one that was frozen.
export function writeBlind(outputDir: string, tickets: Ticket[]): { target: string; rows: number } {
  const target = join(outputDir, 'blind.jsonl');
  if (existsSync(target)) {
    throw new Error('E_BLIND_EXISTS');
  }
  mkdirSync(outputDir, { recursive: true });
  const content = toJsonl(tickets, null);
  writeFileSync(target, content, 'utf8');
  writeFileSync(join(outputDir, 'blind.sha256'), `${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')}\n`, 'utf8');
  return { target, rows: tickets.length };
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const { target, rows } = writeBlind(fileURLToPath(OUTPUT_DIR), buildBlind());
  console.log(`wrote ${target} (${rows} rows)`);
}
