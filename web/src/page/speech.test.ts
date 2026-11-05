import { describe, expect, it } from 'vitest';
import { createSpeech } from './speech';

// A stand-in for the live region that remembers every text it was given, so a repeat can be seen.
function fakeRegion(): { region: HTMLElement; spoken: string[]; now: () => string } {
  const spoken: string[] = [];
  let text = '';
  const region = {
    get textContent() {
      return text;
    },
    set textContent(value: string) {
      text = value;
      spoken.push(value);
    },
  } as unknown as HTMLElement;
  return { region, spoken, now: () => text };
}

const LEARNING = { act: 1, playing: true, offerSpeedUp: false, pace: 'slow' } as const;
const BUSY = { act: 2, playing: true, offerSpeedUp: false, pace: 'fast' } as const;
// Slowed down on the busy day: the next three tickets are narrated like the first three.
const SLOWED_BUSY = { act: 2, playing: true, offerSpeedUp: false, pace: 'slow' } as const;
const PAUSED_BUSY = { act: 2, playing: false, offerSpeedUp: false, pace: 'fast' } as const;
const COMPLETE = { act: 'complete', playing: false, offerSpeedUp: false, pace: 'fast' } as const;
// The run paused itself at the end of the slow part, with the viewer's choice to make.
const OFFER = { act: 1, playing: false, offerSpeedUp: true, pace: 'slow' } as const;
const OFFER_WORDS = 'That was the slow part. Press Speed up to see a busy day.';
const OFFER_BACK_WORDS = 'That was the slow part. Press Speed up to go back to full speed.';

describe('the live region', () => {
  it('says each sentence once, and again only when the sentence changes', () => {
    const { region, spoken } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('First.', LEARNING);
    speech.say('First.', LEARNING);
    speech.say('Second.', LEARNING);
    expect(spoken).toEqual(['First.', 'Second.']);
  });

  it('says the busy day has started, once, and no stage sentence on the busy day while playing', () => {
    const { region, spoken, now } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('Last sentence.', LEARNING);
    speech.say(null, BUSY);
    speech.say(null, BUSY);
    speech.say('A sentence the viewer cannot see.', BUSY);
    expect(spoken).toEqual(['Last sentence.', 'The busy day has started.']);
    expect(now()).toBe('The busy day has started.');
  });

  it('gives the current stage on Pause, and does not announce the busy day again on Play', () => {
    const { region, spoken, now } = fakeRegion();
    const speech = createSpeech(region);
    speech.say(null, BUSY);
    speech.say('Stage sentence.', PAUSED_BUSY);
    expect(now()).toBe('Stage sentence.');
    speech.say(null, BUSY);
    expect(now()).toBe('');
    expect(spoken.filter((text) => text === 'The busy day has started.')).toHaveLength(1);
  });

  // The run stops by itself, so a viewer who cannot see the bar needs telling that it is waiting for them.
  it('says the offer when the run pauses itself, and keeps it while the sentence is the same', () => {
    const { region, spoken, now } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('Guardrails sentence.', LEARNING);
    speech.say('Guardrails sentence.', OFFER);
    speech.say('Guardrails sentence.', OFFER);
    expect(spoken).toEqual(['Guardrails sentence.', OFFER_WORDS]);
    expect(now()).toBe(OFFER_WORDS);
  });

  it('gives the sentence back when a Step changes it, and says the offer again when it comes again', () => {
    const { region, spoken } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('One.', OFFER);
    speech.say('Two.', OFFER);
    speech.say('Three.', LEARNING);
    speech.say('Three.', OFFER);
    expect(spoken).toEqual([OFFER_WORDS, 'Two.', 'Three.', OFFER_WORDS]);
  });

  it('speaks the stage sentences of a slowed-down busy day, and the busy day notice only at full speed', () => {
    const { region, spoken } = fakeRegion();
    const speech = createSpeech(region);
    speech.say(null, BUSY);
    speech.say('Slow ticket, intake.', SLOWED_BUSY);
    speech.say('Slow ticket, privacy.', SLOWED_BUSY);
    expect(spoken).toEqual(['The busy day has started.', 'Slow ticket, intake.', 'Slow ticket, privacy.']);
  });

  it('says what Speed up does at the offer of a slowed-down busy day', () => {
    const { region, spoken } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('Last.', { ...OFFER, act: 2 });
    expect(spoken).toEqual([OFFER_BACK_WORDS]);
  });

  it('says Run complete once, and keeps it while nothing else is said', () => {
    const { region, spoken, now } = fakeRegion();
    const speech = createSpeech(region);
    speech.say('Last sentence.', BUSY);
    speech.say(null, COMPLETE);
    speech.say(null, COMPLETE);
    expect(spoken).toEqual(['The busy day has started.', 'Run complete.']);
    expect(now()).toBe('Run complete.');
  });

  it('says both again after a reset, for a new run', () => {
    const { region, spoken } = fakeRegion();
    const speech = createSpeech(region);
    speech.say(null, BUSY);
    speech.say(null, COMPLETE);
    speech.reset();
    speech.say(null, BUSY);
    speech.say(null, COMPLETE);
    expect(spoken).toEqual([
      'The busy day has started.',
      'Run complete.',
      '',
      'The busy day has started.',
      'Run complete.',
    ]);
  });
});
