import type { Category, Priority, TicketLabel } from '../domain/labels';
import type { Model } from '../model/scorer';
import type { TicketTrail } from '../pipeline/types';
import type { Schedule } from './clock';
import type { Tag } from './prescreen';

// What the engine's callers see: its state, its calls and its pacing constants. The engine itself is in engine.ts.

export interface Waiting {
  id: string;
  maskedText: string;
  tag?: Tag;
}

export type CenterStage = 'intake' | 'privacy' | 'classify' | 'guardrails';

// Where the viewer holds the run: no ticket enters the center ('line'), the center ticket does
// not leave a stage, or nothing is held.
export type Hold = 'line' | CenterStage | null;

export interface RunState {
  seed: number;
  fold: number;
  act: 1 | 2 | 'complete';
  playing: boolean;
  pace: 'slow' | 'fast';
  // The run paused itself at the end of the slow part and waits for Play or Speed up.
  offerSpeedUp: boolean;
  // Run time in ms: the time of the last event fired.
  simTime: number;
  incoming: Waiting[];
  // `deep`: one of the first tickets, which are narrated at every stage.
  current?: { trail: TicketTrail; stage: CenterStage; tag?: Tag; deep: boolean };
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
  hold(where: Hold): void;
  speedUp(): void;
  slowDown(): void;
  truthOf(id: string): TicketLabel;
  onChange(fn: () => void): () => void;
}

export interface RunOptions {
  seed: number;
  model: Model;
  schedule: Schedule;
  wallClock: () => number;
  prescreen: (maskedText: string) => Tag;
  // False only for the throwaway run that times a pass: it times nothing itself, which is
  // what stops a timing run from starting a timing run of its own.
  timed?: boolean;
}

// The first tickets stay in the center long enough to read the full narration of each stage;
// every other ticket takes about a second there.
export const DEEP_TICKETS = 3;
export const DEEP_STAGE_MS = 5000;
export const QUICK_STAGE_MS = 250;
// The pre-screener answers a little after the ticket arrives; nothing waits for it.
export const TAG_DELAY_MS = 400;
// The simulated reviewer closes one open ticket every 1.5 seconds of run time.
export const CLOSE_EVERY_MS = 1500;
