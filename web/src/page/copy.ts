import { CLOSE_EVERY_MS } from '../run/engine';
import { HOURLY_PAY_USD, MINUTES_PER_TICKET } from '../run/valueSaved';
import type { PillKind } from './view';

const MS_PER_SECOND = 1000;

// What the bar says, and the live region with it, when the run pauses itself at the end of the slow part.
export const OFFER_WORDS = 'That was the slow part. Press Speed up to see a busy day.';

// What the line under the title says in See while the pace is the news. At other times it says what the page is.
export const TOP_LINE_WORDS = {
  slow: 'Slowed down for the first few tickets so you can follow along.',
  busy: 'Busy-day speed is back.',
};

// What the source panel of each saved number says. The figures come from the constants the numbers use,
// so the words cannot drift from the sums.
export const TIME_SAVED_SOURCE =
  `Estimate, not a measurement. Each ticket the system sorted correctly with no review counts as ${MINUTES_PER_TICKET} minutes saved. ` +
  'Vendors of IT desk tools put sorting one ticket at 3 to 12 minutes (Mizo, Giant Rocketship) and we found no independent ' +
  'study, so we use less than their lowest figure.';

export const VALUE_SAVED_SOURCE =
  `Estimate, not a measurement. Time saved x $${HOURLY_PAY_USD} an hour, the US median pay for customer service ` +
  'representatives (Bureau of Labor Statistics, May 2025). Benefits are not added, which keeps it low.';

// The parts of each source that are links, and where they go. Opening one is the visitor's choice and sends
// nothing from the page.
export const TIME_SOURCE_LINKS = [
  { phrase: 'Mizo', href: 'https://mizo.tech/blog/ticket-triaging-practical-guide-msp/' },
  {
    phrase: 'Giant Rocketship',
    href: 'https://giantrocketship.com/blog/the-5-minute-ticket-why-your-triage-process-costs-more-than-you-think',
  },
];

export const VALUE_SOURCE_LINKS = [
  {
    phrase: 'Bureau of Labor Statistics, May 2025',
    href: 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm',
  },
];

// What each mark on a closed line means, in the order they are listed. `word` is how the mark starts.
export const PILL_KEY: { kind: PillKind; word: string; meaning: string }[] = [
  { kind: 'auto', word: 'Auto', meaning: 'no review.' },
  { kind: 'flagged', word: 'Flagged', meaning: "the reviewer checked it and kept the model's category." },
  { kind: 'overridden', word: 'Overridden', meaning: "the reviewer changed the model's category." },
  { kind: 'missed', word: 'Missed', meaning: 'it needed a person and did not get one.' },
  { kind: 'wrong', word: 'Wrong team', meaning: 'it went to the wrong team and nobody checked it.' },
  { kind: 'you', word: 'You', meaning: 'your own review.' },
];

// Under Going out: says who closes the tickets, since no person does here.
export function reviewerNote(): string {
  return `A simulated reviewer stands in for a person here. It closes one ticket every ${CLOSE_EVERY_MS / MS_PER_SECOND} seconds.`;
}
