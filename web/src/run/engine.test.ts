import { describe, expect, it } from 'vitest';
import { maskText } from '../privacy/mask';
import { CLOSE_EVERY_MS } from './engine';
import {
  FIRST_ARRIVAL_S,
  FOLD,
  MAX_STEPS,
  SEED,
  STUB_TAG,
  criticalAt,
  currentOf,
  eventKind,
  fakeSchedule,
  firstOpen,
  idOf,
  ids,
  lastDone,
  makeRun,
  pacedDay,
  rawTicket,
  runToOpen,
  scheduleAt,
  stepToClose,
  stepToEnd,
  stepUntil,
  withoutMs,
} from './engineTestKit';
import { foldOf } from './seed';

describe('a new run', () => {
  it('starts paused and empty on the fold the seed names', () => {
    const run = makeRun();
    expect(foldOf(SEED)).toBe(FOLD);
    expect(run.state()).toEqual({
      seed: SEED,
      fold: FOLD,
      act: 1,
      playing: false,
      simTime: 0,
      incoming: [],
      open: [],
      done: [],
      viewerReviews: [],
    });
    expect(run.nextDelayMs()).toBeNull();
  });

  it('knows the truth of the tickets it made and refuses any other id', () => {
    const run = makeRun();
    run.step();
    expect(run.truthOf(idOf(0))).toEqual(rawTicket(0).label);
    expect(() => run.truthOf('T-1-0')).toThrow('E_UNKNOWN_TICKET');
  });
});

describe('arrival and tag', () => {
  it('lets a ticket arrive at its schedule time and takes it into the center before its tag comes', () => {
    const run = makeRun();
    run.step();
    const state = run.state();
    expect(state.simTime).toBe(FIRST_ARRIVAL_S * 1000);
    expect(state.incoming).toEqual([]);
    expect(state.current?.trail.id).toBe(idOf(0));
    expect(state.current?.stage).toBe('intake');
    expect(state.current?.tag).toBeUndefined();
  });

  it('tags a ticket 400 ms after it arrived, from its masked text, even after it left the line', () => {
    const seen: string[] = [];
    const run = makeRun({
      schedule: fakeSchedule(1, 1),
      prescreen: (text) => {
        seen.push(text);
        return STUB_TAG;
      },
    });
    run.step();
    expect(seen).toEqual([]);
    run.play();
    expect(run.nextDelayMs()).toBe(400);
    run.advance();
    expect(run.state().simTime).toBe(FIRST_ARRIVAL_S * 1000 + 400);
    expect(currentOf(run).tag).toEqual(STUB_TAG);
    expect(seen).toEqual([maskText(rawTicket(0).text).text]);
  });

  it('shows a waiting ticket by id, masked text and tag', () => {
    const run = makeRun({ prescreen: criticalAt([1]) });
    stepUntil(run, (s) => s.incoming.some((w) => w.tag !== undefined));
    expect(run.state().incoming[0]).toEqual({
      id: idOf(1),
      maskedText: maskText(rawTicket(1).text).text,
      tag: { priority: 'Urgent', critical: true },
    });
  });

  // The pre-screener's whole job: a critical ticket must not wait behind routine ones.
  it('moves a critical ticket ahead of every waiting ticket that is not critical, and behind earlier critical ones', () => {
    const run = makeRun({ schedule: fakeSchedule(8, 6), prescreen: criticalAt([3, 5]) });
    stepUntil(run, (s) => s.incoming.length === 7 && s.incoming.every((w) => w.tag !== undefined));
    expect(run.state().current?.trail.id).toBe(idOf(0));
    expect(ids(run.state().incoming)).toEqual([3, 5, 1, 2, 4, 6, 7].map(idOf));
  });

  it('keeps a routine ticket where it arrived', () => {
    const run = makeRun({ schedule: fakeSchedule(5, 5) });
    stepUntil(run, (s) => s.incoming.length === 4 && s.incoming.every((w) => w.tag !== undefined));
    expect(ids(run.state().incoming)).toEqual([1, 2, 3, 4].map(idOf));
  });
});

