import { PRIORITIES, ROUTES, type Category } from '../domain/labels';
import type { TicketTrail } from '../pipeline/types';
import { DEEP_STAGE_MS, QUICK_APPROVE_PERCENT, QUICK_STAGE_MS, type Waiting } from './engineTypes';
import type { Tag } from './prescreen';

// The shapes and small helpers the engine is built from, and the card numbers the desk reads too; the run's own state and calls are in engine.ts.

export type EventKind = 'close' | 'stage' | 'tag' | 'arrive';

// Events due at the same moment fire in this order: a ticket leaving the center or being
// closed frees room before a tag or an arrival is dealt with.
export const EVENT_ORDER: readonly EventKind[] = ['close', 'stage', 'tag', 'arrive'];

export interface Due {
  kind: EventKind;
  at: number;
}

// A ticket in the line; `text` is what the pipeline reads when it enters the center.
export interface Queued {
  index: number;
  text: string;
  waiting: Waiting;
}

// A ticket the pipeline has run, in the center or in the open list.
export interface Held {
  index: number;
  text: string;
  trail: TicketTrail;
}

export interface Center extends Held {
  stage: number;
  nextAt: number;
  // One of the first tickets to enter the center, which are given the slow pace.
  deep: boolean;
  tag?: Tag;
}

export interface PendingTag {
  at: number;
  id: string;
  maskedText: string;
}

export function compareOpen(a: Held, b: Held): number {
  const byPriority = PRIORITIES.indexOf(b.trail.guard.priority) - PRIORITIES.indexOf(a.trail.guard.priority);
  return byPriority !== 0 ? byPriority : a.index - b.index;
}

// While the viewer can see a ticket that is not closed, the trail shows what the model
// suggested, not what the simulated reviewer decided: seeing that answer first would make
// the viewer's score meaningless. The stored trail is untouched.
export function hideAnswer(trail: TicketTrail): TicketTrail {
  const shown: TicketTrail = { ...trail };
  delete shown.review;
  const category = shown.category.label as Category;
  shown.final = { category, priority: shown.guard.priority, route: ROUTES[category], by: 'model' };
  return shown;
}

const PERCENT = 100;

// The number a card prints as "N% sure"; the quick-approve cutoff reads this same rounded number.
export function surePercent(trail: TicketTrail): number {
  return Math.round(trail.category.confidence * PERCENT);
}

export function canQuickApprove(trail: TicketTrail): boolean {
  return surePercent(trail) >= QUICK_APPROVE_PERCENT;
}

export function stageMs(deep: boolean): number {
  return deep ? DEEP_STAGE_MS : QUICK_STAGE_MS;
}
