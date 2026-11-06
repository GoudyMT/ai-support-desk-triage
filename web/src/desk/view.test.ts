import { describe, expect, it } from 'vitest';
import { liveNumbers } from '../run/liveNumbers';
import type { Run, RunState } from '../run/engine';
import { canQuickApprove, surePercent } from '../run/engineParts';
import { indexOf, makeDeskRun, rightPick, stepToEnd, stepUntil } from '../run/engineTestKit';
import { valueSaved } from '../run/valueSaved';
import { teamOf, whyFlagged } from '../page/view';
import type { TicketLabel } from '../domain/labels';
import { deskCards, deskNumbers, deskReview, resultLine, sentRows } from './view';

const DESK_TOTAL = 130;
const SAMPLE_EVERY = 10;

interface Day {
  end: RunState;
  approved: string;
  reviewed: string;
  truthOf: Run['truthOf'];
}

let dayOnce: Day | undefined;

// A whole desk day on seed 1001 in which the viewer approves the first card that offers Approve and reviews
// the first one that does not, so every kind of closed ticket the desk lists is present.
function day(): Day {
  if (dayOnce === undefined) {
    const run = makeDeskRun();
    let approved: string | undefined;
    let reviewed: string | undefined;
    stepToEnd(run, (state) => {
      if (approved === undefined) {
        const card = state.open.find(canQuickApprove);
        if (card !== undefined) {
          approved = card.id;
          run.approve(card.id);
        }
      } else if (reviewed === undefined) {
        const card = state.open.find((trail) => !canQuickApprove(trail));
        if (card !== undefined) {
          reviewed = card.id;
          run.review(card.id);
          run.confirm(rightPick(run, card.id));
        }
      }
    });
    if (approved === undefined || reviewed === undefined) throw new Error('test: the day gave no card to act on');
    dayOnce = { end: run.state(), approved, reviewed, truthOf: (id) => run.truthOf(id) };
  }
  return dayOnce;
}

describe('deskCards', () => {
  it('lists the open cards as the run orders them, each with what the card prints', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 3);
    const state = run.state();
    const cards = deskCards(state);
    expect(cards.map((c) => c.id)).toEqual(state.open.map((t) => t.id));
    state.open.forEach((trail, at) => {
      expect(cards[at]).toEqual({
        id: trail.id,
        team: teamOf(trail),
        tag: expect.objectContaining({ level: expect.any(String) }),
        text: trail.maskedText,
        why: `${whyFlagged(trail).charAt(0).toUpperCase()}${whyFlagged(trail).slice(1)}.`,
        percent: surePercent(trail),
        showApprove: canQuickApprove(trail),
      });
    });
  });

  it('puts a Critical card above an older High one, so the worst ticket is read first', () => {
    const run = makeDeskRun();
    const pair = (s: RunState): { critical: string; high: string } | undefined => {
      for (const urgent of s.open.filter((t) => t.guard.priority === 'Urgent')) {
        const older = s.open.find((t) => t.guard.priority === 'High' && indexOf(t.id) < indexOf(urgent.id));
        if (older !== undefined) return { critical: urgent.id, high: older.id };
      }
      return undefined;
    };
    stepUntil(run, (s) => pair(s) !== undefined);
    const found = pair(run.state());
    const ids = deskCards(run.state()).map((c) => c.id);
    expect(found).toBeDefined();
    expect(ids.indexOf(found?.critical ?? '')).toBeLessThan(ids.indexOf(found?.high ?? ''));
  });

  it('offers Approve at 70 percent as printed and not at 69, including at the rounding edge', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 1);
    const state = run.state();
    const trail = state.open[0];
    if (trail === undefined) throw new Error('test: nothing open');
    const at = (confidence: number): { percent: number; showApprove: boolean } => {
      const shown = deskCards({ ...state, open: [{ ...trail, category: { ...trail.category, confidence } }] })[0];
      return { percent: shown?.percent ?? -1, showApprove: shown?.showApprove ?? true };
    };
    expect(at(0.69)).toEqual({ percent: 69, showApprove: false });
    expect(at(0.694)).toEqual({ percent: 69, showApprove: false });
    expect(at(0.695)).toEqual({ percent: 70, showApprove: true });
    expect(at(0.7)).toEqual({ percent: 70, showApprove: true });
  });
});

