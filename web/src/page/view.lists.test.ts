import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, ROUTES, type Category, type TicketLabel } from '../domain/labels';
import type { TicketTrail } from '../pipeline/types';
import { incomingView, moreNumbersView, outgoingView, reviewView } from './view';
import {
  CAPTIONS_TEXT,
  PREVIEW_CHARS,
  RULE_CAPTIONS,
  agreeingTruth,
  finishedRun,
  makeRun,
  missedTruth,
  must,
  noTruth,
  stepUntil,
  trailOf,
  withState,
  wrongTeamTruth,
} from './viewTestKit';

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

  // A rule can raise a ticket to Critical: the card has to show the priority the guardrails settled on.
  it('tags a card with the priority the guardrails settled on, not the one the model first picked', () => {
    const raised = trailOf({ priority: 'Low', reasons: [RULE_CAPTIONS] });
    raised.guard = { ...raised.guard, priority: 'Urgent' };
    expect(must(outgoingView(withState({ open: [raised] }), noTruth).open[0]).tag).toEqual({ word: 'Critical', level: 'critical' });
  });

  it('names at most two caught words and at most two reasons for a flag', () => {
    const rule = { kind: 'rule' as const, reason: 'accessibility issue' as const, words: ['captions', 'subtitles', 'transcript'] };
    const trail = trailOf({
      model: 'Billing',
      reasons: [rule, { kind: 'category', category: 'Billing' }, { kind: 'low confidence', confidence: 0.4 }],
    });
    expect(must(outgoingView(withState({ open: [trail] }), noTruth).open[0]).why).toBe(
      'a rule caught "captions" and "subtitles", and Billing tickets always go to a person',
    );
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

  it('gives Flagged, Overridden, Auto, Wrong team and Missed their own pill', () => {
    const run = finishedRun();
    const state = run.state();
    const pillOf = (id: string, truthOf: (id: string) => TicketLabel) =>
      outgoingView(state, truthOf).closed.find((row) => row.id === id)?.pill;
    const kept = must(state.done.find((t) => t.final.by === 'reviewer' && t.final.category === t.category.label));
    const changed = must(state.done.find((t) => t.final.by === 'reviewer' && t.final.category !== t.category.label));
    const passed = must(state.done.find((t) => !t.guard.flagged));
    const agree = agreeingTruth(state);
    expect(pillOf(kept.id, agree)).toEqual({ kind: 'flagged', word: 'Flagged' });
    expect(pillOf(changed.id, agree)).toEqual({ kind: 'overridden', word: 'Overridden' });
    expect(pillOf(passed.id, agree)).toEqual({ kind: 'auto', word: 'Auto' });
    // A ticket nobody checked that went to the wrong team says so; one that needed a person is Missed first.
    const wrong = wrongTeamTruth(state);
    expect(pillOf(wrong.id, wrong.truthOf)).toEqual({ kind: 'wrong', word: 'Wrong team' });
    const both = (id: string): TicketLabel => ({ ...wrong.truthOf(id), mustReview: id === wrong.id });
    expect(pillOf(wrong.id, both)).toEqual({ kind: 'missed', word: 'Missed' });
    expect(pillOf(passed.id, missedTruth(run).truthOf)).toEqual({ kind: 'missed', word: 'Missed' });
  });

  // A reviewed ticket was checked by a person, so a wrong team is not "nobody checked it".
  it('does not call a reviewed ticket Wrong team', () => {
    const run = finishedRun();
    const state = run.state();
    const wrongEverywhere = (id: string): TicketLabel => {
      const trail = must(state.done.find((t) => t.id === id));
      const other = must(CATEGORIES.find((category) => ROUTES[category] !== trail.final.route));
      return { category: other, priority: trail.final.priority, mustReview: false };
    };
    const kinds = new Set(outgoingView(state, wrongEverywhere).closed.map((row) => row.pill.kind));
    expect(kinds.has('wrong')).toBe(true);
    for (const row of outgoingView(state, wrongEverywhere).closed) {
      const trail = must(state.done.find((t) => t.id === row.id));
      if (trail.review !== undefined) expect(row.pill.kind).not.toBe('wrong');
    }
  });

  // Once the ticket is closed the truth is no secret, so the line says whether the viewer was right.
  it('reads You: right on a ticket the viewer reviewed and got right', () => {
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.length > 0);
    const id = must(open.open[0]).id;
    run.review(id);
    const truth = run.truthOf(id);
    run.confirm({ category: truth.category, priority: truth.priority, route: ROUTES[truth.category] });
    const state = run.state();
    const row = outgoingView(state, run.truthOf).closed.find((closed) => closed.id === id);
    expect(row).toEqual({ id, category: truth.category, pill: { kind: 'you', word: 'You: right' } });
    expect(moreNumbersView(state, run.truthOf).rows.find((r) => r.label === 'Your reviews correct')?.value).toBe(
      '1 of 1',
    );
  });

  it('reads You: wrong when the viewer picked the wrong priority', () => {
    const run = makeRun();
    const open = stepUntil(run, (s) => s.open.length > 0);
    const id = must(open.open[0]).id;
    run.review(id);
    const truth = run.truthOf(id);
    const wrong = must(PRIORITIES.find((priority) => priority !== truth.priority));
    run.confirm({ category: truth.category, priority: wrong, route: ROUTES[truth.category] });
    const row = outgoingView(run.state(), run.truthOf).closed.find((closed) => closed.id === id);
    expect(row?.pill).toEqual({ kind: 'you', word: 'You: wrong' });
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

  it('marks the words of the text being reviewed: model words, the rule word and the hidden detail', () => {
    const trail = trailOf({
      text: CAPTIONS_TEXT,
      found: ['phone'],
      model: 'Accessibility Support',
      terms: ['so cannot', 'follow'],
      reasons: [RULE_CAPTIONS],
    });
    const marked = must(reviewView(withState({ reviewing: trail }))).segments.filter((segment) => segment.kind !== 'plain');
    expect(marked.map((segment) => [segment.kind, segment.text])).toEqual([
      ['rule', 'captions'],
      ['chip', 'so I cannot'],
      ['chip', 'follow'],
      ['mask', '[PHONE_NUMBER]'],
    ]);
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
