import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, ROUTES, type TicketLabel } from '../domain/labels';
import { loadModel } from '../model/scorer';
import { createSchedule } from './clock';
import { createRun, type RunState } from './engine';
import { firstOpen, makeRun, rightPick, stepUntil } from './engineTestKit';
import { createPrescreener } from './prescreen';
import { foldOf } from './seed';
import { dollarsText, minutesText, rose, valueSaved } from './valueSaved';

// A whole 130-ticket day of one seed, finished at once, scored by the fold model the page loads for it.
function finishedDay(seed: number): { state: RunState; truthOf: (id: string) => TicketLabel } {
  const file = new URL(`../../public/models/fold_${foldOf(seed)}.json`, import.meta.url);
  const model = loadModel(JSON.parse(readFileSync(fileURLToPath(file), 'utf8')));
  const run = createRun({
    seed,
    model,
    schedule: createSchedule(seed),
    wallClock: () => 0,
    prescreen: createPrescreener(model),
  });
  run.finishNow();
  return { state: run.state(), truthOf: run.truthOf };
}

describe('value saved', () => {
  // Counted by hand from the closed trails of a whole day, with no tool of this module: tickets with no review,
  // less those the truth says needed a person (Missed) and those sent to a team other than the true one.
  it.each([
    { seed: 1001, noReview: 11, missed: 0, wrongTeam: 0, counted: 11, minutes: 22, dollars: 7.89 },
    { seed: 1000, noReview: 18, missed: 0, wrongTeam: 3, counted: 15, minutes: 30, dollars: 10.77 },
    { seed: 1003, noReview: 15, missed: 1, wrongTeam: 2, counted: 12, minutes: 24, dollars: 8.61 },
  ])('seed $seed: $noReview with no review, $missed missed and $wrongTeam to the wrong team leave $counted', ({ seed, counted, minutes, dollars }) => {
    const { state, truthOf } = finishedDay(seed);
    const saved = valueSaved(state, truthOf);
    expect(saved.counted).toBe(counted);
    expect(saved.minutes).toBe(minutes);
    expect(saved.dollars).toBeCloseTo(dollars, 2);
  });

  // Each reason on its own: one counted ticket is made a must-review ticket, then another is given a true team
  // other than the one the system sent it to.
  it('does not count a ticket that needed a person, or one sent to the wrong team, and counts the rest', () => {
    const { state, truthOf } = finishedDay(1001);
    const counted = state.done.filter((trail) => trail.review === undefined);
    const [first, second] = counted;
    if (first === undefined || second === undefined) throw new Error('test: no ticket to change');
    const otherTeam = CATEGORIES.find((category) => ROUTES[category] !== second.final.route);
    if (otherTeam === undefined) throw new Error('test: every category has the same team');
    const asMissed = (id: string): TicketLabel => ({ ...truthOf(id), mustReview: id === first.id || truthOf(id).mustReview });
    const asWrong = (id: string): TicketLabel => (id === second.id ? { ...truthOf(id), category: otherTeam } : truthOf(id));
    expect(valueSaved(state, truthOf).counted).toBe(counted.length);
    expect(valueSaved(state, asMissed).counted).toBe(counted.length - 1);
    expect(valueSaved(state, asWrong).counted).toBe(counted.length - 1);
  });

  it('starts at nothing, and a ticket in the center or the open list saves nothing yet', () => {
    const run = makeRun();
    expect(valueSaved(run.state(), run.truthOf)).toEqual({ counted: 0, minutes: 0, dollars: 0 });
    stepUntil(run, (s) => s.open.length > 0);
    const busy = run.state();
    expect(busy.done).toHaveLength(0);
    expect(valueSaved(busy, run.truthOf).counted).toBe(0);
  });

  it('adds nothing when the viewer reviews a ticket, though it closes', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const before = valueSaved(run.state(), run.truthOf);
    const id = firstOpen(run).id;
    run.review(id);
    run.confirm(rightPick(run, id));
    const after = run.state();
    expect(after.done.map((trail) => trail.id)).toContain(id);
    expect(valueSaved(after, run.truthOf)).toEqual(before);
  });
});

// The page pulses a number only when it goes up from a value it had shown: not on its first drawing, and
// not when a restart takes it back to zero.
describe('when a saved number has risen', () => {
  it.each([
    [undefined, 0, false],
    [undefined, 5, false],
    [3, 3, false],
    [3, 4, true],
    [4, 3, false],
    [5, 0, false],
    [0, 1, true],
  ])('from %s to %i it is %s', (before, after, expected) => {
    expect(rose(before, after)).toBe(expected);
  });
});

describe('how the numbers read', () => {
  it.each([
    [0, '0 min'],
    [22, '22 min'],
    [59, '59 min'],
    [60, '1 h'],
    [64, '1 h 4 min'],
    [260, '4 h 20 min'],
  ])('%i minutes read %s', (minutes, text) => {
    expect(minutesText(minutes)).toBe(text);
  });

  it.each([
    [0, '$0.00'],
    [7.894, '$7.89'],
    [12.918, '$12.92'],
    [93.29, '$93.29'],
  ])('%f dollars read %s', (dollars, text) => {
    expect(dollarsText(dollars)).toBe(text);
  });
});
