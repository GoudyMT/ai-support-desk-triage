import { describe, expect, it } from 'vitest';
import { TOP_LINE_WORDS } from './copy';
import { paceSpeededUp, topLineView } from './view';
import { makeRun } from './viewTestKit';

// The line under the title says what the page is, except while the pace is the news: in See, a slowed-down run
// says so, and a run that has just gone to full speed says that for a few seconds.
describe('the line under the title', () => {
  it.each([
    // [view, playing, pace, busy day just started, what shows]
    ['learn', true, 'slow', false, 'purpose'],
    ['learn', true, 'fast', true, 'purpose'],
    ['see', false, 'slow', false, 'purpose'],
    ['see', true, 'slow', false, 'slow'],
    ['see', true, 'slow', true, 'slow'],
    ['see', true, 'fast', true, 'busy'],
    ['see', false, 'fast', true, 'busy'],
    ['see', true, 'fast', false, 'purpose'],
    ['see', false, 'fast', false, 'purpose'],
  ] as const)('%s, playing %s at the %s pace, busy day just started %s: %s', (view, playing, pace, busy, shows) => {
    expect(topLineView(view, { ...makeRun().state(), act: 2, playing, pace }, busy)).toBe(shows);
  });

  // "Busy-day speed" is only true once the run is on the busy day, which is Act 2.
  it('does not say busy-day speed is back while the run is still in Act 1', () => {
    expect(topLineView('see', { ...makeRun().state(), act: 1, playing: true, pace: 'fast' }, true)).toBe('purpose');
  });

  it('says the first few tickets are slowed down, and that busy-day speed is back', () => {
    expect(TOP_LINE_WORDS.slow).toBe('Slowed down for the first few tickets so you can follow along.');
    expect(TOP_LINE_WORDS.busy).toBe('Busy-day speed is back.');
  });

  it.each([
    [undefined, 'slow', false],
    [undefined, 'fast', false],
    ['slow', 'slow', false],
    ['slow', 'fast', true],
    ['fast', 'fast', false],
    ['fast', 'slow', false],
  ] as const)('a change from %s to %s starts the busy-day notice: %s', (before, after, starts) => {
    expect(paceSpeededUp(before, after)).toBe(starts);
  });
});
