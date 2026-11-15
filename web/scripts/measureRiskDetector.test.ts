import { describe, expect, it } from 'vitest';
import { bBreaches, chooseThreshold, type TuneRow } from './measureRiskDetector';
import type { SplitLines } from './measureSplit';

// The risk detector's cut-off is set on the tuning side before any judged ticket is read, and its result is held to
// the bar written in the design before any number: on every set, no line worse than the three-path desk, and fewer
// false marks.

const tune = (risky: boolean, flagged: boolean, doubt: boolean, p: number): TuneRow => ({ risky, flagged, doubt, p });

describe('chooseThreshold', () => {
  it('takes the highest cut-off at which the detector misses no more risky tuning tickets than the doubt did', () => {
    // Two risky tickets the rules miss: the doubt catches one, so the detector may miss one too.
    const rows = [tune(true, false, true, 0.3), tune(true, false, false, 0.6), tune(false, false, false, 0.9), tune(true, true, false, 0.01)];
    expect(chooseThreshold(rows)).toBe(0.6);
  });

  it('keeps the cut-off low enough to catch every risky ticket when the doubt caught them all', () => {
    const rows = [tune(true, false, true, 0.2), tune(true, false, true, 0.45), tune(false, false, false, 0.1)];
    expect(chooseThreshold(rows)).toBe(0.2);
  });
});

const LINES: SplitLines = {
  cards: 10, riskyMissed: 2, highOutLow: 0, uncheckedWrongDept: 1, uncheckedWrongPriority: 1, vagueDirect: 3,
  marked: 20, markedRisky: 10, falseMarks: 10, markedWrongTeam: 4, markedWrongTeamRisky: 2, markedWrongPriority: 5,
};

describe('bBreaches', () => {
  it('passes a detector with fewer false marks and no line worse', () => {
    expect(bBreaches(LINES, { ...LINES, falseMarks: 9, marked: 19 })).toEqual([]);
  });

  it('fails a detector with no fewer false marks', () => {
    expect(bBreaches(LINES, LINES)).toEqual(['falseMarks']);
  });

  // A detector that drops the vague tickets the doubt used to mark must not pass by marking less.
  it('fails a detector that sends more vague tickets to a team with no person', () => {
    expect(bBreaches(LINES, { ...LINES, falseMarks: 5, vagueDirect: 4 })).toEqual(['vagueDirect']);
  });

  it.each(['riskyMissed', 'highOutLow', 'markedWrongTeam', 'markedWrongTeamRisky'] as const)('fails a detector worse on %s', (line) => {
    expect(bBreaches(LINES, { ...LINES, falseMarks: 5, [line]: LINES[line] + 1 })).toEqual([line]);
  });

  it('holds unchecked wrong answers to the allowance, 0.25% of the set and at least 1', () => {
    const b = { ...LINES, falseMarks: 5, uncheckedWrongDept: 2 };
    expect(bBreaches(LINES, b, 400)).toEqual([]);
    expect(bBreaches(LINES, { ...b, uncheckedWrongDept: 3 }, 400)).toEqual(['uncheckedWrongDept']);
    expect(bBreaches(LINES, { ...b, uncheckedWrongDept: 3 }, 800)).toEqual([]);
    // 0.25% of 500 is 1.25: rounded down, the allowance is 1.
    expect(bBreaches(LINES, { ...b, uncheckedWrongDept: 3 }, 500)).toEqual(['uncheckedWrongDept']);
    expect(bBreaches(LINES, { ...b, uncheckedWrongDept: 1, uncheckedWrongPriority: 3 }, 400)).toEqual(['uncheckedWrongPriority']);
  });
});
