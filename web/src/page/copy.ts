import { CLOSE_EVERY_MS } from '../run/engine';

const MS_PER_SECOND = 1000;

// Under Going out: says who closes the tickets, since no person does here.
export function reviewerNote(): string {
  return `A simulated reviewer stands in for a person here. It closes one ticket every ${CLOSE_EVERY_MS / MS_PER_SECOND} seconds.`;
}
