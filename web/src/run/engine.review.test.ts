import { describe, expect, it } from 'vitest';
import { PRIORITIES, ROUTES, type Category, type Priority, type TicketLabel } from '../domain/labels';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicket } from '../pipeline/run';
import { QUICK_STAGE_MS } from './engine';
import {
  MAX_STEPS,
  MODEL,
  TOTAL,
  eventKind,
  fakeSchedule,
  firstOpen,
  idOf,
  ids,
  indexOf,
  lastDone,
  lastDoneOf,
  makeRealRun,
  makeRun,
  nextCloseTime,
  otherPriority,
  pacedDay,
  rawTicket,
  rightPick,
  runToOpen,
  stepUntil,
  withoutMs,
} from './engineTestKit';

describe('the open list', () => {
  // The open list is kept highest priority first, then oldest first. Ticket 2 is Medium and the
  // oldest, 5 is High, 6 is Urgent, 7 is Medium: the reviewer closes slower than tickets open,
  // so they pile up.
  it.each([
    ['a younger ticket of higher priority above an older one, and the oldest of the lowest last', 6, [6, 5, 2]],
    ['equal priority with the older first', 7, [5, 2, 7]],
  ])('puts %s', (_name, joining, expected) => {
    const priorities = [2, 5, 6, 7].map((i) => pacedDay().trails.get(idOf(i))?.guard.priority);
    expect(priorities).toEqual(['Medium', 'High', 'Urgent', 'Medium']);
    expect(ids(runToOpen(joining).state().open)).toEqual(expected.map(idOf));
  });

  // On the page's own day the reviewer falls behind and the list grows long: every insert has
  // to find its place among many, and every close takes the ticket on top.
  it('stays in priority then age order through a whole real day, and every close takes the top', () => {
    const run = makeRealRun();
    let peak = 0;
    let closes = 0;
    let before = run.state();
    for (let n = 0; run.state().act !== 'complete' && n <= MAX_STEPS; n += 1) {
      run.step();
      const after = run.state();
      peak = Math.max(peak, after.open.length);
      after.open.slice(1).forEach((trail, at) => {
        const above = after.open[at];
        if (above === undefined) throw new Error('test: the list has a gap');
        const rank = PRIORITIES.indexOf(above.guard.priority) - PRIORITIES.indexOf(trail.guard.priority);
        expect(rank > 0 || (rank === 0 && indexOf(above.id) < indexOf(trail.id))).toBe(true);
      });
      if (eventKind(before, after) === 'close') {
        closes += 1;
        expect(lastDoneOf(after).id).toBe(before.open[0]?.id);
      }
      before = after;
    }
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(closes).toBeGreaterThan(0);
    expect(run.state().act).toBe('complete');
  });

  it('puts a handed-back ticket back in its place, by priority and then age', () => {
    const run = runToOpen(7);
    run.review(idOf(2));
    expect(ids(run.state().open)).toEqual([5, 7].map(idOf));
    run.handBack();
    expect(ids(run.state().open)).toEqual([5, 2, 7].map(idOf));
  });
});

