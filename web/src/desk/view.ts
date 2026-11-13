// What the operator desk shows, worked out from the run's state. Pure: no DOM, so a test reads it directly and
// the page only draws. The engine hides the simulated reviewer's answer on every open card, and nothing here
// puts it back.
import type { Category, Priority, TicketLabel } from '../domain/labels';
import { computeMetrics } from '../pipeline/metrics';
import type { TicketTrail } from '../pipeline/types';
import { tagView, teamOf, whyFlagged, type TagView } from '../page/view';
import type { RunState } from '../run/engine';
import { canQuickApprove, surePercent } from '../run/engineParts';
import { liveNumbers } from '../run/liveNumbers';
import { valueSaved } from '../run/valueSaved';

export interface DeskCard {
  id: string;
  team: string;
  tag: TagView;
  text: string;
  why: string;
  percent: number;
  leaning: string;
  showApprove: boolean;
}

export interface SentRow {
  id: string;
  team: string;
  how: string;
  // The team the card showed, when the ticket went to another one; otherwise nothing.
  was: string | undefined;
  text: string;
}

export interface DeskNumbers {
  closed: number;
  total: number;
  waiting: number;
  highRiskMissed: number;
  rightNoPerson: number;
  reviewerChanged: number;
}

// The demo's reason is a phrase inside a longer line; on a card, and in Try a ticket, it stands alone.
export function sentence(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

const MODELS_DIFFER = 'The two models gave different answers.';

// On a two-model run, whether the sentence model's suggestion differs from the word model's answer.
export function modelsDiffer(trail: TicketTrail): boolean {
  const models = trail.models;
  return models !== undefined && (models.word.category !== models.sentence.category || models.word.priority !== models.sentence.priority);
}

// Why the ticket came to a person: the gate's reasons, then the models' disagreement, which may be the only reason.
export function deskWhy(trail: TicketTrail): string {
  const reasons = whyFlagged(trail);
  const differ = modelsDiffer(trail) ? MODELS_DIFFER : '';
  return [reasons === '' ? '' : sentence(reasons), differ].filter((part) => part !== '').join(' ');
}

// The open list is already ordered by severity and then oldest first. A suggestion the models disagree on carries no
// "sure" percent and no quick approve: a person reads it.
export function deskCards(state: RunState): DeskCard[] {
  return state.open.map((trail) => {
    const team = teamOf(trail);
    const percent = surePercent(trail);
    const differ = modelsDiffer(trail);
    return {
      id: trail.id,
      team,
      tag: tagView(trail.guard.priority),
      text: trail.maskedText,
      why: deskWhy(trail),
      percent,
      leaning: differ ? `Leaning ${team}.` : `Leaning ${team}, ${percent}% sure.`,
      showApprove: !differ && canQuickApprove(trail),
    };
  });
}

function howClosed(state: RunState, trail: TicketTrail): string {
  const yours = state.viewerReviews.find((review) => review.id === trail.id);
  if (yours !== undefined) {
    return yours.quick ? 'You approved' : 'You reviewed';
  }
  if (!trail.guard.flagged) {
    return 'No person needed';
  }
  return trail.final.category === trail.category.label ? 'Reviewer checked' : 'Reviewer changed it';
}

// The team is where the ticket was sent, which is the reviewer's choice when they changed it.
export function sentRows(state: RunState): SentRow[] {
  return [...state.done].reverse().map((trail) => ({
    id: trail.id,
    team: trail.final.route,
    how: howClosed(state, trail),
    was: trail.final.route === teamOf(trail) ? undefined : teamOf(trail),
    text: trail.maskedText,
  }));
}

export interface DeskReview {
  id: string;
  text: string;
  why: string;
  tag: TagView;
  category: Category;
  priority: Priority;
  route: string;
  // On a two-model run, each model's own answer, as "Show both models' answers" lists them.
  models?: { word: string; sentence: string };
}

const answerText = (answer: { category: Category; priority: Priority }): string => `${answer.category}, ${tagView(answer.priority).word}`;

// The ticket the viewer has open, with the model's picks the card starts from.
export function deskReview(state: RunState): DeskReview | undefined {
  const trail = state.reviewing;
  if (trail === undefined) return undefined;
  const review: DeskReview = {
    id: trail.id,
    text: trail.maskedText,
    why: deskWhy(trail),
    tag: tagView(trail.guard.priority),
    category: trail.category.label as Category,
    priority: trail.guard.priority,
    route: teamOf(trail),
  };
  if (trail.models !== undefined) {
    review.models = { word: answerText(trail.models.word), sentence: answerText(trail.models.sentence) };
  }
  return review;
}

// What the viewer is told right after sending: the call is scored on category and priority, as the report is.
export function resultLine(sent: { category: Category; priority: Priority }, truth: TicketLabel): string {
  if (sent.category === truth.category && sent.priority === truth.priority) {
    return 'Your call matched the true answer.';
  }
  return `The true answer was ${truth.category}, ${tagView(truth.priority).word}.`;
}

// A share as the page prints it: a whole percent.
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

export const msText = (ms: number): string => `${ms.toFixed(1)} ms`;

export const flaggedCount = (done: readonly TicketTrail[]): number => done.filter((trail) => trail.guard.flagged).length;

// How many closed tickets went to a person, with their share: `119 (92%)`.
export const sentText = (flagged: number, share: number): string => `${flagged} (${percent(share)})`;

export interface MoreNumbers {
  sent: string;
  ms: string;
}

// The side panel's extra rows, from the same closed tickets the report reads, so the two cannot disagree.
export function moreNumbers(state: RunState, truthOf: (id: string) => TicketLabel): MoreNumbers {
  if (state.done.length === 0) return { sent: sentText(0, 0), ms: msText(0) };
  const metrics = computeMetrics(state.done, truthOf);
  return { sent: sentText(flaggedCount(state.done), metrics.flagRate), ms: msText(metrics.msPerTicket) };
}

export function deskNumbers(state: RunState, total: number, truthOf: (id: string) => TicketLabel): DeskNumbers {
  const live = liveNumbers(state, truthOf);
  return {
    closed: state.done.length,
    total,
    waiting: state.open.length + (state.reviewing === undefined ? 0 : 1),
    highRiskMissed: live.highRiskMissed,
    rightNoPerson: valueSaved(state, truthOf).counted,
    reviewerChanged: live.overrides,
  };
}
