import { describe, expect, it } from 'vitest';
import { ROUTES } from '../domain/labels';
import { minutesText } from '../run/valueSaved';
import { moreNumbersView } from './view';
import { finishedRun, makeRun, noTruth } from './viewTestKit';

describe('time saved and value saved in All numbers', () => {
  // The visitor reads these two as estimates, so each carries its source in the owner's words, and the
  // link sits inside the words it names, so the panel reads the same with or without the link.
  it('puts time saved and value saved first, each with its source', () => {
    const [time, value] = moreNumbersView(makeRun().state(), noTruth).rows;
    expect(time?.source).toEqual({
      text: 'Estimate, not a measurement. Each ticket the system sorted correctly with no review counts as 2 minutes saved. Vendors of IT desk tools put sorting one ticket at 3 to 12 minutes (Mizo, Giant Rocketship) and we found no independent study, so we use less than their lowest figure.',
      links: [
        { phrase: 'Mizo', href: 'https://mizo.tech/blog/ticket-triaging-practical-guide-msp/' },
        {
          phrase: 'Giant Rocketship',
          href: 'https://giantrocketship.com/blog/the-5-minute-ticket-why-your-triage-process-costs-more-than-you-think',
        },
      ],
    });
    expect(value?.source).toEqual({
      text: 'Estimate, not a measurement. Time saved x $21.53 an hour, the US median pay for customer service representatives (Bureau of Labor Statistics, May 2025). Benefits are not added, which keeps it low.',
      links: [
        {
          phrase: 'Bureau of Labor Statistics, May 2025',
          href: 'https://www.bls.gov/ooh/office-and-administrative-support/customer-service-representatives.htm',
        },
      ],
    });
    for (const source of [time?.source, value?.source]) {
      for (const link of source?.links ?? []) expect(source?.text).toContain(link.phrase);
    }
  });

  it('reads the saved numbers from the tickets sorted correctly with no review, as time and as dollars', () => {
    const run = finishedRun();
    const state = run.state();
    const sorted = state.done.filter((trail) => {
      const truth = run.truthOf(trail.id);
      return trail.review === undefined && !truth.mustReview && trail.final.route === ROUTES[truth.category];
    }).length;
    expect(sorted).toBeGreaterThan(0);
    const rows = moreNumbersView(state, run.truthOf).rows;
    expect(rows[0]?.value).toBe(minutesText(sorted * 2));
    expect(rows[1]?.value).toBe(`$${((sorted * 2 * 21.53) / 60).toFixed(2)}`);
  });
});
