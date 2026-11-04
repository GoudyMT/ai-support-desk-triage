import { describe, expect, it } from 'vitest';
import { DEEP_TICKETS, QUICK_STAGE_MS, type Run, type RunState } from './engine';
import {
  MAX_STEPS,
  TOTAL,
  currentOf,
  idOf,
  ids,
  makeRun,
  pacedDay,
  scheduleAt,
  stepUntil,
  withoutMsTrail,
} from './engineTestKit';

// Plays by the page's own calls: the timer asks for the next delay and fires `advance`.
function playUntil(run: Run, reached: (state: RunState) => boolean): void {
  run.play();
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    if (run.nextDelayMs() === null) throw new Error('test: the run has nothing more to do');
    run.advance();
  }
}

const atStage = (stage: string) => (s: RunState) => s.current?.stage === stage;

describe('hold on the line', () => {
  // The Learn walk's first step: tickets pile up in the line and none enters the center.
  it('keeps every ticket out of the center while arrivals and tags carry on, then lets the top one in at once', () => {
    const run = makeRun();
    run.hold('line');
    stepUntil(run, (s) => s.incoming.length >= 4 && s.incoming.every((w) => w.tag !== undefined));
    expect(run.state().current).toBeUndefined();
    const before = run.state().simTime;
    run.hold(null);
    expect(run.state().current?.trail.id).toBe(idOf(0));
    expect(run.state().simTime).toBe(before);
  });
});

describe('hold on a stage', () => {
  it('stops the center ticket at that stage while later arrivals and a close carry on', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0 && s.current?.stage === 'intake');
    const held = currentOf(run).trail.id;
    // At the quick pace Intake would end in a quarter second, long before the first close.
    run.speedUp();
    run.hold('intake');
    stepUntil(run, (s) => s.done.length > 0);
    expect(currentOf(run)).toMatchObject({ stage: 'intake' });
    expect(currentOf(run).trail.id).toBe(held);
  });

  // The third arrival is at 12 s, long after the first ticket's Intake ended at 5.5 s.
  const LATE = [0.5, 8, 12];

  it('lets the ticket on at once when the hold moves, without turning run time back', () => {
    const run = makeRun({ schedule: scheduleAt(LATE, 3) });
    run.hold('intake');
    stepUntil(run, (s) => s.incoming.length >= 2);
    const times = [run.state().simTime];
    expect(times[0]).toBeGreaterThan(5500);
    run.hold('privacy');
    run.step();
    times.push(run.state().simTime);
    expect(currentOf(run).stage).toBe('privacy');
    run.hold(null);
    stepUntil(run, atStage('classify'));
    times.push(run.state().simTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[1]).toBe(times[0]);
  });

  it('does not report a held event as the next one', () => {
    const run = makeRun({ schedule: scheduleAt([0.5, 30], 1) });
    run.hold('guardrails');
    stepUntil(run, (s) => s.incoming.length > 0);
    run.play();
    // Guardrails ended at 20.5 s, so its event is overdue: the next thing is the second ticket's tag.
    expect(run.nextDelayMs()).toBe(400);
    run.hold(null);
    expect(run.nextDelayMs()).toBe(0);
  });

  it('has nothing to wait for when only a held event is left', () => {
    const run = makeRun({ schedule: scheduleAt([0.5], 1) });
    run.hold('intake');
    stepUntil(run, (s) => s.current?.tag !== undefined);
    run.play();
    expect(run.nextDelayMs()).toBeNull();
    run.advance();
    expect(currentOf(run).stage).toBe('intake');
  });
});

