import { describe, expect, it } from 'vitest';
import { ROUTES, type TicketLabel } from '../domain/labels';
import type { TicketTrail } from '../pipeline/types';
import { CLOSE_EVERY_MS, type CenterStage, type RunState } from '../run/engine';
import {
  centerView,
  controlsView,
  explainMode,
  idleText,
  moreNumbersView,
  realSpeedView,
  statsView,
  statusView,
} from './view';
import {
  CAPTIONS_TEXT,
  RULE_CAPTIONS,
  TOTAL,
  atStage,
  finishedRun,
  makeRun,
  missedTruth,
  must,
  noTruth,
  stepUntil,
  trailOf,
  withState,
} from './viewTestKit';

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
      ["Model's category right so far (closed tickets)", '-'],
      ['Old keyword rules (v0), same tickets', '-'],
      ['Simulated reviewer overrides', '0'],
      ['Tickets per second', '-'],
      ['Your reviews correct', '-'],
    ]);
    expect(view.assumptions).toEqual([
      'Assumed arrivals: 100 tickets in a business day shown as 90 seconds',
      `Assumed: the simulated reviewer closes one ticket every ${CLOSE_EVERY_MS / 1000} seconds`,
      'Assumed: the simulated reviewer is wrong 5% of the time',
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
    expect(value(state, "Model's category right so far (closed tickets)", run.truthOf)).toBe(
      `${Math.round((right / TOTAL) * 100)}%`,
    );
    expect(value(state, 'Simulated reviewer overrides', run.truthOf)).toBe(String(overrides));
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

  describe('the step after Guardrails', () => {
    const stepsAt = (trail: TicketTrail, stage: CenterStage) =>
      must(centerView(withState({ current: { trail, stage, deep: true } }))).steps;
    const flagged = trailOf({ reasons: [RULE_CAPTIONS], flagged: true });
    const passed = trailOf({ flagged: false });

    it('is marked next, with its words, when Guardrails is reached and a person will look', () => {
      expect(stepsAt(flagged, 'guardrails')).toEqual([
        { name: 'Intake', status: 'done' },
        { name: 'Privacy', status: 'done' },
        { name: 'Classify', status: 'done' },
        { name: 'Guardrails', status: 'now' },
        { name: 'Next: Review by a person', status: 'next' },
        { name: 'Done', status: 'pending' },
      ]);
    });

    it('is Done, with its words, when no person is needed', () => {
      const steps = stepsAt(passed, 'guardrails');
      expect(steps.slice(3)).toEqual([
        { name: 'Guardrails', status: 'now' },
        { name: 'Review', status: 'pending' },
        { name: 'Next: Done, no review needed', status: 'next' },
      ]);
    });

    it('is not marked at any earlier stage', () => {
      for (const stage of ['intake', 'privacy', 'classify'] as const) {
        expect(stepsAt(flagged, stage).filter((step) => step.status === 'next')).toEqual([]);
      }
    });

    // The simulated reviewer's answer stays hidden until the ticket is closed.
    it('says nothing of what the reviewer will decide', () => {
      const answered: TicketTrail = {
        ...flagged,
        review: { category: 'Security Concern', priority: 'Urgent', route: ROUTES['Security Concern'] },
      };
      expect(JSON.stringify(stepsAt(answered, 'guardrails'))).toBe(JSON.stringify(stepsAt(flagged, 'guardrails')));
    });
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

  it('says in the Privacy row what was masked, or which four kinds were looked for and not found', () => {
    const privacy = (found: TicketTrail['found']) =>
      must(centerView(withState({ current: { trail: trailOf({ found }), stage: 'privacy', deep: true } }))).lines[0]?.text;
    expect(privacy([])).toBe('no email, phone, order or card number found.');
    expect(privacy(['phone', 'phone', 'card'])).toBe('masked 2 phone numbers, 1 card number.');
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
    expect(must(centerView(tagged)).tag).toEqual({ word: 'Low', level: 'low', text: 'First guess: Low' });
  });

  it('calls the pre-screener tag a first guess, in the same priority words as every other tag', () => {
    const tagged = withState({
      current: { trail: trailOf(), stage: 'intake', tag: { priority: 'Urgent', critical: true }, deep: true },
    });
    expect(must(centerView(tagged)).tag).toEqual({ word: 'Critical', level: 'critical', text: 'First guess: Critical' });
  });

  it('says Critical, not Urgent, for the model priority in the Classify row', () => {
    const trail = trailOf({ priority: 'Urgent' });
    const view = must(centerView(withState({ current: { trail, stage: 'classify', deep: true } })));
    expect(view.lines[1]?.text).toContain('Priority Critical, 85% sure.');
    expect(view.lines[1]?.text).not.toContain('Urgent');
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

  // A viewer who watched the whole day can still see the software's speed: the one button left is the
  // timing pass alone, until it has been run.
  it('stops them once the run is complete, and offers only the timing pass', () => {
    expect(controlsView(finishedRun().state(), TOTAL)).toEqual({
      playLabel: 'Play',
      playDisabled: true,
      stepDisabled: true,
      realSpeedLabel: 'See how fast this runs at real speed',
    });
  });

  it('offers nothing more once the timing pass has been run', () => {
    const run = finishedRun();
    run.finishNow();
    expect(controlsView(run.state(), TOTAL).realSpeedLabel).toBeNull();
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

describe('the line shown when no ticket is in the center', () => {
  const fresh = makeRun().state();

  it('asks for Play when paused, and says it is waiting when playing between tickets', () => {
    expect(idleText(fresh, TOTAL)).toBe('Press Play to see the next ticket.');
    expect(idleText({ ...fresh, playing: true }, TOTAL)).toBe('Waiting for the next ticket');
  });

  it('says no more tickets are coming once every one has arrived and the reviewer has the rest', () => {
    const run = makeRun();
    const state = stepUntil(
      run,
      (s) => s.current === undefined && s.incoming.length === 0 && s.open.length > 0 && s.done.length + s.open.length === TOTAL,
    );
    const text = 'No more tickets coming. The reviewer is finishing the open ones.';
    expect(idleText({ ...state, playing: true }, TOTAL)).toBe(text);
    expect(idleText(state, TOTAL)).toBe(text);
  });

  it('keeps waiting while a ticket is still to arrive, even with an empty line and the reviewer busy', () => {
    const state = withState({ playing: true, incoming: [], current: undefined, open: [trailOf()], done: [] });
    expect(idleText(state, TOTAL)).toBe('Waiting for the next ticket');
  });

  it('says Run complete at the end', () => {
    expect(idleText(finishedRun().state(), TOTAL)).toBe('Run complete');
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
