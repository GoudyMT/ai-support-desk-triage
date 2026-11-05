import { describe, expect, it } from 'vitest';
import { ROUTES, type Category } from '../domain/labels';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { TicketTrail } from '../pipeline/types';
import { createSchedule } from './clock';
import type { RunState } from './engine';
import {
  MAX_STEPS,
  MODEL,
  SEED,
  TOTAL,
  criticalAt,
  fakeSchedule,
  firstOpen,
  idOf,
  ids,
  indexOf,
  lastDone,
  makeRealRun,
  makeRun,
  outline,
  pacedDay,
  placeOf,
  rawTicket,
  rightPick,
  scheduleAt,
  stepToEnd,
  stepUntil,
  withoutMs,
  withoutMsTrail,
} from './engineTestKit';

describe('the whole run', () => {
  it('moves each ticket through the line, the four stages, then open if flagged, then done', () => {
    const { states, trails } = pacedDay();
    let flagged = 0;
    let unflagged = 0;
    for (let i = 0; i < TOTAL; i += 1) {
      const places: string[] = [];
      for (const s of states) {
        const place = placeOf(s, idOf(i));
        if (place !== undefined && place !== places.at(-1)) places.push(place);
      }
      const isFlagged = trails.get(idOf(i))?.guard.flagged === true;
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
    const { end } = pacedDay();
    expect(end.act).toBe('complete');
    expect(end.playing).toBe(false);
    expect(end.current).toBeUndefined();
    expect(end.incoming).toEqual([]);
    expect(end.open).toEqual([]);
    expect(ids(end.done).sort()).toEqual(Array.from({ length: TOTAL }, (_, i) => idOf(i)).sort());
    expect(end.realSpeed).toBeUndefined();
  });

  it('scores each ticket exactly as the pipeline does with the fold model, stamped with its schedule time', () => {
    const schedule = fakeSchedule(TOTAL, 6);
    const reviewer = createSimulatedReviewer(SEED, (id) => rawTicket(indexOf(id)).label);
    for (const trail of pacedDay().end.done) {
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
    for (const s of pacedDay().states) {
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
      const states = [run.state()];
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

describe('the tickets that are narrated stage by stage', () => {
  it('marks the first three tickets in the center as deep, and the others as not', () => {
    const run = makeRun();
    const deep = new Map<string, boolean>();
    stepToEnd(run, (state) => {
      if (state.current !== undefined) deep.set(state.current.trail.id, state.current.deep);
    });
    expect([...deep.keys()].length).toBe(TOTAL);
    for (let i = 0; i < TOTAL; i += 1) expect(deep.get(idOf(i))).toBe(i < 3);
  });
});

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

// The viewer's score means nothing if the simulated reviewer's answer is on screen first.
describe('what stays hidden until a ticket is done', () => {
  it('never shows the reviewer\'s answer in the center, the open list or the review form', () => {
    const { states, end } = pacedDay();
    let hiddenSeen = 0;
    for (const s of states) {
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
    const reviewed = end.done.filter((t) => t.guard.flagged);
    expect(reviewed.length).toBeGreaterThan(0);
    expect(reviewed.every((t) => t.review !== undefined && t.final.by === 'reviewer')).toBe(true);
  });

  it('hides only the answer: an open ticket and its closed trail agree on everything else', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length === 1);
    const shown = firstOpen(run);
    const full = pacedDay().trails.get(shown.id);
    expect(full?.review).toBeDefined();
    expect(shown).toEqual({ ...full, review: undefined, final: shown.final });
    run.review(shown.id);
    expect(run.state().reviewing).toEqual(shown);
    run.handBack();
    stepUntil(run, (s) => s.done.some((t) => t.id === shown.id));
    expect(lastDone(run)).toEqual(full);
  });
});
