import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import type { Model } from '../model/scorer';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer, TicketTrail } from '../pipeline/types';
import { maskText } from '../privacy/mask';
import type { Schedule } from './clock';
import { foldOf } from './seed';

export interface Tag {
  priority: Priority;
  critical: boolean;
}

export interface Waiting {
  id: string;
  maskedText: string;
  tag?: Tag;
}

export type CenterStage = 'intake' | 'privacy' | 'classify' | 'guardrails';

export interface RunState {
  seed: number;
  fold: number;
  act: 1 | 2 | 'complete';
  playing: boolean;
  // Run time in ms: the time of the last event fired.
  simTime: number;
  incoming: Waiting[];
  current?: { trail: TicketTrail; stage: CenterStage; tag?: Tag };
  open: TicketTrail[];
  done: TicketTrail[];
  reviewing?: TicketTrail;
  viewerReviews: { id: string; correct: boolean }[];
  realSpeed?: { tickets: number; ms: number };
}

export interface Run {
  state(): RunState;
  nextDelayMs(): number | null;
  advance(): void;
  step(): void;
  play(): void;
  pause(): void;
  review(id: string): void;
  confirm(d: { category: Category; priority: Priority; route: string }): void;
  handBack(): void;
  finishNow(): void;
  truthOf(id: string): TicketLabel;
  onChange(fn: () => void): () => void;
}

// The first tickets stay in the center long enough to read the full narration of each stage;
// every other ticket takes about a second there.
export const DEEP_TICKETS = 3;
export const DEEP_STAGE_MS = 5000;
export const QUICK_STAGE_MS = 250;
// The pre-screener answers a little after the ticket arrives; nothing waits for it.
export const TAG_DELAY_MS = 400;
// The simulated reviewer closes one open ticket per second of run time.
export const CLOSE_EVERY_MS = 1000;
const MS_PER_SECOND = 1000;

const CENTER_STAGES: readonly CenterStage[] = ['intake', 'privacy', 'classify', 'guardrails'];

type EventKind = 'close' | 'stage' | 'tag' | 'arrive';

// Events due at the same moment fire in this order: a ticket leaving the center or being
// closed frees room before a tag or an arrival is dealt with.
const EVENT_ORDER: readonly EventKind[] = ['close', 'stage', 'tag', 'arrive'];

interface Due {
  kind: EventKind;
  at: number;
}

// A ticket in the line; `text` is what the pipeline reads when it enters the center.
interface Queued {
  index: number;
  text: string;
  waiting: Waiting;
}

// A ticket the pipeline has run, in the center or in the open list.
interface Held {
  index: number;
  text: string;
  trail: TicketTrail;
}

interface Center extends Held {
  stage: number;
  nextAt: number;
  tag?: Tag;
}

interface PendingTag {
  at: number;
  id: string;
  maskedText: string;
}

function compareOpen(a: Held, b: Held): number {
  const byPriority = PRIORITIES.indexOf(b.trail.guard.priority) - PRIORITIES.indexOf(a.trail.guard.priority);
  return byPriority !== 0 ? byPriority : a.index - b.index;
}

// While the viewer can see a ticket that is not closed, the trail shows what the model
// suggested, not what the simulated reviewer decided: seeing that answer first would make
// the viewer's score meaningless. The stored trail is untouched.
function hideAnswer(trail: TicketTrail): TicketTrail {
  const shown: TicketTrail = { ...trail };
  delete shown.review;
  const category = shown.category.label as Category;
  shown.final = { category, priority: shown.guard.priority, route: ROUTES[category], by: 'model' };
  return shown;
}

function stageMs(index: number): number {
  return index < DEEP_TICKETS ? DEEP_STAGE_MS : QUICK_STAGE_MS;
}

