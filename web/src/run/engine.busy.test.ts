import { describe, expect, it } from 'vitest';
import { createSchedule } from './clock';
import type { Run, RunState } from './engine';
import {
  MAX_STEPS,
  SEED,
  firstOpen,
  idOf,
  ids,
  makeRealRun,
  makeRun,
  outline,
  pacedDay,
  rightPick,
  stepUntil,
  withoutMsTrail,
} from './engineTestKit';

// The viewer's Speed up (and Play at the end of the slow part) moves a run that is still on Act 1's slow
// arrivals, one ticket every 4 seconds, onto the busy day: what was still to arrive in Act 1 joins the line at once
// and the clock goes to the first arrival of Act 2.
const ACT1 = 30;
const SECOND_MS = 1000;
const FIRST_ACT2_MS = createSchedule(SEED).arrivesAt(ACT1) * SECOND_MS;

const arrived = (s: RunState): number =>
  s.incoming.length + s.open.length + s.done.length + (s.current === undefined ? 0 : 1) + (s.reviewing === undefined ? 0 : 1);

function playUntil(run: Run, reached: (state: RunState) => boolean): void {
  run.play();
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    if (run.nextDelayMs() === null) throw new Error('test: the run has nothing more to do');
    run.advance();
  }
}

// A real day, paused ten seconds in on Act 1's slow arrivals.
function tenSecondsIn(): Run {
  const run = makeRealRun();
  stepUntil(run, (s) => s.simTime >= 10 * SECOND_MS);
  return run;
}

describe('Speed up on Act 1', () => {
  it('lands every ticket still to come in Act 1 in the line at once and moves the clock to Act 2', () => {
    const run = tenSecondsIn();
    const before = run.state();
    expect(arrived(before)).toBeLessThan(ACT1);
    run.speedUp();
    const after = run.state();
    expect(arrived(after)).toBe(ACT1);
    expect(after.simTime).toBe(FIRST_ACT2_MS);
    expect(after.simTime).toBeGreaterThan(before.simTime);
    expect([...after.incoming.map((w) => w.id), ...ids(after.open), ...ids(after.done), after.current?.trail.id ?? ''].filter((id) => id !== '').sort()).toEqual(
      Array.from({ length: ACT1 }, (_, i) => idOf(i)).sort(),
    );
    expect(after.act).toBe(2);
    expect(after.pace).toBe('fast');
  });

  it('shows the busy day within a second of playing: Act 2 tickets are arriving', () => {
    const run = tenSecondsIn();
    run.speedUp();
    run.play();
    let waited = 0;
    // Counted from Act 1's last ticket, which is already in the line by now: the next arrival is Act 2's.
    while (arrived(run.state()) <= ACT1) {
      const delay = run.nextDelayMs();
      if (delay === null) throw new Error('test: nothing more to do');
      waited += delay;
      run.advance();
    }
    expect(waited).toBeLessThanOrEqual(SECOND_MS);
  });

  it('is the same for a seed whenever it is pressed the same way, and never turns run time back', () => {
    const first = tenSecondsIn();
    const second = tenSecondsIn();
    first.speedUp();
    second.speedUp();
    expect(outline(first.state())).toBe(outline(second.state()));
    first.play();
    second.play();
    let last = first.state().simTime;
    for (let n = 0; n < 400 && first.state().act !== 'complete'; n += 1) {
      first.advance();
      second.advance();
      expect(outline(first.state())).toBe(outline(second.state()));
      expect(first.state().simTime).toBeGreaterThanOrEqual(last);
      last = first.state().simTime;
    }
  });

  // The viewer's choice at the end of the slow part is the page's to make (Speed up, or Play in See, which asks
  // for it); Learn's own Play, which keeps the walk going, is not the viewer asking for the busy day.
  it('is not what the engine does on its own Play at the end of the slow part: that carries on at the quick pace', () => {
    const play = makeRealRun();
    playUntil(play, (s) => s.offerSpeedUp);
    play.play();
    expect(arrived(play.state())).toBeLessThan(ACT1);
    expect(play.state()).toMatchObject({ act: 1, pace: 'fast', playing: true, offerSpeedUp: false });
    const press = makeRealRun();
    playUntil(press, (s) => s.offerSpeedUp);
    press.speedUp();
    press.play();
    expect(arrived(press.state())).toBe(ACT1);
    expect(press.state().act).toBe(2);
  });

  // A run left at the quick pace on Act 1's arrivals (Learn played on at the offer) can be offered the busy day again.
  it('offers the busy day again to a run at the quick pace on Act 1, and only to one', () => {
    const run = makeRealRun();
    playUntil(run, (s) => s.offerSpeedUp);
    run.play();
    run.offerBusyDay();
    expect(run.state()).toMatchObject({ offerSpeedUp: true, playing: false, pace: 'slow', act: 1 });
    run.speedUp();
    run.play();
    run.offerBusyDay();
    expect(run.state()).toMatchObject({ offerSpeedUp: false, act: 2 });
    const fresh = makeRealRun();
    fresh.offerBusyDay();
    expect(fresh.state().offerSpeedUp).toBe(false);
  });

  it('forgets a busy day asked for under the review form when the viewer slows down', () => {
    const run = makeRealRun();
    stepUntil(run, (s) => s.open.length > 0);
    run.review(firstOpen(run).id);
    const during = arrived(run.state());
    run.speedUp();
    run.slowDown();
    run.handBack();
    expect(arrived(run.state())).toBe(during);
    expect(run.state().act).toBe(1);
  });

  it('does not move the clock again once the busy day is on, and Slow down still works there', () => {
    const run = tenSecondsIn();
    run.speedUp();
    run.play();
    run.advance();
    run.advance();
    run.pause();
    const at = run.state().simTime;
    run.slowDown();
    expect(run.state()).toMatchObject({ pace: 'slow', act: 2, offerSpeedUp: false });
    run.speedUp();
    expect(run.state().simTime).toBe(at);
    run.slowDown();
    stepUntil(run, (s) => s.current?.deep === true);
    expect(run.state().act).toBe(2);
  });

  it('waits for the review form: the clock does not move while the viewer reviews, and moves when it closes', () => {
    const run = makeRealRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    const during = run.state();
    run.speedUp();
    expect(run.state().simTime).toBe(during.simTime);
    expect(arrived(run.state())).toBe(arrived(during));
    run.handBack();
    expect(arrived(run.state())).toBe(ACT1);
    expect(run.state().simTime).toBe(FIRST_ACT2_MS);
  });

  it('moves to the busy day when the viewer confirms the ticket they were reviewing', () => {
    const run = makeRealRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    run.speedUp();
    run.confirm(rightPick(run, id));
    expect(arrived(run.state())).toBe(ACT1);
    expect(run.state().simTime).toBe(FIRST_ACT2_MS);
  });

  it('leaves the real speed finish alone: the same trails and the same measured pass as without it', () => {
    let now = 0;
    const clock = () => (now += 1);
    const run = makeRun({ wallClock: clock });
    run.speedUp();
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(state.done.map(withoutMsTrail).sort()).toEqual(pacedDay().end.done.map(withoutMsTrail).sort());
    now = 0;
    const clean = makeRun({ wallClock: clock });
    clean.finishNow();
    expect(state.realSpeed).toEqual(clean.state().realSpeed);
  });
});
