import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLDS } from '../src/generator/templates';
import { POOL_PER_WORDING, buildPool, dealWeeks, templateRefsOf, type PoolRow } from '../src/generator/weeks';
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
import { V2_SIZES, buildV2Desk } from './exportV2';
import { startTextsOf, type WeekHeldOut } from './exportWeeks';

// The fair 90-day run deals templates into weeks by how hard the start model
// finds them. This writes, per stream, the held-out tickets it scores to rate
// each template; each row names the templates it was built from.
const OUTPUT_DIR = new URL('../../ml/data/generated/', import.meta.url);

export interface PoolStream {
  stream: number;
  rows: PoolRow[];
  // Normalised texts of the start model's training set.
  startTexts: ReadonlySet<string>;
}

export interface PoolData {
  streams: PoolStream[];
}

export function buildPoolData(
  sizes: { perWording: number; trainPerWording: number } = { perWording: POOL_PER_WORDING, trainPerWording: V2_SIZES.trainPerWording },
): PoolData {
  const streams = Array.from({ length: FOLDS }, (_, stream) => ({
    stream,
    rows: buildPool(stream, sizes.perWording),
    startTexts: startTextsOf(stream, sizes.trainPerWording),
  }));
  return { streams };
}

// Pool tickets are drawn the way week tickets are, and week tickets become
// training rows, so the pool passes the same guards, all before the first write.
export function writePool(outputDir: string, data: PoolData, held: WeekHeldOut): { target: string; rows: number }[] {
  const lists = data.streams.map(({ rows }) => rows.map((row) => row.ticket));
  assertBlindIsolated(held.blind, lists);
  assertHandwrittenIsolated([...held.handwritten, ...held.fresh], lists);
  if (holdsAnyOf(held.desk, lists)) {
    throw new Error('E_DESK_IN_TRAIN');
  }
  for (const { rows, startTexts } of data.streams) {
    if (rows.some((row) => startTexts.has(normalizeText(row.ticket.text)))) {
      throw new Error('E_WEEK_IN_TRAIN');
    }
  }
  mkdirSync(outputDir, { recursive: true });
  return data.streams.map(({ stream, rows }) => {
    const lines = rows.map((row) => {
      const base = JSON.parse(toJsonl([row.ticket], stream)) as Record<string, unknown>;
      return JSON.stringify({ ...base, wording: row.wording, templates: row.templates });
    });
    const target = join(outputDir, `v2_fair_pool_${stream}.jsonl`);
    writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
    return { target, rows: rows.length };
  });
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const data = buildPoolData();
  const held = { blind: loadBlind(), handwritten: loadHandwritten(), fresh: loadHandwritten(FRESH_SOURCE), desk: buildV2Desk(V2_SIZES.desk) };
  for (const { stream, rows } of data.streams) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const ref of row.templates) {
        counts.set(ref, (counts.get(ref) ?? 0) + 1);
      }
    }
    const heldOut = [...dealWeeks(stream).keys()];
    const refs = new Map([...templateRefsOf('built-in'), ...templateRefsOf('extra')]);
    const unmet = heldOut.filter((template) => !counts.has(refs.get(template) ?? '')).length;
    const fewest = Math.min(...counts.values());
    console.log(`stream ${stream}: ${rows.length} tickets, ${heldOut.length} held-out templates, ${unmet} never drawn, fewest tickets for a drawn one ${fewest}`);
  }
  for (const { target, rows } of writePool(fileURLToPath(OUTPUT_DIR), data, held)) {
    console.log(`wrote ${target} (${rows} rows)`);
  }
}
