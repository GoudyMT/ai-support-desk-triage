import { CLOSE_EVERY_MS } from '../run/engine';
import { HOURLY_PAY_USD, MINUTES_PER_TICKET } from '../run/valueSaved';
import type { PillKind } from './view';

const MS_PER_SECOND = 1000;

// What the line under the title says in See while the pace is the news. At other times it says what the page is.
export const TOP_LINE_WORDS = {
  slow: 'Slowed down for the first few tickets so you can follow along.',
  busy: 'Busy-day speed is back.',
};

// What the source panel of each saved number says. The figures come from the constants the numbers use,
// so the words cannot drift from the sums.
export const TIME_SAVED_SOURCE =
  `Estimate, not a measurement. Each ticket no person touched counts as ${MINUTES_PER_TICKET} minutes saved. ` +
  'Tool vendors publish 2 to 12 minutes for sorting one ticket and we found no independent study, so we use the low end.';

export const VALUE_SAVED_SOURCE =
  `Estimate, not a measurement. Time saved x $${HOURLY_PAY_USD} an hour, the US median pay for customer service ` +
  'representatives (Bureau of Labor Statistics, May 2025). Benefits are not added, which keeps it low.';

// The part of VALUE_SAVED_SOURCE that is the link, and where it goes. Opening it is the visitor's choice
// and sends nothing from the page.
export const VALUE_SOURCE_LINK = {
  phrase: 'Bureau of Labor Statistics, May 2025',
  href: 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm',
};

// What each mark on a closed line means, in the order they are listed. `word` is how the mark starts.
export const PILL_KEY: { kind: PillKind; word: string; meaning: string }[] = [
  { kind: 'auto', word: 'Auto', meaning: 'no person needed.' },
  { kind: 'flagged', word: 'Flagged', meaning: "a person checked it and kept the model's category." },
  { kind: 'overridden', word: 'Overridden', meaning: "the reviewer changed the model's category." },
  { kind: 'missed', word: 'Missed', meaning: 'it needed a person and did not get one.' },
  { kind: 'you', word: 'You', meaning: 'your own review.' },
];

// Under Going out: says who closes the tickets, since no person does here.
export function reviewerNote(): string {
  return `A simulated reviewer stands in for a person here. It closes one ticket every ${CLOSE_EVERY_MS / MS_PER_SECOND} seconds.`;
}
