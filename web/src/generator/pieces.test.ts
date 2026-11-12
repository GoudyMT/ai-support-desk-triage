import { describe, expect, it } from 'vitest';
import { EXTRA_WORDING } from './extraFrames';
import { FAKE_SENTENCES, FEATURES, MONTHS, PLANS, PRODUCTS } from './fakeData';
import { BUILT_IN_WORDING, generateTicketDetail, type TicketDetail } from './generate';
import { PIECE_KINDS, swapMapFor, type PieceKind } from './pieces';
import { FOLDS, poolOf, type Split } from './templates';
import type { Wording } from './wording';

// The teaching copy of the 90-day run: a retrained model learns from the ticket
// with every held-out piece (threat phrase, join, fake-data frame, product,
// plan, feature, month) swapped for one the start model trained on, so a
// later week's repeat of that piece cannot be remembered.

const WORDINGS: [string, Wording][] = [
  ['built-in', BUILT_IN_WORDING],
  ['extra', EXTRA_WORDING],
];
const STREAMS = Array.from({ length: FOLDS }, (_, stream) => stream);
const TICKETS = 2_000;
const SEED = 41;

function listsOf(kind: PieceKind, wording: Wording): readonly string[] {
  switch (kind) {
    case 'threat':
      return wording.threatPhrases;
    case 'connector':
      return wording.twoIssueConnectors;
    case 'fakeFrame':
      return Object.values(FAKE_SENTENCES).flat();
    case 'product':
      return PRODUCTS;
    case 'plan':
      return PLANS;
    case 'feature':
      return FEATURES;
    case 'month':
      return MONTHS;
  }
}

// The start model of stream k trained on every fold but k and k + 1.
function startSplit(stream: number): Split {
  return { fold: stream, side: 'train', alsoHeldOut: (stream + 1) % FOLDS };
}

function heldOutOf(kind: PieceKind, wording: Wording, stream: number): readonly string[] {
  if (kind === 'fakeFrame') {
    return Object.values(FAKE_SENTENCES).flatMap((list) => poolOf(list, { fold: stream, side: 'heldout' }));
  }
  return poolOf(listsOf(kind, wording), { fold: stream, side: 'heldout' });
}

function trainedOf(kind: PieceKind, wording: Wording, stream: number): readonly string[] {
  if (kind === 'fakeFrame') {
    return Object.values(FAKE_SENTENCES).flatMap((list) => poolOf(list, startSplit(stream)));
  }
  return poolOf(listsOf(kind, wording), startSplit(stream));
}

// A fake-data frame shows up in a ticket without its {value}.
function stem(kind: PieceKind, piece: string): string {
  return kind === 'fakeFrame' ? piece.replace('{value}', '').trim() : piece;
}

function teachRun(stream: number, wording: Wording): { plain: TicketDetail; taught: TicketDetail }[] {
  const swap = swapMapFor(stream, wording);
  const split: Split = { fold: stream, side: 'heldout' };
  return Array.from({ length: TICKETS }, (_, index) => ({
    plain: generateTicketDetail(SEED, index, split, wording),
    taught: generateTicketDetail(SEED, index, split, wording, swap),
  }));
}

describe('swapMapFor', () => {
  it.each(STREAMS)('maps every held-out piece of stream %i to a distinct piece its start model trained on', (stream) => {
    for (const [, wording] of WORDINGS) {
      const map = swapMapFor(stream, wording);
      for (const kind of PIECE_KINDS) {
        const kindMap = map.get(kind);
        expect(kindMap).toBeDefined();
        expect([...(kindMap?.keys() ?? [])].sort()).toEqual([...heldOutOf(kind, wording, stream)].sort());
        const taught = [...(kindMap?.values() ?? [])];
        const trained = new Set(trainedOf(kind, wording, stream));
        expect(taught.filter((piece) => !trained.has(piece))).toEqual([]);
        expect(new Set(taught).size).toBe(taught.length);
      }
    }
  });

  it('gives the same map for the same seed and refuses a stream outside the folds', () => {
    const one = swapMapFor(2, EXTRA_WORDING);
    const two = swapMapFor(2, EXTRA_WORDING);
    for (const kind of PIECE_KINDS) {
      expect([...(two.get(kind)?.entries() ?? [])]).toEqual([...(one.get(kind)?.entries() ?? [])]);
    }
    expect(() => swapMapFor(FOLDS, BUILT_IN_WORDING)).toThrow('E_SPLIT_RANGE');
  });
});

