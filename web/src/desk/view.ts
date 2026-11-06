// What the operator desk shows, worked out from the run's state. Pure: no DOM, so a test reads it directly and
// the page only draws. The engine hides the simulated reviewer's answer on every open card, and nothing here
// puts it back.
import type { Category, Priority, TicketLabel } from '../domain/labels';
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
  showApprove: boolean;
}

export interface SentRow {
  id: string;
  team: string;
  how: string;
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

// The demo's reason is a phrase inside a longer line; on a card it stands alone.
function sentence(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

// The open list is already ordered by severity and then oldest first.
export function deskCards(state: RunState): DeskCard[] {
  return state.open.map((trail) => ({
    id: trail.id,
    team: teamOf(trail),
    tag: tagView(trail.guard.priority),
    text: trail.maskedText,
    why: sentence(whyFlagged(trail)),
    percent: surePercent(trail),
    showApprove: canQuickApprove(trail),
  }));
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
}

// The ticket the viewer has open, with the model's picks the card starts from.
export function deskReview(state: RunState): DeskReview | undefined {
  const trail = state.reviewing;
  if (trail === undefined) return undefined;
  return {
    id: trail.id,
    text: trail.maskedText,
    why: sentence(whyFlagged(trail)),
    tag: tagView(trail.guard.priority),
    category: trail.category.label as Category,
    priority: trail.guard.priority,
    route: teamOf(trail),
  };
}

// What the viewer is told right after sending: the call is scored on category and priority, as the report is.
export function resultLine(sent: { category: Category; priority: Priority }, truth: TicketLabel): string {
  if (sent.category === truth.category && sent.priority === truth.priority) {
    return 'Your call matched the true answer.';
  }
  return `The true answer was ${truth.category}, ${tagView(truth.priority).word}.`;
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
