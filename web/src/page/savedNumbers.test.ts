import { describe, expect, it } from 'vitest';
import { minutesText } from '../run/valueSaved';
import { moreNumbersView } from './view';
import { finishedRun, makeRun, noTruth } from './viewTestKit';

describe('time saved and value saved in All numbers', () => {
  // The visitor reads these two as estimates, so each carries its source in the owner's words, and the
  // link sits inside the words it names, so the panel reads the same with or without the link.
  it('puts time saved and value saved first, each with its source', () => {
    const [time, value] = moreNumbersView(makeRun().state(), noTruth).rows;
    expect(time?.source).toEqual({
      text: 'Estimate, not a measurement. Each ticket no person touched counts as 2 minutes saved. Tool vendors publish 2 to 12 minutes for sorting one ticket and we found no independent study, so we use the low end.',
    });
    expect(value?.source).toEqual({
      text: 'Estimate, not a measurement. Time saved x $21.53 an hour, the US median pay for customer service representatives (Bureau of Labor Statistics, May 2025). Benefits are not added, which keeps it low.',
      link: {
        phrase: 'Bureau of Labor Statistics, May 2025',
        href: 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm',
      },
    });
    expect(value?.source?.text).toContain(value?.source?.link?.phrase ?? 'no link');
  });

  it('reads the saved numbers from the tickets no person touched, as time and as dollars', () => {
    const state = finishedRun().state();
    const untouched = state.done.filter((trail) => !trail.guard.flagged).length;
    expect(untouched).toBeGreaterThan(0);
    const rows = moreNumbersView(state, noTruth).rows;
    expect(rows[0]?.value).toBe(minutesText(untouched * 2));
    expect(rows[1]?.value).toBe(`$${((untouched * 2 * 21.53) / 60).toFixed(2)}`);
  });
});
