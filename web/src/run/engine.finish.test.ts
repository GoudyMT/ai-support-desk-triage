import { describe, expect, it } from 'vitest';
import { createSchedule } from './clock';
import type { RunState } from './engine';
import {
  SEED,
  TOTAL,
  firstOpen,
  idOf,
  ids,
  makeRun,
  pacedDay,
  rightPick,
  runToOpen,
  stepUntil,
  withoutMs,
  withoutMsTrail,
} from './engineTestKit';

describe('finishNow', () => {
  it('closes every ticket at once and reports the measured time from the wall clock read before and after', () => {
    const reads: number[] = [];
    const run = makeRun({
      wallClock: () => {
        const reading = (reads.length + 1) * 7;
        reads.push(reading);
        return reading;
      },
    });
    const readsBefore = reads.length;
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(state.playing).toBe(false);
    expect(state.done.map(withoutMsTrail)).toEqual(pacedDay().end.done.map(withoutMsTrail));
    const first = reads[readsBefore] ?? 0;
    const last = reads.at(-1) ?? 0;
    expect(state.realSpeed).toEqual({ tickets: TOTAL, ms: last - first });
    expect(last - first).toBeGreaterThan(0);
  });

  // The real speed button with a ticket open and the form closed, and again on the last ticket.
  it.each([
    ['a ticket open', (s: RunState) => s.open.length > 0 && s.done.length > 2],
    ['the last ticket in the center', (s: RunState) => s.current?.trail.id === idOf(TOTAL - 1)],
  ])('closes every ticket once and ends complete with %s', (_name, ready) => {
    const { end } = pacedDay();
    const run = makeRun();
    stepUntil(run, ready);
    const remaining = TOTAL - run.state().done.length;
    expect(remaining).toBeGreaterThan(0);
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(ids(state.done).sort()).toEqual(ids(end.done).sort());
    expect(state.done.map(withoutMsTrail).sort()).toEqual(end.done.map(withoutMsTrail).sort());
    expect(state.open).toEqual([]);
    expect(state.incoming).toEqual([]);
    expect(state.realSpeed?.tickets).toBe(remaining);
  });

  // The page's own schedule: 30 tickets in Act 1 and the 100-ticket busy day.
  it('closes all 130 tickets of the real schedule', () => {
    const schedule = createSchedule(SEED);
    const run = makeRun({ schedule });
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(new Set(ids(state.done)).size).toBe(schedule.total);
    expect(state.done).toHaveLength(schedule.total);
    expect(state.realSpeed?.tickets).toBe(schedule.total);
  });

  it('counts the viewer\'s earlier reviews once and leaves them in place', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    run.confirm(rightPick(run, id));
    run.finishNow();
    expect(run.state().viewerReviews).toEqual([{ id, correct: true }]);
    expect(ids(run.state().done).filter((x) => x === id)).toHaveLength(1);
    expect(run.state().done).toHaveLength(TOTAL);
  });

  it('does nothing while a form is open', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    run.review(firstOpen(run).id);
    const held = withoutMs(run.state());
    run.finishNow();
    expect(withoutMs(run.state())).toBe(held);
    expect(run.state().realSpeed).toBeUndefined();
  });
});

describe('onChange', () => {
  it('tells listeners once after each change, with the new state in place, and stops after unsubscribe', () => {
    const run = makeRun();
    const seen: string[] = [];
    const off = run.onChange(() => {
      const s = run.state();
      seen.push(`${s.playing}/${s.current?.stage}/${s.reviewing?.id}/${s.act}`);
    });
    run.advance();
    expect(seen).toEqual([]);
    run.play();
    run.play();
    run.advance();
    run.pause();
    expect(seen).toEqual(['true/undefined/undefined/1', 'true/intake/undefined/1', 'false/intake/undefined/1']);
    off();
    run.step();
    expect(seen).toHaveLength(3);
  });

  it('tells listeners once for a whole finish, not once per event', () => {
    const run = makeRun();
    let told = 0;
    run.onChange(() => {
      told += 1;
    });
    run.finishNow();
    expect(told).toBe(1);
  });

  // The page redraws on a change: Hand back moves a card back into the list.
  it('tells listeners once when the viewer hands a ticket back, with the ticket already back in the list', () => {
    const run = runToOpen(6);
    run.review(idOf(6));
    const seen: { reviewing: boolean; open: string[] }[] = [];
    run.onChange(() => seen.push({ reviewing: run.state().reviewing !== undefined, open: ids(run.state().open) }));
    run.handBack();
    expect(seen).toEqual([{ reviewing: false, open: [6, 5, 2].map(idOf) }]);
  });

  // The page's timer stops when the run stops playing; the last Confirm ends the run.
  it('stops playing when the viewer confirms the last ticket', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.done.length === TOTAL - 1);
    expect(run.state().open).toHaveLength(1);
    run.play();
    const id = firstOpen(run).id;
    run.review(id);
    expect(run.state().playing).toBe(true);
    run.confirm(rightPick(run, id));
    expect(run.state().act).toBe('complete');
    expect(run.state().playing).toBe(false);
    expect(run.nextDelayMs()).toBeNull();
  });

  it('tells listeners once when the viewer confirms, with the review already counted', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    const seen: { reviewing: boolean; reviews: number }[] = [];
    run.onChange(() => seen.push({ reviewing: run.state().reviewing !== undefined, reviews: run.state().viewerReviews.length }));
    run.confirm(rightPick(run, id));
    expect(seen).toEqual([{ reviewing: false, reviews: 1 }]);
  });
});
