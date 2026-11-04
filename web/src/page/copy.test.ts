import { describe, expect, it } from 'vitest';
import { reviewerNote } from './copy';

describe('the note under Going out', () => {
  it('says the reviewer is simulated and how often it closes a ticket, from the engine constant', () => {
    expect(reviewerNote()).toBe(
      'A simulated reviewer stands in for a person here. It closes one ticket every 1.5 seconds.',
    );
  });
});
