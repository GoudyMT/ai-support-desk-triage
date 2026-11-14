import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FOLDS } from '../src/generator/templates';
import {
  TICKETS_PER_DAY,
  buildWeeks,
  dealWeeks,
  dealWeeksByDifficulty,
  predictedGap,
  predictedWeekShares,
  type Difficulty,
  type WeekRow,
} from '../src/generator/weeks';
import {
  FRESH_SOURCE,
  assertBlindIsolated,
  assertHandwrittenIsolated,
  holdsAnyOf,
  isRunAsCommand,
  loadBlind,
  loadHandwritten,
  toJsonl,
} from './exportDataset';
import { V2_SIZES, buildV2Desk, buildV2Train } from './exportV2';

// The 90-day run's tickets: for each stream (a practice fold), 13 weeks of
// tickets built only from that week's held-out templates. A stream starts from
// the practice model trained on the pair of folds that leaves the stream out.
// The fair run (--fair) deals the templates by the start model's ratings and
// writes each row's teaching copy, into files of its own.
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

export interface WeekSizes {
  perDay: number;
  trainPerWording: number;
}

export interface WeekStream {
  stream: number;
  weeks: WeekRow[][];
  // The start model's training set.
  startRows: readonly { text: string }[];
}

export interface WeekData {
  streams: WeekStream[];
}

/** The practice pair whose training set leaves this stream out, low fold first, as the tuning files are named. */
export function startPair(stream: number): [number, number] {
  const other = (stream + 1) % FOLDS;
  return stream < other ? [stream, other] : [other, stream];
}

/** The start model's training set for a stream, rebuilt from its seed. */
export function startRowsOf(stream: number, trainPerWording: number): { text: string }[] {
  const [fold, alsoHeldOut] = startPair(stream);
  return buildV2Train({ fold, side: 'train', alsoHeldOut }, trainPerWording);
}

/**
 * The start model's training set for a stream, as the file the driver trains on.
 *
 * Args:
 *   dir: the folder holding the v2 tuning files.
 *   stream: the practice fold.
 *
 * Returns:
 *   The file's rows.
 *
 * Throws:
 *   Error('E_START_MISSING') when the file is not there: a guard against an empty
 *   list would pass and prove nothing.
 */
export function readStartRows(dir: string, stream: number): { text: string }[] {
  const [a, b] = startPair(stream);
  const path = join(dir, `v2_tune_${a}_${b}.jsonl`);
  if (!existsSync(path)) {
    throw new Error('E_START_MISSING');
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => ({ text: String((JSON.parse(line) as { text?: unknown }).text ?? '') }));
}

export function buildWeekData(sizes: WeekSizes = { perDay: TICKETS_PER_DAY, trainPerWording: V2_SIZES.trainPerWording }): WeekData {
  const streams = Array.from({ length: FOLDS }, (_, stream) => ({
    stream,
    weeks: buildWeeks(stream, sizes.perDay),
    startRows: startRowsOf(stream, sizes.trainPerWording),
  }));
  return { streams };
}

/** One stream's fair weeks: dealt by the start model's ratings, each row with its teaching copy. */
export function buildFairWeekStream(stream: number, difficulty: Difficulty, startRows: readonly { text: string }[], perDay = TICKETS_PER_DAY): WeekStream {
  return { stream, weeks: buildWeeks(stream, perDay, dealWeeksByDifficulty(stream, difficulty), true), startRows };
}

export interface WeekHeldOut {
  blind: readonly { text: string }[];
  handwritten: readonly { text: string }[];
  fresh: readonly { text: string }[];
  desk: readonly { text: string }[];
}

export const PLAIN_NAME = (stream: number): string => `v2_weeks_${stream}.jsonl`;
export const FAIR_NAME = (stream: number): string => `v2_fair_weeks_${stream}.jsonl`;

