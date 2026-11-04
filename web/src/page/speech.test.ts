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

const LEARNING = { act: 1, playing: true } as const;
const BUSY = { act: 2, playing: true } as const;
const PAUSED_BUSY = { act: 2, playing: false } as const;
const COMPLETE = { act: 'complete', playing: false } as const;

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
