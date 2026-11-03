import { describe, expect, it } from 'vitest';
import { ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import type { RunState } from '../run/engine';
import type { Stage } from '../run/stage';
import {
  controlsView,
  currentTicketView,
  feedView,
  narrationView,
  numbersView,
  stageRowView,
  statusView,
  takeOverDefaults,
} from './view';

const SEED = 1001;

interface TrailOpts {
  id?: string;
  text?: string;
  found?: TicketTrail['found'];
  model?: Category;
  modelPriority?: Priority;
  terms?: string[];
  reasons?: FlagReason[];
  flagged?: boolean;
  // The reviewer's category when the ticket was flagged and reviewed.
  reviewed?: Category;
  reviewedPriority?: Priority;
  ms?: number;
}

function trailOf(o: TrailOpts = {}): TicketTrail {
  const model = o.model ?? 'Billing';
  const flagged = o.flagged ?? o.reviewed !== undefined;
  const base: TicketTrail = {
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
    priority: { label: o.modelPriority ?? 'Medium', confidence: 0.85, probabilities: {}, topTerms: [] },
    guard: { flagged, reasons: o.reasons ?? [], priority: o.modelPriority ?? 'Medium', clearedBySecondCheck: false },
    final: { category: model, priority: o.modelPriority ?? 'Medium', route: ROUTES[model], by: 'model' },
    v0: { category: model, priority: 'Medium', mustReview: false },
    ms: o.ms ?? 0,
  };
  if (o.reviewed === undefined) {
    return base;
  }
  const decision = { category: o.reviewed, priority: o.reviewedPriority ?? base.guard.priority, route: ROUTES[o.reviewed] };
  return { ...base, review: decision, final: { ...decision, by: 'reviewer' } };
}

function stateOf(o: {
  done?: TicketTrail[];
  current?: { trail: TicketTrail; stage: Stage; waiting?: boolean };
  playing?: boolean;
  speed?: RunState['speed'];
  takeOver?: boolean;
  act?: RunState['act'];
  viewerReviews?: RunState['viewerReviews'];
}): RunState {
  const state: RunState = {
    seed: SEED,
    fold: 1,
    act: o.act ?? 1,
    speed: o.speed ?? 'learn',
    playing: o.playing ?? true,
    takeOver: o.takeOver ?? false,
    done: o.done ?? [],
    viewerReviews: o.viewerReviews ?? [],
    simTime: 0,
  };
  if (o.current !== undefined) {
    state.current = { trail: o.current.trail, stage: o.current.stage, waitingForViewer: o.current.waiting ?? false };
  }
  return state;
}

const NO_TRUTH = (): TicketLabel => ({ category: 'Billing', priority: 'Medium', mustReview: false });

const RULE_CAPTIONS: FlagReason = { kind: 'rule', reason: 'accessibility issue', words: ['captions'] };
const CAPTIONS_TEXT = 'The call has no captions so I cannot follow. Ring me on [PHONE_NUMBER] any weekday.';

describe('stage row', () => {
  const flagged = trailOf({ id: 'T-1001-1', model: 'Accessibility Support', reasons: [RULE_CAPTIONS], reviewed: 'Accessibility Support' });
  const plain = (n: number) => trailOf({ id: `T-1001-${n}` });

  it('counts the tickets that reached each stage and lights only the current one', () => {
    const state = stateOf({
      done: [plain(0), flagged, plain(2)],
      current: { trail: trailOf({ id: 'T-1001-3' }), stage: 'classify' },
    });
    const cells = stageRowView(state);
    expect(cells.map((cell) => [cell.title, cell.caption])).toEqual([
      ['1 Intake', '4 received'],
      ['2 Privacy', '4 masked'],
      ['3 Classify', '4 scored - now'],
      ['4 Guardrails', '1 flagged'],
      ['5 Review', '1 reviewed'],
      ['6 Done', '3 done'],
    ]);
    expect(cells.map((cell) => cell.lit)).toEqual([false, false, true, false, false, false]);
  });

  it('counts a ticket at Done once, because it is also the last entry of done', () => {
    const last = plain(2);
    const cells = stageRowView(stateOf({ done: [plain(0), last], current: { trail: last, stage: 'done' } }));
    expect(cells.map((cell) => cell.caption)).toEqual([
      '2 received',
      '2 masked',
      '2 scored',
      '0 flagged',
      '0 reviewed',
      '2 done - now',
    ]);
  });

  it('says paused here, in words, when the run is paused', () => {
    const cells = stageRowView(stateOf({ playing: false, current: { trail: plain(0), stage: 'privacy' } }));
    expect(cells[1]?.caption).toBe('1 masked - paused here');
  });

  it('names the viewer on the Review stage while the run waits for them', () => {
    const cells = stageRowView(
      stateOf({ takeOver: true, current: { trail: flagged, stage: 'review', waiting: true } }),
    );
    expect(cells[4]).toMatchObject({ title: '5 Review - you', caption: '1 reviewed - waiting for you', lit: true });
  });

  it('lights nothing once the run is complete', () => {
    const cells = stageRowView(stateOf({ act: 'complete', done: [plain(0)] }));
    expect(cells.some((cell) => cell.lit)).toBe(false);
  });
});

describe('ticket feed', () => {
  const MUST_REVIEW = (): TicketLabel => ({ category: 'Billing', priority: 'Medium', mustReview: true });

  it('shows the latest ticket first, with the one now in progress on top', () => {
    const rows = feedView(
      stateOf({
        done: [trailOf({ id: 'T-1001-0' }), trailOf({ id: 'T-1001-1' })],
        current: { trail: trailOf({ id: 'T-1001-2' }), stage: 'intake' },
      }),
      NO_TRUTH,
    );
    expect(rows.map((row) => row.id)).toEqual(['T-1001-2', 'T-1001-1', 'T-1001-0']);
    expect(rows[0]).toMatchObject({ text: 'T-1001-2', current: true, pill: { kind: 'working', word: 'In progress' } });
  });

  it('gives Auto, Flagged, Overridden and Missed their own pill words', () => {
    const auto = trailOf({ id: 'T-1001-0' });
    const kept = trailOf({ id: 'T-1001-1', model: 'Security Concern', reviewed: 'Security Concern', reviewedPriority: 'Urgent' });
    const changed = trailOf({ id: 'T-1001-2', model: 'Other', reviewed: 'Billing' });
    const missed = trailOf({ id: 'T-1001-3', model: 'Other' });
    const truth = (id: string): TicketLabel => (id === 'T-1001-3' ? MUST_REVIEW() : NO_TRUTH());
    const words = feedView(stateOf({ done: [auto, kept, changed, missed] }), truth).map((row) => [row.id, row.pill]);
    expect(words).toEqual([
      ['T-1001-3', { kind: 'missed', word: 'Missed' }],
      ['T-1001-2', { kind: 'overridden', word: 'Overridden' }],
      ['T-1001-1', { kind: 'flagged', word: 'Flagged' }],
      ['T-1001-0', { kind: 'auto', word: 'Auto' }],
    ]);
  });

  it('keeps every miss in the feed, however long the run has gone on', () => {
    const trails = Array.from({ length: 129 }, (_, i) => trailOf({ id: `T-1001-${i}` }));
    const truth = (id: string): TicketLabel => (id === 'T-1001-0' ? MUST_REVIEW() : NO_TRUTH());
    const rows = feedView(stateOf({ done: trails }), truth);
    expect(rows).toHaveLength(129);
    expect(rows.at(-1)?.pill.word).toBe('Missed');
  });

  it('flags the current ticket from the Guardrails stage on, and shows its category once classified', () => {
    const trail = trailOf({ id: 'T-1001-4', model: 'Accessibility Support', reasons: [RULE_CAPTIONS], flagged: true });
    const at = (stage: Stage) => feedView(stateOf({ current: { trail, stage } }), NO_TRUTH)[0];
    expect(at('classify')).toMatchObject({ text: 'T-1001-4 Accessibility Support', pill: { word: 'In progress' } });
    expect(at('guardrails')).toMatchObject({ pill: { kind: 'flagged', word: 'Flagged' } });
  });

  it('says a ticket waits for you, without a category, while the viewer reviews it', () => {
    const trail = trailOf({ id: 'T-1001-4', model: 'Accessibility Support', reasons: [RULE_CAPTIONS], flagged: true });
    const row = feedView(stateOf({ takeOver: true, current: { trail, stage: 'review', waiting: true } }), NO_TRUTH)[0];
    expect(row?.text).toBe('T-1001-4 waiting for you');
  });
});

describe('current ticket', () => {
  const trail = trailOf({
    text: CAPTIONS_TEXT,
    found: ['phone'],
    model: 'Accessibility Support',
    terms: ['so cannot', 'follow'],
    reasons: [RULE_CAPTIONS, { kind: 'category', category: 'Accessibility Support' }],
    flagged: true,
  });
  const at = (stage: Stage) => currentTicketView(stateOf({ current: { trail, stage } }));
  const kindsOf = (stage: Stage) =>
    at(stage)
      ?.segments.filter((segment) => segment.kind !== 'plain')
      .map((segment) => [segment.kind, segment.text]);

  it('marks word chips, the rule word and the mask token, and keeps the text whole', () => {
    expect(kindsOf('guardrails')).toEqual([
      ['rule', 'captions'],
      ['chip', 'so I cannot'],
      ['chip', 'follow'],
      ['mask', '[PHONE_NUMBER]'],
    ]);
    expect(at('guardrails')?.segments.map((segment) => segment.text).join('')).toBe(CAPTIONS_TEXT);
  });

  it('shows no word chips before Classify, no rule word before Guardrails', () => {
    expect(kindsOf('intake')).toEqual([]);
    expect(kindsOf('privacy')).toEqual([['mask', '[PHONE_NUMBER]']]);
    expect(kindsOf('classify')).toEqual([
      ['chip', 'so I cannot'],
      ['chip', 'follow'],
      ['mask', '[PHONE_NUMBER]'],
    ]);
  });

  it('keeps a mask token whole when a word pair runs into it', () => {
    const run = trailOf({ text: 'Ring me on [PHONE_NUMBER] now', found: ['phone'], terms: ['me on'] });
    const segments = currentTicketView(stateOf({ current: { trail: run, stage: 'classify' } }))?.segments;
    expect(segments?.filter((segment) => segment.kind !== 'plain')).toEqual([
      { kind: 'chip', text: 'me on' },
      { kind: 'mask', text: '[PHONE_NUMBER]' },
    ]);
  });

  it('gives a trail line to every stage but only fills in the stages reached', () => {
    const lines = at('classify')?.lines ?? [];
    expect(lines.map((line) => [line.label, line.status])).toEqual([
      ['Intake', 'done'],
      ['Privacy', 'done'],
      ['Classify', 'now'],
      ['Guardrails', 'pending'],
      ['Review', 'pending'],
      ['Done', 'pending'],
    ]);
    expect(lines.slice(0, 3).map((line) => line.text)).toEqual([
      'received.',
      'masked 1 phone number.',
      'Accessibility Support, 67% sure. Priority Medium, 85% sure.',
    ]);
    expect(lines.slice(3).map((line) => line.text)).toEqual([null, null, null]);
  });

  it('explains the flag in the Guardrails line', () => {
    expect(at('guardrails')?.lines[3]?.text).toBe(
      'flagged. A rule caught "captions", and Accessibility Support tickets always go to a person.',
    );
  });

  it('says who reviewed the ticket, and says you when the viewer did', () => {
    const reviewed = trailOf({ id: 'T-1001-6', model: 'Other', reviewed: 'Billing', reviewedPriority: 'High', flagged: true });
    const line = (viewerReviews: RunState['viewerReviews']) =>
      currentTicketView(stateOf({ viewerReviews, current: { trail: reviewed, stage: 'review' } }))?.lines[4]?.text;
    expect(line([])).toBe('the simulated reviewer chose Billing, priority High.');
    expect(line([{ id: 'T-1001-6', correct: true }])).toBe('you chose Billing, priority High.');
  });

  it('says the review was not needed for a ticket that went straight to Done', () => {
    const view = currentTicketView(stateOf({ done: [trailOf()], current: { trail: trailOf(), stage: 'done' } }));
    expect(view?.lines[4]?.text).toBe('not needed.');
    expect(view?.lines[5]?.text).toBe('sent to Billing Team as Billing, priority Medium.');
  });

  it('has no current ticket once the run is complete', () => {
    expect(currentTicketView(stateOf({ act: 'complete' }))).toBeUndefined();
  });
});

describe('narration', () => {
  const flaggedTrail = trailOf({ id: 'T-1001-6', model: 'Other', reviewed: 'Billing', flagged: true });

  it('speaks for the current stage with the technical detail behind it', () => {
    const view = narrationView(stateOf({ current: { trail: trailOf(), stage: 'classify' } }));
    expect(view?.heading).toBe('What is happening - step 3 of 6, Classify');
    expect(view?.plain).toContain('The model reads the masked text');
    expect(view?.detail.map((row) => row.label)).toContain('Confidence floor');
  });

  it('names the viewer, not the simulated reviewer, at the review stage of a ticket they reviewed', () => {
    const view = narrationView(
      stateOf({ viewerReviews: [{ id: 'T-1001-6', correct: true }], current: { trail: flaggedTrail, stage: 'review' } }),
    );
    expect(view?.plain).toBe('You read the ticket and chose Billing with Medium priority.');
    const done = narrationView(
      stateOf({ viewerReviews: [{ id: 'T-1001-6', correct: true }], current: { trail: flaggedTrail, stage: 'done' } }),
    );
    expect(done?.plain).toBe('The ticket goes to Billing Team as Billing, priority Medium, decided by you.');
  });

  it('keeps naming the simulated reviewer when the viewer did not review the ticket', () => {
    const view = narrationView(stateOf({ current: { trail: flaggedTrail, stage: 'review' } }));
    expect(view?.plain).toContain('simulated reviewer');
  });

  it('tells the viewer the ticket waits for them instead of claiming no review was needed', () => {
    const waiting = { ...trailOf({ model: 'Other', flagged: true }) };
    const view = narrationView(stateOf({ takeOver: true, current: { trail: waiting, stage: 'review', waiting: true } }));
    expect(view?.plain).toBe('This ticket is waiting for you. Choose a category, priority and team, then confirm.');
  });
});

describe('live numbers', () => {
  const right = trailOf({ id: 'T-1001-0', ms: 500 });
  const wrong = { ...trailOf({ id: 'T-1001-1', model: 'Other', ms: 500 }), v0: { category: 'Other' as Category, priority: 'Medium' as Priority, mustReview: false } };
  const truth = (id: string): TicketLabel =>
    id === 'T-1001-1' ? { category: 'Billing', priority: 'Medium', mustReview: true } : NO_TRUTH();
  const value = (label: string, state: RunState) =>
    numbersView(state, truth).rows.find((row) => row.label === label)?.value;

  it('shows a dash for every number that has no value yet', () => {
    const view = numbersView(stateOf({}), truth);
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      ['Tickets done', '0'],
      ['Tickets per second', '-'],
      ['Accuracy so far', '-'],
      ['v0 on the same tickets', '-'],
      ['Flagged for a person', '-'],
      ['Reviewer overrides', '0'],
      ['High-risk tickets missed so far', '0'],
      ['Your reviews correct', '-'],
    ]);
  });

  it('shows the figures of the tickets done, a missed high-risk ticket among them', () => {
    const state = stateOf({ done: [right, wrong], speed: 'real' });
    expect(value('Tickets done', state)).toBe('2');
    expect(value('Tickets per second', state)).toBe('2.0');
    expect(value('Accuracy so far', state)).toBe('50%');
    expect(value('v0 on the same tickets', state)).toBe('50%');
    expect(value('Flagged for a person', state)).toBe('0%');
    expect(value('High-risk tickets missed so far', state)).toBe('1');
  });

  it('shows how many of the viewer reviews were right', () => {
    const state = stateOf({ done: [right], viewerReviews: [{ id: 'a', correct: true }, { id: 'b', correct: false }] });
    expect(value('Your reviews correct', state)).toBe('1 of 2');
  });

  it('shows the arrival assumption from Act 2 on, and not during Act 1', () => {
    expect(numbersView(stateOf({ act: 1 }), truth).assumption.shown).toBe(false);
    const act2 = numbersView(stateOf({ act: 2 }), truth).assumption;
    expect(act2).toEqual({ text: 'Assumed arrivals: 100 tickets per business day', shown: true });
    expect(numbersView(stateOf({ act: 'complete' }), truth).assumption.shown).toBe(true);
  });
});

