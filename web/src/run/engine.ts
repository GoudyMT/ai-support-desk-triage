import type { Category, Priority, TicketLabel } from '../domain/labels';
import { generateTicket } from '../generator/generate';
import { createSimulatedReviewer } from '../pipeline/reviewer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import type { Reviewer, TicketTrail } from '../pipeline/types';
import { maskText } from '../privacy/mask';
import {
  EVENT_ORDER,
  compareOpen,
  hideAnswer,
  stageMs,
  type Center,
  type Due,
  type EventKind,
  type Held,
  type PendingTag,
  type Queued,
} from './engineParts';
import {
  CLOSE_EVERY_MS,
  DEEP_TICKETS,
  QUICK_STAGE_MS,
  TAG_DELAY_MS,
  type CenterStage,
  type Hold,
  type Run,
  type RunOptions,
  type RunState,
} from './engineTypes';
import { foldOf } from './seed';

export * from './engineTypes';

const MS_PER_SECOND = 1000;

const CENTER_STAGES: readonly CenterStage[] = ['intake', 'privacy', 'classify', 'guardrails'];

export function createRun(opts: RunOptions): Run {
  const { seed, model, schedule, wallClock, prescreen, timed = true } = opts;
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
  let held: Hold = null;
  // Tickets still to enter the center at the slow pace.
  let slowLeft = DEEP_TICKETS;
  // The count reached zero by tickets entering, not by the viewer: the end of the slow part is then offered.
  let slowRanOut = false;
  let offerSpeedUp = false;
  let nextArrival = 0;
  // The viewer asked for the busy day, and the run has not yet moved to it (a review form is open).
  let busyDayDue = false;
  // The run has moved on to Act 2's arrivals.
  let busyDay = false;
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
    if (center !== undefined || held === 'line') {
      return;
    }
    const next = line.shift();
    if (next === undefined) {
      return;
    }
    const ticket = { index: next.index, text: next.text };
    const trail = runWith(ticket, next.waiting.id, simulatedReviewer);
    const deep = slowLeft > 0;
    if (deep) {
      slowLeft -= 1;
      slowRanOut = slowLeft === 0;
    }
    center = { ...ticket, trail, stage: 0, nextAt: now + stageMs(deep), deep };
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
      center.nextAt = now + stageMs(center.deep);
      return;
    }
    const { index, text, trail } = center;
    if (center.deep && slowRanOut) {
      slowRanOut = false;
      offerSpeedUp = true;
      playing = false;
    }
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
    if (closeAt !== null && held !== 'reviewer') {
      due.push({ kind: 'close', at: closeAt });
    }
    if (center !== undefined && !(held !== null && CENTER_STAGES[center.stage] === held)) {
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
    return busyDay ? 2 : schedule.act(center?.index ?? Math.max(nextArrival - 1, 0));
  }

  // A viewer who asks for speed wants the busy day, not Act 1's slow arrivals at a quicker pace. What is
  // still to arrive in Act 1 joins the line now, and the clock goes to the first arrival of Act 2; it never
  // goes back. A review form holds the run still, so the move waits for it. Once Act 2's arrivals are under
  // way there is nothing to move.
  function settleBusyDay(): void {
    if (!busyDayDue || reviewing !== undefined) {
      return;
    }
    busyDayDue = false;
    if (nextArrival > 0 && schedule.act(nextArrival - 1) === 2) {
      return;
    }
    let firstAct2 = nextArrival;
    while (firstAct2 < schedule.total && schedule.act(firstAct2) === 1) {
      firstAct2 += 1;
    }
    if (firstAct2 < schedule.total) {
      now = Math.max(now, schedule.arrivesAt(firstAct2) * MS_PER_SECOND);
    }
    while (nextArrival < firstAct2) {
      arrive();
    }
    busyDay = true;
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
    if (isComplete()) {
      playing = false;
    }
    settleBusyDay();
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
    settleBusyDay();
    notify();
  }

  // The time of one unpaced pass over every ticket, on a fresh run with the same seed, model,
  // schedule and pre-screener. It has its own simulated reviewer and shares no state with this
  // run, so it measures the same work whenever the button is pressed.
  function timeFullPass(): number {
    const started = wallClock();
    createRun({ ...opts, timed: false }).finishNow();
    return wallClock() - started;
  }

  // Finishes the live run with no pacing and no timing, then reports the measured pass. A run that
  // ended by itself has nothing left to finish and is only timed, and only once.
  function finishNow(): void {
    if (reviewing !== undefined || (isComplete() && (realSpeed !== undefined || !timed))) {
      return;
    }
    // Real speed is the software's own pace: a hold, the slow count and the offer's pause are the viewer's.
    held = null;
    fillCenter();
    for (let event = nextEvent(); event !== undefined; event = nextEvent()) {
      fire(event);
    }
    slowRanOut = false;
    offerSpeedUp = false;
    if (timed) {
      realSpeed = { tickets: schedule.total, ms: timeFullPass() };
    }
    notify();
  }

  function state(): RunState {
    // A finished run has nothing left to speed up.
    const offered = offerSpeedUp && !isComplete();
    const snapshot: RunState = {
      seed,
      fold,
      act: currentAct(),
      playing,
      pace: slowLeft > 0 || offered || center?.deep === true ? 'slow' : 'fast',
      offerSpeedUp: offered,
      simTime: now,
      incoming: line.map((q) => ({ ...q.waiting })),
      open: open.map((held) => hideAnswer(held.trail)),
      done: [...done],
      viewerReviews: viewerReviews.map((entry) => ({ ...entry })),
    };
    if (center !== undefined) {
      snapshot.current = {
        trail: hideAnswer(center.trail),
        stage: CENTER_STAGES[center.stage] ?? 'intake',
        deep: center.deep,
      };
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
        offerSpeedUp = false;
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
    hold(where) {
      held = where;
      fillCenter();
      notify();
    },
    // The ticket in the center is sped up too: waiting out its slow stages would make the button feel broken.
    speedUp() {
      slowLeft = 0;
      slowRanOut = false;
      offerSpeedUp = false;
      if (center !== undefined) {
        center.deep = false;
        center.nextAt = Math.min(center.nextAt, now + QUICK_STAGE_MS);
      }
      busyDayDue = true;
      settleBusyDay();
      notify();
    },
    slowDown() {
      slowLeft = DEEP_TICKETS;
      offerSpeedUp = false;
      // A busy day asked for under the review form is no longer wanted.
      busyDayDue = false;
      notify();
    },
    // A run left at the quick pace on Act 1's arrivals (Learn played on at the offer) is paused and offered the busy day.
    offerBusyDay() {
      if (!isComplete() && !busyDay && slowLeft === 0 && !offerSpeedUp) {
        offerSpeedUp = true;
        playing = false;
        notify();
      }
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
