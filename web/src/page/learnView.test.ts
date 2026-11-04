import { describe, expect, it } from 'vitest';
import { narrate } from '../run/narrate';
import { STEPS } from './learnSteps';
import {
  WORDS_PER_MINUTE,
  barFills,
  learnBarView,
  placeBlock,
  reachStep,
  stepMs,
  ticketLine,
  unionBox,
  type Box,
} from './learnView';
import { makeRun } from './viewTestKit';

const step = (n: number) => {
  const found = STEPS[n];
  if (found === undefined) throw new Error('test: no such step');
  return found;
};

describe('how long a step stays', () => {
  const MS_PER_MINUTE = 60_000;
  // "Messages come in" is 3 words and its text is 26.
  const FIRST_WORDS = 29;

  it('reads at 238 words a minute, counting the title and the text split on spaces', () => {
    expect(WORDS_PER_MINUTE).toBe(238);
    expect(stepMs(step(0), null)).toBeCloseTo((FIRST_WORDS / 238) * MS_PER_MINUTE, 6);
  });

  it('adds the words of the live ticket sentence when there is one', () => {
    const sentence = 'The model is fairly sure this is a billing question.';
    expect(stepMs(step(2), sentence)).toBeCloseTo(stepMs(step(2), null) + (10 / 238) * MS_PER_MINUTE, 6);
  });
});

describe('reaching a step on the real engine', () => {
  // The hold is only set; the engine has to be walked until the live ticket is where the words say.
  const where = (n: number) => {
    const run = makeRun();
    expect(reachStep(run, step(n))).toBe(true);
    return run.state();
  };

  it.each([
    [2, 'intake'],
    [3, 'privacy'],
    [4, 'classify'],
    [5, 'guardrails'],
  ])('puts the first ticket at the stage of step %i, not past it', (n, stage) => {
    const state = where(n - 1);
    expect(state.current?.trail.id).toBe('T-1001-0');
    expect(state.current?.stage).toBe(stage);
  });

  it('holds the line for the first step: tickets wait and none is in the center', () => {
    const state = where(0);
    expect(state.current).toBeUndefined();
    expect(state.incoming.length).toBeGreaterThan(0);
  });

  it('lets the first flagged ticket reach the outgoing list for step 6 and one close for step 7', () => {
    expect(where(5).open.length).toBeGreaterThan(0);
    expect(where(6).done.length).toBeGreaterThan(0);
  });

  it('walks forward from one step to the next on the same run', () => {
    const run = makeRun();
    for (const n of [0, 1, 2, 3, 4]) expect(reachStep(run, step(n))).toBe(true);
    expect(run.state().current?.stage).toBe('guardrails');
  });

  it('gives up at the limit instead of looping for ever', () => {
    expect(reachStep(makeRun(), step(4), 3)).toBe(false);
  });

  it('moves a paused run too, by stepping it', () => {
    const run = makeRun();
    run.pause();
    expect(reachStep(run, step(3))).toBe(true);
    expect(run.state().current?.stage).toBe('classify');
  });
});

describe('the live ticket sentence', () => {
  it("is the narration of the lit stage for the ticket in the center, or none when it is empty", () => {
    const run = makeRun();
    reachStep(run, step(2));
    const state = run.state();
    const trail = state.current?.trail;
    expect(trail).toBeDefined();
    expect(ticketLine(state, 'privacy')).toBe(narrate(trail as NonNullable<typeof trail>, 'privacy').plain);
    const empty = makeRun();
    expect(ticketLine(empty.state(), 'privacy')).toBeNull();
  });
});

describe('the loading bars', () => {
  it('shows done steps full, later steps empty and the current one by its share', () => {
    expect(barFills(2, 0.25, 4)).toEqual([1, 1, 0.25, 0]);
  });

  it('never fills the current step past full', () => {
    expect(barFills(0, 1.4, 3)).toEqual([1, 0, 0]);
  });
});

describe('the Learn row of the bar', () => {
  it('turns Next into See The Process on the last step and cannot go back from the first', () => {
    expect(learnBarView(0, 7, false)).toEqual({ backDisabled: true, mainLabel: 'Pause', nextLabel: 'Next', count: 'Step 1 of 7' });
    expect(learnBarView(6, 7, true)).toEqual({ backDisabled: false, mainLabel: 'Resume', nextLabel: 'See The Process', count: 'Step 7 of 7' });
  });
});

describe('where the context block goes', () => {
  const VIEW = { width: 1280, height: 730 };
  const BLOCK = { width: 336, height: 190 };
  const overlaps = (a: Box, b: Box): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const inside = (b: Box): boolean => b.left >= 0 && b.top >= 0 && b.left + b.width <= VIEW.width && b.top + b.height <= VIEW.height;

  it.each<[string, Box]>([
    ['the line on the left', { left: 16, top: 100, width: 240, height: 600 }],
    ['the going-out column on the right', { left: 940, top: 100, width: 320, height: 600 }],
    ['the stats along the top', { left: 400, top: 8, width: 500, height: 56 }],
    ['a line in the wide middle', { left: 270, top: 300, width: 660, height: 40 }],
  ])('puts the block beside %s, inside the screen and clear of it', (_name, hole) => {
    const at = placeBlock(hole, BLOCK, VIEW);
    const box = { ...at, ...BLOCK };
    expect(inside(box)).toBe(true);
    expect(overlaps(box, hole)).toBe(false);
  });
});

describe('the box a hole covers', () => {
  it('is the smallest box holding all the lit parts', () => {
    expect(
      unionBox([
        { left: 10, top: 10, width: 100, height: 20 },
        { left: 20, top: 40, width: 200, height: 10 },
      ]),
    ).toEqual({ left: 10, top: 10, width: 210, height: 40 });
    expect(unionBox([])).toBeUndefined();
  });
});
