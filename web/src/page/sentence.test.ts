import { describe, expect, it } from 'vitest';
import type { CenterStage, RunState } from '../run/engine';
import { createSentence } from './sentence';
import { centerView } from './view';
import { RULE_CAPTIONS, trailOf, withState } from './viewTestKit';

// A later learn-pace ticket is in the center for a quarter of a second per stage, so its one sentence
// (said at Guardrails) used to be gone before it could be read. It is held until the next one comes.
const FIVE = trailOf({ id: 'T-1003-5', model: 'Accessibility Support', reasons: [RULE_CAPTIONS] });
const SIX = trailOf({ id: 'T-1003-6', model: 'Accessibility Support', reasons: [RULE_CAPTIONS] });
const GUARDRAILS_FIVE = 'This ticket waits for a person because the accessibility issue safety rule matched "captions".';

function moment(parts: { stage?: CenterStage; ticket?: typeof FIVE; playing?: boolean; act?: 1 | 2 | 'complete' }): {
  state: RunState;
  view: ReturnType<typeof centerView>;
} {
  const { ticket, stage = 'intake', playing = true, act = 1 } = parts;
  const state = withState({
    playing,
    act,
    ...(ticket === undefined ? {} : { current: { trail: ticket, stage, deep: false } }),
  });
  return { state, view: centerView(state) };
}

function say(sentence: ReturnType<typeof createSentence>, parts: Parameters<typeof moment>[0]): string | null {
  const { state, view } = moment(parts);
  return sentence.next(state, view);
}

describe('the sentence of a later learn-pace ticket', () => {
  it('shows at Guardrails with no id, while its own ticket is in the center', () => {
    expect(say(createSentence(), { ticket: FIVE, stage: 'guardrails' })).toBe(GUARDRAILS_FIVE);
  });

  it('stays, with its ticket id in front, while the next ticket is worked and when the center is empty', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails' });
    for (const stage of ['intake', 'privacy', 'classify'] as const) {
      expect(say(sentence, { ticket: SIX, stage })).toBe(`T-1003-5: ${GUARDRAILS_FIVE}`);
    }
    expect(say(sentence, {})).toBe(`T-1003-5: ${GUARDRAILS_FIVE}`);
  });

  it('is replaced by the next ticket\'s sentence, with no id, once that ticket reaches Guardrails', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails' });
    say(sentence, { ticket: SIX, stage: 'intake' });
    expect(say(sentence, { ticket: SIX, stage: 'guardrails' })).toBe(GUARDRAILS_FIVE.replace('T-1003-5', 'T-1003-6'));
  });

  it('has no id when the held sentence is of the ticket still in the center', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails', playing: false });
    expect(say(sentence, { ticket: FIVE, stage: 'guardrails', playing: true })).toBe(GUARDRAILS_FIVE);
  });
});

describe('the other moments', () => {
  it('says nothing before any sentence has been shown', () => {
    expect(say(createSentence(), { ticket: SIX, stage: 'intake' })).toBeNull();
  });

  it('says nothing on the busy day while playing, and keeps nothing from before it', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails' });
    expect(say(sentence, { ticket: SIX, stage: 'guardrails', act: 2 })).toBeNull();
    expect(say(sentence, { ticket: SIX, stage: 'intake', act: 2 })).toBeNull();
    expect(say(sentence, { ticket: SIX, stage: 'intake', act: 1 })).toBeNull();
  });

  it('gives the current stage on Pause, on the busy day too', () => {
    const paused = say(createSentence(), { ticket: SIX, stage: 'classify', playing: false, act: 2 });
    expect(paused).toContain('After the privacy step, the model picks');
  });

  it('says nothing once the run is complete', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails' });
    expect(say(sentence, { act: 'complete', playing: false })).toBeNull();
  });

  it('forgets the held sentence on reset', () => {
    const sentence = createSentence();
    say(sentence, { ticket: FIVE, stage: 'guardrails' });
    sentence.reset();
    expect(say(sentence, { ticket: SIX, stage: 'intake' })).toBeNull();
    expect(say(sentence, {})).toBeNull();
  });
});
