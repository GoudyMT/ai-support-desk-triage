import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { loadModel } from '../model/scorer';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import { CLOSE_EVERY_MS, createRun, type CenterStage, type Run, type RunState } from '../run/engine';
import type { Tag } from '../run/prescreen';
import {
  centerView,
  controlsView,
  explainMode,
  incomingView,
  moreNumbersView,
  outgoingView,
  realSpeedView,
  reviewView,
  statsView,
  statusView,
} from './view';

const SEED = 1001;
const TOTAL = 12;
const MAX_STEPS = 5000;
// Tickets arrive a quarter second apart from half a second in, so the line fills while the
// center is busy; the first six are Act 1.
const FIRST_ARRIVAL_S = 0.5;
const ARRIVAL_GAP_S = 0.25;
const ACT1_TICKETS = 6;
const PREVIEW_CHARS = 60;

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

function makeRun(): Run {
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

function stepUntil(run: Run, reached: (state: RunState) => boolean): RunState {
  for (let n = 0; !reached(run.state()); n += 1) {
    if (n > MAX_STEPS) throw new Error('test: the wanted state never came');
    run.step();
  }
  return run.state();
}

function finishedRun(): Run {
  const run = makeRun();
  stepUntil(run, (s) => s.act === 'complete');
  return run;
}

function atStage(stage: CenterStage): RunState {
  return stepUntil(makeRun(), (s) => s.current?.stage === stage);
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('test: a value that should exist is missing');
  return value;
}

const noTruth = (): TicketLabel => ({ category: 'Billing', priority: 'Medium', mustReview: false });

// A finished run's state with the truth saying one closed, unflagged ticket needed a person.
function missedTruth(run: Run): { id: string; truthOf: (id: string) => TicketLabel } {
  const id = must(run.state().done.find((trail) => !trail.guard.flagged)).id;
  return { id, truthOf: (other) => (other === id ? { ...noTruth(), mustReview: true } : noTruth()) };
}

const RULE_CAPTIONS: FlagReason = { kind: 'rule', reason: 'accessibility issue', words: ['captions'] };
const CAPTIONS_TEXT = 'The call has no captions so I cannot follow. Ring me on [PHONE_NUMBER] any weekday.';

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
function trailOf(o: TrailOpts = {}): TicketTrail {
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

function withState(patch: Partial<RunState>): RunState {
  return { ...makeRun().state(), ...patch };
}

describe('top stats', () => {
  it('starts at zero, with a dash where a share needs a ticket', () => {
    expect(statsView(makeRun().state(), noTruth)).toEqual([
      { label: 'Tickets done', value: '0', alert: false },
      { label: 'Flagged for a person', value: '-', alert: false },
      { label: 'Pending review', value: '0', alert: false },
      { label: 'High-risk missed', value: '0', alert: false },
    ]);
  });

  it('raises the alert only when a high-risk ticket was missed', () => {
    const run = finishedRun();
    const state = run.state();
    const clean = statsView(state, noTruth);
    expect(clean.map((row) => row.alert)).toEqual([false, false, false, false]);
    const missed = statsView(state, missedTruth(run).truthOf);
    expect(missed.find((row) => row.label === 'High-risk missed')).toEqual({
      label: 'High-risk missed',
      value: '1',
      alert: true,
    });
    const flagged = state.done.filter((trail) => trail.guard.flagged).length;
    expect(missed.map((row) => row.value).slice(0, 3)).toEqual([
      String(TOTAL),
      `${Math.round((flagged / TOTAL) * 100)}%`,
      '0',
    ]);
  });

  it('keeps counting a ticket as pending while the viewer has its form open', () => {
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.length > 0);
    const pendingBefore = statsView(open, noTruth)[2]?.value;
    run.review(must(open.open[0]).id);
    const reviewing = run.state();
    expect(reviewing.open).toHaveLength(open.open.length - 1);
    expect(pendingBefore).toBe(String(open.open.length));
    expect(statsView(reviewing, noTruth)[2]?.value).toBe(pendingBefore);
  });
});

describe('more numbers', () => {
  const value = (state: RunState, label: string, truthOf: (id: string) => TicketLabel = noTruth) =>
    moreNumbersView(state, truthOf).rows.find((row) => row.label === label)?.value;

  it('shows a dash for every number that has no value yet, and states both assumptions', () => {
    const view = moreNumbersView(makeRun().state(), noTruth);
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      ['Accuracy so far', '-'],
      ['v0 on the same tickets', '-'],
      ['Reviewer overrides', '0'],
      ['Tickets per second', '-'],
      ['Your reviews correct', '-'],
    ]);
    expect(view.assumptions).toEqual([
      'Assumed arrivals: 100 tickets per business day',
      `Assumed: the simulated reviewer closes one ticket every ${CLOSE_EVERY_MS / 1000} seconds`,
    ]);
  });

  it('shows the figures of the closed tickets once the run has gone on', () => {
    const run = finishedRun();
    const state = run.state();
    const right = state.done.filter((trail) => trail.category.label === run.truthOf(trail.id).category).length;
    const overrides = state.done.filter(
      (trail) => trail.final.by === 'reviewer' && trail.final.category !== trail.category.label,
    ).length;
    expect(overrides).toBeGreaterThan(0);
    expect(value(state, 'Accuracy so far', run.truthOf)).toBe(`${Math.round((right / TOTAL) * 100)}%`);
    expect(value(state, 'Reviewer overrides', run.truthOf)).toBe(String(overrides));
  });

  it('reads the real speed run as tickets per second, and a dash when its time was zero', () => {
    const state = makeRun().state();
    expect(value({ ...state, realSpeed: { tickets: 12, ms: 6 } }, 'Tickets per second')).toBe('2000.0');
    expect(value({ ...state, realSpeed: { tickets: 12, ms: 0 } }, 'Tickets per second')).toBe('-');
  });
});

