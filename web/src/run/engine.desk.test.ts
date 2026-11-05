import { describe, expect, it } from 'vitest';
import { ROUTES, type Category, type Priority } from '../domain/labels';
import type { TicketTrail } from '../pipeline/types';
import { QUICK_APPROVE_PERCENT, type RunState } from './engine';
import { canQuickApprove, surePercent } from './engineParts';
import {
  DESK_CLOSE_EVERY_MS,
  MAX_STEPS,
  makeDeskRun,
  makeRun,
  rightPick,
  stepToClose,
  stepToEnd,
  stepUntil,
} from './engineTestKit';

const DESK_TOTAL = 130;

function withConfidence(confidence: number): TicketTrail {
  return { category: { confidence } } as TicketTrail;
}

function openCard(state: RunState, quick: boolean): TicketTrail | undefined {
  return state.open.find((trail) => canQuickApprove(trail) === quick);
}

describe('closeEveryMs', () => {
  it('sets the gap between the reviewer closing one ticket and the next', () => {
    const run = makeRun({ closeEveryMs: DESK_CLOSE_EVERY_MS });
    stepUntil(run, (s) => s.open.length >= 2);
    const first = stepToClose(run);
    expect(stepToClose(run)).toBe(first + DESK_CLOSE_EVERY_MS);
  });
});

describe('deepTickets: 0', () => {
  it('lets a whole desk day play by itself: no slow ticket, no pause to offer speed up, all 130 done', () => {
    const run = makeDeskRun();
    run.play();
    let slowSeen = false;
    let offered = false;
    let stalled = false;
    for (let n = 0; run.state().act !== 'complete' && !stalled && n <= MAX_STEPS; n += 1) {
      run.advance();
      const after = run.state();
      slowSeen ||= after.current?.deep === true || after.pace === 'slow';
      offered ||= after.offerSpeedUp;
      stalled = !after.playing && after.act !== 'complete';
    }
    expect(slowSeen).toBe(false);
    expect(offered).toBe(false);
    expect(stalled).toBe(false);
    expect(run.state().done).toHaveLength(DESK_TOTAL);
  });

  it('stays quick after Slow down, because the restored count is the option and not the default', () => {
    const run = makeDeskRun();
    run.slowDown();
    let slowSeen = false;
    stepToEnd(run, (s) => {
      slowSeen ||= s.current?.deep === true || s.pace === 'slow';
    });
    expect(slowSeen).toBe(false);
  });
});

describe('the quick-approve cutoff', () => {
  it('is the number the card prints: 69 percent no, 70 percent yes, at the rounding edge too', () => {
    expect(QUICK_APPROVE_PERCENT).toBe(70);
    const cases: [number, number, boolean][] = [
      [0.69, 69, false],
      [0.694, 69, false],
      [0.695, 70, true],
      [0.7, 70, true],
      [0.99, 99, true],
    ];
    for (const [confidence, printed, can] of cases) {
      expect(surePercent(withConfidence(confidence))).toBe(printed);
      expect(canQuickApprove(withConfidence(confidence))).toBe(can);
    }
  });
});

describe('approve', () => {
  it('closes a 70-percent card to the team and priority it shows, as the viewer, scored against the truth', () => {
    const run = makeDeskRun();
    const shown = new Map<string, { category: Category; priority: Priority; route: string }>();
    stepToEnd(run, (state) => {
      for (const trail of state.open) {
        if (!canQuickApprove(trail)) continue;
        const category = trail.category.label as Category;
        shown.set(trail.id, { category, priority: trail.guard.priority, route: ROUTES[category] });
        run.approve(trail.id);
      }
    });
    const end = run.state();
    expect(shown.size).toBeGreaterThan(2);
    expect(end.done).toHaveLength(DESK_TOTAL);
    expect(new Set(end.done.map((t) => t.id)).size).toBe(DESK_TOTAL);
    expect(end.viewerReviews.map((v) => v.id).sort()).toEqual([...shown.keys()].sort());
    const outcomes = end.viewerReviews.map((entry) => {
      const pick = shown.get(entry.id);
      const truth = run.truthOf(entry.id);
      const done = end.done.find((t) => t.id === entry.id);
      expect(done?.final).toEqual({ ...pick, by: 'reviewer' });
      expect(entry.quick).toBe(true);
      expect(entry.correct).toBe(pick?.category === truth.category && pick?.priority === truth.priority);
      return entry.correct;
    });
    // A wrong quick approval is kept as wrong, not rounded up: both outcomes occur on this seed.
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
  });

  it('does nothing for a card under the cutoff', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => openCard(s, false) !== undefined);
    const card = openCard(run.state(), false);
    if (card === undefined) throw new Error('test: no low-confidence card');
    expect(surePercent(card)).toBeLessThan(QUICK_APPROVE_PERCENT);
    let changes = 0;
    run.onChange(() => {
      changes += 1;
    });
    const before = JSON.stringify(run.state());
    run.approve(card.id);
    expect(JSON.stringify(run.state())).toBe(before);
    expect(changes).toBe(0);
  });

  it('does nothing for a ticket the reviewer already closed, and no ticket is lost', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.done.some((t) => t.guard.flagged && canQuickApprove(t)));
    const closed = run.state().done.find((t) => t.guard.flagged && canQuickApprove(t));
    if (closed === undefined) throw new Error('test: nothing closed');
    const before = JSON.stringify(run.state());
    run.approve(closed.id);
    run.approve('T-0-0');
    expect(JSON.stringify(run.state())).toBe(before);
    expect(run.state().viewerReviews).toEqual([]);
    stepToEnd(run);
    const end = run.state();
    expect(new Set(end.done.map((t) => t.id)).size).toBe(DESK_TOTAL);
    expect(end.done).toHaveLength(DESK_TOTAL);
  });

  it('does nothing while a review form is open, so the form is not pulled from under the viewer', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 2 && openCard(s, true) !== undefined);
    const card = openCard(run.state(), true);
    const other = run.state().open.find((t) => t.id !== card?.id);
    if (card === undefined || other === undefined) throw new Error('test: no pair of cards');
    run.review(other.id);
    const before = JSON.stringify(run.state());
    run.approve(card.id);
    expect(JSON.stringify(run.state())).toBe(before);
    expect(run.state().open.map((t) => t.id)).toContain(card.id);
    expect(run.state().viewerReviews).toEqual([]);
  });
});

describe('confirm', () => {
  it('records a review through the form as not quick, so the report can tell the two apart', () => {
    const run = makeDeskRun();
    stepUntil(run, (s) => s.open.length >= 1);
    const id = run.state().open[0]?.id ?? '';
    run.review(id);
    run.confirm(rightPick(run, id));
    expect(run.state().viewerReviews).toEqual([{ id, correct: true, quick: false }]);
  });
});
