import { createRng } from '../generator/rng';

export const ACT1_TICKETS = 30;
export const ACT1_SECONDS = 120;
export const ACT2_TICKETS_PER_DAY = 100;
export const ACT2_SECONDS = 90;

// A support desk is quietest at opening and in the late afternoon and busiest in
// mid-morning, so the day is four quarters of fixed ticket counts with a peak in
// the second. Fixed counts (not random draws) keep the peak true for every seed;
// the seed only places each arrival inside its quarter. The counts add up to
// ACT2_TICKETS_PER_DAY.
const ACT2_QUARTER_COUNTS = [20, 40, 25, 15] as const;

export interface Schedule {
  act(i: number): 1 | 2;
  arrivesAt(i: number): number;
  total: number;
}

function act2Arrivals(seed: number): number[] {
  const rng = createRng(seed);
  const quarterSeconds = ACT2_SECONDS / ACT2_QUARTER_COUNTS.length;
  const times: number[] = [];
  ACT2_QUARTER_COUNTS.forEach((count, quarter) => {
    const start = ACT1_SECONDS + quarter * quarterSeconds;
    const inQuarter = Array.from({ length: count }, () => start + rng.next() * quarterSeconds);
    times.push(...inQuarter.sort((a, b) => a - b));
  });
  return times;
}

function ticketChecker(total: number): (i: number) => number {
  return (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= total) {
      throw new Error('E_TICKET_RANGE');
    }
    return i;
  };
}

export function createSchedule(seed: number): Schedule {
  const total = ACT1_TICKETS + ACT2_TICKETS_PER_DAY;
  const act2 = act2Arrivals(seed);
  const checked = ticketChecker(total);
  return {
    total,
    act: (i) => (checked(i) < ACT1_TICKETS ? 1 : 2),
    arrivesAt: (i) => {
      checked(i);
      const time = i < ACT1_TICKETS ? (i * ACT1_SECONDS) / ACT1_TICKETS : act2[i - ACT1_TICKETS];
      if (time === undefined) {
        throw new Error('E_TICKET_RANGE');
      }
      return time;
    },
  };
}

// The operator desk's day: the same number of tickets as the demo's, one steady trickle in one act. Each ticket
// lands at a seeded point inside its own slot, so arrivals never bunch, never tie and keep the average pace.
export const DESK_ARRIVAL_SECONDS = 1.8;

export function createDeskSchedule(seed: number): Schedule {
  const total = ACT1_TICKETS + ACT2_TICKETS_PER_DAY;
  const rng = createRng(seed);
  const times = Array.from({ length: total }, (_, i) => (i + rng.next()) * DESK_ARRIVAL_SECONDS);
  const checked = ticketChecker(total);
  return {
    total,
    act: (i) => {
      checked(i);
      return 2;
    },
    arrivesAt: (i) => {
      const time = times[checked(i)];
      if (time === undefined) {
        throw new Error('E_TICKET_RANGE');
      }
      return time;
    },
  };
}
