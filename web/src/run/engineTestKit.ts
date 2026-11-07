import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import { loadModel } from '../model/scorer';
import type { TicketTrail } from '../pipeline/types';
import { createDeskSchedule, createSchedule, type Schedule } from './clock';
import { createRun, type Run, type RunState } from './engine';
import { createPrescreener, type Tag } from './prescreen';

// Helpers shared by the engine's test files.

export const SEED = 1001;
export const FOLD = 1;
export const TOTAL = 12;
// Tickets arrive a quarter second apart from half a second in: quick enough that the line
// fills while the center is busy, and exact in binary so times compare with toBe.
export const FIRST_ARRIVAL_S = 0.5;
export const ARRIVAL_GAP_S = 0.25;
export const MAX_STEPS = 5000;
export const STUB_TAG: Tag = { priority: 'Medium', critical: false };

// The fold model for seed 1001, loaded once: the page loads exactly this file.
export const MODEL = loadModel(
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/models/fold_${FOLD}.json`, import.meta.url)), 'utf8')),
);

export function fakeSchedule(total: number, act1Tickets: number): Schedule {
  return {
    total,
    act: (i) => (i < act1Tickets ? 1 : 2),
    arrivesAt: (i) => FIRST_ARRIVAL_S + i * ARRIVAL_GAP_S,
  };
}

// Arrival times (seconds) chosen by the test, for events that must fall on the same moment.
export function scheduleAt(times: number[], act1Tickets: number): Schedule {
  return {
    total: times.length,
    act: (i) => (i < act1Tickets ? 1 : 2),
    arrivesAt: (i) => times[i] ?? Number.NaN,
  };
}

// The pre-screener's n-th call is for the n-th ticket to arrive (tags come in arrival order).
export function criticalAt(indices: number[]): (maskedText: string) => Tag {
  let calls = 0;
  return () => {
    const critical = indices.includes(calls);
    calls += 1;
    return { priority: critical ? 'Urgent' : 'Low', critical };
  };
}

// The page's own setup: its 130-ticket schedule and the real pre-screener on the fold model.
export function makeRealRun(wallClock: () => number = () => 0): Run {
  return createRun({
    seed: SEED,
    model: MODEL,
    schedule: createSchedule(SEED),
    wallClock,
    prescreen: createPrescreener(MODEL),
  });
}

export function makeRun(
  opts: {
    schedule?: Schedule;
    wallClock?: () => number;
    prescreen?: (maskedText: string) => Tag;
    closeEveryMs?: number;
    deepTickets?: number;
  } = {},
): Run {
  return createRun({
    seed: SEED,
    model: MODEL,
    schedule: opts.schedule ?? fakeSchedule(TOTAL, 6),
    wallClock: opts.wallClock ?? (() => 0),
    prescreen: opts.prescreen ?? (() => STUB_TAG),
    ...(opts.closeEveryMs === undefined ? {} : { closeEveryMs: opts.closeEveryMs }),
    ...(opts.deepTickets === undefined ? {} : { deepTickets: opts.deepTickets }),
  });
}

// The desk's own setup: its 130-ticket schedule, the real pre-screener, the reviewer's trickle and no slow start.
export const DESK_CLOSE_EVERY_MS = 2000;

export function makeDeskRun(seed: number = SEED): Run {
  return createRun({
    seed,
    model: MODEL,
    schedule: createDeskSchedule(seed),
    wallClock: () => 0,
    prescreen: createPrescreener(MODEL),
    closeEveryMs: DESK_CLOSE_EVERY_MS,
    deepTickets: 0,
  });
}

export function idOf(index: number): string {
  return `T-${SEED}-${index}`;
}

export function indexOf(id: string): number {
  return Number(id.split('-')[2]);
}

export function rawTicket(index: number): { text: string; label: TicketLabel } {
  return generateTicket(SEED, index, { fold: FOLD, side: 'heldout' });
}

export function stepUntil(run: Run, reached: (state: RunState) => boolean): void {
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    run.step();
  }
}

export function stepToEnd(run: Run, onState: (state: RunState) => void = () => {}): void {
  onState(run.state());
  for (let n = 0; run.state().act !== 'complete' && n <= MAX_STEPS; n += 1) {
    run.step();
    onState(run.state());
  }
}

// What a careful viewer would pick: the truth.
export function rightPick(run: Run, id: string): { category: Category; priority: Priority; route: string } {
  const truth = run.truthOf(id);
  return { category: truth.category, priority: truth.priority, route: ROUTES[truth.category] };
}

export function otherPriority(priority: Priority): Priority {
  return PRIORITIES.find((p) => p !== priority) ?? 'Low';
}

export function withoutMs(state: RunState): string {
  return JSON.stringify(state, (key, value: unknown) => (key === 'ms' ? undefined : value));
}

export function withoutMsTrail(trail: TicketTrail): string {
  return JSON.stringify({ ...trail, ms: undefined });
}

export function ids(trails: { id: string }[]): string[] {
  return trails.map((t) => t.id);
}

export function currentOf(run: Run): NonNullable<RunState['current']> {
  const current = run.state().current;
  if (current === undefined) throw new Error('test: the run has no current ticket');
  return current;
}

export function firstOpen(run: Run): TicketTrail {
  const first = run.state().open[0];
  if (first === undefined) throw new Error('test: nothing is open');
  return first;
}

export function lastDoneOf(state: RunState): TicketTrail {
  const last = state.done.at(-1);
  if (last === undefined) throw new Error('test: nothing is done');
  return last;
}

export function lastDone(run: Run): TicketTrail {
  return lastDoneOf(run.state());
}

// What one event did, read from the state before and after it: a close takes a ticket off
// the open list into done; a leave sends the center's ticket on.
export function eventKind(before: RunState, after: RunState): 'close' | 'leave' | 'other' {
  if (after.done.length > before.done.length && after.open.length < before.open.length) return 'close';
  if (before.current !== undefined && after.current?.trail.id !== before.current.trail.id) return 'leave';
  return 'other';
}

// Steps to the next close and returns the run time it happened at.
export function stepToClose(run: Run): number {
  for (let n = 0; n <= MAX_STEPS; n += 1) {
    const before = run.state();
    run.step();
    if (eventKind(before, run.state()) === 'close') return run.state().simTime;
  }
  throw new Error('test: no ticket was closed');
}

// A run stopped the moment ticket `index` joins the open list. The reviewer closes slower
// than the center sends tickets on, so older tickets are still open beside it.
export function runToOpen(index: number): Run {
  const run = makeRun();
  stepUntil(run, (s) => s.open.some((t) => t.id === idOf(index)));
  return run;
}

// The run time at which the reviewer closes the top open ticket, read from a copy of the
// run stopped when ticket `index` joined the list, with nobody reviewing.
export function nextCloseTime(index: number): number {
  const run = runToOpen(index);
  const top = firstOpen(run).id;
  stepUntil(run, (s) => s.done.some((t) => t.id === top));
  return run.state().simTime;
}

// A state boiled down to what the page draws, with ticket ids for the trails, so a whole
// real day can be compared step by step without holding hundreds of copies of every trail.
export function outline(state: RunState): string {
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

export function placeOf(state: RunState, id: string): string | undefined {
  if (state.incoming.some((w) => w.id === id)) return 'incoming';
  if (state.current?.trail.id === id) return state.current.stage;
  if (state.open.some((t) => t.id === id)) return 'open';
  if (state.reviewing?.id === id) return 'reviewing';
  if (state.done.some((t) => t.id === id)) return 'done';
  return undefined;
}

export interface PacedDay {
  end: RunState;
  states: RunState[];
  trails: Map<string, TicketTrail>;
}

let pacedDayOnce: PacedDay | undefined;

// The finished short run with nobody reviewing, stepped event by event: the answer every other
// path (finish now, a viewer's hand back) must reproduce. Computed once per test file.
export function pacedDay(): PacedDay {
  if (pacedDayOnce === undefined) {
    const run = makeRun();
    const states: RunState[] = [];
    stepToEnd(run, (s) => states.push(s));
    const end = run.state();
    pacedDayOnce = { end, states, trails: new Map(end.done.map((trail) => [trail.id, trail])) };
  }
  return pacedDayOnce;
}