describe('Review', () => {
  // Review pressed on the ticket the simulated reviewer closes next: the form holds it and the
  // clock stops; Confirm closes it with the viewer's pick and the reviewer takes the next one.
  it('holds the ticket the reviewer would close next, stops the clock, and lets the reviewer take the next one after Confirm', () => {
    // Ticket 6 has just joined [5, 2] and tops the list, so it is the next the reviewer closes.
    const closesAt = nextCloseTime(6);
    const run = runToOpen(6);
    run.play();
    const due = run.nextDelayMs();
    const before = run.state();
    expect(due).toBe(QUICK_STAGE_MS);
    run.review(idOf(6));
    expect(run.state().reviewing?.id).toBe(idOf(6));
    expect(ids(run.state().open)).toEqual([5, 2].map(idOf));
    expect(run.nextDelayMs()).toBeNull();
    const held = withoutMs(run.state());
    for (let n = 0; n < 5; n += 1) run.advance();
    run.pause();
    for (let n = 0; n < 5; n += 1) run.step();
    run.finishNow();
    run.play();
    expect(withoutMs(run.state())).toBe(held);
    expect(run.state().simTime).toBe(before.simTime);

    run.confirm(rightPick(run, idOf(6)));
    expect(run.state().reviewing).toBeUndefined();
    expect(run.state().viewerReviews).toEqual([{ id: idOf(6), correct: true, quick: false }]);
    expect(lastDone(run).id).toBe(idOf(6));
    expect(lastDone(run).final.by).toBe('reviewer');
    expect(run.nextDelayMs()).toBe(due);
    // The reviewer's schedule did not move while the form was open: it takes the next open
    // ticket when it would have closed this one.
    run.pause();
    stepUntil(run, (s) => s.done.some((t) => t.id === idOf(5)));
    expect(run.state().simTime).toBe(closesAt);
  });

  // Review works on any open ticket, not only the top one; the others stay where they were.
  it('holds a ticket from the middle of the open list and puts it back in its place on Hand back', () => {
    const run = runToOpen(6);
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    run.review(idOf(5));
    expect(run.state().reviewing?.id).toBe(idOf(5));
    expect(ids(run.state().open)).toEqual([6, 2].map(idOf));
    run.handBack();
    expect(run.state().reviewing).toBeUndefined();
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
  });

  it('gives the ticket back to the simulated reviewer on Hand back, without counting a review', () => {
    const run = runToOpen(6);
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    run.review(idOf(6));
    run.handBack();
    expect(run.state().reviewing).toBeUndefined();
    expect(ids(run.state().open)).toEqual([6, 5, 2].map(idOf));
    expect(run.state().viewerReviews).toEqual([]);
    stepUntil(run, (s) => s.done.some((t) => t.id === idOf(6)));
    expect(lastDone(run)).toEqual(pacedDay().trails.get(idOf(6)));
    expect(run.state().simTime).toBe(nextCloseTime(6));
  });

  it('runs the ticket again with the viewer\'s pick, so the trail shown is the trail scored', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    const truth = run.truthOf(id);
    const wrongCategory: Category = truth.category === 'Billing' ? 'Other' : 'Billing';
    const pick = { category: wrongCategory, priority: truth.priority, route: ROUTES[wrongCategory] };
    run.review(id);
    run.confirm(pick);
    const ticket = rawTicket(indexOf(id));
    const rerun = runTicket(ticket.text, id, {
      model: MODEL,
      reviewer: { decide: () => pick },
      floor: CONFIDENCE_FLOOR,
      secondCheckOn: SECOND_CHECK_ON,
      now: () => 0,
    });
    expect(lastDone(run)).toEqual({ ...rerun, receivedAt: fakeSchedule(TOTAL, 6).arrivesAt(indexOf(id)) });
    expect(lastDone(run).final).toEqual({ ...pick, by: 'reviewer' });
    expect(run.state().viewerReviews).toEqual([{ id, correct: false, quick: false }]);
    expect(run.state().open.some((t) => t.id === id)).toBe(false);
  });

  // The ticket is sent where the viewer chose, not where its category would send it.
  it('closes the ticket on the team the viewer picked, even when that is not its category team', () => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    const truth = run.truthOf(id);
    const otherTeam = Object.values(ROUTES).find((team) => team !== ROUTES[truth.category]);
    expect(otherTeam).toBeDefined();
    run.review(id);
    run.confirm({ category: truth.category, priority: truth.priority, route: otherTeam ?? '' });
    expect(lastDone(run).final.route).toBe(otherTeam);
  });

  // The parent design's rule: right means category and priority both match the truth; the team is shown, not scored.
  it.each([
    ['category and priority right, team wrong', (t: TicketLabel) => ({ category: t.category, priority: t.priority, route: 'Nowhere' }), true],
    [
      'category right, priority wrong',
      (t: TicketLabel) => ({ category: t.category, priority: otherPriority(t.priority), route: ROUTES[t.category] }),
      false,
    ],
    [
      'priority right, category wrong',
      (t: TicketLabel) => {
        const category: Category = t.category === 'Billing' ? 'Other' : 'Billing';
        return { category, priority: t.priority, route: ROUTES[category] };
      },
      false,
    ],
  ])('scores a review: %s', (_name, pickFor, correct) => {
    const run = makeRun();
    stepUntil(run, (s) => s.open.length > 0);
    const id = firstOpen(run).id;
    run.review(id);
    run.confirm(pickFor(run.truthOf(id)));
    expect(run.state().viewerReviews).toEqual([{ id, correct, quick: false }]);
  });

  it('ignores Review on an unknown or non-open ticket, Review while a form is open, and Confirm or Hand back with no form', () => {
    const run = makeRun();
    const pick = { category: 'Billing' as Category, priority: 'Low' as Priority, route: ROUTES.Billing };
    const changes: number[] = [];
    run.onChange(() => changes.push(1));
    run.confirm(pick);
    run.handBack();
    run.review(idOf(0));
    expect(changes).toEqual([]);
    const pair = runToOpen(6);
    pair.onChange(() => changes.push(1));
    const atPair = withoutMs(pair.state());
    pair.review('T-nope');
    pair.review(pair.state().current?.trail.id ?? 'none');
    pair.confirm(pick);
    pair.handBack();
    expect(withoutMs(pair.state())).toBe(atPair);
    pair.review(idOf(6));
    const holding = withoutMs(pair.state());
    pair.review(idOf(5));
    expect(withoutMs(pair.state())).toBe(holding);
    expect(changes).toEqual([1]);
  });
});