describe('real speed result', () => {
  it('is absent until a real speed run was measured, then gives tickets, time and rate', () => {
    const state = makeRun().state();
    expect(realSpeedView(state)).toBeUndefined();
    expect(realSpeedView({ ...state, realSpeed: { tickets: 12, ms: 6 } })).toEqual({
      tickets: 12,
      ms: 6,
      perSecond: 2000,
    });
  });
});

describe('coming in', () => {
  it('lists the waiting tickets with their tag word, a Critical one first, an untagged one without', () => {
    const state = stepUntil(makeRun(), (s) => s.incoming.some((w) => w.tag?.critical === true));
    const view = incomingView(state);
    expect(view.map((row) => [row.id.slice(-1), row.tag?.word ?? null])).toEqual([
      ['3', 'Critical'],
      ['1', 'Medium'],
      ['2', 'High'],
      ['4', null],
    ]);
    expect(view[0]?.tag).toEqual({ word: 'Critical', level: 'critical' });
    expect(view[1]?.tag).toEqual({ word: 'Medium', level: 'medium' });
  });

  it('shows a one-line preview: whitespace collapsed, cut at 60 characters', () => {
    const state = withState({
      incoming: [
        { id: 'T-1', maskedText: `Hello   there\n\nfriend ${'x'.repeat(80)}` },
        { id: 'T-2', maskedText: 'Short   one' },
      ],
    });
    const [long, short] = incomingView(state);
    expect(long?.preview).toBe(`Hello there friend ${'x'.repeat(PREVIEW_CHARS - 'Hello there friend '.length)}`);
    expect(long?.preview).toHaveLength(PREVIEW_CHARS);
    expect(short?.preview).toBe('Short one');
  });
});

