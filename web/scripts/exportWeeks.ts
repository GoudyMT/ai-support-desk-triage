import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLDS } from '../src/generator/templates';
import { TICKETS_PER_DAY, buildWeeks, dealWeeks, type WeekRow } from '../src/generator/weeks';
import {
  FRESH_SOURCE,
  assertBlindIsolated,
  assertHandwrittenIsolated,
  holdsAnyOf,
  isRunAsCommand,
  loadBlind,
  loadHandwritten,
  normalizeText,
  toJsonl,
} from './exportDataset';
import { V2_SIZES, buildV2Desk, buildV2Train } from './exportV2';

// The 90-day run's tickets: for each stream (a practice fold), 13 weeks of
// tickets built only from that week's held-out templates. A stream starts from
// the practice model trained on the pair of folds that leaves the stream out.
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

export interface WeekSizes {
  perDay: number;
  trainPerWording: number;
}

export interface WeekStream {
  stream: number;
  weeks: WeekRow[][];
  // Normalised texts of the start model's training set.
  startTexts: ReadonlySet<string>;
}

export interface WeekData {
  streams: WeekStream[];
}

/** The practice pair whose training set leaves this stream out, low fold first, as the tuning files are named. */
export function startPair(stream: number): [number, number] {
  const other = (stream + 1) % FOLDS;
  return stream < other ? [stream, other] : [other, stream];
}

export function buildWeekData(sizes: WeekSizes = { perDay: TICKETS_PER_DAY, trainPerWording: V2_SIZES.trainPerWording }): WeekData {
  const streams = Array.from({ length: FOLDS }, (_, stream) => {
    const [fold, alsoHeldOut] = startPair(stream);
    const start = buildV2Train({ fold, side: 'train', alsoHeldOut }, sizes.trainPerWording);
    return { stream, weeks: buildWeeks(stream, sizes.perDay), startTexts: new Set(start.map((ticket) => normalizeText(ticket.text))) };
  });
  return { streams };
}

export interface WeekHeldOut {
  blind: readonly { text: string }[];
  handwritten: readonly { text: string }[];
  fresh: readonly { text: string }[];
  desk: readonly { text: string }[];
}

// Checked tickets of the weeks become training rows, so every guard of a
// training export applies, and every check runs before the first write.
export function writeWeeks(outputDir: string, data: WeekData, held: WeekHeldOut): { target: string; rows: number }[] {
  const lists = data.streams.map(({ weeks }) => weeks.flat().map((row) => row.ticket));
  assertBlindIsolated(held.blind, lists);
  assertHandwrittenIsolated([...held.handwritten, ...held.fresh], lists);
  if (holdsAnyOf(held.desk, lists)) {
    throw new Error('E_DESK_IN_TRAIN');
  }
  for (const { weeks, startTexts } of data.streams) {
    if (weeks.flat().some((row) => startTexts.has(normalizeText(row.ticket.text)))) {
      throw new Error('E_WEEK_IN_TRAIN');
    }
  }
  mkdirSync(outputDir, { recursive: true });
  return data.streams.map(({ stream, weeks }) => {
    const rows = weeks.flat();
    const lines = rows.map((row) => {
      const base = JSON.parse(toJsonl([row.ticket], stream)) as Record<string, unknown>;
      return JSON.stringify({ ...base, week: row.week, day: row.day, wording: row.wording });
    });
    const target = join(outputDir, `v2_weeks_${stream}.jsonl`);
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
    return { target, rows: rows.length };
  });
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  for (let stream = 0; stream < FOLDS; stream += 1) {
    const sizes = Array.from({ length: 13 }, () => 0);
    for (const week of dealWeeks(stream).values()) {
      sizes[week] = (sizes[week] ?? 0) + 1;
    }
    console.log(`stream ${stream}: ${sizes.reduce((a, b) => a + b, 0)} templates; per week ${sizes.join(' ')}`);
  }
  const held = { blind: loadBlind(), handwritten: loadHandwritten(), fresh: loadHandwritten(FRESH_SOURCE), desk: buildV2Desk(V2_SIZES.desk) };
  for (const { target, rows } of writeWeeks(fileURLToPath(OUTPUT_DIR), buildWeekData(), held)) {
    console.log(`wrote ${target} (${rows} rows)`);
  }
}
