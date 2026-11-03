import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import { loadModel } from '../model/scorer';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { TicketTrail } from '../pipeline/types';
import type { Schedule } from './clock';
import { createRun, type Run, type RunState } from './engine';
import { foldOf } from './seed';

const SEED = 1001;
const FOLD = 1;
const SECONDS_BETWEEN_TICKETS = 7;
const ALL_STAGES = ['intake', 'privacy', 'classify', 'guardrails', 'review', 'done'];
const MAX_STEPS = 5000;

// The fold model for seed 1001, loaded once: the page loads exactly this file.
const MODEL = loadModel(
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../public/models/fold_${FOLD}.json`, import.meta.url)), 'utf8')),
);

// A short run with times a test can recognise: ticket i arrives at 7i + 0.5.
function fakeSchedule(total: number, act1Tickets: number): Schedule {
  return {
    total,
    act: (i) => (i < act1Tickets ? 1 : 2),
    arrivesAt: (i) => i * SECONDS_BETWEEN_TICKETS + 0.5,
  };
}

function makeRun(opts: { total?: number; act1?: number; wallClock?: () => number; seed?: number } = {}): Run {
  return createRun({
    seed: opts.seed ?? SEED,
    model: MODEL,
    schedule: fakeSchedule(opts.total ?? 12, opts.act1 ?? 6),
    wallClock: opts.wallClock ?? (() => 0),
  });
}

function currentOf(run: Run): NonNullable<RunState['current']> {
  const current = run.state().current;
  if (current === undefined) throw new Error('test: the run has no current ticket');
  return current;
}

function indexOf(id: string): number {
  return Number(id.split('-')[2]);
}

function stepUntil(run: Run, reached: (state: RunState) => boolean): void {
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    run.step();
  }
}

function toReview(run: Run): void {
  stepUntil(run, (s) => s.current?.stage === 'review');
}

// What a careful viewer would pick: the truth.
function rightPick(run: Run, id: string): { category: Category; priority: Priority; route: string } {
  const truth = run.truthOf(id);
  return { category: truth.category, priority: truth.priority, route: ROUTES[truth.category] };
}

// Steps a run to its end, answering every Take over wait with the right pick.
function drive(run: Run, onState: (state: RunState) => void): void {
  onState(run.state());
  for (let n = 0; run.state().act !== 'complete'; n += 1) {
    // A run that never completes stops here and fails the tests that expect 'complete'.
    if (n > MAX_STEPS) break;
    const current = run.state().current;
    if (current?.waitingForViewer) run.confirm(rightPick(run, current.trail.id));
    else run.step();
    onState(run.state());
  }
}

// The trail the simulated reviewer produces for the first flagged ticket of the seed,
// read from a run that does not take over (so nothing hides it).
function simulatedTrailAtReview(): TicketTrail {
  const run = makeRun();
  toReview(run);
  return currentOf(run).trail;
}

function otherPriority(priority: Priority): Priority {
  return PRIORITIES.find((p) => p !== priority) ?? 'Low';
}

function withoutMs(state: RunState): string {
  return JSON.stringify(state, (key, value: unknown) => (key === 'ms' ? undefined : value));
}

function labelOf(index: number): TicketLabel {
  return generateTicket(SEED, index, { fold: FOLD, side: 'heldout' }).label;
}

const AUTO_TOTAL = 20;
let autoRun: Run;
const autoStates: RunState[] = [];
let takenRun: Run;
const takenStates: RunState[] = [];

beforeAll(() => {
  autoRun = makeRun({ total: AUTO_TOTAL, act1: 8 });
  drive(autoRun, (s) => autoStates.push(s));
  takenRun = makeRun({ total: AUTO_TOTAL, act1: 8 });
  takenRun.setTakeOver(true);
  drive(takenRun, (s) => takenStates.push(s));
});

describe('a full run with nobody taking over', () => {
  it('uses the fold the seed names', () => {
    expect(foldOf(SEED)).toBe(FOLD);
    expect(autoStates[0]?.fold).toBe(FOLD);
    expect(autoStates[0]?.seed).toBe(SEED);
  });

  it('walks each ticket through its stages in order, review only when flagged', () => {
    const seen = new Map<string, string[]>();
    for (const s of autoStates) {
      if (s.current === undefined) continue;
      const stages = seen.get(s.current.trail.id) ?? [];
      stages.push(s.current.stage);
      seen.set(s.current.trail.id, stages);
    }
    const final = autoStates[autoStates.length - 1];
    expect(final?.done).toHaveLength(AUTO_TOTAL);
    expect(seen.size).toBe(AUTO_TOTAL);
    let flagged = 0;
    let unflagged = 0;
    for (const trail of final?.done ?? []) {
      const expected = trail.guard.flagged ? ALL_STAGES : ALL_STAGES.filter((stage) => stage !== 'review');
      expect(seen.get(trail.id)).toEqual(expected);
      if (trail.guard.flagged) flagged += 1;
      else unflagged += 1;
    }
    // The check above means nothing unless both kinds of ticket were in the run.
    expect(flagged).toBeGreaterThan(0);
    expect(unflagged).toBeGreaterThan(0);
  });

  it('finishes done with every ticket of the seed, in order, and nothing current', () => {
    const final = autoRun.state();
    expect(final.act).toBe('complete');
    expect(final.playing).toBe(false);
    expect(final.current).toBeUndefined();
    expect(final.done.map((t) => t.id)).toEqual(Array.from({ length: AUTO_TOTAL }, (_, i) => `T-${SEED}-${i}`));
  });

  it('does nothing once complete', () => {
    expect(autoRun.state().act).toBe('complete');
    const before = withoutMs(autoRun.state());
    autoRun.play();
    autoRun.advance();
    autoRun.step();
    expect(autoRun.state().playing).toBe(false);
    expect(withoutMs(autoRun.state())).toBe(before);
  });

  it('scores each ticket exactly as the pipeline does with the fold model, stamped with its arrival time', () => {
    const schedule = fakeSchedule(AUTO_TOTAL, 8);
    const reviewer = createSimulatedReviewer(SEED, (id) => labelOf(indexOf(id)));
    expect(autoRun.state().done).toHaveLength(AUTO_TOTAL);
    autoRun.state().done.forEach((trail, i) => {
      const ticket = generateTicket(SEED, i, { fold: FOLD, side: 'heldout' });
      const expected = runTicket(ticket.text, ticket.id, {
        model: MODEL,
        reviewer,
        floor: CONFIDENCE_FLOOR,
        secondCheckOn: SECOND_CHECK_ON,
        now: () => 0,
      });
      expect(trail).toEqual({ ...expected, receivedAt: schedule.arrivesAt(i), ms: trail.ms });
      expect(trail.id.startsWith(`T-${SEED}-`)).toBe(true);
    });
  });

  it('reports the arrival time of the ticket now in intake as the run time', () => {
    const withTicket = autoStates.filter((s) => s.current !== undefined);
    expect(withTicket.length).toBeGreaterThan(AUTO_TOTAL);
    for (const s of withTicket) {
      expect(s.simTime).toBe(indexOf(s.current?.trail.id ?? '') * SECONDS_BETWEEN_TICKETS + 0.5);
    }
  });

  it('follows the schedule for the act, and switches to real speed when Act 2 starts', () => {
    const withTicket = autoStates.filter((s) => s.current !== undefined);
    expect(withTicket.some((s) => s.act === 1)).toBe(true);
    expect(withTicket.some((s) => s.act === 2)).toBe(true);
    for (const s of withTicket) {
      const index = indexOf(s.current?.trail.id ?? '');
      expect(s.act).toBe(index < 8 ? 1 : 2);
      expect(s.speed).toBe(index < 8 ? 'learn' : 'real');
    }
  });
});

describe('a full run with Take over on', () => {
  it('never makes a person wait on an unflagged ticket, and waits only inside review', () => {
    let unflaggedSeen = 0;
    let waits = 0;
    for (const s of takenStates) {
      if (s.current === undefined) continue;
      if (!s.current.trail.guard.flagged) {
        unflaggedSeen += 1;
        expect(s.current.waitingForViewer).toBe(false);
        expect(s.current.stage).not.toBe('review');
      }
      if (s.current.waitingForViewer) {
        waits += 1;
        expect(s.current.stage).toBe('review');
        expect(s.current.trail.guard.flagged).toBe(true);
      }
    }
    expect(unflaggedSeen).toBeGreaterThan(0);
    expect(waits).toBeGreaterThan(0);
  });

  it('records one scored review for each flagged ticket, all right when the viewer picks the truth', () => {
    const final = takenRun.state();
    const flaggedIds = final.done.filter((t) => t.guard.flagged).map((t) => t.id);
    expect(flaggedIds.length).toBeGreaterThan(0);
    expect(final.viewerReviews).toEqual(flaggedIds.map((id) => ({ id, correct: true })));
    for (const trail of final.done.filter((t) => t.guard.flagged)) {
      expect(trail.final.by).toBe('reviewer');
      expect(trail.final.category).toBe(labelOf(indexOf(trail.id)).category);
    }
  });
});

describe('replay', () => {
  it('gives the same states, step for step, from the same seed whatever the wall clock reads', () => {
    const record = (wallClock: () => number): RunState[] => {
      const run = makeRun({ total: 8, act1: 3, wallClock });
      // Take over is on so the viewer's path is replayed too.
      run.setTakeOver(true);
      const states: RunState[] = [];
      drive(run, (s) => states.push(s));
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

describe('a new run', () => {
  it('starts paused at the intake of the first ticket of the seed, at learn speed', () => {
    const state = makeRun().state();
    expect(state).toMatchObject({
      seed: SEED,
      fold: FOLD,
      act: 1,
      speed: 'learn',
      playing: false,
      takeOver: false,
      done: [],
      viewerReviews: [],
      simTime: 0.5,
    });
    expect(state.current?.stage).toBe('intake');
    expect(state.current?.trail.id).toBe(`T-${SEED}-0`);
    expect(state.current?.waitingForViewer).toBe(false);
  });

  it('knows the truth of the tickets it made and refuses any other id', () => {
    const run = makeRun();
    expect(run.truthOf(`T-${SEED}-0`)).toEqual(labelOf(0));
    expect(() => run.truthOf('T-1-0')).toThrow('E_UNKNOWN_TICKET');
  });
});

describe('play, pause and step', () => {
  it('moves one stage per advance while playing, and not while paused', () => {
    const run = makeRun();
    run.advance();
    expect(currentOf(run).stage).toBe('intake');
    run.play();
    expect(run.state().playing).toBe(true);
    run.advance();
    expect(currentOf(run).stage).toBe('privacy');
    run.pause();
    expect(run.state().playing).toBe(false);
    run.advance();
    expect(currentOf(run).stage).toBe('privacy');
  });

  // Pause pressed mid-ticket, then Step: the next stage of the same ticket, never a new one.
  it('steps to the next stage of the same ticket after a pause', () => {
    const run = makeRun();
    run.play();
    run.advance();
    run.advance();
    run.pause();
    const paused = currentOf(run);
    expect(paused.stage).toBe('classify');
    run.step();
    const stepped = currentOf(run);
    expect(stepped.stage).toBe('guardrails');
    expect(stepped.trail.id).toBe(paused.trail.id);
  });

  // The page's timer only calls advance(); it must find the run stopped at the end.
  it('stops playing by itself when the run completes', () => {
    const run = makeRun({ total: 2, act1: 1 });
    run.play();
    for (let n = 0; run.state().act !== 'complete' && n < MAX_STEPS; n += 1) run.advance();
    expect(run.state().act).toBe('complete');
    expect(run.state().playing).toBe(false);
  });

  it('leaves stepping to the paused run: Step does nothing while playing', () => {
    const run = makeRun();
    run.play();
    run.step();
    expect(currentOf(run).stage).toBe('intake');
  });
});

describe('Take over', () => {
  it('holds the run on a flagged ticket until the viewer confirms, then scores the pick', () => {
    const run = makeRun();
    run.setTakeOver(true);
    toReview(run);
    const waiting = run.state();
    expect(waiting.current?.waitingForViewer).toBe(true);

    run.step();
    run.play();
    run.advance();
    run.pause();
    expect(run.state().current).toEqual(waiting.current);
    expect(run.state().simTime).toBe(waiting.simTime);

    const id = currentOf(run).trail.id;
    const truth = run.truthOf(id);
    const wrongCategory: Category = truth.category === 'Billing' ? 'Other' : 'Billing';
    const pick = { category: wrongCategory, priority: truth.priority, route: ROUTES[wrongCategory] };
    run.confirm(pick);

    const confirmed = currentOf(run);
    expect(confirmed.waitingForViewer).toBe(false);
    expect(confirmed.stage).toBe('review');
    expect(confirmed.trail.id).toBe(id);
    expect(confirmed.trail.final).toEqual({ ...pick, by: 'reviewer' });
    // The ticket is run again with the viewer as the reviewer, so the whole trail (the
    // review note included) is the pipeline's own answer to that pick.
    const ticket = generateTicket(SEED, indexOf(id), { fold: FOLD, side: 'heldout' });
    const rerun = runTicket(ticket.text, id, {
      model: MODEL,
      reviewer: { decide: () => pick },
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: () => 0,
    });
    expect(confirmed.trail).toEqual({
      ...rerun,
      receivedAt: fakeSchedule(12, 6).arrivesAt(indexOf(id)),
      ms: confirmed.trail.ms,
    });
    expect(run.state().viewerReviews).toEqual([{ id, correct: false }]);

    run.step();
    expect(currentOf(run).stage).toBe('done');
    expect(run.state().done.at(-1)?.final).toEqual({ ...pick, by: 'reviewer' });
    expect(run.state().viewerReviews).toHaveLength(1);
  });

  // Parent C3: right means category and priority both match the truth; the team is shown, not scored.
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
    run.setTakeOver(true);
    toReview(run);
    const id = currentOf(run).trail.id;
    run.confirm(pickFor(run.truthOf(id)));
    expect(run.state().viewerReviews).toEqual([{ id, correct }]);
  });

  it('tells listeners once when the viewer confirms, with the review already counted', () => {
    const run = makeRun();
    run.setTakeOver(true);
    toReview(run);
    const seen: { waiting: boolean; reviews: number }[] = [];
    run.onChange(() => seen.push({ waiting: currentOf(run).waitingForViewer, reviews: run.state().viewerReviews.length }));
    run.confirm(rightPick(run, currentOf(run).trail.id));
    expect(seen).toEqual([{ waiting: false, reviews: 1 }]);
  });

  // The viewer's score means nothing if the simulated reviewer's answer is on screen first.
  it('hides the simulated reviewer\'s answer while the viewer reviews, showing the model\'s suggestion', () => {
    const run = makeRun();
    run.setTakeOver(true);
    toReview(run);
    const shown = currentOf(run).trail;
    expect(currentOf(run).waitingForViewer).toBe(true);
    expect(shown.review).toBeUndefined();
    const suggested = shown.category.label as Category;
    expect(shown.final).toEqual({ category: suggested, priority: shown.guard.priority, route: ROUTES[suggested], by: 'model' });
    // Nothing else about the ticket is hidden.
    expect(shown).toEqual({ ...simulatedTrailAtReview(), review: undefined, final: shown.final });
  });

  // Hand back pressed while the form is open: the simulated reviewer's answer stands.
  it('hands the open ticket back to the simulated reviewer without counting a review', () => {
    const run = makeRun();
    run.setTakeOver(true);
    toReview(run);
    const simulated = simulatedTrailAtReview();
    expect(simulated.review).toBeDefined();
    run.setTakeOver(false);
    expect(run.state().takeOver).toBe(false);
    expect(currentOf(run).waitingForViewer).toBe(false);
    expect(currentOf(run).trail).toEqual(simulated);
    expect(run.state().viewerReviews).toEqual([]);
    run.step();
    expect(currentOf(run).stage).toBe('done');
    expect(run.state().done.at(-1)).toEqual(simulated);
    expect(run.state().viewerReviews).toEqual([]);
  });

  // Take over switched on after the ticket reached review: that one finishes with the
  // reviewer, the next flagged one waits.
  it('lets a ticket already in review finish, and holds the next flagged one', () => {
    const run = makeRun();
    toReview(run);
    const inReview = currentOf(run).trail;
    run.setTakeOver(true);
    expect(currentOf(run).waitingForViewer).toBe(false);
    run.step();
    expect(currentOf(run).stage).toBe('done');
    expect(run.state().done.at(-1)).toEqual(inReview);
    expect(run.state().viewerReviews).toEqual([]);

    toReview(run);
    expect(currentOf(run).trail.id).not.toBe(inReview.id);
    expect(currentOf(run).waitingForViewer).toBe(true);
  });

  it('ignores a confirm when nobody is being waited on', () => {
    const run = makeRun();
    const pick = { category: 'Billing' as Category, priority: 'Low' as Priority, route: ROUTES.Billing };
    const atStart = withoutMs(run.state());
    run.confirm(pick);
    expect(withoutMs(run.state())).toBe(atStart);
    // In review, but with Take over off, the simulated reviewer already decided.
    toReview(run);
    const inReview = withoutMs(run.state());
    run.confirm(pick);
    expect(withoutMs(run.state())).toBe(inReview);
    expect(run.state().viewerReviews).toEqual([]);
  });
});

describe('speed', () => {
  it('lets the viewer switch speed at any time, and does not undo it on later tickets', () => {
    const run = makeRun({ total: 6, act1: 2 });
    run.setSpeed('real');
    expect(run.state().speed).toBe('real');
    run.setSpeed('learn');
    stepUntil(run, (s) => s.act === 2);
    expect(run.state().speed).toBe('real');
    run.setSpeed('learn');
    expect(run.state().speed).toBe('learn');
    stepUntil(run, (s) => s.current?.trail.id === `T-${SEED}-3` && s.current.stage === 'intake');
    expect(run.state().speed).toBe('learn');
  });
});

describe('onChange', () => {
  it('tells listeners after each change, with the new state already in place, and stops after unsubscribe', () => {
    const run = makeRun();
    const seen: string[] = [];
    const off = run.onChange(() => {
      const s = run.state();
      seen.push(`${s.playing}/${s.current?.stage}/${s.speed}/${s.takeOver}`);
    });
    run.advance();
    expect(seen).toEqual([]);
    run.play();
    run.play();
    run.advance();
    run.pause();
    run.setSpeed('real');
    run.setSpeed('real');
    run.setTakeOver(true);
    expect(seen).toEqual([
      'true/intake/learn/false',
      'true/privacy/learn/false',
      'false/privacy/learn/false',
      'false/privacy/real/false',
      'false/privacy/real/true',
    ]);
    off();
    run.step();
    expect(seen).toHaveLength(5);
  });
});
