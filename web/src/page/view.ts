// Everything the page's panels show, worked out from the run's state. Pure: no DOM, so a
// test reads it directly. The engine hides the simulated reviewer's answer while a ticket is
// open or under review, and nothing here puts it back.
import { ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import { MASK_TOKENS } from '../privacy/mask';
import { ACT2_TICKETS_PER_DAY } from '../run/clock';
import { CLOSE_EVERY_MS, type RunState } from '../run/engine';
import { liveNumbers } from '../run/liveNumbers';
import { narrate } from '../run/narrate';
import { STAGES, type Stage } from '../run/stage';
import { findSpans } from './spans';

export type PillKind = 'auto' | 'flagged' | 'overridden' | 'missed' | 'you';

export type SegmentKind = 'plain' | 'chip' | 'rule' | 'mask';

export interface Segment {
  kind: SegmentKind;
  text: string;
}

export interface TagView {
  word: 'Critical' | 'High' | 'Medium' | 'Low';
  level: 'critical' | 'high' | 'medium' | 'low';
}

export interface CenterView {
  id: string;
  tag: TagView | null;
  stageName: string;
  steps: { name: string; status: 'done' | 'now' | 'pending' }[];
  segments: Segment[];
  // One row per stage from Privacy on, so the center never changes height as stages are reached.
  // A row whose stage is not reached has `text: null`: nothing of a later result is shown early.
  lines: { label: string; text: string | null }[];
  plain: string;
  why: { label: string; value: string }[];
}

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const NO_VALUE = '-';
const PREVIEW_CHARS = 60;
const WHITESPACE = /\s+/g;
const MAX_REASONS_SHOWN = 2;

const STAGE_NAMES: Record<Stage, string> = {
  intake: 'Intake',
  privacy: 'Privacy',
  classify: 'Classify',
  guardrails: 'Guardrails',
  review: 'Review',
  done: 'Done',
};

const TAG_VIEWS: Record<Priority, TagView> = {
  Urgent: { word: 'Critical', level: 'critical' },
  High: { word: 'High', level: 'high' },
  Medium: { word: 'Medium', level: 'medium' },
  Low: { word: 'Low', level: 'low' },
};

// Each row names its stage for what it is: the checks are rules, the Classify step is the trained model.
const LINE_LABELS: Record<'privacy' | 'classify' | 'guardrails', string> = {
  privacy: 'Privacy (rules)',
  classify: 'Classify (trained model)',
  guardrails: 'Guardrails (rules)',
};

// The stages that write a line in the center; Intake only shows the ticket arriving.
const LINE_STAGES = ['privacy', 'classify', 'guardrails'] as const;
type LineStage = (typeof LINE_STAGES)[number];

const stageIndex = (stage: Stage): number => STAGES.indexOf(stage);
const percent = (share: number): string => `${Math.round(share * PERCENT)}%`;
const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const tagView = (priority: Priority): TagView => ({ ...TAG_VIEWS[priority] });

// The team the model's category sends the ticket to. It reads the category only: the trail's
// final answer or review may hold the simulated reviewer's, which must not show while a ticket is open.
function teamOf(trail: TicketTrail): string {
  return ROUTES[trail.category.label as Category];
}

function viewerReviewed(state: RunState, trail: TicketTrail): boolean {
  return state.viewerReviews.some((review) => review.id === trail.id);
}

function pillFor(state: RunState, trail: TicketTrail, truth: TicketLabel): { kind: PillKind; word: string } {
  if (viewerReviewed(state, trail)) {
    return { kind: 'you', word: 'You' };
  }
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

function segmentsOf(trail: TicketTrail, at: number): Segment[] {
  const kinds = markText(trail, at);
  const segments: Segment[] = [];
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

function whyFlagged(trail: TicketTrail): string {
  return trail.guard.reasons.slice(0, MAX_REASONS_SHOWN).map(reasonPhrase).join(', and ');
}

function lineText(trail: TicketTrail, stage: LineStage): string {
  switch (stage) {
    case 'privacy': {
      const masked = narrate(trail, 'privacy').detail.find((row) => row.label === 'Masked')?.value ?? 'nothing';
      return masked === 'nothing' ? 'nothing personal found.' : `masked ${masked}.`;
    }
    case 'classify':
      return (
        `${trail.category.label}, ${percent(trail.category.confidence)} sure. ` +
        `Priority ${trail.priority.label}, ${percent(trail.priority.confidence)} sure. ` +
        `Goes to ${teamOf(trail)}.`
      );
    case 'guardrails': {
      if (!trail.guard.flagged) {
        return trail.guard.clearedBySecondCheck ? 'not flagged. A second check cleared the low confidence.' : 'not flagged.';
      }
      const why = whyFlagged(trail);
      return why === '' ? 'flagged.' : `flagged. ${capitalised(why)}.`;
    }
  }
}

// The first stage whose result a "Why this choice" row tells.
function revealedAt(label: string): Stage {
  if (label === 'Masked') return 'privacy';
  if (label.startsWith('Flag')) return 'guardrails';
  return 'classify';
}

export function statsView(
  state: RunState,
  truthOf: (id: string) => TicketLabel,
): { label: string; value: string; alert: boolean }[] {
  const live = liveNumbers(state, truthOf);
  const pending = state.open.length + (state.reviewing === undefined ? 0 : 1);
  return [
    { label: 'Tickets done', value: String(live.done), alert: false },
    { label: 'Flagged for a person', value: live.flaggedShare === null ? NO_VALUE : percent(live.flaggedShare), alert: false },
    { label: 'Pending review', value: String(pending), alert: false },
    { label: 'High-risk missed', value: String(live.highRiskMissed), alert: live.highRiskMissed > 0 },
  ];
}

export function moreNumbersView(
  state: RunState,
  truthOf: (id: string) => TicketLabel,
): { rows: { label: string; value: string }[]; assumptions: string[] } {
  const live = liveNumbers(state, truthOf);
  const share = (value: number | null): string => (value === null ? NO_VALUE : percent(value));
  const perSecond = realSpeedView(state)?.perSecond ?? null;
  const { correct, total } = live.viewerCorrect;
  return {
    rows: [
      { label: 'Accuracy so far', value: share(live.modelAccuracy) },
      { label: 'v0 on the same tickets', value: share(live.v0Accuracy) },
      { label: 'Reviewer overrides', value: String(live.overrides) },
      { label: 'Tickets per second', value: perSecond === null ? NO_VALUE : perSecond.toFixed(1) },
      { label: 'Your reviews correct', value: total === 0 ? NO_VALUE : `${correct} of ${total}` },
    ],
    assumptions: [
      `Assumed arrivals: ${ACT2_TICKETS_PER_DAY} tickets per business day`,
      `Assumed: the simulated reviewer closes one ticket every ${CLOSE_EVERY_MS / MS_PER_SECOND} seconds`,
    ],
  };
}

export function incomingView(state: RunState): { id: string; preview: string; tag: TagView | null }[] {
  return state.incoming.map((waiting) => ({
    id: waiting.id,
    preview: waiting.maskedText.replace(WHITESPACE, ' ').slice(0, PREVIEW_CHARS),
    tag: waiting.tag === undefined ? null : tagView(waiting.tag.priority),
  }));
}

export function centerView(state: RunState): CenterView | undefined {
  const { current } = state;
  if (current === undefined) {
    return undefined;
  }
  const { trail, stage } = current;
  const at = stageIndex(stage);
  return {
    id: trail.id,
    tag: current.tag === undefined ? null : tagView(current.tag.priority),
    stageName: STAGE_NAMES[stage],
    steps: STAGES.map((name, i) => ({
      name: STAGE_NAMES[name],
      status: i < at ? 'done' : i === at ? 'now' : 'pending',
    })),
    segments: segmentsOf(trail, at),
    lines: LINE_STAGES.map((line) => ({
      label: LINE_LABELS[line],
      text: stageIndex(line) <= at ? lineText(trail, line) : null,
    })),
    plain: narrate(trail, stage).plain,
    why: narrate(trail, stage).detail.filter((row) => stageIndex(revealedAt(row.label)) <= at),
  };
}

export function outgoingView(
  state: RunState,
  truthOf: (id: string) => TicketLabel,
): {
  open: { id: string; category: string; tag: TagView; team: string; why: string }[];
  closed: { id: string; category: string; pill: { kind: PillKind; word: string } }[];
} {
  return {
    open: state.open.map((trail) => ({
      id: trail.id,
      category: trail.category.label,
      tag: tagView(trail.guard.priority),
      team: teamOf(trail),
      why: whyFlagged(trail),
    })),
    closed: [...state.done].reverse().map((trail) => ({
      id: trail.id,
      category: trail.final.category,
      pill: pillFor(state, trail, truthOf(trail.id)),
    })),
  };
}

export function controlsView(
  state: RunState,
  total: number,
): { playLabel: 'Play' | 'Pause'; playDisabled: boolean; stepDisabled: boolean; realSpeedLabel: string | null } {
  const blocked = state.act === 'complete' || state.reviewing !== undefined;
  const left = total - state.done.length;
  return {
    playLabel: state.playing ? 'Pause' : 'Play',
    playDisabled: blocked,
    stepDisabled: blocked || state.playing,
    realSpeedLabel: blocked ? null : `Run the last ${left === 1 ? 'ticket' : `${left} tickets`} at real speed`,
  };
}

export function statusView(state: RunState): string {
  if (state.act === 'complete') return 'Run complete';
  if (!state.playing) return 'Paused';
  return state.act === 1 ? 'Learning pace' : 'Busy day';
}

export function explainMode(state: RunState): 'offered' | 'off' {
  return state.act === 1 || !state.playing ? 'offered' : 'off';
}

// A zero reading (a coarse browser timer) gives no rate rather than Infinity.
export function realSpeedView(state: RunState): { tickets: number; ms: number; perSecond: number | null } | undefined {
  const { realSpeed } = state;
  if (realSpeed === undefined) {
    return undefined;
  }
  return {
    ...realSpeed,
    perSecond: realSpeed.ms > 0 ? (realSpeed.tickets / realSpeed.ms) * MS_PER_SECOND : null,
  };
}

export function reviewView(state: RunState):
  | { id: string; segments: Segment[]; why: string; category: Category; priority: Priority; route: string }
  | undefined {
  const { reviewing } = state;
  if (reviewing === undefined) {
    return undefined;
  }
  const category = reviewing.category.label as Category;
  return {
    id: reviewing.id,
    segments: segmentsOf(reviewing, stageIndex('guardrails')),
    why: `${whyFlagged(reviewing)}.`,
    category,
    priority: reviewing.guard.priority,
    route: ROUTES[category],
  };
}
