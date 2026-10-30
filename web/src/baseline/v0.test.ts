import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Category, Priority } from '../domain/labels';
import { generateTickets } from '../generator/generate';
import { v0Triage, type V0Result } from './v0';

const PAGE_URL = new URL('../../../capstone/prototype/AI_Support_Desk_Triage_Prototype.html', import.meta.url);
const SET_URL = new URL('../../../ml/data/handwritten.jsonl', import.meta.url);
const GENERATED_SEED = 3;
const GENERATED_COUNT = 2000;
const SET_SIZE = 48;

const SCRIPT_MATCH = /<script>([\s\S]*?)<\/script>/.exec(readFileSync(PAGE_URL, 'utf8'));
const PAGE_SCRIPT = SCRIPT_MATCH?.[1] ?? '';

// Runs the prototype page's own script on one ticket and reads its answer back from
// the HTML the page would have drawn, so the port is compared to the page itself and
// not to a second hand-copy of its rules.
function runOriginalPage(ticket: string): V0Result {
  let html = '';
  const sandbox = {
    document: {
      getElementById: (id: string) =>
        id === 'ticket'
          ? { value: ticket }
          : {
              set innerHTML(value: string) {
                html = value;
              },
            },
    },
    alert: () => undefined,
  };
  runInNewContext(`${PAGE_SCRIPT}\nanalyze();`, sandbox);
  const category = /<span class="badge [a-z]+">([^<]+)<\/span>/.exec(html)?.[1];
  const priority = /<span class="priority-[a-z]+">([^<]+)<\/span>/.exec(html)?.[1];
  const review = /class="badge (review-yes|review-no)"/.exec(html)?.[1];
  if (category === undefined || priority === undefined || review === undefined) {
    throw new Error(`page output not readable for: ${ticket}`);
  }
  return { category: category as Category, priority: priority as Priority, mustReview: review === 'review-yes' };
}

const handwritten = readFileSync(SET_URL, 'utf8')
  .replace(/\r/g, '')
  .trimEnd()
  .split('\n')
  .map((line) => (JSON.parse(line) as { id: string; text: string }));

describe('v0Triage matches the original prototype page', () => {
  it('the page script is found and answers a plain ticket', () => {
    expect(runOriginalPage('I was charged twice this month and need help fixing my bill.')).toEqual({
      category: 'Billing',
      priority: 'Medium',
      mustReview: true,
    });
  });

  it('agrees on all hand-written tickets', () => {
    expect(handwritten).toHaveLength(SET_SIZE);
    for (const row of handwritten) {
      expect({ id: row.id, ...v0Triage(row.text) }).toEqual({ id: row.id, ...runOriginalPage(row.text) });
    }
  });

  it('agrees on every generated ticket', () => {
    const tickets = generateTickets(GENERATED_SEED, GENERATED_COUNT);
    expect(tickets).toHaveLength(GENERATED_COUNT);
    for (const ticket of tickets) {
      expect({ id: ticket.id, ...v0Triage(ticket.text) }).toEqual({ id: ticket.id, ...runOriginalPage(ticket.text) });
    }
  });

  it('keeps the original quirks, because v0 is the yardstick and is never fixed', () => {
    // "Canada" contains the substring "ada".
    expect(v0Triage('I moved to Canada')).toEqual({ category: 'Accessibility Support', priority: 'High', mustReview: true });
    // A later block overwrites the category; the billing review flag stays.
    expect(v0Triage('billing error')).toEqual({ category: 'Technical Issue', priority: 'High', mustReview: true });
  });

  it('answers empty and whitespace-only text with the default instead of the page alert', () => {
    const fallback = { category: 'Other', priority: 'Medium', mustReview: false };
    expect(v0Triage('')).toEqual(fallback);
    expect(v0Triage('  \n\t ')).toEqual(fallback);
  });
});
