import { describe, expect, it } from 'vitest';
import { ACT1_SECONDS, ACT1_TICKETS, ACT2_SECONDS, ACT2_TICKETS_PER_DAY, createSchedule } from './clock';

const SEED = 1001;
const QUARTERS = 4;

function act2Times(seed: number): number[] {
  const schedule = createSchedule(seed);
  return Array.from({ length: ACT2_TICKETS_PER_DAY }, (_, k) => schedule.arrivesAt(ACT1_TICKETS + k));
}

describe('createSchedule', () => {
  it('holds every ticket the run shows, so the page knows when the run is complete', () => {
    expect(createSchedule(SEED).total).toBe(130);
  });

  it('puts the first 30 tickets in Act 1 and the next 100 in Act 2', () => {
    const schedule = createSchedule(SEED);
    expect(Array.from({ length: ACT1_TICKETS }, (_, i) => schedule.act(i)).every((a) => a === 1)).toBe(true);
    expect(Array.from({ length: ACT2_TICKETS_PER_DAY }, (_, k) => schedule.act(ACT1_TICKETS + k)).every((a) => a === 2)).toBe(true);
  });

  it('spaces Act 1 evenly over its 120 seconds so learn speed has a steady rhythm', () => {
    const schedule = createSchedule(SEED);
    const times = Array.from({ length: ACT1_TICKETS }, (_, i) => schedule.arrivesAt(i));
    const gap = ACT1_SECONDS / ACT1_TICKETS;
    expect(times[0]).toBe(0);
    times.forEach((time, i) => expect(time).toBeCloseTo(i * gap, 9));
    expect(times[ACT1_TICKETS - 1]).toBeLessThan(ACT1_SECONDS);
  });

  it('keeps Act 2 inside its 90 seconds, after Act 1, and never goes back in time', () => {
    const times = act2Times(SEED);
    expect(times).toHaveLength(ACT2_TICKETS_PER_DAY);
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(ACT1_SECONDS);
      expect(time).toBeLessThanOrEqual(ACT1_SECONDS + ACT2_SECONDS);
    }
    times.forEach((time, k) => {
      if (k > 0) expect(time).toBeGreaterThanOrEqual(times[k - 1] ?? Infinity);
    });
  });

  it('is busiest in the second quarter of the day (mid-morning) for every seed', () => {
    for (const seed of [1000, SEED, 424242, 4294967295]) {
      const counts = new Array<number>(QUARTERS).fill(0);
      for (const time of act2Times(seed)) {
        const quarter = Math.min(QUARTERS - 1, Math.floor(((time - ACT1_SECONDS) / ACT2_SECONDS) * QUARTERS));
        counts[quarter] = (counts[quarter] ?? 0) + 1;
      }
      const midMorning = counts[1] ?? 0;
      counts.forEach((count, quarter) => {
        if (quarter !== 1) expect(midMorning).toBeGreaterThan(count);
      });
    }
  });

  it('replays: the same seed gives the same times and another seed gives other ones', () => {
    expect(act2Times(SEED)).toEqual(act2Times(SEED));
    expect(act2Times(SEED + 1)).not.toEqual(act2Times(SEED));
  });

  it('refuses a ticket number outside 0..total-1 with a static code', () => {
    const schedule = createSchedule(SEED);
    for (const bad of [-1, 130, 1.5, Number.NaN]) {
      expect(() => schedule.act(bad)).toThrow('E_TICKET_RANGE');
      expect(() => schedule.arrivesAt(bad)).toThrow('E_TICKET_RANGE');
    }
    expect(() => schedule.arrivesAt(129)).not.toThrow();
  });
});
