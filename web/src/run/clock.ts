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

export function createSchedule(seed: number): Schedule {
  const total = ACT1_TICKETS + ACT2_TICKETS_PER_DAY;
  const act2 = act2Arrivals(seed);
  const checked = (i: number): number => {
    if (!Number.isInteger(i) || i < 0 || i >= total) {
      throw new Error('E_TICKET_RANGE');
    }
    return i;
  };
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
