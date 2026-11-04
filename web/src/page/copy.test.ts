import { describe, expect, it } from 'vitest';
import { ROUTES } from '../domain/labels';
import { PILL_KEY, paceNote, reviewerNote } from './copy';
import { outgoingView } from './view';
import { finishedRun, makeRun, missedTruth, must, noTruth, stepUntil } from './viewTestKit';

describe('the note above the board', () => {
  it('says the run is slowed down and when it speeds up, with the number from the engine constant', () => {
    expect(paceNote()).toBe(
      'Slowed down so you can read each step. It speeds up after the first 3 tickets.',
    );
  });
});

describe('the note under Going out', () => {
  it('says the reviewer is simulated and how often it closes a ticket, from the engine constant', () => {
    expect(reviewerNote()).toBe(
      'A simulated reviewer stands in for a person here. It closes one ticket every 1.5 seconds.',
    );
  });
});

// A visitor decodes the closed list with this key, so each sentence must say what the code does when it
// picks the mark: Flagged is a reviewer who kept the model's CATEGORY (the priority may differ) and
// Overridden is a changed CATEGORY, as in pillFor.
describe('the key to the marks on a closed line', () => {
  it('lists each mark in turn with the meaning the code gives it', () => {
    expect(PILL_KEY.map((row) => `${row.word}: ${row.meaning}`)).toEqual([
      'Auto: no person needed.',
      "Flagged: a person checked it and kept the model's category.",
      "Overridden: the reviewer changed the model's category.",
      'Missed: it needed a person and did not get one.',
      'You: your own review.',
    ]);
  });

  // A mark the closed list can show without a line in the key would be one a visitor cannot decode.
  it('starts every mark the closed list can show, and no other', () => {
    const run = finishedRun();
    const state = run.state();
    const words = new Set(outgoingView(state, noTruth).closed.map((row) => row.pill.word));
    for (const row of outgoingView(state, missedTruth(run).truthOf).closed) words.add(row.pill.word);
    const viewed = makeRun();
    const id = must(stepUntil(viewed, (s) => s.open.length > 0).open[0]).id;
    viewed.review(id);
    const truth = viewed.truthOf(id);
    viewed.confirm({ category: truth.category, priority: truth.priority, route: ROUTES[truth.category] });
    for (const row of outgoingView(viewed.state(), viewed.truthOf).closed) words.add(row.pill.word.split(':')[0] ?? '');
    expect([...words].sort()).toEqual(PILL_KEY.map((row) => row.word).sort());
  });
});
