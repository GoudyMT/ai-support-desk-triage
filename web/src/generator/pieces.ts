import { FAKE_SENTENCES, FEATURES, MONTHS, PLANS, PRODUCTS } from './fakeData';
import { buildTicketDetail, generateTicketDetail, type TicketDetail } from './generate';
import { createRng } from './rng';
import { FOLDS, checkSplit, poolOf, type Split } from './templates';
import type { Wording } from './wording';

// The 90-day run scores a model on held-out tickets and then teaches it the ones a
// person checked. Templates are dealt into weeks, so a taught template never comes
// back; the smaller pieces cannot be (each fold holds only a few threat phrases or
// product names, and there are 13 weeks). So a model is taught a copy of each
// ticket in which every held-out piece is swapped for a piece of the same kind
// that the stream's start model already trained on: repeats of a piece then help
// neither the retrained model nor the frozen one.
export const PIECE_KINDS = ['threat', 'connector', 'fakeFrame', 'product', 'plan', 'feature', 'month'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export interface Piece {
  kind: PieceKind;
  heldOut: string;
  taught: string;
}

export type SwapMap = ReadonlyMap<PieceKind, ReadonlyMap<string, string>>;

// Called wherever the generator puts a piece into a ticket; returns the text to use.
export type Swap = (kind: PieceKind, value: string) => string;

export interface TeachingDetail extends TicketDetail {
  // The copy a retrained model learns from, and the pieces swapped to make it.
  teachText: string;
  pieces: Piece[];
}

const SWAP_SEED = 113;

/**
 * Builds a ticket and its teaching copy from the same draws.
 *
 * A swap changes only what is written, so both builds pick the same templates and
 * labels, and the ticket is the one generateTicketDetail gives. Typos fall on the
 * swapped text and may land elsewhere, since the text is a different length.
 *
 * Args:
 *   seed, index, split, wording: as for generateTicketDetail.
 *   map: the stream's swap map.
 *
 * Returns:
 *   The ticket's detail, with `teachText` and the swapped `pieces`.
 *
 * Throws:
 *   Error('E_PIECE_UNMAPPED') for a piece the map does not hold.
 */
export function teachingDetail(seed: number, index: number, split: Split, wording: Wording, map: SwapMap): TeachingDetail {
  const detail = generateTicketDetail(seed, index, split, wording);
  const pieces: Piece[] = [];
  const taught = buildTicketDetail(seed, index, split, wording, recordingSwap(map, pieces));
  return { ...detail, teachText: taught.ticket.text, pieces };
}

// The lists a piece is drawn from. Fake-data frames are split per kind of data, so
// each frame list is cut into folds on its own.
function listsOf(kind: PieceKind, wording: Wording): readonly (readonly string[])[] {
  switch (kind) {
    case 'threat':
      return [wording.threatPhrases];
    case 'connector':
      return [wording.twoIssueConnectors];
    case 'fakeFrame':
      return Object.values(FAKE_SENTENCES);
    case 'product':
      return [PRODUCTS];
    case 'plan':
      return [PLANS];
    case 'feature':
      return [FEATURES];
    case 'month':
      return [MONTHS];
  }
}

/**
 * Pairs every held-out piece of a stream with a piece its start model trained on.
 *
 * The start model of stream k trained on every fold but k and k + 1. Within each
 * list, the held-out pieces are paired in order with a seeded shuffle of that
 * list's trained pieces, so two pieces of one kind never share a stand-in.
 *
 * Args:
 *   stream: the practice fold whose held-out pieces are swapped.
 *   wording: the wording the stream's tickets are drawn from.
 *   seed: the shuffle's seed.
 *
 * Returns:
 *   For each kind, the stand-in of each held-out piece.
 *
 * Throws:
 *   Error('E_SPLIT_RANGE') for a stream outside the folds.
 */
export function swapMapFor(stream: number, wording: Wording, seed: number = SWAP_SEED): SwapMap {
  const heldOut: Split = { fold: stream, side: 'heldout' };
  checkSplit(heldOut);
  const trained: Split = { fold: stream, side: 'train', alsoHeldOut: (stream + 1) % FOLDS };
  const rng = createRng(seed);
  const map = new Map<PieceKind, Map<string, string>>();
  for (const kind of PIECE_KINDS) {
    const kindMap = new Map<string, string>();
    for (const list of listsOf(kind, wording)) {
      const standIns = [...poolOf(list, trained)];
      // Fisher-Yates, so every pairing is equally likely.
      for (let i = standIns.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [standIns[i], standIns[j]] = [standIns[j] as string, standIns[i] as string];
      }
      poolOf(list, heldOut).forEach((piece, at) => {
        const standIn = standIns[at];
        if (standIn === undefined) {
          throw new Error('E_PIECE_SHORT');
        }
        kindMap.set(piece, standIn);
      });
    }
    map.set(kind, kindMap);
  }
  return map;
}

/**
 * A Swap that replaces each held-out piece through the map and records it.
 *
 * Args:
 *   map: the stream's swap map.
 *   drawn: filled with every piece swapped, in the order the generator drew them.
 *
 * Returns:
 *   The Swap; it throws Error('E_PIECE_UNMAPPED') for a piece the map does not
 *   hold, such as a piece of another stream.
 */
export function recordingSwap(map: SwapMap, drawn: Piece[]): Swap {
  return (kind, value) => {
    const taught = map.get(kind)?.get(value);
    if (taught === undefined) {
      throw new Error('E_PIECE_UNMAPPED');
    }
    drawn.push({ kind, heldOut: value, taught });
    return taught;
  };
}