describe('status line and controls', () => {
  const current = { trail: trailOf(), stage: 'intake' as Stage };

  it('says what the run is doing in words', () => {
    expect(statusView(stateOf({ current }))).toBe('Act 1 of 2 - learn speed');
    expect(statusView(stateOf({ current, speed: 'real', act: 2 }))).toBe('Act 2 of 2 - real speed');
    expect(statusView(stateOf({ current, playing: false }))).toBe('Paused');
    expect(statusView(stateOf({ current, takeOver: true }))).toBe(
      'You are the reviewer - the run waits on each flagged ticket',
    );
    expect(statusView(stateOf({ act: 'complete', playing: false }))).toBe('Run complete');
  });

  it('turns Play into Pause, and stops Play and Step while the viewer must answer or the run is over', () => {
    expect(controlsView(stateOf({ current, playing: false }))).toMatchObject({ playLabel: 'Play', playDisabled: false, stepDisabled: false });
    expect(controlsView(stateOf({ current }))).toMatchObject({ playLabel: 'Pause', playDisabled: false, stepDisabled: true });
    const waiting = stateOf({ takeOver: true, current: { ...current, stage: 'review', waiting: true } });
    expect(controlsView(waiting)).toMatchObject({ playDisabled: true, stepDisabled: true, takeOverLabel: 'Hand back to the reviewer', takeOverOn: true });
    expect(controlsView(stateOf({ act: 'complete', playing: false }))).toMatchObject({ playDisabled: true, stepDisabled: true, takeOverLabel: 'Take over' });
  });
});

describe('take over form defaults', () => {
  it('start from the model picks, with the team that follows the category and the reason for the flag', () => {
    const trail = trailOf({ model: 'Accessibility Support', modelPriority: 'High', reasons: [RULE_CAPTIONS], flagged: true });
    const defaults = takeOverDefaults(stateOf({ takeOver: true, current: { trail, stage: 'review', waiting: true } }));
    expect(defaults).toEqual({
      category: 'Accessibility Support',
      priority: 'High',
      route: 'Accessibility Team',
      why: 'a rule caught "captions".',
    });
  });

  it('are absent when no ticket waits for the viewer', () => {
    expect(takeOverDefaults(stateOf({ current: { trail: trailOf(), stage: 'review' } }))).toBeUndefined();
  });
});

describe('a ticket waiting for the viewer', () => {
  // The engine gives a waiting ticket no review; the Review line must say so in words, not "not needed".
  it('says Review is waiting for you, not that no review was needed', () => {
    const trail = trailOf({ model: 'Other', flagged: true });
    const view = currentTicketView(stateOf({ takeOver: true, current: { trail, stage: 'review', waiting: true } }));
    expect(view?.lines[4]).toMatchObject({ status: 'now', text: 'waiting for you.' });
  });
});