// Checked tickets of the weeks become training rows (their teaching copies, in
// the fair run), so every guard of a training export applies to both texts, with
// the same match (raw and masked), and every check runs before the first write.
export function writeWeeks(outputDir: string, data: WeekData, held: WeekHeldOut, name = PLAIN_NAME): { target: string; rows: number }[] {
  const lists = data.streams.flatMap(({ weeks }) => {
    const rows = weeks.flat();
    const taught = rows.flatMap((row) => (row.teachText === undefined ? [] : [{ text: row.teachText }]));
    return [rows.map((row) => row.ticket), taught];
  });
  assertBlindIsolated(held.blind, lists);
  assertHandwrittenIsolated([...held.handwritten, ...held.fresh], lists);
  if (holdsAnyOf(held.desk, lists)) {
    throw new Error('E_DESK_IN_TRAIN');
  }
  for (const { weeks, startRows } of data.streams) {
    if (holdsAnyOf(startRows, [weeks.flat().map((row) => row.ticket)])) {
      throw new Error('E_WEEK_IN_TRAIN');
    }
  }
  mkdirSync(outputDir, { recursive: true });
  return data.streams.map(({ stream, weeks }) => {
    const rows = weeks.flat();
    const lines = rows.map((row) => {
      const base = JSON.parse(toJsonl([row.ticket], stream)) as Record<string, unknown>;
      const fair = row.teachText === undefined ? {} : { teachText: row.teachText, templates: row.templates ?? [] };
      return JSON.stringify({ ...base, week: row.week, day: row.day, wording: row.wording, ...fair });
    });
    const target = join(outputDir, name(stream));
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
    return { target, rows: rows.length };
  });
}

function printDeal(stream: number, deal: ReadonlyMap<unknown, number>): void {
  const sizes = Array.from({ length: 13 }, () => 0);
  for (const week of deal.values()) {
    sizes[week] = (sizes[week] ?? 0) + 1;
  }
  console.log(`stream ${stream}: ${sizes.reduce((a, b) => a + b, 0)} templates; per week ${sizes.join(' ')}`);
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const { values } = parseArgs({ options: { fair: { type: 'boolean' }, stream: { type: 'string' }, difficulty: { type: 'string' } } });
  const outputDir = fileURLToPath(OUTPUT_DIR);
  const held = { blind: loadBlind(), handwritten: loadHandwritten(), fresh: loadHandwritten(FRESH_SOURCE), desk: buildV2Desk(V2_SIZES.desk) };
  if (values.fair === true) {
    const stream = Number(values.stream);
    if (!Number.isInteger(stream) || stream < 0 || stream >= FOLDS || values.difficulty === undefined) {
      throw new Error('E_FAIR_ARGS');
    }
    const difficulty = JSON.parse(readFileSync(values.difficulty, 'utf8')) as Difficulty;
    const deal = dealWeeksByDifficulty(stream, difficulty);
    printDeal(stream, deal);
    const shares = predictedWeekShares(stream, deal, difficulty);
    console.log(`predicted start-model share per week: ${shares.map((share) => share.toFixed(3)).join(' ')}`);
    console.log(`predicted gap, days 1-30 vs 61-90: ${predictedGap(shares).toFixed(2)} points`);
    const data = { streams: [buildFairWeekStream(stream, difficulty, readStartRows(outputDir, stream))] };
    for (const { target, rows } of writeWeeks(outputDir, data, held, FAIR_NAME)) {
      console.log(`wrote ${target} (${rows} rows)`);
    }
  } else {
    for (let stream = 0; stream < FOLDS; stream += 1) {
      printDeal(stream, dealWeeks(stream));
    }
    const data = buildWeekData();
    const streams = data.streams.map((entry) => ({ ...entry, startRows: readStartRows(outputDir, entry.stream) }));
    for (const { target, rows } of writeWeeks(outputDir, { streams }, held)) {
      console.log(`wrote ${target} (${rows} rows)`);
    }
  }
}
