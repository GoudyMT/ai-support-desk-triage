import { describe, expect, it } from 'vitest';
import { swapMapFor } from './pieces';
import { EXTRA_WORDING } from './extraFrames';
import { BUILT_IN_WORDING } from './generate';
import type { Template } from './templates';
import { WEEKS, buildWeeks, dealWeeks, dealWeeksByDifficulty, templateRefsOf, type Difficulty } from './weeks';

// The fair 90-day run deals templates into weeks by how hard the start model finds
// them, so each week is about as hard as the others for a model that never learns.

const REFS = new Map([...templateRefsOf('built-in'), ...templateRefsOf('extra')]);

function ref(template: Template): string {
  return REFS.get(template) ?? '';
}

// The ticket-weighted mean rating of each week under a deal.
function weekMeans(deal: ReadonlyMap<Template, number>, difficulty: Difficulty): number[] {
  const sums = Array.from({ length: WEEKS }, () => ({ right: 0, count: 0 }));
  for (const [template, week] of deal) {
    const rated = difficulty[ref(template)];
    const sum = sums[week];
    if (rated !== undefined && sum !== undefined) {
      sum.right += rated.right * rated.count;
      sum.count += rated.count;
    }
  }
  return sums.map(({ right, count }) => (count === 0 ? 0 : right / count));
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

// Ratings that make the round-robin deal lopsided: every template it puts in the
// first seven weeks is always right, every other one always wrong.
function lopsided(stream: number): Difficulty {
  const ratings: Difficulty = {};
  for (const [template, week] of dealWeeks(stream)) {
    ratings[ref(template)] = { right: week < 7 ? 1 : 0, count: 10 };
  }
  return ratings;
}

describe('dealWeeksByDifficulty', () => {
  it('deals every held-out template into exactly one week, the same deal for the same inputs', () => {
    const difficulty = lopsided(1);
    const deal = dealWeeksByDifficulty(1, difficulty);
    expect([...deal.keys()].sort((a, b) => ref(a).localeCompare(ref(b)))).toEqual(
      [...dealWeeks(1).keys()].sort((a, b) => ref(a).localeCompare(ref(b))),
    );
    expect([...dealWeeksByDifficulty(1, difficulty).entries()]).toEqual([...deal.entries()]);
  });

  it('evens out how hard the weeks are where the round-robin deal does not', () => {
    for (const stream of [0, 3]) {
      const difficulty = lopsided(stream);
      const before = spread(weekMeans(dealWeeks(stream), difficulty));
      const after = spread(weekMeans(dealWeeksByDifficulty(stream, difficulty), difficulty));
      expect(before).toBe(1);
      expect(after).toBeLessThan(0.2);
    }
  });

  it('keeps the weeks within two templates of each other, and every week fills', () => {
    const deal = dealWeeksByDifficulty(2, lopsided(2));
    const sizes = Array.from({ length: WEEKS }, () => 0);
    for (const week of deal.values()) {
      sizes[week] = (sizes[week] ?? 0) + 1;
    }
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(2);
    expect(buildWeeks(2, 2, deal).every((rows) => rows.length === 14)).toBe(true);
  });

  it('still deals a template the pool never rated', () => {
    const difficulty = lopsided(0);
    const [missing] = [...dealWeeks(0).keys()];
    delete difficulty[ref(missing as Template)];
    expect(dealWeeksByDifficulty(0, difficulty).has(missing as Template)).toBe(true);
  });
});

describe('buildWeeks with a deal and teaching copies', () => {
  const stream = 1;
  const deal = dealWeeksByDifficulty(stream, lopsided(stream));
  const weeks = buildWeeks(stream, 2, deal, true);

  it('keeps each ticket in the week the given deal puts all its templates in', () => {
    for (const rows of weeks) {
      for (const row of rows) {
        expect(row.templates?.length ?? 0).toBeGreaterThan(0);
        for (const name of row.templates ?? []) {
          const template = [...deal.keys()].find((candidate) => ref(candidate) === name);
          expect(template && deal.get(template)).toBe(row.week);
        }
      }
    }
  });

  it('gives every row a teaching copy built with the stream swap map', () => {
    const maps = { 'built-in': swapMapFor(stream, BUILT_IN_WORDING), extra: swapMapFor(stream, EXTRA_WORDING) };
    let swapped = 0;
    for (const row of weeks.flat()) {
      expect(typeof row.teachText).toBe('string');
      if (row.teachText !== row.ticket.text) {
        swapped += 1;
      }
      // No held-out product of the stream survives into the teaching copy.
      for (const held of maps[row.wording].get('product')?.keys() ?? []) {
        expect(row.teachText ?? '').not.toContain(held);
      }
    }
    expect(swapped).toBeGreaterThan(0);
  });

  it('builds the same week tickets as before when no deal is given', () => {
    expect(buildWeeks(stream, 2).map((rows) => rows.map((row) => row.ticket.id))).toEqual(
      buildWeeks(stream, 2, dealWeeks(stream)).map((rows) => rows.map((row) => row.ticket.id)),
    );
    expect(buildWeeks(stream, 2).flat().every((row) => row.teachText === undefined)).toBe(true);
  });
});
