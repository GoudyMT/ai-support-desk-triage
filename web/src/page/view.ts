// Everything the page's panels show, worked out from the run's state. Pure: no DOM, so a
// test reads it directly. The engine hides the simulated reviewer's answer while the viewer
// reviews, and nothing here puts it back.
import { ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import { MASK_TOKENS } from '../privacy/mask';
import { ACT2_TICKETS_PER_DAY } from '../run/clock';
import type { RunState } from '../run/engine';
import { liveNumbers } from '../run/liveNumbers';
import { narrate } from '../run/narrate';
import { STAGES, type Stage } from '../run/stage';
import { findSpans } from './spans';

export interface StageCell {
  stage: Stage;
  title: string;
  caption: string;
  lit: boolean;
}

export type PillKind = 'auto' | 'flagged' | 'overridden' | 'missed' | 'working';

export interface FeedRow {
  id: string;
  text: string;
  pill: { kind: PillKind; word: string };
  current: boolean;
}

export type SegmentKind = 'plain' | 'chip' | 'rule' | 'mask';

export interface TrailLine {
  stage: Stage;
  label: string;
  // Null for a stage the ticket has not reached: nothing of its result is shown early.
  text: string | null;
  status: 'done' | 'now' | 'pending';
}

export interface CurrentTicketView {
  id: string;
  segments: { kind: SegmentKind; text: string }[];
  lines: TrailLine[];
}

export interface NarrationView {
  heading: string;
  plain: string;
  detail: { label: string; value: string }[];
}

export interface NumbersView {
  rows: { label: string; value: string }[];
  assumption: { text: string; shown: boolean };
}

export interface ControlsView {
  playLabel: string;
  playDisabled: boolean;
  stepDisabled: boolean;
  takeOverLabel: string;
  takeOverOn: boolean;
  speed: RunState['speed'];
}

export interface TakeOverDefaults {
  category: Category;
  priority: Priority;
  route: string;
  why: string;
}

const PERCENT = 100;
const NO_VALUE = '-';
const STAGE_NAMES: Record<Stage, string> = {
  intake: 'Intake',
  privacy: 'Privacy',
  classify: 'Classify',
  guardrails: 'Guardrails',
  review: 'Review',
  done: 'Done',
};
// What each stage's count counts, as the locked wireframe words it.
const STAGE_COUNT_WORDS: Record<Stage, string> = {
  intake: 'received',
  privacy: 'masked',
  classify: 'scored',
  guardrails: 'flagged',
  review: 'reviewed',
  done: 'done',
};
const VIEWER_WAITING = 'This ticket is waiting for you. Choose a category, priority and team, then confirm.';

const stageIndex = (stage: Stage): number => STAGES.indexOf(stage);
const percent = (share: number): string => `${Math.round(share * PERCENT)}%`;
const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// Every ticket that has entered the run and the stage it is at. A ticket at Done is also the
// last of `done`, so only a ticket still moving is added.
function entries(state: RunState): { trail: TicketTrail; at: number }[] {
  const doneAt = stageIndex('done');
  const all = state.done.map((trail) => ({ trail, at: doneAt }));
  if (state.current !== undefined && state.current.stage !== 'done') {
    all.push({ trail: state.current.trail, at: stageIndex(state.current.stage) });
  }
  return all;
}

function viewerReviewed(state: RunState, trail: TicketTrail): boolean {
  return state.viewerReviews.some((review) => review.id === trail.id);
}

export function stageRowView(state: RunState): StageCell[] {
  const all = entries(state);
  const waiting = state.current?.waitingForViewer === true;
  return STAGES.map((stage, i) => {
    const reached = all.filter((entry) => entry.at >= i);
    // Guardrails reads "flagged" in the wireframe, so its count is the tickets it flagged; only
    // a flagged ticket goes on to review, so a ticket that skipped it is not counted as reviewed.
    const flaggedOnly = stage === 'guardrails' || stage === 'review';
    const count = flaggedOnly ? reached.filter((entry) => entry.trail.guard.flagged).length : reached.length;
    const lit = state.current?.stage === stage;
    let note = '';
    if (lit) {
      note = waiting && stage === 'review' ? ' - waiting for you' : state.playing ? ' - now' : ' - paused here';
    }
    return {
      stage,
      title: `${i + 1} ${STAGE_NAMES[stage]}${lit && waiting && stage === 'review' ? ' - you' : ''}`,
      caption: `${count} ${STAGE_COUNT_WORDS[stage]}${note}`,
      lit,
    };
  });
}

function pillFor(trail: TicketTrail, truth: TicketLabel): FeedRow['pill'] {
  if (!trail.guard.flagged && truth.mustReview) {
    return { kind: 'missed', word: 'Missed' };
  }
  if (trail.final.by === 'reviewer') {
    return trail.final.category === trail.category.label
      ? { kind: 'flagged', word: 'Flagged' }
      : { kind: 'overridden', word: 'Overridden' };
  }
  return { kind: 'auto', word: 'Auto' };
}

export function feedView(state: RunState, truthOf: (id: string) => TicketLabel): FeedRow[] {
  const current = state.current;
  const rows: FeedRow[] = [...state.done].reverse().map((trail) => ({
    id: trail.id,
    text: `${trail.id} ${trail.final.category}`,
    pill: pillFor(trail, truthOf(trail.id)),
    current: trail.id === current?.trail.id,
  }));
  if (current !== undefined && current.stage !== 'done') {
    const at = stageIndex(current.stage);
    const { trail } = current;
    let text = trail.id;
    if (current.waitingForViewer) {
      text = `${trail.id} waiting for you`;
    } else if (at >= stageIndex('classify')) {
      text = `${trail.id} ${trail.category.label}`;
    }
    const flagged = at >= stageIndex('guardrails') && trail.guard.flagged;
    rows.unshift({
      id: trail.id,
      text,
      pill: flagged ? { kind: 'flagged', word: 'Flagged' } : { kind: 'working', word: 'In progress' },
      current: true,
    });
  }
  return rows;
}

function ruleWords(trail: TicketTrail): string[] {
  return trail.guard.reasons.flatMap((reason) => (reason.kind === 'rule' ? reason.words : []));
}

function markText(trail: TicketTrail, at: number): SegmentKind[] {
  const text = trail.maskedText;
  const kinds = Array.from({ length: text.length }, (): SegmentKind => 'plain');
  const mark = (start: number, end: number, kind: SegmentKind): void => {
    kinds.fill(kind, start, end);
  };
  // Later marks win where spans overlap: a mask token is never cut by a chip.
  if (at >= stageIndex('classify')) {
    for (const { term } of trail.category.topTerms) {
      for (const span of findSpans(text, term)) mark(span.start, span.end, 'chip');
    }
  }
  if (at >= stageIndex('guardrails')) {
    for (const word of ruleWords(trail)) {
      for (const span of findSpans(text, word)) mark(span.start, span.end, 'rule');
    }
  }
  if (at >= stageIndex('privacy')) {
    for (const token of Object.values(MASK_TOKENS)) {
      for (let from = text.indexOf(token); from !== -1; from = text.indexOf(token, from + token.length)) {
        mark(from, from + token.length, 'mask');
      }
    }
  }
  return kinds;
}

function segmentsOf(trail: TicketTrail, at: number): CurrentTicketView['segments'] {
  const kinds = markText(trail, at);
  const segments: CurrentTicketView['segments'] = [];
  // The marks are offsets into the text's UTF-16 units, so the text is read the same way.
  for (let i = 0; i < trail.maskedText.length; i += 1) {
    const char = trail.maskedText.charAt(i);
    const kind = kinds[i] ?? 'plain';
    const last = segments.at(-1);
    if (last?.kind === kind) {
      last.text += char;
    } else {
      segments.push({ kind, text: char });
    }
  }
  return segments;
}

function reasonPhrase(reason: FlagReason): string {
  switch (reason.kind) {
    case 'rule':
      return `a rule caught ${reason.words.slice(0, 2).map((word) => `"${word}"`).join(' and ')}`;
    case 'category':
      return `${reason.category} tickets always go to a person`;
    case 'low confidence':
      return 'the model is not sure enough';
  }
}

const MAX_REASONS_SHOWN = 2;

function whyFlagged(trail: TicketTrail): string {
  return trail.guard.reasons.slice(0, MAX_REASONS_SHOWN).map(reasonPhrase).join(', and ');
}

function lineText(state: RunState, trail: TicketTrail, stage: Stage, waiting: boolean): string {
  switch (stage) {
    case 'intake':
      return 'received.';
    case 'privacy': {
      const masked = narrate(trail, 'privacy').detail.find((row) => row.label === 'Masked')?.value ?? 'nothing';
      return masked === 'nothing' ? 'nothing personal found.' : `masked ${masked}.`;
    }
    case 'classify':
      return (
        `${trail.category.label}, ${percent(trail.category.confidence)} sure. ` +
        `Priority ${trail.priority.label}, ${percent(trail.priority.confidence)} sure.`
      );
    case 'guardrails': {
      if (!trail.guard.flagged) {
        return trail.guard.clearedBySecondCheck ? 'not flagged. A second check cleared the low confidence.' : 'not flagged.';
      }
      const why = whyFlagged(trail);
      return why === '' ? 'flagged.' : `flagged. ${capitalised(why)}.`;
    }
    case 'review': {
      if (waiting) return 'waiting for you.';
      if (trail.review === undefined) return 'not needed.';
      const who = viewerReviewed(state, trail) ? 'you' : 'the simulated reviewer';
      return `${who} chose ${trail.review.category}, priority ${trail.review.priority}.`;
    }
    case 'done':
      return `sent to ${trail.final.route} as ${trail.final.category}, priority ${trail.final.priority}.`;
  }
}

export function currentTicketView(state: RunState): CurrentTicketView | undefined {
  const { current } = state;
  if (current === undefined) {
    return undefined;
  }
  const at = stageIndex(current.stage);
  return {
    id: current.trail.id,
    segments: segmentsOf(current.trail, at),
    lines: STAGES.map((stage, i) => ({
      stage,
      label: STAGE_NAMES[stage],
      text: i <= at ? lineText(state, current.trail, stage, current.waitingForViewer) : null,
      status: i < at ? 'done' : i === at ? 'now' : 'pending',
    })),
  };
}

function plainSentence(state: RunState, trail: TicketTrail, stage: Stage, waiting: boolean): string {
  if (stage === 'review' && waiting) {
    return VIEWER_WAITING;
  }
  if (viewerReviewed(state, trail) && stage === 'review' && trail.review !== undefined) {
    return `You read the ticket and chose ${trail.review.category} with ${trail.review.priority} priority.`;
  }
  if (viewerReviewed(state, trail) && stage === 'done') {
    const { route, category, priority } = trail.final;
    return `The ticket goes to ${route} as ${category}, priority ${priority}, decided by you.`;
  }
  return narrate(trail, stage).plain;
}

export function narrationView(state: RunState): NarrationView | undefined {
  const { current } = state;
  if (current === undefined) {
    return undefined;
  }
  return {
    heading: `What is happening - step ${stageIndex(current.stage) + 1} of ${STAGES.length}, ${STAGE_NAMES[current.stage]}`,
    plain: plainSentence(state, current.trail, current.stage, current.waitingForViewer),
    detail: narrate(current.trail, current.stage).detail,
  };
}

export function numbersView(state: RunState, truthOf: (id: string) => TicketLabel): NumbersView {
  const live = liveNumbers(state, truthOf);
  const share = (value: number | null): string => (value === null ? NO_VALUE : percent(value));
  const { correct, total } = live.viewerCorrect;
  return {
    rows: [
      { label: 'Tickets done', value: String(live.done) },
      { label: 'Tickets per second', value: live.perSecond === null ? NO_VALUE : live.perSecond.toFixed(1) },
      { label: 'Accuracy so far', value: share(live.modelAccuracy) },
      { label: 'v0 on the same tickets', value: share(live.v0Accuracy) },
      { label: 'Flagged for a person', value: share(live.flaggedShare) },
      { label: 'Reviewer overrides', value: String(live.overrides) },
      { label: 'High-risk tickets missed so far', value: String(live.highRiskMissed) },
      { label: 'Your reviews correct', value: total === 0 ? NO_VALUE : `${correct} of ${total}` },
    ],
    assumption: {
      text: `Assumed arrivals: ${ACT2_TICKETS_PER_DAY} tickets per business day`,
      shown: state.act !== 1,
    },
  };
}

export function statusView(state: RunState): string {
  if (state.act === 'complete') return 'Run complete';
  if (!state.playing) return 'Paused';
  if (state.takeOver) return 'You are the reviewer - the run waits on each flagged ticket';
  return `Act ${state.act} of 2 - ${state.speed} speed`;
}

export function controlsView(state: RunState): ControlsView {
  const over = state.act === 'complete';
  const blocked = over || state.current?.waitingForViewer === true;
  return {
    playLabel: state.playing ? 'Pause' : 'Play',
    playDisabled: blocked,
    stepDisabled: blocked || state.playing,
    takeOverLabel: state.takeOver ? 'Hand back to the reviewer' : 'Take over',
    takeOverOn: state.takeOver,
    speed: state.speed,
  };
}

export function takeOverDefaults(state: RunState): TakeOverDefaults | undefined {
  const { current } = state;
  if (current?.waitingForViewer !== true) {
    return undefined;
  }
  const category = current.trail.category.label as Category;
  return {
    category,
    priority: current.trail.guard.priority,
    route: ROUTES[category],
    why: `${whyFlagged(current.trail)}.`,
  };
}