describe('the ticket being worked', () => {
  const reached = (view: NonNullable<ReturnType<typeof centerView>>) => view.lines.map((line) => line.text !== null);

  it('shows nothing of the result at Intake, and adds each row as its stage is reached', () => {
    const labels = (stage: CenterStage) => centerView(atStage(stage))?.why.map((row) => row.label) ?? [];
    expect(labels('intake')).toEqual([]);
    expect(labels('privacy')).toEqual(['Masked']);
    const classify = labels('classify');
    expect(classify).toEqual(expect.arrayContaining(['Confidence', 'Confidence floor', 'Masked']));
    expect(classify.some((label) => label.startsWith('Flag'))).toBe(false);
    expect(labels('guardrails').some((label) => label.startsWith('Flag'))).toBe(true);
  });

  it('lights the six steps up to the current stage and fills in only the lines reached', () => {
    const view = must(centerView(atStage('classify')));
    expect(view.stageName).toBe('Classify');
    expect(view.steps).toEqual([
      { name: 'Intake', status: 'done' },
      { name: 'Privacy', status: 'done' },
      { name: 'Classify', status: 'now' },
      { name: 'Guardrails', status: 'pending' },
      { name: 'Review', status: 'pending' },
      { name: 'Done', status: 'pending' },
    ]);
    // Each row names the stage for what it is: rules, a trained model, rules.
    expect(view.lines.map((line) => line.label)).toEqual([
      'Privacy (rules)',
      'Classify (trained model)',
      'Guardrails (rules)',
    ]);
    expect(reached(view)).toEqual([true, true, false]);
    expect(reached(must(centerView(atStage('intake'))))).toEqual([false, false, false]);
    expect(reached(must(centerView(atStage('privacy'))))).toEqual([true, false, false]);
    expect(reached(must(centerView(atStage('guardrails'))))).toEqual([true, true, true]);
  });

  it('holds no text from the trail in a row whose stage has not been reached', () => {
    const view = must(centerView(atStage('intake')));
    expect(view.lines).toEqual([
      { label: 'Privacy (rules)', text: null },
      { label: 'Classify (trained model)', text: null },
      { label: 'Guardrails (rules)', text: null },
    ]);
    // Nothing of the later results is anywhere in the rows, whatever the field is called.
    const trail = must(atStage('intake').current).trail;
    const rows = JSON.stringify(centerView(atStage('intake'))?.lines);
    expect(rows).not.toContain(trail.category.label);
    expect(rows).not.toContain('flagged');
    const guardrails = must(centerView(atStage('classify'))).lines[2];
    expect(guardrails).toEqual({ label: 'Guardrails (rules)', text: null });
  });

  it('gives one note on the highlighted words once Classify is reached, and none before', () => {
    const note = (stage: CenterStage) => centerView(atStage(stage))?.whyNote;
    expect(note('intake')).toBeNull();
    expect(note('privacy')).toBeNull();
    const text =
      'The highlighted words moved the model most. It counts words and does not read meaning, so small words can show up.';
    expect(note('classify')).toBe(text);
    expect(note('guardrails')).toBe(text);
  });

  it('ends the Classify line with the team the model category sends the ticket to', () => {
    const trail = trailOf({ model: 'Accessibility Support' });
    const view = must(centerView(withState({ current: { trail, stage: 'classify', deep: true } })));
    expect(view.lines[1]?.text).toMatch(/Priority Medium, 85% sure\. Goes to Accessibility Team\.$/);
    expect(ROUTES['Accessibility Support']).toBe('Accessibility Team');
  });

  it('explains the flag in the Guardrails line', () => {
    const trail = trailOf({
      model: 'Accessibility Support',
      reasons: [RULE_CAPTIONS, { kind: 'category', category: 'Accessibility Support' }],
    });
    const view = must(centerView(withState({ current: { trail, stage: 'guardrails', deep: true } })));
    expect(view.lines.at(-1)?.text).toBe(
      'flagged. A rule caught "captions", and Accessibility Support tickets always go to a person.',
    );
  });

  it('speaks for the stage it is at, in plain words', () => {
    expect(must(centerView(atStage('intake'))).plain).toContain('The ticket arrived');
    expect(must(centerView(atStage('classify'))).plain).toContain('The model reads the masked text');
  });

  describe('the plain sentence', () => {
    const trail = trailOf({ model: 'Accessibility Support', reasons: [RULE_CAPTIONS] });
    const sentence = (opts: { playing: boolean; act: 1 | 2; deep: boolean; stage: CenterStage }): string | null =>
      must(
        centerView(
          withState({ playing: opts.playing, act: opts.act, current: { trail, stage: opts.stage, deep: opts.deep } }),
        ),
      ).plain;
    const STAGES: CenterStage[] = ['intake', 'privacy', 'classify', 'guardrails'];

    it('is on every stage of a deep ticket at learn pace', () => {
      for (const stage of STAGES) expect(sentence({ playing: true, act: 1, deep: true, stage })).not.toBeNull();
    });

    it('is one sentence, when Guardrails is reached, for a later ticket at learn pace', () => {
      expect(STAGES.map((stage) => sentence({ playing: true, act: 1, deep: false, stage }) !== null)).toEqual([
        false,
        false,
        false,
        true,
      ]);
    });

    it('is absent on the busy day while playing, for any ticket and stage', () => {
      for (const deep of [true, false]) {
        for (const stage of STAGES) expect(sentence({ playing: true, act: 2, deep, stage })).toBeNull();
      }
    });

    it('is always there on Pause, for the stage the ticket is at', () => {
      for (const [act, deep] of [[1, false], [2, false], [2, true]] as const) {
        for (const stage of STAGES) {
          const plain = sentence({ playing: false, act, deep, stage });
          expect(plain).toBe(centerView(withState({ playing: false, act, current: { trail, stage, deep } }))?.plain);
          expect(plain).not.toBeNull();
        }
      }
      expect(sentence({ playing: false, act: 2, deep: false, stage: 'intake' })).toContain('The ticket arrived');
    });
  });

  it('carries the tag once the pre-screener has answered, and none before', () => {
    const run = makeRun();
    run.step();
    expect(must(centerView(run.state())).tag).toBeNull();
    const tagged = stepUntil(run, (s) => s.current?.tag !== undefined);
    expect(must(centerView(tagged)).tag).toEqual({ word: 'Low', level: 'low' });
  });

  it('has no ticket once the run is complete', () => {
    expect(centerView(finishedRun().state())).toBeUndefined();
  });

  describe('the text marks', () => {
    const trail = trailOf({
      text: CAPTIONS_TEXT,
      found: ['phone'],
      model: 'Accessibility Support',
      terms: ['so cannot', 'follow'],
      reasons: [RULE_CAPTIONS],
    });
    const at = (stage: CenterStage, shown = trail) => must(centerView(withState({ current: { trail: shown, stage, deep: true } })));
    const marked = (stage: CenterStage) =>
      at(stage)
        .segments.filter((segment) => segment.kind !== 'plain')
        .map((segment) => [segment.kind, segment.text]);

    it('marks word chips, the rule word and the mask token, and keeps the text whole', () => {
      expect(marked('guardrails')).toEqual([
        ['rule', 'captions'],
        ['chip', 'so I cannot'],
        ['chip', 'follow'],
        ['mask', '[PHONE_NUMBER]'],
      ]);
      expect(at('guardrails').segments.map((segment) => segment.text).join('')).toBe(CAPTIONS_TEXT);
    });

    it('shows no word chips before Classify, no rule word before Guardrails', () => {
      expect(marked('intake')).toEqual([]);
      expect(marked('privacy')).toEqual([['mask', '[PHONE_NUMBER]']]);
      expect(marked('classify')).toEqual([
        ['chip', 'so I cannot'],
        ['chip', 'follow'],
        ['mask', '[PHONE_NUMBER]'],
      ]);
    });

    it('keeps a mask token whole when a word pair runs into it', () => {
      const run = trailOf({ text: 'Ring me on [PHONE_NUMBER] now', found: ['phone'], terms: ['me on'] });
      expect(at('classify', run).segments.filter((segment) => segment.kind !== 'plain')).toEqual([
        { kind: 'chip', text: 'me on' },
        { kind: 'mask', text: '[PHONE_NUMBER]' },
      ]);
    });
  });
});

