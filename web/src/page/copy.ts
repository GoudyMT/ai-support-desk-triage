import { CLOSE_EVERY_MS, DEEP_TICKETS } from '../run/engine';
import type { PillKind } from './view';

const MS_PER_SECOND = 1000;

// Above the board while the first tickets go slowly: says why, and when it stops.
export function paceNote(): string {
  return `Slowed down so you can read each step. It speeds up after the first ${DEEP_TICKETS} tickets.`;
}

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