describe('the slow count', () => {
  it('makes the first three tickets into the center slow, then the rest quick, and says which pace it is', () => {
    const run = makeRun();
    const deep = new Map<string, boolean>();
    expect(run.state().pace).toBe('slow');
    stepUntil(run, (s) => {
      if (s.current !== undefined) deep.set(s.current.trail.id, s.current.deep);
      return s.current?.trail.id === idOf(DEEP_TICKETS);
    });
    expect([...deep.values()]).toEqual([true, true, true, false]);
    // The end of the slow part is on offer until the viewer plays on.
    expect(run.state().pace).toBe('slow');
    run.play();
    expect(run.state().pace).toBe('fast');
  });

  it('speeds the ticket in the center and every later one up when the viewer asks', () => {
    const run = makeRun();
    stepUntil(run, atStage('intake'));
    const asked = run.state().simTime;
    run.speedUp();
    expect(run.state().pace).toBe('fast');
    expect(currentOf(run).deep).toBe(false);
    run.step();
    expect(run.state().simTime - asked).toBeLessThanOrEqual(QUICK_STAGE_MS);
    stepUntil(run, (s) => s.current?.trail.id === idOf(1));
    expect(currentOf(run).deep).toBe(false);
  });

  it('slows the next three tickets down again', () => {
    const run = makeRun();
    run.speedUp();
    stepUntil(run, (s) => s.current?.trail.id === idOf(1));
    run.slowDown();
    expect(run.state().pace).toBe('slow');
    const deep = new Map<string, boolean>();
    stepUntil(run, (s) => {
      if (s.current !== undefined) deep.set(s.current.trail.id, s.current.deep);
      return s.current?.trail.id === idOf(1 + DEEP_TICKETS + 1);
    });
    expect([...deep.values()]).toEqual([false, true, true, true, false]);
    run.play();
    expect(run.state().pace).toBe('fast');
  });
});

describe('the offer to speed up', () => {
  it('pauses the run when the last slow ticket leaves, and offers the busy day', () => {
    const run = makeRun();
    playUntil(run, (s) => s.offerSpeedUp);
    const state = run.state();
    expect(state.playing).toBe(false);
    expect(state.pace).toBe('slow');
    const gone = [...ids(state.open), ...ids(state.done)];
    expect(gone).toContain(idOf(DEEP_TICKETS - 1));
    expect(state.current?.trail.id).toBe(idOf(DEEP_TICKETS));
  });

  it('is not made after the viewer sped up', () => {
    const run = makeRun();
    run.speedUp();
    run.play();
    for (let n = 0; run.state().act !== 'complete' && n < MAX_STEPS; n += 1) {
      expect(run.state().offerSpeedUp).toBe(false);
      run.advance();
    }
    expect(run.state().act).toBe('complete');
  });

  it('goes when the viewer presses Play, and the run goes on at the quick pace', () => {
    const run = makeRun();
    playUntil(run, (s) => s.offerSpeedUp);
    run.play();
    expect(run.state()).toMatchObject({ offerSpeedUp: false, pace: 'fast', playing: true });
    const entered = currentOf(run).trail.id;
    expect(currentOf(run).deep).toBe(false);
    run.advance();
    expect(currentOf(run).trail.id).toBe(entered);
  });

  it.each([
    ['speeds up', (run: Run) => run.speedUp(), 'fast'],
    ['slows down', (run: Run) => run.slowDown(), 'slow'],
  ])('goes when the viewer %s', (_name, press, pace) => {
    const run = makeRun();
    playUntil(run, (s) => s.offerSpeedUp);
    press(run);
    expect(run.state()).toMatchObject({ offerSpeedUp: false, pace });
  });

  it('comes again after slowing down and three more slow tickets', () => {
    const run = makeRun();
    run.speedUp();
    run.slowDown();
    playUntil(run, (s) => s.offerSpeedUp);
    expect(run.state().current?.trail.id).toBe(idOf(DEEP_TICKETS));
  });
});

describe('finishNow with a hold, a slow count and the offer', () => {
  // The real speed number and the trails must be the same however the viewer left the run.
  it.each([
    ['a hold on the line', (run: Run) => run.hold('line')],
    [
      'a hold on a stage',
      (run: Run) => {
        run.hold('classify');
        stepUntil(run, atStage('classify'));
      },
    ],
    ['the offer showing', (run: Run) => playUntil(run, (s) => s.offerSpeedUp)],
  ])('gives the paced day\'s trails and the same measured pass with %s', (_name, leave) => {
    const clean = makeRun({ wallClock: tickingClock() });
    clean.finishNow();
    const run = makeRun({ wallClock: tickingClock() });
    leave(run);
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(state.offerSpeedUp).toBe(false);
    expect(state.done.map(withoutMsTrail).sort()).toEqual(pacedDay().end.done.map(withoutMsTrail).sort());
    expect(state.realSpeed?.tickets).toBe(TOTAL);
    expect(state.realSpeed?.ms).toBe(clean.state().realSpeed?.ms);
  });
});

function tickingClock(): () => number {
  let now = 0;
  return () => {
    now += 1;
    return now;
  };
}