describe('going out', () => {
  it('lists open tickets in the order given, each with its priority tag and why it was flagged', () => {
    const urgent = trailOf({
      id: 'T-1001-8',
      model: 'Accessibility Support',
      priority: 'Urgent',
      reasons: [RULE_CAPTIONS, { kind: 'category', category: 'Accessibility Support' }],
    });
    const low = trailOf({ id: 'T-1001-9', model: 'Other', priority: 'Low', reasons: [{ kind: 'low confidence', confidence: 0.4 }] });
    expect(outgoingView(withState({ open: [urgent, low] }), noTruth).open).toEqual([
      {
        id: 'T-1001-8',
        category: 'Accessibility Support',
        tag: { word: 'Critical', level: 'critical' },
        team: ROUTES['Accessibility Support'],
        why: 'a rule caught "captions", and Accessibility Support tickets always go to a person',
      },
      {
        id: 'T-1001-9',
        category: 'Other',
        tag: { word: 'Low', level: 'low' },
        team: ROUTES.Other,
        why: 'the model is not sure enough',
      },
    ]);
  });

  it('names the team from the model category, never from an answer the trail carries', () => {
    const answered: TicketTrail = {
      ...trailOf({ model: 'Other', priority: 'Low', reasons: [{ kind: 'low confidence', confidence: 0.4 }] }),
      review: { category: 'Billing', priority: 'High', route: ROUTES.Billing },
      final: { category: 'Billing', priority: 'High', route: ROUTES.Billing, by: 'reviewer' },
    };
    expect(must(outgoingView(withState({ open: [answered] }), noTruth).open[0]).team).toBe(ROUTES.Other);
  });

  it('shows the model team, not the simulated reviewer team, on a ticket the reviewer will override', () => {
    const reference = finishedRun().state();
    const overridden = must(
      reference.done.find(
        (trail) =>
          trail.review !== undefined &&
          trail.review.category !== trail.category.label &&
          ROUTES[trail.review.category] !== ROUTES[trail.category.label as Category],
      ),
    );
    const open = stepUntil(makeRun(), (s) => s.open.some((trail) => trail.id === overridden.id));
    const card = must(outgoingView(open, noTruth).open.find((c) => c.id === overridden.id));
    expect(card.team).toBe(ROUTES[overridden.category.label as Category]);
    expect(card.team).not.toBe(overridden.review?.route);
  });

  it('lists closed tickets newest first', () => {
    const state = finishedRun().state();
    const ids = outgoingView(state, noTruth).closed.map((row) => row.id);
    expect(ids).toEqual(state.done.map((trail) => trail.id).reverse());
  });

  it('gives Flagged, Overridden, Auto and Missed their own pill', () => {
    const run = finishedRun();
    const state = run.state();
    const pillOf = (id: string, truthOf: (id: string) => TicketLabel) =>
      outgoingView(state, truthOf).closed.find((row) => row.id === id)?.pill;
    const kept = must(state.done.find((t) => t.final.by === 'reviewer' && t.final.category === t.category.label));
    const changed = must(state.done.find((t) => t.final.by === 'reviewer' && t.final.category !== t.category.label));
    const passed = must(state.done.find((t) => !t.guard.flagged));
    expect(pillOf(kept.id, noTruth)).toEqual({ kind: 'flagged', word: 'Flagged' });
    expect(pillOf(changed.id, noTruth)).toEqual({ kind: 'overridden', word: 'Overridden' });
    expect(pillOf(passed.id, noTruth)).toEqual({ kind: 'auto', word: 'Auto' });
    expect(pillOf(passed.id, missedTruth(run).truthOf)).toEqual({ kind: 'missed', word: 'Missed' });
  });

  it('reads You on a ticket the viewer reviewed', () => {
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.length > 0);
    const id = must(open.open[0]).id;
    run.review(id);
    const truth = run.truthOf(id);
    run.confirm({ category: truth.category, priority: truth.priority, route: ROUTES[truth.category] });
    const state = run.state();
    const row = outgoingView(state, run.truthOf).closed.find((closed) => closed.id === id);
    expect(row).toEqual({ id, category: truth.category, pill: { kind: 'you', word: 'You' } });
    expect(moreNumbersView(state, run.truthOf).rows.find((r) => r.label === 'Your reviews correct')?.value).toBe(
      '1 of 1',
    );
  });
});

