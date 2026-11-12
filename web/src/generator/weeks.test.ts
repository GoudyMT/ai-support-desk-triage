import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../domain/labels';
import { EXTRA_WORDING } from './extraFrames';
import { BUILT_IN_WORDING, generateTicketDetail } from './generate';
import { FOLDS, poolOf, type Template } from './templates';
import { WEEKS, buildWeeks, dealWeeks, weekOfTicket } from './weeks';
import type { Wording } from './wording';

// The template lists a ticket's body is built from, for one wording.
function listsOf(wording: Wording): (readonly Template[])[] {
  return [
    ...CATEGORIES.map((category) => wording.templates[category]),
    ...CATEGORIES.map((category) => wording.trapTemplates[category]),
    wording.vagueTemplates,
    wording.politeSecurityTemplates,
  ];
}

const LISTS = [...listsOf(BUILT_IN_WORDING), ...listsOf(EXTRA_WORDING)];

function heldOut(stream: number): Template[] {
  return LISTS.flatMap((list) => [...poolOf(list, { fold: stream, side: 'heldout' })]);
}

function trainingSide(stream: number): Set<Template> {
  return new Set(LISTS.flatMap((list) => [...poolOf(list, { fold: stream, side: 'train' })]));
}

describe('dealWeeks', () => {
  it.each(Array.from({ length: FOLDS }, (_, stream) => stream))('deals every held-out template of stream %i into exactly one week', (stream) => {
    const deal = dealWeeks(stream);
    const expected = heldOut(stream);
    expect(deal.size).toBe(expected.length);
    for (const template of expected) {
      const week = deal.get(template);
      expect(week).toBeDefined();
      expect(week).toBeGreaterThanOrEqual(0);
      expect(week).toBeLessThan(WEEKS);
    }
  });

  it('gives every week a template, the weeks within one template of each other', () => {
    for (let stream = 0; stream < FOLDS; stream += 1) {
      const sizes = Array.from({ length: WEEKS }, () => 0);
      for (const week of dealWeeks(stream).values()) {
        sizes[week] = (sizes[week] ?? 0) + 1;
      }
      expect(Math.min(...sizes)).toBeGreaterThan(0);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('replays the same deal for the same seed and another for another seed', () => {
    const asList = (deal: ReadonlyMap<Template, number>): number[] => heldOut(1).map((template) => deal.get(template) ?? -1);
    expect(asList(dealWeeks(1))).toEqual(asList(dealWeeks(1)));
    expect(asList(dealWeeks(1, 114))).not.toEqual(asList(dealWeeks(1)));
  });
});

describe('weekOfTicket', () => {
  const deal = dealWeeks(0);
  const byWeek = (week: number): Template[] => [...deal].filter(([, w]) => w === week).map(([template]) => template);

  it('names the week when every template of a ticket is in it', () => {
    const [first] = byWeek(4);
    expect(first).toBeDefined();
    expect(weekOfTicket([first as Template], deal)).toBe(4);
  });

  it('names no week for a two-issue ticket that spans weeks', () => {
    const [a] = byWeek(2);
    const [b] = byWeek(3);
    expect(weekOfTicket([a as Template, b as Template], deal)).toBeUndefined();
  });

  it('names no week for a template the stream trains on', () => {
    const [trained] = trainingSide(0);
    expect(weekOfTicket([trained as Template], deal)).toBeUndefined();
  });
});

describe('buildWeeks', () => {
  const PER_DAY = 2;
  const weeks = buildWeeks(2, PER_DAY);
  const deal = dealWeeks(2);

  it('fills every day of every week with its tickets, half from each wording', () => {
    expect(weeks).toHaveLength(WEEKS);
    for (const week of weeks) {
      expect(week).toHaveLength(7 * PER_DAY);
      for (let day = 1; day <= 7; day += 1) {
        expect(week.filter((row) => row.day === day)).toHaveLength(PER_DAY);
      }
      expect(week.filter((row) => row.wording === 'built-in')).toHaveLength(7 * PER_DAY / 2);
    }
  });

  it('keeps a ticket only in the week that holds all its templates', () => {
    weeks.forEach((week, number) => {
      for (const row of week) {
        const wording = row.wording === 'built-in' ? BUILT_IN_WORDING : EXTRA_WORDING;
        const detail = generateTicketDetail(row.ticket.seed, row.ticket.index, { fold: 2, side: 'heldout' }, wording);
        expect(detail.ticket.text).toBe(row.ticket.text);
        expect(weekOfTicket(detail.templates, deal)).toBe(number);
      }
    });
  });

  it('writes no ticket text twice and no id twice', () => {
    const rows = weeks.flat();
    expect(new Set(rows.map((row) => row.ticket.text)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.ticket.id)).size).toBe(rows.length);
  });

  it('refuses an odd count per day, which cannot split evenly over two wordings', () => {
    expect(() => buildWeeks(2, 3)).toThrow('E_WEEKS_COUNT');
  });
});