describe('the teaching copy', () => {
  it.each(STREAMS)('keeps no held-out piece of stream %i, and changes nothing a model is scored on', (stream) => {
    const drawnKinds = new Set<PieceKind>();
    let withPieces = 0;
    let withoutPieces = 0;
    for (const [, wording] of WORDINGS) {
      for (const { plain, taught } of teachRun(stream, wording)) {
        // The scored ticket is byte for byte the one built without a swap map.
        expect(taught.ticket).toEqual(plain.ticket);
        expect(taught.templates).toEqual(plain.templates);
        const teachText = taught.teachText ?? '';
        const pieces = taught.pieces ?? [];
        const fixedWords = taught.templates.map((template) => template.text.toLowerCase()).join('\n');
        for (const kind of PIECE_KINDS) {
          for (const piece of heldOutOf(kind, wording, stream)) {
            const word = stem(kind, piece).toLowerCase();
            // A held-out word may stay only where a template's own fixed words carry it.
            if (teachText.toLowerCase().includes(word)) {
              expect(fixedWords).toContain(word);
            }
          }
        }
        for (const piece of pieces) {
          drawnKinds.add(piece.kind);
          expect(swapMapFor(stream, wording).get(piece.kind)?.get(piece.heldOut)).toBe(piece.taught);
        }
        if (pieces.length === 0) {
          withoutPieces += 1;
          expect(teachText).toBe(plain.ticket.text);
        } else {
          withPieces += 1;
        }
      }
    }
    expect([...drawnKinds].sort()).toEqual([...PIECE_KINDS].sort());
    expect(withPieces).toBeGreaterThan(0);
    expect(withoutPieces).toBeGreaterThan(0);
  });

  it('keeps two different plans different when a template compares them', () => {
    let compared = 0;
    for (const stream of STREAMS) {
      for (const [, wording] of WORDINGS) {
        for (const { taught } of teachRun(stream, wording)) {
          if (!taught.templates.some((template) => template.text.includes('{otherPlan}'))) {
            continue;
          }
          // Two plans that differ in the ticket differ in its teaching copy. (A
          // two-issue ticket may name one plan in both of its templates.)
          const plans = (taught.pieces ?? []).filter((piece) => piece.kind === 'plan');
          const heldOut = new Set(plans.map((piece) => piece.heldOut));
          expect(heldOut.size).toBeGreaterThan(1);
          expect(new Set(plans.map((piece) => piece.taught)).size).toBe(heldOut.size);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('keeps a month that is part of a template, not a slot', () => {
    let kept = 0;
    for (const stream of STREAMS) {
      for (const [, wording] of WORDINGS) {
        for (const { taught } of teachRun(stream, wording)) {
          // Typos fall in other places in the two copies, so a misspelled month says nothing here.
          if (taught.ticket.hardCase === 'typos') {
            continue;
          }
          for (const month of MONTHS) {
            const inTemplate = taught.templates.some((template) => template.text.includes(month));
            if (inTemplate && !taught.ticket.text.toLowerCase().includes(month.toLowerCase())) {
              continue;
            }
            if (inTemplate) {
              expect((taught.teachText ?? '').toLowerCase()).toContain(month.toLowerCase());
              kept += 1;
            }
          }
        }
      }
    }
    expect(kept).toBeGreaterThan(0);
  });

  it('refuses a swap map of another stream', () => {
    const otherStream = swapMapFor(0, BUILT_IN_WORDING);
    const run = (): void => {
      for (let index = 0; index < TICKETS; index += 1) {
        generateTicketDetail(SEED, index, { fold: 1, side: 'heldout' }, BUILT_IN_WORDING, otherStream);
      }
    };
    expect(run).toThrow('E_PIECE_UNMAPPED');
  });
});