describe('controls', () => {
  it('turns Play into Pause, and allows Step only while paused', () => {
    const paused = makeRun().state();
    expect(controlsView(paused, TOTAL)).toMatchObject({ playLabel: 'Play', playDisabled: false, stepDisabled: false });
    expect(controlsView({ ...paused, playing: true }, TOTAL)).toMatchObject({
      playLabel: 'Pause',
      playDisabled: false,
      stepDisabled: true,
    });
  });

  it('stops Play and Step and hides real speed while the review form is open', () => {
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.length > 0);
    run.review(must(open.open[0]).id);
    expect(controlsView(run.state(), TOTAL)).toEqual({
      playLabel: 'Play',
      playDisabled: true,
      stepDisabled: true,
      realSpeedLabel: null,
    });
  });

  it('stops them, and hides real speed, once the run is complete', () => {
    expect(controlsView(finishedRun().state(), TOTAL)).toEqual({
      playLabel: 'Play',
      playDisabled: true,
      stepDisabled: true,
      realSpeedLabel: null,
    });
  });

  it('counts the tickets not yet closed in the real speed label', () => {
    const run = makeRun();
    const fresh = run.state();
    expect(controlsView(fresh, TOTAL).realSpeedLabel).toBe(`Run the last ${TOTAL} tickets at real speed`);
    const some = stepUntil(run, (s) => s.done.length === 3);
    expect(controlsView(some, TOTAL).realSpeedLabel).toBe(`Run the last ${TOTAL - 3} tickets at real speed`);
  });

  // The button names one ticket as "the last ticket", never "the last 1 tickets".
  it('reads in the singular when one ticket is left', () => {
    const run = makeRun();
    const lastOne = stepUntil(run, (s) => s.done.length === TOTAL - 1);
    expect(controlsView(lastOne, TOTAL).realSpeedLabel).toBe('Run the last ticket at real speed');
  });
});

