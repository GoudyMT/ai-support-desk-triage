import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel } from '../model/scorer';
import { createSchedule } from './clock';
import { createRun, type RunState } from './engine';
import { firstOpen, makeRun, rightPick, stepUntil } from './engineTestKit';
import { createPrescreener } from './prescreen';
import { foldOf } from './seed';
import { dollarsText, minutesText, valueSaved } from './valueSaved';

// A whole 130-ticket day of one seed, finished at once, scored by the fold model the page loads for it.
function finishedDay(seed: number): RunState {
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
  return run.state();
}

describe('value saved', () => {
  // Counted by the lead on the real engine: the tickets of a whole day that no person touched.
  it.each([
    { seed: 1001, untouched: 11, minutes: 22, dollars: 7.89 },
    { seed: 1000, untouched: 18, minutes: 36, dollars: 12.92 },
  ])('seed $seed leaves $untouched of 130 untouched: $minutes min, $dollars dollars', ({ seed, untouched, minutes, dollars }) => {
    const saved = valueSaved(finishedDay(seed));
    expect(saved.untouched).toBe(untouched);
    expect(saved.minutes).toBe(minutes);
    expect(saved.dollars).toBeCloseTo(dollars, 2);
  });

  it('starts at nothing, and a ticket in the center or the open list saves nothing yet', () => {
    const run = makeRun();
    expect(valueSaved(run.state())).toEqual({ untouched: 0, minutes: 0, dollars: 0 });
    stepUntil(run, (s) => s.open.length > 0);
    const busy = run.state();
    expect(busy.done).toHaveLength(0);
    expect(valueSaved(busy).untouched).toBe(0);
  });

  it('adds nothing when the viewer reviews a ticket, though it closes', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const before = valueSaved(run.state());
    const id = firstOpen(run).id;
    run.review(id);
    run.confirm(rightPick(run, id));
    const after = run.state();
    expect(after.done.map((trail) => trail.id)).toContain(id);
    expect(valueSaved(after)).toEqual(before);
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
