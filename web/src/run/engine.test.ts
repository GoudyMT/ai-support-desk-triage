import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import { loadModel } from '../model/scorer';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { TicketTrail } from '../pipeline/types';
import { maskText } from '../privacy/mask';
import { createSchedule, type Schedule } from './clock';
import { CLOSE_EVERY_MS, QUICK_STAGE_MS, createRun, type Run, type RunState } from './engine';
import { createPrescreener, type Tag } from './prescreen';
import { foldOf } from './seed';

const SEED = 1001;
const FOLD = 1;
const TOTAL = 12;
// Tickets arrive a quarter second apart from half a second in: quick enough that the line
// fills while the center is busy, and exact in binary so times compare with toBe.
const FIRST_ARRIVAL_S = 0.5;
const ARRIVAL_GAP_S = 0.25;
const MAX_STEPS = 5000;
const STUB_TAG: Tag = { priority: 'Medium', critical: false };

// The fold model for seed 1001, loaded once: the page loads exactly this file.
const MODEL = loadModel(
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/models/fold_${FOLD}.json`, import.meta.url)), 'utf8')),
);

function fakeSchedule(total: number, act1Tickets: number): Schedule {
  return {
    total,
    act: (i) => (i < act1Tickets ? 1 : 2),
    arrivesAt: (i) => FIRST_ARRIVAL_S + i * ARRIVAL_GAP_S,
  };
}

// Arrival times (seconds) chosen by the test, for events that must fall on the same moment.
function scheduleAt(times: number[], act1Tickets: number): Schedule {
  return {
    total: times.length,
    act: (i) => (i < act1Tickets ? 1 : 2),
    arrivesAt: (i) => times[i] ?? Number.NaN,
  };
}

// The pre-screener's n-th call is for the n-th ticket to arrive (tags come in arrival order).
function criticalAt(indices: number[]): (maskedText: string) => Tag {
  let calls = 0;
  return () => {
    const critical = indices.includes(calls);
    calls += 1;
    return { priority: critical ? 'Urgent' : 'Low', critical };
  };
}

// The page's own setup: its 130-ticket schedule and the real pre-screener on the fold model.
function makeRealRun(wallClock: () => number = () => 0): Run {
  return createRun({
    seed: SEED,
    model: MODEL,
    schedule: createSchedule(SEED),
    wallClock,
    prescreen: createPrescreener(MODEL),
  });
}

function makeRun(
  opts: {
    schedule?: Schedule;
    wallClock?: () => number;
    prescreen?: (maskedText: string) => Tag;
  } = {},
): Run {
  return createRun({
    seed: SEED,
    model: MODEL,
    schedule: opts.schedule ?? fakeSchedule(TOTAL, 6),
    wallClock: opts.wallClock ?? (() => 0),
    prescreen: opts.prescreen ?? (() => STUB_TAG),
  });
}

function idOf(index: number): string {
  return `T-${SEED}-${index}`;
}

function indexOf(id: string): number {
  return Number(id.split('-')[2]);
}

function rawTicket(index: number): { text: string; label: TicketLabel } {
  return generateTicket(SEED, index, { fold: FOLD, side: 'heldout' });
}

function stepUntil(run: Run, reached: (state: RunState) => boolean): void {
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    run.step();
  }
}

function stepToEnd(run: Run, onState: (state: RunState) => void = () => {}): void {
  onState(run.state());
  for (let n = 0; run.state().act !== 'complete' && n <= MAX_STEPS; n += 1) {
    run.step();
    onState(run.state());
  }
}

// What a careful viewer would pick: the truth.
function rightPick(run: Run, id: string): { category: Category; priority: Priority; route: string } {
  const truth = run.truthOf(id);
  return { category: truth.category, priority: truth.priority, route: ROUTES[truth.category] };
}

function otherPriority(priority: Priority): Priority {
  return PRIORITIES.find((p) => p !== priority) ?? 'Low';
}

function withoutMs(state: RunState): string {
  return JSON.stringify(state, (key, value: unknown) => (key === 'ms' ? undefined : value));
}

function ids(trails: { id: string }[]): string[] {
  return trails.map((t) => t.id);
}

function currentOf(run: Run): NonNullable<RunState['current']> {
  const current = run.state().current;
  if (current === undefined) throw new Error('test: the run has no current ticket');
  return current;
}

function firstOpen(run: Run): TicketTrail {
  const first = run.state().open[0];
  if (first === undefined) throw new Error('test: nothing is open');
  return first;
}

function lastDoneOf(state: RunState): TicketTrail {
  const last = state.done.at(-1);
  if (last === undefined) throw new Error('test: nothing is done');
  return last;
}

function lastDone(run: Run): TicketTrail {
  return lastDoneOf(run.state());
}

// What one event did, read from the state before and after it: a close takes a ticket off
// the open list into done; a leave sends the center's ticket on.
function eventKind(before: RunState, after: RunState): 'close' | 'leave' | 'other' {
  if (after.done.length > before.done.length && after.open.length < before.open.length) return 'close';
  if (before.current !== undefined && after.current?.trail.id !== before.current.trail.id) return 'leave';
  return 'other';
}

// Steps to the next close and returns the run time it happened at.
function stepToClose(run: Run): number {
  for (let n = 0; n <= MAX_STEPS; n += 1) {
    const before = run.state();
    run.step();
    if (eventKind(before, run.state()) === 'close') return run.state().simTime;
  }
  throw new Error('test: no ticket was closed');
}

// A run stopped the moment ticket `index` joins the open list. The reviewer closes slower
// than the center sends tickets on, so older tickets are still open beside it.
function runToOpen(index: number): Run {
  const run = makeRun();
  stepUntil(run, (s) => s.open.some((t) => t.id === idOf(index)));
  return run;
}

// The run time at which the reviewer closes the top open ticket, read from a copy of the
// run stopped when ticket `index` joined the list, with nobody reviewing.
function nextCloseTime(index: number): number {
  const run = runToOpen(index);
  const top = firstOpen(run).id;
  stepUntil(run, (s) => s.done.some((t) => t.id === top));
  return run.state().simTime;
}

// The finished run with nobody reviewing, stepped event by event: the answer every other
// path (finish now, a viewer's hand back) must reproduce.
let paced: RunState;
const pacedStates: RunState[] = [];
const fullTrails = new Map<string, TicketTrail>();

beforeAll(() => {
  const run = makeRun();
  stepToEnd(run, (s) => pacedStates.push(s));
  paced = run.state();
  for (const trail of paced.done) fullTrails.set(trail.id, trail);
});

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
        let tied = 0;
        pacedStates.forEach((state, n) => {
          const before = pacedStates[n - 1];
          const first = pacedStates[n - 2];
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

describe('the whole run', () => {
  it('moves each ticket through the line, the four stages, then open if flagged, then done', () => {
    let flagged = 0;
    let unflagged = 0;
    for (let i = 0; i < TOTAL; i += 1) {
      const places: string[] = [];
      for (const s of pacedStates) {
        const place = placeOf(s, idOf(i));
        if (place !== undefined && place !== places.at(-1)) places.push(place);
      }
      const isFlagged = fullTrails.get(idOf(i))?.guard.flagged === true;
      if (places[0] === 'incoming') places.shift();
      expect(places).toEqual(['intake', 'privacy', 'classify', 'guardrails', ...(isFlagged ? ['open'] : []), 'done']);
      if (isFlagged) flagged += 1;
      else unflagged += 1;
    }
    // The check above means nothing unless both kinds of ticket were in the run.
    expect(flagged).toBeGreaterThan(0);
    expect(unflagged).toBeGreaterThan(0);
  });

  it('ends complete with every ticket of the seed closed once, and nothing left anywhere', () => {
    expect(paced.act).toBe('complete');
    expect(paced.playing).toBe(false);
    expect(paced.current).toBeUndefined();
    expect(paced.incoming).toEqual([]);
    expect(paced.open).toEqual([]);
    expect(ids(paced.done).sort()).toEqual(Array.from({ length: TOTAL }, (_, i) => idOf(i)).sort());
    expect(paced.realSpeed).toBeUndefined();
  });

  it('scores each ticket exactly as the pipeline does with the fold model, stamped with its schedule time', () => {
    const schedule = fakeSchedule(TOTAL, 6);
    const reviewer = createSimulatedReviewer(SEED, (id) => rawTicket(indexOf(id)).label);
    for (const trail of paced.done) {
      const ticket = rawTicket(indexOf(trail.id));
      const expected = runTicket(ticket.text, trail.id, {
        model: MODEL,
        reviewer,
        floor: CONFIDENCE_FLOOR,
        secondCheckOn: SECOND_CHECK_ON,
        now: () => 0,
      });
      expect(trail).toEqual({ ...expected, receivedAt: schedule.arrivesAt(indexOf(trail.id)) });
      expect(trail.id.startsWith(`T-${SEED}-`)).toBe(true);
    }
  });

  it('follows the ticket in the center for the act, else the latest arrival', () => {
    for (const s of pacedStates) {
      if (s.current !== undefined && s.act !== 'complete') {
        expect(s.act).toBe(indexOf(s.current.trail.id) < 6 ? 1 : 2);
      }
    }
    const run = makeRun({ schedule: scheduleAt([0, 100], 1) });
    stepUntil(run, (s) => s.done.length === 1);
    expect(run.state().current).toBeUndefined();
    expect(run.state().act).toBe(1);
    run.step();
    expect(run.state().act).toBe(2);
  });

  it('gives the same states, step for step, from the same seed whatever the wall clock reads', () => {
    const record = (wallClock: () => number): RunState[] => {
      const run = makeRun({ wallClock, prescreen: criticalAt([2, 4]) });
      const states: RunState[] = [run.state()];
      let reviewed = false;
      while (run.state().act !== 'complete' && states.length < MAX_STEPS) {
        const top = run.state().open[0];
        // The viewer's path is replayed too: the first open ticket is reviewed and confirmed.
        if (!reviewed && top !== undefined) {
          reviewed = true;
          run.review(top.id);
          states.push(run.state());
          run.confirm(rightPick(run, top.id));
        } else {
          run.step();
        }
        states.push(run.state());
      }
      return states;
    };
    let ticks = 0;
    const first = record(() => 0);
    const second = record(() => (ticks += 5));
    expect(second.map(withoutMs)).toEqual(first.map(withoutMs));
    // Without this the comparison could hide an engine that never measured anything.
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  });
});

// A state boiled down to what the page draws, with ticket ids for the trails, so a whole
// real day can be compared step by step without holding hundreds of copies of every trail.
function outline(state: RunState): string {
  return JSON.stringify({
    time: state.simTime,
    act: state.act,
    playing: state.playing,
    incoming: state.incoming,
    current: state.current && { id: state.current.trail.id, stage: state.current.stage, tag: state.current.tag },
    open: ids(state.open),
    reviewing: state.reviewing?.id,
    done: ids(state.done),
    viewerReviews: state.viewerReviews,
  });
}

function placeOf(state: RunState, id: string): string | undefined {
  if (state.incoming.some((w) => w.id === id)) return 'incoming';
  if (state.current?.trail.id === id) return state.current.stage;
  if (state.open.some((t) => t.id === id)) return 'open';
  if (state.reviewing?.id === id) return 'reviewing';
  if (state.done.some((t) => t.id === id)) return 'done';
  return undefined;
}

// The viewer's score means nothing if the simulated reviewer's answer is on screen first.
describe('a whole real day', () => {
  const steppedDay = (wallClock: () => number): { outlines: string[]; end: RunState } => {
    const run = makeRealRun(wallClock);
    const outlines: string[] = [];
    stepToEnd(run, (s) => outlines.push(outline(s)));
    return { outlines, end: run.state() };
  };

  it('replays the same, step for step, whatever the wall clock reads', () => {
    let ticks = 0;
    const first = steppedDay(() => 0);
    const second = steppedDay(() => (ticks += 5));
    expect(first.end.act).toBe('complete');
    expect(second.outlines).toEqual(first.outlines);
    expect(second.end.done.map(withoutMsTrail)).toEqual(first.end.done.map(withoutMsTrail));
    // Without this the comparison could hide an engine that never measured anything.
    expect(JSON.stringify(second.end.done)).not.toBe(JSON.stringify(first.end.done));
  });

  it.each([
    ['the start', (s: RunState) => s.simTime >= 0],
    ['a pile of five open tickets', (s: RunState) => s.open.length >= 5],
  ])('gives the same trails, in the same order, when finished at once from %s as when stepped', (_name, ready) => {
    const stepped = steppedDay(() => 0).end;
    const run = makeRealRun();
    stepUntil(run, ready);
    run.finishNow();
    const finished = run.state();
    expect(finished.act).toBe('complete');
    expect(finished.done).toHaveLength(createSchedule(SEED).total);
    expect(finished.done.map(withoutMsTrail)).toEqual(stepped.done.map(withoutMsTrail));
  });
});

describe('what stays hidden until a ticket is done', () => {
  it('never shows the reviewer\'s answer in the center, the open list or the review form', () => {
    let hiddenSeen = 0;
    for (const s of pacedStates) {
      const shown = [s.current?.trail, ...s.open, s.reviewing].filter((t): t is TicketTrail => t !== undefined);
      for (const trail of shown) {
        expect(trail.review).toBeUndefined();
        expect(trail.final.by).toBe('model');
        const category = trail.category.label as Category;
        expect(trail.final).toEqual({ category, priority: trail.guard.priority, route: ROUTES[category], by: 'model' });
        if (trail.guard.flagged) hiddenSeen += 1;
      }
    }
    expect(hiddenSeen).toBeGreaterThan(0);
    const reviewed = paced.done.filter((t) => t.guard.flagged);
    expect(reviewed.length).toBeGreaterThan(0);
    expect(reviewed.every((t) => t.review !== undefined && t.final.by === 'reviewer')).toBe(true);
  });

  it('hides only the answer: an open ticket and its closed trail agree on everything else', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length === 1);
    const shown = firstOpen(run);
    const full = fullTrails.get(shown.id);
    expect(full?.review).toBeDefined();
    expect(shown).toEqual({ ...full, review: undefined, final: shown.final });
    run.review(shown.id);
    expect(run.state().reviewing).toEqual(shown);
    run.handBack();
    stepUntil(run, (s) => s.done.some((t) => t.id === shown.id));
    expect(lastDone(run)).toEqual(full);
  });
});

describe('the open list', () => {
  // The open list is kept highest priority first, then oldest first. Ticket 2 is Medium and the
  // oldest, 5 is High, 6 is Urgent, 7 is Medium: the reviewer closes slower than tickets open,
  // so they pile up.
  it.each([
    ['a younger ticket of higher priority above an older one, and the oldest of the lowest last', 6, [6, 5, 2]],
    ['equal priority with the older first', 7, [5, 2, 7]],
  ])('puts %s', (_name, joining, expected) => {
    const priorities = [2, 5, 6, 7].map((i) => fullTrails.get(idOf(i))?.guard.priority);
    expect(priorities).toEqual(['Medium', 'High', 'Urgent', 'Medium']);
    expect(ids(runToOpen(joining).state().open)).toEqual(expected.map(idOf));
  });

  // On the page's own day the reviewer falls behind and the list grows long: every insert has
  // to find its place among many, and every close takes the ticket on top.
  it('stays in priority then age order through a whole real day, and every close takes the top', () => {
    const run = makeRealRun();
    let peak = 0;
    let closes = 0;
    let before = run.state();
    for (let n = 0; run.state().act !== 'complete' && n <= MAX_STEPS; n += 1) {
      run.step();
      const after = run.state();
      peak = Math.max(peak, after.open.length);
      after.open.slice(1).forEach((trail, at) => {
        const above = after.open[at];
        if (above === undefined) throw new Error('test: the list has a gap');
        const rank = PRIORITIES.indexOf(above.guard.priority) - PRIORITIES.indexOf(trail.guard.priority);
        expect(rank > 0 || (rank === 0 && indexOf(above.id) < indexOf(trail.id))).toBe(true);
      });
      if (eventKind(before, after) === 'close') {
        closes += 1;
        expect(lastDoneOf(after).id).toBe(before.open[0]?.id);
      }
      before = after;
    }
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(closes).toBeGreaterThan(0);
    expect(run.state().act).toBe('complete');
  });

  it('puts a handed-back ticket back in its place, by priority and then age', () => {
    const run = runToOpen(7);
    run.review(idOf(2));
    expect(ids(run.state().open)).toEqual([5, 7].map(idOf));
    run.handBack();
    expect(ids(run.state().open)).toEqual([5, 2, 7].map(idOf));
  });
});

describe('Review', () => {
  // Review pressed on the ticket the simulated reviewer closes next: the form holds it and the
  // clock stops; Confirm closes it with the viewer's pick and the reviewer takes the next one.
  it('holds the ticket the reviewer would close next, stops the clock, and lets the reviewer take the next one after Confirm', () => {
    // Ticket 6 has just joined [5, 2] and tops the list, so it is the next the reviewer closes.
    const closesAt = nextCloseTime(6);
    const run = runToOpen(6);
    run.play();
    const due = run.nextDelayMs();
    const before = run.state();
    expect(due).toBe(QUICK_STAGE_MS);
    run.review(idOf(6));
    expect(run.state().reviewing?.id).toBe(idOf(6));
    expect(ids(run.state().open)).toEqual([5, 2].map(idOf));
    expect(run.nextDelayMs()).toBeNull();
    const held = withoutMs(run.state());
    for (let n = 0; n < 5; n += 1) run.advance();
    run.pause();
    for (let n = 0; n < 5; n += 1) run.step();
    run.finishNow();
    run.play();
    expect(withoutMs(run.state())).toBe(held);
    expect(run.state().simTime).toBe(before.simTime);

    run.confirm(rightPick(run, idOf(6)));
    expect(run.state().reviewing).toBeUndefined();
    expect(run.state().viewerReviews).toEqual([{ id: idOf(6), correct: true }]);
    expect(lastDone(run).id).toBe(idOf(6));
    expect(lastDone(run).final.by).toBe('reviewer');
    expect(run.nextDelayMs()).toBe(due);
    // The reviewer's schedule did not move while the form was open: it takes the next open
    // ticket when it would have closed this one.
    run.pause();
    stepUntil(run, (s) => s.done.some((t) => t.id === idOf(5)));
    expect(run.state().simTime).toBe(closesAt);
  });

  // Review works on any open ticket, not only the top one; the others stay where they were.
  it('holds a ticket from the middle of the open list and puts it back in its place on Hand back', () => {
    const run = runToOpen(6);
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    run.review(idOf(5));
    expect(run.state().reviewing?.id).toBe(idOf(5));
    expect(ids(run.state().open)).toEqual([6, 2].map(idOf));
    run.handBack();
    expect(run.state().reviewing).toBeUndefined();
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
  });

  it('gives the ticket back to the simulated reviewer on Hand back, without counting a review', () => {
    const run = runToOpen(6);
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    run.review(idOf(6));
    run.handBack();
    expect(run.state().reviewing).toBeUndefined();
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    expect(run.state().viewerReviews).toEqual([]);
    stepUntil(run, (s) => s.done.some((t) => t.id === idOf(6)));
    expect(lastDone(run)).toEqual(fullTrails.get(idOf(6)));
    expect(run.state().simTime).toBe(nextCloseTime(6));
  });

  it('runs the ticket again with the viewer\'s pick, so the trail shown is the trail scored', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    const truth = run.truthOf(id);
    const wrongCategory: Category = truth.category === 'Billing' ? 'Other' : 'Billing';
    const pick = { category: wrongCategory, priority: truth.priority, route: ROUTES[wrongCategory] };
    run.review(id);
    run.confirm(pick);
    const ticket = rawTicket(indexOf(id));
    const rerun = runTicket(ticket.text, id, {
      model: MODEL,
      reviewer: { decide: () => pick },
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: () => 0,
    });
    expect(lastDone(run)).toEqual({ ...rerun, receivedAt: fakeSchedule(TOTAL, 6).arrivesAt(indexOf(id)) });
    expect(lastDone(run).final).toEqual({ ...pick, by: 'reviewer' });
    expect(run.state().viewerReviews).toEqual([{ id, correct: false }]);
    expect(run.state().open.some((t) => t.id === id)).toBe(false);
  });

  // The parent design's rule: right means category and priority both match the truth; the team is shown, not scored.
  it.each([
    ['category and priority right, team wrong', (t: TicketLabel) => ({ category: t.category, priority: t.priority, route: 'Nowhere' }), true],
    [
      'category right, priority wrong',
      (t: TicketLabel) => ({ category: t.category, priority: otherPriority(t.priority), route: ROUTES[t.category] }),
      false,
    ],
    [
      'priority right, category wrong',
      (t: TicketLabel) => {
        const category: Category = t.category === 'Billing' ? 'Other' : 'Billing';
        return { category, priority: t.priority, route: ROUTES[category] };
      },
      false,
    ],
  ])('scores a review: %s', (_name, pickFor, correct) => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    run.confirm(pickFor(run.truthOf(id)));
    expect(run.state().viewerReviews).toEqual([{ id, correct }]);
  });

  it('ignores Review on an unknown or non-open ticket, Review while a form is open, and Confirm or Hand back with no form', () => {
    const run = makeRun();
    const pick = { category: 'Billing' as Category, priority: 'Low' as Priority, route: ROUTES.Billing };
    const changes: number[] = [];
    run.onChange(() => changes.push(1));
    run.confirm(pick);
    run.handBack();
    run.review(idOf(0));
    expect(changes).toEqual([]);
    const pair = runToOpen(6);
    pair.onChange(() => changes.push(1));
    const atPair = withoutMs(pair.state());
    pair.review('T-nope');
    pair.review(pair.state().current?.trail.id ?? 'none');
    pair.confirm(pick);
    pair.handBack();
    expect(withoutMs(pair.state())).toBe(atPair);
    pair.review(idOf(6));
    const holding = withoutMs(pair.state());
    pair.review(idOf(5));
    expect(withoutMs(pair.state())).toBe(holding);
    expect(changes).toEqual([1]);
  });
});

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
    expect(state.done.map(withoutMsTrail)).toEqual(paced.done.map(withoutMsTrail));
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
    const run = makeRun();
    stepUntil(run, ready);
    const remaining = TOTAL - run.state().done.length;
    expect(remaining).toBeGreaterThan(0);
    run.finishNow();
    const state = run.state();
    expect(state.act).toBe('complete');
    expect(ids(state.done).sort()).toEqual(ids(paced.done).sort());
    expect(state.done.map(withoutMsTrail).sort()).toEqual(paced.done.map(withoutMsTrail).sort());
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

function withoutMsTrail(trail: TicketTrail): string {
  return JSON.stringify({ ...trail, ms: undefined });
}

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
