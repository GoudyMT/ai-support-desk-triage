import { describe, expect, it } from 'vitest';
import { makeDeskRun, stepToEnd } from '../run/engineTestKit';
import { HOURLY_PAY_USD, MINUTES_PER_TICKET, valueSaved } from '../run/valueSaved';
import { estimate, parseAssumption } from './panel';

describe('estimate', () => {
  it('gives the same minutes and dollars as the demo\'s value saved when the two starting values are used', () => {
    const run = makeDeskRun();
    stepToEnd(run);
    const state = run.state();
    const saved = valueSaved(state, (id) => run.truthOf(id));
    expect(saved.counted).toBeGreaterThan(0);
    expect(estimate(saved.counted, { minutes: MINUTES_PER_TICKET, pay: HOURLY_PAY_USD })).toEqual({
      minutes: saved.minutes,
      dollars: saved.dollars,
    });
  });

  it('follows the two values the viewer typed', () => {
    expect(estimate(10, { minutes: 3, pay: 30 })).toEqual({ minutes: 30, dollars: 15 });
    expect(estimate(10, { minutes: 0, pay: 30 })).toEqual({ minutes: 0, dollars: 0 });
  });

  it('does not print float noise for a fractional number of minutes', () => {
    expect(estimate(3, { minutes: 0.1, pay: 60 }).minutes).toBe(0.3);
  });
});

describe('parseAssumption', () => {
  it('takes a number of 0 or more, with spaces around it', () => {
    expect(parseAssumption('2', 5)).toEqual({ value: 2, message: '' });
    expect(parseAssumption(' 21.53 ', 5)).toEqual({ value: 21.53, message: '' });
    expect(parseAssumption('0', 5)).toEqual({ value: 0, message: '' });
  });

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['not a number', 'abc'],
    ['negative', '-1'],
    ['infinite', 'Infinity'],
  ])('keeps the last good value and says so for an input that is %s', (_name, raw) => {
    expect(parseAssumption(raw, 21.53)).toEqual({ value: 21.53, message: 'Kept 21.53. Enter a number of 0 or more.' });
  });
});
