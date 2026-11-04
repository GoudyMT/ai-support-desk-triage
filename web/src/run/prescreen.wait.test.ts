import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel, type Model } from '../model/scorer';
import { ACT1_TICKETS, createSchedule } from './clock';
import { createRun } from './engine';
import { createPrescreener, type Tag } from './prescreen';
import { foldOf } from './seed';

const FIRST_SEED = 3000;
const SEED_COUNT = 12;
const MS_PER_SECOND = 1000;
const MAX_STEPS = 20000;

const models = new Map<number, Model>();
function foldModel(fold: number): Model {
  const known = models.get(fold);
  if (known !== undefined) return known;
  const url = new URL(`../../public/models/fold_${fold}.json`, import.meta.url);
  const model = loadModel(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
  models.set(fold, model);
  return model;
}

interface Day {
  urgentWaits: number[];
  tickets: number;
  marked: number;
}

// One whole run on the page's own schedule and fold model, stepped event by event with nobody
// reviewing. Each urgent Act 2 ticket's wait is the time from its arrival to its turn in the
// center (Act 1 has no queue to speak of: tickets arrive 4 s apart).
function simulate(seed: number, prescreen: (maskedText: string) => Tag): Day {
  const schedule = createSchedule(seed);
  let marked = 0;
  const run = createRun({
    seed,
    model: foldModel(foldOf(seed)),
    schedule,
    wallClock: () => 0,
    prescreen: (text) => {
      const tag = prescreen(text);
      marked += tag.critical ? 1 : 0;
      return tag;
    },
  });
  const entered = new Map<string, number>();
  for (let n = 0; run.state().act !== 'complete' && n < MAX_STEPS; n += 1) {
    run.step();
    const state = run.state();
    const id = state.current?.trail.id;
    if (id !== undefined && !entered.has(id)) entered.set(id, state.simTime);
  }
  const urgentWaits: number[] = [];
  for (let i = ACT1_TICKETS; i < schedule.total; i += 1) {
    const id = `T-${seed}-${i}`;
    if (run.truthOf(id).priority === 'Urgent') {
      urgentWaits.push((entered.get(id) ?? Number.NaN) - schedule.arrivesAt(i) * MS_PER_SECOND);
    }
  }
  return { urgentWaits, tickets: schedule.total, marked };
}

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

// Measured on these seeds (urgent Act 2 tickets, 158 of them): the mean wait is 13.1 s with no
// pre-screener and 4.3 s with it, a third; it marks 22% of the tickets critical.
const HALVED = 0.5;
const MAX_MARKED_SHARE = 0.3;

function week(prescreenFor: (model: Model) => (maskedText: string) => Tag) {
  const waits: number[] = [];
  let marked = 0;
  let tickets = 0;
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed += 1) {
    const day = simulate(seed, prescreenFor(foldModel(foldOf(seed))));
    waits.push(...day.urgentWaits);
    marked += day.marked;
    tickets += day.tickets;
  }
  return { wait: mean(waits), urgent: waits.length, markedShare: marked / tickets };
}

const nobody = (): ((maskedText: string) => Tag) => () => ({ priority: 'Low', critical: false });
const everybody = (): ((maskedText: string) => Tag) => () => ({ priority: 'Urgent', critical: true });

// The pre-screener exists so that an urgent ticket does not wait in line behind routine ones. Seeds
// 3000-3011 were not used to choose how many words it keeps.
describe('the pre-screener against waiting, on seeds it was not cut on', () => {
  const baseline = week(nobody);

  it('has urgent tickets to wait, and they wait without it', () => {
    expect(baseline.urgent).toBeGreaterThan(100);
    expect(baseline.wait).toBeGreaterThan(MS_PER_SECOND);
  });

  it('at least halves how long urgent tickets wait, marking no more than 30% of tickets critical', () => {
    const screened = week(createPrescreener);
    expect(screened.wait).toBeLessThanOrEqual(baseline.wait * HALVED);
    expect(screened.markedShare).toBeLessThanOrEqual(MAX_MARKED_SHARE);
  });

  // Marking every ticket critical puts them all in the same line again, so it must not pass.
  it('is not passed by marking everything critical', () => {
    const everything = week(everybody);
    expect(everything.wait).toBeGreaterThan(baseline.wait * HALVED);
    expect(everything.markedShare).toBeGreaterThan(MAX_MARKED_SHARE);
  });
});