describe('events in run time', () => {
  it('shows each center stage 5000 ms for the first three tickets and 250 ms for the rest', () => {
    const run = makeRun();
    // Per ticket: when each of its four stages began, then when it left the center.
    const marks = new Map<string, number[]>();
    let lastId: string | undefined;
    let lastStage: string | undefined;
    stepToEnd(run, (s) => {
      const id = s.current?.trail.id;
      if (lastId !== undefined && id !== lastId) marks.set(lastId, [...(marks.get(lastId) ?? []), s.simTime]);
      if (id !== undefined && (id !== lastId || s.current?.stage !== lastStage)) {
        marks.set(id, [...(marks.get(id) ?? []), s.simTime]);
      }
      lastId = id;
      lastStage = s.current?.stage;
    });
    for (let i = 0; i < 6; i += 1) {
      const times = marks.get(idOf(i)) ?? [];
      expect(times).toHaveLength(5);
      const gaps = times.slice(1).map((t, n) => t - (times[n] ?? 0));
      const expected = i < 3 ? 5000 : 250;
      expect(gaps).toEqual([expected, expected, expected, expected]);
    }
  });

  it('closes the top open ticket CLOSE_EVERY_MS after it opened', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length === 1);
    const opened = run.state().simTime;
    const id = firstOpen(run).id;
    stepUntil(run, (s) => s.done.some((t) => t.id === id));
    expect(run.state().simTime).toBe(opened + CLOSE_EVERY_MS);
    expect(lastDone(run).id).toBe(id);
  });

  // The reviewer keeps going: after one close the next open ticket closes exactly one
  // CLOSE_EVERY_MS later, not at once, not never.
  it('closes the second of two open tickets CLOSE_EVERY_MS after the first', () => {
    // Ticket 3 joins ticket 2, the first time two are open; no earlier close left one waiting.
    const run = runToOpen(3);
    expect(ids(run.state().open)).toEqual([3, 2].map(idOf));
    const firstClosedAt = stepToClose(run);
    expect(lastDone(run).id).toBe(idOf(3));
    expect(stepToClose(run)).toBe(firstClosedAt + CLOSE_EVERY_MS);
  });

  it.each([
    [
      'a close before a stage',
      () => {
        // A ticket leaves the center every 4 x QUICK_STAGE_MS and the reviewer closes every
        // CLOSE_EVERY_MS, so the two fall on the same moment when the last center event of a
        // ticket is due as a close is: the close must come first.
        const { states } = pacedDay();
        let tied = 0;
        states.forEach((state, n) => {
          const before = states[n - 1];
          const first = states[n - 2];
          if (before === undefined || first === undefined || before.simTime !== state.simTime) return;
          const kinds = [eventKind(first, before), eventKind(before, state)];
          if (kinds.includes('close') && kinds.includes('leave')) {
            tied += 1;
            expect(kinds).toEqual(['close', 'leave']);
          }
        });
        expect(tied).toBeGreaterThan(0);
      },
    ],
    [
      'a stage before a tag',
      () => {
        // Ticket 1 arrives at 4600 ms, so its tag is due at 5000 ms, as ticket 0 leaves intake.
        const run = makeRun({ schedule: scheduleAt([0, 4.6], 2) });
        stepUntil(run, (s) => s.incoming.length === 1);
        run.step();
        expect(currentOf(run).stage).toBe('privacy');
        expect(run.state().incoming[0]?.tag).toBeUndefined();
        run.step();
        expect(run.state().incoming[0]?.tag).toEqual(STUB_TAG);
      },
    ],
    [
      'a tag before an arrival',
      () => {
        // Ticket 1 arrives at 400 ms, as ticket 0's tag is due.
        const run = makeRun({ schedule: scheduleAt([0, 0.4], 2) });
        run.step();
        run.step();
        expect(currentOf(run).tag).toEqual(STUB_TAG);
        expect(run.state().incoming).toEqual([]);
        run.step();
        expect(run.state().incoming).toHaveLength(1);
      },
    ],
  ])('fires events due at the same moment in a fixed order: %s', (_name, scenario) => {
    scenario();
  });
});

describe('play, pause and step', () => {
  it('fires one event per advance while playing, and not while paused', () => {
    const run = makeRun();
    run.advance();
    expect(run.state().simTime).toBe(0);
    run.play();
    expect(run.state().playing).toBe(true);
    run.advance();
    expect(run.state().simTime).toBe(500);
    run.pause();
    expect(run.state().playing).toBe(false);
    expect(run.nextDelayMs()).toBeNull();
    run.advance();
    expect(run.state().simTime).toBe(500);
  });

  // Pause pressed mid-stage, then Step: the next event of the same ticket, and Play goes on from there.
  it('steps to the next event after a pause and plays on from it', () => {
    const run = makeRun({ schedule: fakeSchedule(1, 1) });
    run.play();
    run.advance();
    run.advance();
    run.pause();
    const paused = run.state();
    expect(currentOf(run).stage).toBe('intake');
    run.step();
    const stepped = run.state();
    expect(stepped.current?.stage).toBe('privacy');
    expect(stepped.current?.trail.id).toBe(paused.current?.trail.id);
    expect(stepped.simTime).toBe(500 + 5000);
    run.play();
    expect(run.nextDelayMs()).toBe(5000);
    run.advance();
    expect(currentOf(run).stage).toBe('classify');
  });

  it('leaves stepping to the paused run: Step does nothing while playing', () => {
    const run = makeRun();
    run.play();
    run.step();
    expect(run.state().simTime).toBe(0);
  });

  it('stops playing by itself when the run completes, and then does nothing', () => {
    const run = makeRun({ schedule: fakeSchedule(2, 1) });
    run.play();
    for (let n = 0; run.state().act !== 'complete' && n < MAX_STEPS; n += 1) run.advance();
    const end = run.state();
    expect(end.act).toBe('complete');
    expect(end.playing).toBe(false);
    expect(end.current).toBeUndefined();
    expect(end.done).toHaveLength(2);
    expect(run.nextDelayMs()).toBeNull();
    run.play();
    run.advance();
    run.step();
    run.finishNow();
    expect(withoutMs(run.state())).toBe(withoutMs(end));
    expect(run.state().realSpeed).toBeUndefined();
  });
});
