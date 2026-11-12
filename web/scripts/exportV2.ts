import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESK_WORDING } from '../src/generator/deskFrames';
import { EXTRA_WORDING } from '../src/generator/extraFrames';
import { BUILT_IN_WORDING, MAX_TICKETS, generateTicket, generateTickets, type Split, type Ticket } from '../src/generator/generate';
import { FOLDS } from '../src/generator/templates';
import type { Wording } from '../src/generator/wording';
import {
  FRESH_SOURCE,
  assertBlindIsolated,
  assertHandwrittenIsolated,
  handwrittenToJsonl,
  holdsAnyOf,
  isRunAsCommand,
  loadBlind,
  loadHandwritten,
  normalizeText,
  toJsonl,
  type HandwrittenRow,
} from './exportDataset';

// The second model's data. It trains on two wordings, the built-in one and the
// extra one, half its tickets from each, and it is scored on wording it never
// saw: a left-out fold of both in a practice round, and the desk wording for
// the model that ships. Each stream has its own seed, so no two tickets share
// an id or their random draws.
export const V2_SEEDS = { builtInTrain: 1, extraTrain: 11, builtInHeldout: 2, extraHeldout: 12, desk: 21 } as const;
const TRAIN_PER_WORDING = 10_000;
const HELDOUT_PER_WORDING = 2_000;
const DESK_COUNT = 4_000;
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

export interface V2Sizes {
  trainPerWording: number;
  heldoutPerWording: number;
  desk: number;
}

export const V2_SIZES: V2Sizes = { trainPerWording: TRAIN_PER_WORDING, heldoutPerWording: HELDOUT_PER_WORDING, desk: DESK_COUNT };

export function buildV2Train(split: Split, count: number): Ticket[] {
  return [
    ...generateTickets(V2_SEEDS.builtInTrain, count, split, BUILT_IN_WORDING),
    ...generateTickets(V2_SEEDS.extraTrain, count, split, EXTRA_WORDING),
  ];
}

// Tickets of one stream whose text is not among `taken`, each text once.
function freshTickets(seed: number, split: Split, wording: Wording, count: number, taken: Set<string>): Ticket[] {
  const kept: Ticket[] = [];
  for (let index = 0; index < MAX_TICKETS && kept.length < count; index += 1) {
    const ticket = generateTicket(seed, index, split, wording);
    const key = normalizeText(ticket.text);
    if (!taken.has(key)) {
      taken.add(key);
      kept.push(ticket);
    }
  }
  if (kept.length < count) {
    throw new Error('E_V2_SHORT');
  }
  return kept;
}

export function buildV2Heldout(fold: number, count: number, trainTexts: ReadonlySet<string>): Ticket[] {
  const taken = new Set(trainTexts);
  const split: Split = { fold, side: 'heldout' };
  return [
    ...freshTickets(V2_SEEDS.builtInHeldout, split, BUILT_IN_WORDING, count, taken),
    ...freshTickets(V2_SEEDS.extraHeldout, split, EXTRA_WORDING, count, taken),
  ];
}

export function buildV2Desk(count: number): Ticket[] {
  return freshTickets(V2_SEEDS.desk, 'all', DESK_WORDING, count, new Set());
}

export interface V2Data {
  train: Ticket[];
  desk: Ticket[];
  tuning: { leftOut: [number, number]; train: Ticket[] }[];
  heldout: { fold: number; tickets: Ticket[] }[];
}

export function buildV2(sizes: V2Sizes = V2_SIZES): V2Data {
  const tuning: V2Data['tuning'] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    for (let alsoHeldOut = fold + 1; alsoHeldOut < FOLDS; alsoHeldOut += 1) {
      tuning.push({ leftOut: [fold, alsoHeldOut], train: buildV2Train({ fold, side: 'train', alsoHeldOut }, sizes.trainPerWording) });
    }
  }
  // A held-out ticket must be new to every practice model scored on it, and
  // every such model's wording is inside the fold's own training side.
  const heldout = Array.from({ length: FOLDS }, (_, fold) => {
    const trained = new Set(buildV2Train({ fold, side: 'train' }, sizes.trainPerWording).map((ticket) => normalizeText(ticket.text)));
    return { fold, tickets: buildV2Heldout(fold, sizes.heldoutPerWording, trained) };
  });
  return { train: buildV2Train('all', sizes.trainPerWording), desk: buildV2Desk(sizes.desk), tuning, heldout };
}

// The sets no model may train or tune on. All three are required: a caller
// that left one out would switch its check off without a word.
export interface V2HeldOut {
  blind: readonly { text: string }[];
  handwritten: readonly HandwrittenRow[];
  fresh: readonly HandwrittenRow[];
}

// Every check runs before the first write, so a leak leaves no file behind. The
// practice held-out files count as tuning data here: settings are picked on
// them, so they may hold no blind, desk or hand-written text either. The fresh
// hand-written tickets are written as they are, with their masked text, for the
// second model to be scored on.
export function writeV2(outputDir: string, data: V2Data, held: V2HeldOut): { target: string; rows: number }[] {
  const { blind, handwritten, fresh } = held;
  const trainingLists = [data.train, ...data.tuning.map(({ train }) => train), ...data.heldout.map(({ tickets }) => tickets)];
  assertBlindIsolated(blind, trainingLists);
  assertHandwrittenIsolated([...handwritten, ...fresh], trainingLists);
  if (holdsAnyOf(data.desk, trainingLists)) {
    throw new Error('E_DESK_IN_TRAIN');
  }
  for (const { leftOut, train } of data.tuning) {
    const trained = new Set(train.map((ticket) => normalizeText(ticket.text)));
    for (const fold of leftOut) {
      if ((data.heldout[fold]?.tickets ?? []).some((ticket) => trained.has(normalizeText(ticket.text)))) {
        throw new Error('E_TUNE_OVERLAP');
      }
    }
  }
  mkdirSync(outputDir, { recursive: true });
  const files: [string, Ticket[], number | null][] = [
    ['v2_train.jsonl', data.train, null],
    ['v2_desk.jsonl', data.desk, null],
    ...data.tuning.map(({ leftOut, train }): [string, Ticket[], null] => [`v2_tune_${leftOut[0]}_${leftOut[1]}.jsonl`, train, null]),
    ...data.heldout.map(({ fold, tickets }): [string, Ticket[], number] => [`v2_heldout_${fold}.jsonl`, tickets, fold]),
  ];
  const written = files.map(([name, tickets, fold]) => {
    const target = join(outputDir, name);
    writeFileSync(target, toJsonl(tickets, fold), 'utf8');
    return { target, rows: tickets.length };
  });
  if (fresh.length > 0) {
    const target = join(outputDir, 'v2_handwritten_fresh.jsonl');
    writeFileSync(target, handwrittenToJsonl(fresh), 'utf8');
    written.push({ target, rows: fresh.length });
  }
  return written;
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  for (const { target, rows } of writeV2(fileURLToPath(OUTPUT_DIR), buildV2(), { blind: loadBlind(), handwritten: loadHandwritten(), fresh: loadHandwritten(FRESH_SOURCE) })) {
    console.log(`wrote ${target} (${rows} rows)`);
  }
}
