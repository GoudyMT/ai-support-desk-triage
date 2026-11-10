import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from '../domain/labels';
import { generateTicketDetail, generateTickets } from './generate';
import type { Split, Template } from './templates';
import type { Wording } from './wording';

const STREAM_SIZE = 2000;
const SAMPLE_SIZE = 600;

function streamHash(seed: number, split: Split): string {
  return createHash('sha256').update(JSON.stringify(generateTickets(seed, STREAM_SIZE, split))).digest('hex');
}

function perCategory(make: (category: Category) => readonly Template[]): Record<Category, readonly Template[]> {
  return Object.fromEntries(CATEGORIES.map((category) => [category, make(category)])) as Record<Category, readonly Template[]>;
}

// A second wording with nothing in common with the built-in one: every text
// carries a marker no built-in sentence has.
const OTHER: Wording = {
  templates: perCategory((category) => [
    { text: `zqx plain one about ${category}`, grievance: true },
    { text: `zqx plain two about ${category}`, grievance: true },
  ]),
  trapTemplates: perCategory((category) => [{ text: `zqx trap about ${category}` }]),
  vagueTemplates: [{ text: 'zqx vague' }],
  politeSecurityTemplates: [{ text: 'zqx polite report' }],
  threatPhrases: ['Zqx threat.'],
  twoIssueConnectors: ['Zqx also.'],
  openers: ['Zqx opener,'],
  closers: ['Zqx closer.'],
  requests: ['Zqx request.'],
};

describe('ticket streams and their wording', () => {
  // pin: 4. The built-in streams feed every recorded number of the first model
  // (its training files, its test folds and the live desk), so a refactor that
  // moves one random draw would silently change all of them.
  it.each([
    ['all', 7, 'all', 'd6241a5ba8022b4390f2629267fdcd5f5a990bfdfe096aca33b5f883d830e8a2'],
    ['a training side', 1, { fold: 0, side: 'train' }, 'a1cd8ed3f1b054bb053909a99d6b12abd91bd7a1498375b75d2b07997cac78f1'],
    ['a held-out side', 2, { fold: 3, side: 'heldout' }, 'c53a7e88a172f4b24d7a2af704ad8ae919b1ffd844170f98554ce2942cd362f1'],
    ['a tuning side', 5, { fold: 1, side: 'train', alsoHeldOut: 2 }, '3da3e6e90d8a051a9095c37843e7ccaa533e779f195865209d1bb2eca7ca25b1'],
  ] as const)('writes the same built-in tickets as before for %s', (_name, seed, split, expected) => {
    expect(streamHash(seed, split)).toBe(expected);
  });

  it('builds every ticket of a stream from the wording it is given, and from nothing else', () => {
    const allowed = new Set<Template>([
      ...Object.values(OTHER.templates).flat(),
      ...Object.values(OTHER.trapTemplates).flat(),
      ...OTHER.vagueTemplates,
      ...OTHER.politeSecurityTemplates,
    ]);
    let openers = 0;
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      const detail = generateTicketDetail(11, index, 'all', OTHER);
      for (const template of detail.templates) {
        expect(allowed.has(template), detail.plainText).toBe(true);
      }
      for (const sentence of detail.plainText.toLowerCase().split(/\n|(?<=[.,])\s+/)) {
        expect(sentence.startsWith('zqx'), detail.plainText).toBe(true);
      }
      openers += detail.plainText.toLowerCase().startsWith('zqx opener,') ? 1 : 0;
    }
    expect(openers).toBeGreaterThan(0);
  });
});