export function createRun(opts: {
  seed: number;
  model: Model;
  schedule: Schedule;
  wallClock: () => number;
  prescreen: (maskedText: string) => Tag;
}): Run {
  const { seed, model, schedule, wallClock, prescreen } = opts;
  const fold = foldOf(seed);
  const truths = new Map<string, TicketLabel>();
  const truthOf = (id: string): TicketLabel => {
    const label = truths.get(id);
    if (label === undefined) {
      throw new Error('E_UNKNOWN_TICKET');
    }
    return label;
  };
  const simulatedReviewer = createSimulatedReviewer(seed, truthOf);
  const listeners = new Set<() => void>();

  let now = 0;
  let playing = false;
  let nextArrival = 0;
  let closeAt: number | null = null;
  let center: Center | undefined;
  let reviewing: Held | undefined;
  let realSpeed: { tickets: number; ms: number } | undefined;
  const line: Queued[] = [];
  const pendingTags: PendingTag[] = [];
  const open: Held[] = [];
  const done: TicketTrail[] = [];
  const viewerReviews: { id: string; correct: boolean }[] = [];

  const isComplete = (): boolean => done.length >= schedule.total;

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  // runTicket stamps receivedAt and ms from one clock; the engine keeps the measured ms
  // and takes receivedAt from the schedule, so replays agree on everything but ms.
  function runWith(held: { index: number; text: string }, id: string, reviewer: Reviewer): TicketTrail {
    const trail = runTicket(held.text, id, {
      model,
      reviewer,
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: wallClock,
    });
    return { ...trail, receivedAt: schedule.arrivesAt(held.index) };
  }

  // The reviewer's second runs while someone is waiting for it, and starts when the first
  // ticket opens; a review that leaves others open keeps the second already running.
  function armClose(): void {
    if (open.length === 0) {
      closeAt = null;
    } else if (closeAt === null) {
      closeAt = now + CLOSE_EVERY_MS;
    }
  }

  function addOpen(held: Held): void {
    open.push(held);
    open.sort(compareOpen);
    armClose();
  }

  function fillCenter(): void {
    if (center !== undefined) {
      return;
    }
    const next = line.shift();
    if (next === undefined) {
      return;
    }
    const held = { index: next.index, text: next.text };
    const trail = runWith(held, next.waiting.id, simulatedReviewer);
    center = { ...held, trail, stage: 0, nextAt: now + stageMs(next.index) };
    if (next.waiting.tag !== undefined) {
      center.tag = next.waiting.tag;
    }
  }

  function arrive(): void {
    const index = nextArrival;
    nextArrival += 1;
    const ticket = generateTicket(seed, index, { fold, side: 'heldout' });
    truths.set(ticket.id, ticket.label);
    const maskedText = maskText(ticket.text).text;
    line.push({ index, text: ticket.text, waiting: { id: ticket.id, maskedText } });
    pendingTags.push({ at: now + TAG_DELAY_MS, id: ticket.id, maskedText });
    fillCenter();
  }

  // A critical ticket goes behind the critical ones already waiting and ahead of the rest.
  function tagTicket(): void {
    const pending = pendingTags.shift();
    if (pending === undefined) {
      return;
    }
    const tag = prescreen(pending.maskedText);
    const queued = line.find((q) => q.waiting.id === pending.id);
    if (queued === undefined) {
      // Already in the center: the tag still applies to it.
      if (center?.trail.id === pending.id) {
        center.tag = tag;
      }
      return;
    }
    queued.waiting.tag = tag;
    if (tag.critical) {
      line.splice(line.indexOf(queued), 1);
      line.splice(line.filter((q) => q.waiting.tag?.critical === true).length, 0, queued);
    }
  }

  function stepCenter(): void {
    if (center === undefined) {
      return;
    }
    if (center.stage < CENTER_STAGES.length - 1) {
      center.stage += 1;
      center.nextAt = now + stageMs(center.index);
      return;
    }
    const { index, text, trail } = center;
    center = undefined;
    if (trail.guard.flagged) {
      addOpen({ index, text, trail });
    } else {
      done.push(trail);
    }
    fillCenter();
  }

  function closeTop(): void {
    const top = open.shift();
    if (top !== undefined) {
      done.push(top.trail);
    }
    closeAt = null;
    armClose();
  }

  const HANDLERS: Record<EventKind, () => void> = {
    close: closeTop,
    stage: stepCenter,
    tag: tagTicket,
    arrive,
  };

  function nextEvent(): Due | undefined {
    const due: Due[] = [];
    if (closeAt !== null) {
      due.push({ kind: 'close', at: closeAt });
    }
    if (center !== undefined) {
      due.push({ kind: 'stage', at: center.nextAt });
    }
    const pending = pendingTags[0];
    if (pending !== undefined) {
      due.push({ kind: 'tag', at: pending.at });
    }
    if (nextArrival < schedule.total) {
      due.push({ kind: 'arrive', at: schedule.arrivesAt(nextArrival) * MS_PER_SECOND });
    }
    due.sort((a, b) => a.at - b.at || EVENT_ORDER.indexOf(a.kind) - EVENT_ORDER.indexOf(b.kind));
    return due[0];
  }

  function fire(event: Due): void {
    now = Math.max(now, event.at);
    HANDLERS[event.kind]();
    if (isComplete()) {
      playing = false;
    }
  }

  function tick(): void {
    const event = nextEvent();
    if (reviewing === undefined && event !== undefined) {
      fire(event);
      notify();
    }
  }

  function currentAct(): 1 | 2 | 'complete' {
    if (isComplete()) {
      return 'complete';
    }
    return schedule.act(center?.index ?? Math.max(nextArrival - 1, 0));
  }

  function confirm(d: { category: Category; priority: Priority; route: string }): void {
    if (reviewing === undefined) {
      return;
    }
    const held = reviewing;
    reviewing = undefined;
    const id = held.trail.id;
    const decision = { category: d.category, priority: d.priority, route: d.route };
    done.push(runWith(held, id, { decide: () => decision }));
    const truth = truthOf(id);
    viewerReviews.push({ id, correct: d.category === truth.category && d.priority === truth.priority });
    armClose();
    if (isComplete()) {
      playing = false;
    }
    notify();
  }

  function review(id: string): void {
    const at = open.findIndex((held) => held.trail.id === id);
    const held = open[at];
    if (reviewing !== undefined || held === undefined) {
      return;
    }
    open.splice(at, 1);
    reviewing = held;
    armClose();
    notify();
  }

  function handBack(): void {
    if (reviewing === undefined) {
      return;
    }
    const held = reviewing;
    reviewing = undefined;
    addOpen(held);
    notify();
  }

  function finishNow(): void {
    if (reviewing !== undefined || isComplete()) {
      return;
    }
    const tickets = schedule.total - done.length;
    const started = wallClock();
    for (let event = nextEvent(); event !== undefined; event = nextEvent()) {
      fire(event);
    }
    realSpeed = { tickets, ms: wallClock() - started };
    notify();
  }

  function state(): RunState {
    const snapshot: RunState = {
      seed,
      fold,
      act: currentAct(),
      playing,
      simTime: now,
      incoming: line.map((q) => ({ ...q.waiting })),
      open: open.map((held) => hideAnswer(held.trail)),
      done: [...done],
      viewerReviews: viewerReviews.map((entry) => ({ ...entry })),
    };
    if (center !== undefined) {
      snapshot.current = { trail: hideAnswer(center.trail), stage: CENTER_STAGES[center.stage] ?? 'intake' };
      if (center.tag !== undefined) {
        snapshot.current.tag = center.tag;
      }
    }
    if (reviewing !== undefined) {
      snapshot.reviewing = hideAnswer(reviewing.trail);
    }
    if (realSpeed !== undefined) {
      snapshot.realSpeed = { ...realSpeed };
    }
    return snapshot;
  }

  return {
    state,
    nextDelayMs() {
      const event = nextEvent();
      if (!playing || reviewing !== undefined || isComplete() || event === undefined) {
        return null;
      }
      return Math.max(0, event.at - now);
    },
    advance() {
      if (playing) {
        tick();
      }
    },
    step() {
      if (!playing) {
        tick();
      }
    },
    play() {
      if (!playing && !isComplete()) {
        playing = true;
        notify();
      }
    },
    pause() {
      if (playing) {
        playing = false;
        notify();
      }
    },
    review,
    confirm,
    handBack,
    finishNow,
    truthOf,
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