describe('sentRows', () => {
  it('lists closed tickets newest first, with the masked text', () => {
    const { end } = day();
    const rows = sentRows(end);
    expect(rows.map((r) => r.id)).toEqual(end.done.map((t) => t.id).reverse());
    expect(rows).toHaveLength(DESK_TOTAL);
    const first = end.done.at(-1);
    expect(rows[0]?.text).toBe(first?.maskedText);
  });

  it('says how each ticket was closed, in exactly five ways', () => {
    const { end, approved, reviewed } = day();
    const rows = sentRows(end);
    const howOf = (id: string): string | undefined => rows.find((r) => r.id === id)?.how;
    const viewerIds = new Set(end.viewerReviews.map((v) => v.id));
    expect(howOf(approved)).toBe('You approved');
    expect(howOf(reviewed)).toBe('You reviewed');
    // "Changed" is about the category the model picked: a reviewer who only moved the priority has kept it.
    for (const trail of end.done) {
      if (viewerIds.has(trail.id)) continue;
      if (!trail.guard.flagged) {
        expect(howOf(trail.id)).toBe('No person needed');
      } else {
        expect(howOf(trail.id)).toBe(trail.final.category === trail.category.label ? 'Reviewer checked' : 'Reviewer changed it');
      }
    }
    expect(end.done.some((t) => t.guard.flagged && t.final.priority !== t.guard.priority && t.final.category === t.category.label)).toBe(true);
    expect(new Set(rows.map((r) => r.how))).toEqual(
      new Set(['No person needed', 'Reviewer checked', 'Reviewer changed it', 'You approved', 'You reviewed']),
    );
  });

  it('names the team the ticket was sent to, which is the reviewer\'s when they changed it', () => {
    const { end } = day();
    const changed = end.done.find((t) => t.final.by === 'reviewer' && t.final.category !== t.category.label);
    const row = sentRows(end).find((r) => r.id === changed?.id);
    expect(row?.team).toBe(changed?.final.route);
    expect(row?.team).not.toBe(changed === undefined ? '' : teamOf(changed));
  });
});

describe('deskReview', () => {
  it('is nothing until a ticket is opened, then holds that ticket at the model\'s picks', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 2);
    expect(deskReview(run.state())).toBeUndefined();
    const card = deskCards(run.state())[1];
    if (card === undefined) throw new Error('test: no second card');
    run.review(card.id);
    const trail = run.state().reviewing;
    expect(deskReview(run.state())).toEqual({
      id: card.id,
      text: card.text,
      why: card.why,
      tag: card.tag,
      category: trail?.category.label,
      priority: trail?.guard.priority,
      route: teamOf(trail as NonNullable<typeof trail>),
    });
    run.handBack();
    expect(deskReview(run.state())).toBeUndefined();
  });

  it('starts at the priority the card shows when a rule raised it above the model\'s own', () => {
    const run = makeDeskRun();
    const raised = (s: RunState) => s.open.find((t) => t.guard.priority !== t.priority.label);
    stepUntil(run, (s) => raised(s) !== undefined);
    const trail = raised(run.state());
    if (trail === undefined) throw new Error('test: no raised card');
    run.review(trail.id);
    const review = deskReview(run.state());
    expect(review?.priority).toBe(trail.guard.priority);
    expect(review?.tag).toEqual(deskCards({ ...run.state(), open: [trail] })[0]?.tag);
  });
});

describe('resultLine', () => {
  const truth: TicketLabel = { category: 'Billing', priority: 'Urgent', mustReview: true };

  it('says the call matched when category and priority are both the true ones', () => {
    expect(resultLine({ category: 'Billing', priority: 'Urgent' }, truth)).toBe('Your call matched the true answer.');
  });

  it('names the true answer when either differs, with Critical as the tags say it', () => {
    const answer = 'The true answer was Billing, Critical.';
    expect(resultLine({ category: 'Technical Issue', priority: 'Urgent' }, truth)).toBe(answer);
    expect(resultLine({ category: 'Billing', priority: 'High' }, truth)).toBe(answer);
  });
});

describe('deskNumbers', () => {
  it('equals the live numbers and the value saved on the same state, all through a day', () => {
    const run = makeDeskRun();
    let seen = 0;
    stepToEnd(run, (state) => {
      seen += 1;
      if (seen % SAMPLE_EVERY !== 0) return;
      const live = liveNumbers(state, (id) => run.truthOf(id));
      expect(deskNumbers(state, DESK_TOTAL, (id) => run.truthOf(id))).toEqual({
        closed: state.done.length,
        total: DESK_TOTAL,
        waiting: state.open.length,
        highRiskMissed: live.highRiskMissed,
        rightNoPerson: valueSaved(state, (id) => run.truthOf(id)).counted,
        reviewerChanged: live.overrides,
      });
    });
    expect(seen).toBeGreaterThan(SAMPLE_EVERY);
  });

  it('counts the ticket under review as waiting, so the number does not dip while a form is open', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 2);
    const before = deskNumbers(run.state(), DESK_TOTAL, (id) => run.truthOf(id)).waiting;
    run.review(run.state().open[0]?.id ?? '');
    expect(run.state().open.length).toBe(before - 1);
    expect(deskNumbers(run.state(), DESK_TOTAL, (id) => run.truthOf(id)).waiting).toBe(before);
  });

  it('reads the right counts at the end of a day: all closed, some sorted with no person, some changed', () => {
    const { end, truthOf } = day();
    const numbers = deskNumbers(end, DESK_TOTAL, truthOf);
    expect(numbers.closed).toBe(DESK_TOTAL);
    expect(numbers.waiting).toBe(0);
    expect(numbers.rightNoPerson).toBeGreaterThan(0);
    expect(numbers.reviewerChanged).toBeGreaterThan(0);
    expect(numbers.rightNoPerson).not.toBe(numbers.reviewerChanged);
  });
});