describe('status and the explanation', () => {
  const base = makeRun().state();

  it('names the pace: learning in Act 1, a busy day in Act 2, then paused or complete', () => {
    expect(statusView({ ...base, act: 1, playing: true })).toBe('Learning pace');
    expect(statusView({ ...base, act: 2, playing: true })).toBe('Busy day');
    expect(statusView({ ...base, act: 2, playing: false })).toBe('Paused');
    expect(statusView({ ...base, act: 'complete', playing: false })).toBe('Run complete');
  });

  it('offers the explanation in Act 1 and when paused, and turns it off on the busy day while playing', () => {
    expect(explainMode({ ...base, act: 1, playing: true })).toBe('offered');
    expect(explainMode({ ...base, act: 2, playing: true })).toBe('off');
    expect(explainMode({ ...base, act: 2, playing: false })).toBe('offered');
  });
});

describe('the review form', () => {
  it('is absent when no ticket is being reviewed', () => {
    expect(reviewView(makeRun().state())).toBeUndefined();
  });

  it('ignores a reviewer answer even if the trail carries one', () => {
    const answered: TicketTrail = {
      ...trailOf({ model: 'Other', priority: 'Low', reasons: [{ kind: 'low confidence', confidence: 0.4 }] }),
      review: { category: 'Billing', priority: 'High', route: ROUTES.Billing },
    };
    expect(reviewView(withState({ reviewing: answered }))).toMatchObject({
      category: 'Other',
      priority: 'Low',
      route: ROUTES.Other,
      why: 'the model is not sure enough.',
    });
  });

  it('says when a rule raised the priority above the model pick, and not otherwise', () => {
    const raised: TicketTrail = trailOf({ priority: 'Low', reasons: [RULE_CAPTIONS] });
    raised.guard = { ...raised.guard, priority: 'Urgent' };
    expect(reviewView(withState({ reviewing: raised }))).toMatchObject({ priority: 'Urgent', priorityRaised: true });
    const plain = trailOf({ priority: 'Medium', reasons: [{ kind: 'low confidence', confidence: 0.4 }] });
    expect(reviewView(withState({ reviewing: plain }))).toMatchObject({ priority: 'Medium', priorityRaised: false });
  });

  it('starts from the model picks and shows nothing of the simulated reviewer answer', () => {
    const reference = finishedRun().state();
    const overridden = must(
      reference.done.find((trail) => trail.review !== undefined && trail.review.category !== trail.category.label),
    );
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.some((trail) => trail.id === overridden.id));
    const flagged = must(open.open.find((trail) => trail.id === overridden.id));
    run.review(overridden.id);
    const view = must(reviewView(run.state()));
    const modelPick = flagged.category.label as Category;
    expect(view.id).toBe(overridden.id);
    expect(view.category).toBe(modelPick);
    expect(view.category).not.toBe(overridden.review?.category);
    expect(view.priority).toBe(flagged.guard.priority);
    expect(view.route).toBe(ROUTES[modelPick]);
    expect(view.why).toBe(`${outgoingView(open, noTruth).open.find((card) => card.id === overridden.id)?.why}.`);
    expect(view.segments.map((segment) => segment.text).join('')).toBe(flagged.maskedText);
  });
});
