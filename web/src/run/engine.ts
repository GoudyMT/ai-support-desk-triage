import type { Category, Priority, TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import type { Model } from '../model/scorer';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer, TicketTrail } from '../pipeline/types';
import type { Schedule } from './clock';
import { foldOf } from './seed';
import type { Stage } from './stage';

export type Speed = 'learn' | 'real';

export interface RunState {
  seed: number;
  fold: number;
  act: 1 | 2 | 'complete';
  speed: Speed;
  playing: boolean;
  takeOver: boolean;
  current?: { trail: TicketTrail; stage: Stage; waitingForViewer: boolean };
  done: TicketTrail[];
  viewerReviews: { id: string; correct: boolean }[];
  simTime: number;
}

export interface Run {
  state(): RunState;
  advance(): void;
  play(): void;
  pause(): void;
  step(): void;
  setSpeed(s: Speed): void;
  setTakeOver(on: boolean): void;
  confirm(d: { category: Category; priority: Priority; route: string }): void;
  truthOf(id: string): TicketLabel;
  onChange(fn: () => void): () => void;
}

// The ticket now moving through the stages. `trail` is the pipeline's answer with the
// simulated reviewer; a viewer's confirm replaces it.
interface Live {
  index: number;
  text: string;
  trail: TicketTrail;
  stage: Stage;
  waiting: boolean;
}

// The stage that follows each one on the way to done; guardrails is decided separately
// because only a flagged ticket goes on to review.
const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  intake: 'privacy',
  privacy: 'classify',
  classify: 'guardrails',
  review: 'done',
};

export function createRun(opts: { seed: number; model: Model; schedule: Schedule; wallClock: () => number }): Run {
  const { seed, model, schedule, wallClock } = opts;
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

  let live: Live | undefined;
  let complete = false;
  let speed: Speed = 'learn';
  let playing = false;
  let takeOver = false;
  let simTime = 0;
  const done: TicketTrail[] = [];
  const viewerReviews: { id: string; correct: boolean }[] = [];

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  // runTicket stamps receivedAt and ms from one clock; the engine keeps the measured ms
  // and takes receivedAt from the schedule, so replays agree on everything but ms.
  function runWith(index: number, text: string, id: string, reviewer: Reviewer): TicketTrail {
    const trail = runTicket(text, id, {
      model,
      reviewer,
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: wallClock,
    });
    return { ...trail, receivedAt: schedule.arrivesAt(index) };
  }

  function enter(index: number): void {
    const ticket = generateTicket(seed, index, { fold, side: 'heldout' });
    truths.set(ticket.id, ticket.label);
    live = {
      index,
      text: ticket.text,
      trail: runWith(index, ticket.text, ticket.id, simulatedReviewer),
      stage: 'intake',
      waiting: false,
    };
    simTime = schedule.arrivesAt(index);
    // Act 2 is the busy day, which reads at real speed; the viewer may switch back.
    if (index > 0 && schedule.act(index) === 2 && schedule.act(index - 1) === 1) {
      speed = 'real';
    }
  }

  // Moves the current ticket one stage on; false when nothing can move.
  function move(): boolean {
    if (live === undefined || live.waiting) {
      return false;
    }
    const next = NEXT_STAGE[live.stage];
    if (next !== undefined) {
      live.stage = next;
    } else if (live.stage === 'guardrails') {
      live.stage = live.trail.guard.flagged ? 'review' : 'done';
      // Decided as the ticket enters review: a ticket already being reviewed by the
      // simulated reviewer when Take over turns on finishes with it.
      live.waiting = live.stage === 'review' && takeOver;
    } else if (live.index + 1 < schedule.total) {
      enter(live.index + 1);
    } else {
      live = undefined;
      complete = true;
      playing = false;
      return true;
    }
    if (live.stage === 'done') {
      done.push(live.trail);
    }
    return true;
  }

  function tick(): void {
    if (move()) {
      notify();
    }
  }

  enter(0);

  return {
    state() {
      const state: RunState = {
        seed,
        fold,
        act: complete ? 'complete' : schedule.act(live?.index ?? 0),
        speed,
        playing,
        takeOver,
        done: [...done],
        viewerReviews: viewerReviews.map((review) => ({ ...review })),
        simTime,
      };
      if (live !== undefined) {
        state.current = { trail: live.trail, stage: live.stage, waitingForViewer: live.waiting };
      }
      return state;
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
      if (!playing && !complete) {
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
    setSpeed(s) {
      if (s !== speed) {
        speed = s;
        notify();
      }
    },
    setTakeOver(on) {
      if (on === takeOver) {
        return;
      }
      takeOver = on;
      if (!on && live !== undefined) {
        live.waiting = false;
      }
      notify();
    },
    confirm(d) {
      if (live === undefined || !live.waiting) {
        return;
      }
      const id = live.trail.id;
      const decision = { category: d.category, priority: d.priority, route: d.route };
      live.trail = runWith(live.index, live.text, id, { decide: () => decision });
      live.waiting = false;
      const truth = truthOf(id);
      viewerReviews.push({ id, correct: d.category === truth.category && d.priority === truth.priority });
      notify();
    },
    truthOf,
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
