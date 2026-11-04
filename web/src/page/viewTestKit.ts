import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { loadModel } from '../model/scorer';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import { createRun, type CenterStage, type Run, type RunState } from '../run/engine';
import type { Tag } from '../run/prescreen';

// Helpers shared by the page view's test files.

const SEED = 1001;
export const TOTAL = 12;
const MAX_STEPS = 5000;
// Tickets arrive a quarter second apart from half a second in, so the line fills while the
// center is busy; the first six are Act 1.
const FIRST_ARRIVAL_S = 0.5;
const ARRIVAL_GAP_S = 0.25;
const ACT1_TICKETS = 6;
export const PREVIEW_CHARS = 60;

// The fold model seed 1001 runs on: the page loads exactly this file.
const MODEL = loadModel(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../public/models/fold_1.json', import.meta.url)), 'utf8')),
);

// The pre-screener's n-th call is for the n-th ticket to arrive: Low, Medium, High, Urgent, then again.
function cyclingPrescreen(): (maskedText: string) => Tag {
  let calls = 0;
  return () => {
    const priority = PRIORITIES[calls % PRIORITIES.length] ?? 'Low';
    calls += 1;
    return { priority, critical: priority === 'Urgent' };
  };
}

export function makeRun(): Run {
  return createRun({
    seed: SEED,
    model: MODEL,
    schedule: {
      total: TOTAL,
      act: (i) => (i < ACT1_TICKETS ? 1 : 2),
      arrivesAt: (i) => FIRST_ARRIVAL_S + i * ARRIVAL_GAP_S,
    },
    wallClock: () => 0,
    prescreen: cyclingPrescreen(),
  });
}

export function stepUntil(run: Run, reached: (state: RunState) => boolean): RunState {
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    run.step();
  }
  return run.state();
}

export function finishedRun(): Run {
  const run = makeRun();
  stepUntil(run, (s) => s.act === 'complete');
  return run;
}

export function atStage(stage: CenterStage): RunState {
  return stepUntil(makeRun(), (s) => s.current?.stage === stage);
}

export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('test: a value that should exist is missing');
  return value;
}

export const noTruth = (): TicketLabel => ({ category: 'Billing', priority: 'Medium', mustReview: false });

// A finished run's state with the truth saying one closed, unflagged ticket needed a person.
export function missedTruth(run: Run): { id: string; truthOf: (id: string) => TicketLabel } {
  const id = must(run.state().done.find((trail) => !trail.guard.flagged)).id;
  return { id, truthOf: (other) => (other === id ? { ...noTruth(), mustReview: true } : noTruth()) };
}

// A truth that agrees with where each closed ticket went: no ticket needed a person and none went to the wrong team.
export function agreeingTruth(state: RunState): (id: string) => TicketLabel {
  return (id) => {
    const trail = must(state.done.find((t) => t.id === id));
    return { category: trail.final.category, priority: trail.final.priority, mustReview: false };
  };
}

// The same, except that a ticket the system sent on unflagged really belonged to another team.
export function wrongTeamTruth(state: RunState): { id: string; truthOf: (id: string) => TicketLabel } {
  const sent = must(state.done.find((trail) => !trail.guard.flagged));
  const other = must(CATEGORIES.find((category) => ROUTES[category] !== sent.final.route));
  const agree = agreeingTruth(state);
  return { id: sent.id, truthOf: (id) => (id === sent.id ? { ...agree(id), category: other } : agree(id)) };
}

export const RULE_CAPTIONS: FlagReason = { kind: 'rule', reason: 'accessibility issue', words: ['captions'] };
export const CAPTIONS_TEXT = 'The call has no captions so I cannot follow. Ring me on [PHONE_NUMBER] any weekday.';

interface TrailOpts {
  id?: string;
  text?: string;
  found?: TicketTrail['found'];
  model?: Category;
  priority?: Priority;
  terms?: string[];
  reasons?: FlagReason[];
  flagged?: boolean;
}

// A trail written by hand for the cases a real run would not reach on demand.
export function trailOf(o: TrailOpts = {}): TicketTrail {
  const model = o.model ?? 'Billing';
  const priority = o.priority ?? 'Medium';
  return {
    id: o.id ?? 'T-1001-0',
    receivedAt: 0,
    maskedText: o.text ?? 'My invoice is wrong',
    found: o.found ?? [],
    category: {
      label: model,
      confidence: 0.67,
      probabilities: {},
      topTerms: (o.terms ?? []).map((term) => ({ term, weight: 0.4 })),
    },
    priority: { label: priority, confidence: 0.85, probabilities: {}, topTerms: [] },
    guard: { flagged: o.flagged ?? true, reasons: o.reasons ?? [], priority, clearedBySecondCheck: false },
    final: { category: model, priority, route: ROUTES[model], by: 'model' },
    v0: { category: model, priority: 'Medium', mustReview: false },
    ms: 0,
  };
}

export function withState(patch: Partial<RunState>): RunState {
  return { ...makeRun().state(), ...patch };
}
