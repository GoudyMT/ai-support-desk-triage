import { CATEGORIES } from '../domain/labels';
import { EXTRA_WORDING } from './extraFrames';
import { BUILT_IN_WORDING, generateTicketDetail, type Ticket } from './generate';
import { swapMapFor, teachingDetail } from './pieces';
import { createRng } from './rng';
import { checkSplit, poolOf, type Split, type Template } from './templates';
import type { Wording } from './wording';

// The 90-day run's calendar. A stream is one practice fold: its held-out
// templates are dealt into weeks, and a week's tickets use only that week's
// templates, so every ticket a model is scored on is built from wording it has
// not been taught yet, even after it retrains on the weeks before.
export const WEEKS = 13;
export const DAYS_PER_WEEK = 7;
export const TICKETS_PER_DAY = 100;
const DEAL_SEED = 113;
// Seeds of their own, apart from every export stream, so no week ticket shares
// its random draws with a ticket a model trained or was scored on before.
const WEEK_SEEDS = { 'built-in': 41, extra: 51 } as const;
// Weeks of rare templates fill slowly; past this many draws per wording the
// stream cannot fill its weeks and the run stops instead of looping.
const MAX_DRAWS = 2_000_000;
// Held-out draws per wording that the start model scores to rate each template.
export const POOL_PER_WORDING = 20_000;

export type WeekWording = keyof typeof WEEK_SEEDS;

export interface WeekRow {
  week: number;
  day: number;
  wording: WeekWording;
  ticket: Ticket;
  // With teaching copies: the copy a retrained model learns from, and the names of
  // the templates the ticket used.
  teachText?: string;
  templates?: string[];
}

// The start model's rating of each template by name: share right, tickets rated.
export type Difficulty = Record<string, { right: number; count: number }>;

interface WeekLoad {
  templates: number;
  right: number;
  count: number;
}

type Rating = Difficulty[string];

// The week a template goes to: among the weeks holding the fewest of its list (so
// each week keeps the same mix of departments and hard cases) and at most one
// template above the emptiest week (so every week still fills), the one whose
// ticket-weighted rating ends closest to the whole stream's. A hard template so
// goes to an easy week and an easy one to a hard week. Requiring the very fewest
// templates in all would leave one week to choose from: the round-robin deal again.
function closestWeek(loads: readonly WeekLoad[], ofList: readonly number[], rating: Rating, target: number): number {
  const fewestOfList = Math.min(...ofList);
  const fewest = Math.min(...loads.map((load) => load.templates));
  const open = loads
    .map((_, week) => week)
    .filter((week) => ofList[week] === fewestOfList && (loads[week]?.templates ?? 0) <= fewest + 1);
  const gap = (week: number): number => {
    const load = loads[week] ?? { templates: 0, right: 0, count: 0 };
    const count = load.count + rating.count;
    return count === 0 ? 0 : Math.abs((load.right + rating.right * rating.count) / count - target);
  };
  return open.reduce((best, week) => (gap(week) < gap(best) ? week : best));
}

// A held-out template with its wording, its list (by place) and its rating.
interface Placed {
  template: Template;
  wording: WeekWording;
  list: number;
  rating: Rating;
}

// Every held-out template of a stream, rated; one the pool never met takes its
// list's mean rating and no weight.
function placedTemplates(stream: number, difficulty: Difficulty): Placed[] {
  const split: Split = { fold: stream, side: 'heldout' };
  return (Object.keys(WORDINGS) as WeekWording[]).flatMap((wording) => {
    const refs = templateRefsOf(wording);
    return templateLists(WORDINGS[wording]).flatMap((list, at) => {
      const items = poolOf(list, split);
      const rated = items.flatMap((template) => {
        const rating = difficulty[refs.get(template) ?? ''];
        return rating === undefined ? [] : [rating.right];
      });
      const listMean = rated.length === 0 ? 1 : rated.reduce((sum, right) => sum + right, 0) / rated.length;
      return items.map((template) => ({ template, wording, list: at, rating: difficulty[refs.get(template) ?? ''] ?? { right: listMean, count: 0 } }));
    });
  });
}

// A week's tickets are half from each wording, and within a wording each template
// gives tickets in proportion to how often the pool met it.
function weekShares(placed: readonly Placed[], deal: ReadonlyMap<Template, number>): number[] {
  const sums = Array.from({ length: WEEKS }, () => ({ 'built-in': { right: 0, count: 0 }, extra: { right: 0, count: 0 } }));
  for (const { template, wording, rating } of placed) {
    const sum = sums[deal.get(template) ?? 0]?.[wording];
    if (sum !== undefined) {
      sum.right += rating.right * rating.count;
      sum.count += rating.count;
    }
  }
  return sums.map((week) => {
    const parts = Object.values(week).filter((part) => part.count > 0);
    return parts.length === 0 ? 0 : parts.reduce((total, part) => total + part.right / part.count, 0) / parts.length;
  });
}

/**
 * The start model's predicted share right in each week of a deal, from the pool ratings.
 *
 * Args:
 *   stream: the practice fold.
 *   deal: the week of every held-out template.
 *   difficulty: the start model's rating of each template, by name.
 *
 * Returns:
 *   One share (0 to 1) per week.
 */
export function predictedWeekShares(stream: number, deal: ReadonlyMap<Template, number>, difficulty: Difficulty): number[] {
  return weekShares(placedTemplates(stream, difficulty), deal);
}

// Days are 1-based and the same size; day d falls in week floor((d - 1) / 7).
function meanOverDays(shares: readonly number[], first: number, last: number): number {
  let total = 0;
  for (let day = first; day <= last; day += 1) {
    total += shares[Math.floor((day - 1) / DAYS_PER_WEEK)] ?? 0;
  }
  return total / (last - first + 1);
}

/**
 * The predicted gap between days 1-30 and days 61-90, in points, as the balance check measures it.
 *
 * Args:
 *   shares: one predicted share per week.
 *
 * Returns:
 *   The absolute difference of the two windows' mean daily share, times 100.
 */
export function predictedGap(shares: readonly number[]): number {
  return Math.abs(meanOverDays(shares, 1, 30) - meanOverDays(shares, 61, 90)) * 100;
}

// How uneven a deal is: the weeks' spread around their mean, plus the gap the
// balance check measures, weighed as much as all the weeks together, since a week
// outside days 1-30 and 61-90 cannot move that check.
function unevenness(shares: readonly number[]): number {
  const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  const spread = shares.reduce((sum, share) => sum + (share - mean) ** 2, 0);
  return spread + WEEKS * (meanOverDays(shares, 1, 30) - meanOverDays(shares, 61, 90)) ** 2;
}

// One pass can leave a week holding mostly hard templates: whatever comes first
// fills it. This swaps two templates of the same list between weeks (so every week
// keeps its mix of departments, hard cases and template count) whenever the swap
// makes the predicted weeks more even, until no swap helps.
const MAX_SWAP_PASSES = 100;

function evenOut(placed: readonly Placed[], deal: Map<Template, number>): void {
  const groups = new Map<string, Placed[]>();
  for (const item of placed) {
    const key = `${item.wording}|${item.list}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  let current = unevenness(weekShares(placed, deal));
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass += 1) {
    let improved = false;
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = (group[i] as Placed).template;
          const b = (group[j] as Placed).template;
          const weekA = deal.get(a) ?? 0;
          const weekB = deal.get(b) ?? 0;
          if (weekA === weekB) {
            continue;
          }
          deal.set(a, weekB).set(b, weekA);
          const swapped = unevenness(weekShares(placed, deal));
          if (swapped < current - 1e-12) {
            current = swapped;
            improved = true;
          } else {
            deal.set(a, weekA).set(b, weekB);
          }
        }
      }
    }
    if (!improved) {
      return;
    }
  }
}

// The ticket-weighted rating of all the stream's held-out templates together.
function streamRating(stream: number, difficulty: Difficulty): number {
  let right = 0;
  let count = 0;
  for (const name of Object.keys(WORDINGS) as WeekWording[]) {
    const refs = templateRefsOf(name);
    for (const template of dealWeeks(stream).keys()) {
      const rating = difficulty[refs.get(template) ?? ''];
      if (rating !== undefined) {
        right += rating.right * rating.count;
        count += rating.count;
      }
    }
  }
  return count === 0 ? 0 : right / count;
}

/**
 * Deals one stream's held-out templates into weeks so each week is about as hard.
 *
 * Within each list, hardest first, each template goes to the week it brings
 * closest to the stream's overall rating (closestWeek), weighed by how many
 * tickets each template gives. Ties keep the seeded shuffle's order. A template
 * the pool never rated takes its list's mean rating and no weight. Then swaps
 * within each list even out the predicted weeks (evenOut).
 *
 * Args:
 *   stream: the practice fold whose held-out templates are dealt.
 *   difficulty: the start model's rating of each template, by name.
 *   seed: the shuffle's seed.
 *   swaps: false leaves the one-pass deal, for comparison.
 *
 * Returns:
 *   The week (0 to WEEKS - 1) of every held-out template, keyed by the template.
 *
 * Throws:
 *   Error('E_SPLIT_RANGE') for a stream outside the folds.
 */
export function dealWeeksByDifficulty(stream: number, difficulty: Difficulty, seed: number = DEAL_SEED, swaps = true): Map<Template, number> {
  const split: Split = { fold: stream, side: 'heldout' };
  checkSplit(split);
  const rng = createRng(seed);
  const deal = new Map<Template, number>();
  const loads: WeekLoad[] = Array.from({ length: WEEKS }, () => ({ templates: 0, right: 0, count: 0 }));
  const target = streamRating(stream, difficulty);
  for (const name of Object.keys(WORDINGS) as WeekWording[]) {
    const refs = templateRefsOf(name);
    for (const list of templateLists(WORDINGS[name])) {
      const items = [...poolOf(list, split)];
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [items[i], items[j]] = [items[j] as Template, items[i] as Template];
      }
      const rated = items.flatMap((template) => {
        const rating = difficulty[refs.get(template) ?? ''];
        return rating === undefined ? [] : [rating.right];
      });
      const listMean = rated.length === 0 ? 1 : rated.reduce((sum, right) => sum + right, 0) / rated.length;
      const ratings = items.map((template) => difficulty[refs.get(template) ?? ''] ?? { right: listMean, count: 0 });
      // Array.prototype.sort is stable, so equal ratings keep the shuffled order.
      const order = items.map((_, at) => at).sort((a, b) => (ratings[a]?.right ?? 0) - (ratings[b]?.right ?? 0));
      const ofList = Array.from({ length: WEEKS }, () => 0);
      for (const at of order) {
        const template = items[at] as Template;
        const rating = ratings[at] ?? { right: listMean, count: 0 };
        const week = closestWeek(loads, ofList, rating, target);
        const load = loads[week] as WeekLoad;
        deal.set(template, week);
        ofList[week] = (ofList[week] ?? 0) + 1;
        load.templates += 1;
        load.right += rating.right * rating.count;
        load.count += rating.count;
      }
    }
  }
  if (swaps) {
    evenOut(placedTemplates(stream, difficulty), deal);
  }
  return deal;
}

const WORDINGS: Record<WeekWording, Wording> = { 'built-in': BUILT_IN_WORDING, extra: EXTRA_WORDING };

// Every list a ticket's body is drawn from, with a short name. Openers, requests,
// closers, connectors and threat phrases are shared voice, not templates, and
// stay out. Names use the category's place, since a category name holds a slash.
function namedTemplateLists(wording: Wording): [string, readonly Template[]][] {
  return [
    ...CATEGORIES.map((category, at): [string, readonly Template[]] => [`plain${at}`, wording.templates[category]]),
    ...CATEGORIES.map((category, at): [string, readonly Template[]] => [`trap${at}`, wording.trapTemplates[category]]),
    ['vague', wording.vagueTemplates],
    ['politeSecurity', wording.politeSecurityTemplates],
  ];
}

function templateLists(wording: Wording): (readonly Template[])[] {
  return namedTemplateLists(wording).map(([, list]) => list);
}

/**
 * Deals one stream's held-out templates into weeks.
 *
 * Each list is shuffled with the seed and dealt in turn, the count carrying on
 * from list to list, so every week gets templates and the weeks differ in size
 * by at most one.
 *
 * Args:
 *   stream: the practice fold whose held-out templates are dealt.
 *   seed: the shuffle's seed.
 *
 * Returns:
 *   The week (0 to WEEKS - 1) of every held-out template, keyed by the template.
 *
 * Throws:
 *   Error('E_SPLIT_RANGE') for a stream outside the folds.
 */
export function dealWeeks(stream: number, seed: number = DEAL_SEED): Map<Template, number> {
  const split: Split = { fold: stream, side: 'heldout' };
  checkSplit(split);
  const rng = createRng(seed);
  const deal = new Map<Template, number>();
  let counted = 0;
  for (const wording of Object.values(WORDINGS)) {
    for (const list of templateLists(wording)) {
      const items = [...poolOf(list, split)];
      // Fisher-Yates, so every order is equally likely.
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [items[i], items[j]] = [items[j] as Template, items[i] as Template];
      }
      for (const template of items) {
        deal.set(template, counted % WEEKS);
        counted += 1;
      }
    }
  }
  return deal;
}

/**
 * The week a ticket belongs to: the one week that holds every template it used.
 *
 * Args:
 *   templates: the templates the ticket's body was built from.
 *   deal: the stream's deal.
 *
 * Returns:
 *   The week, or undefined when the templates span weeks or one is not dealt.
 */
export function weekOfTicket(templates: readonly Template[], deal: ReadonlyMap<Template, number>): number | undefined {
  const weeks = new Set(templates.map((template) => deal.get(template)));
  if (weeks.size !== 1 || weeks.has(undefined)) {
    return undefined;
  }
  return [...weeks][0];
}

export interface PoolRow {
  wording: WeekWording;
  ticket: Ticket;
  templates: string[];
}

/**
 * A stable name for every template of a wording: `<wording>|<list>|<index>`.
 *
 * Args:
 *   wording: which wording's templates to name.
 *
 * Returns:
 *   The name of each template.
 */
export function templateRefsOf(wording: WeekWording): Map<Template, string> {
  const refs = new Map<Template, string>();
  for (const [name, list] of namedTemplateLists(WORDINGS[wording])) {
    list.forEach((template, index) => refs.set(template, `${wording}|${name}|${index}`));
  }
  return refs;
}

/**
 * The tickets the start model scores to rate a stream's held-out templates.
 *
 * They are the first draws of each wording from the week seeds, the same draws
 * the week builder picks its tickets from, so a template is rated on tickets
 * like the ones it will be scored on.
 *
 * Args:
 *   stream: the practice fold.
 *   perWording: draws per wording.
 *
 * Returns:
 *   The tickets, each with the names of the templates it used.
 */
export function buildPool(stream: number, perWording: number = POOL_PER_WORDING): PoolRow[] {
  const split: Split = { fold: stream, side: 'heldout' };
  checkSplit(split);
  return (Object.keys(WORDINGS) as WeekWording[]).flatMap((name) => {
    const refs = templateRefsOf(name);
    return Array.from({ length: perWording }, (_, index) => {
      const detail = generateTicketDetail(WEEK_SEEDS[name], index, split, WORDINGS[name]);
      const templates = detail.templates.map((template) => refs.get(template) ?? '');
      return { wording: name, ticket: detail.ticket, templates };
    });
  });
}

/**
 * Builds a stream's 90 days of tickets, week by week.
 *
 * Held-out tickets of each wording are drawn in index order; a ticket is kept
 * when its templates fall in one week that still needs tickets of that wording
 * and its text is new. Kept tickets of a week are spread over its days in turn.
 *
 * Args:
 *   stream: the practice fold.
 *   perDay: tickets per day, half from each wording.
 *
 * Returns:
 *   WEEKS lists of DAYS_PER_WEEK * perDay rows, each with its day (1 to 7).
 *
 * Throws:
 *   Error('E_WEEKS_COUNT') for a count per day that is not a positive even number;
 *   Error('E_WEEKS_SHORT') when a week cannot be filled.
 */
export function buildWeeks(
  stream: number,
  perDay: number = TICKETS_PER_DAY,
  dealt?: ReadonlyMap<Template, number>,
  teach = false,
): WeekRow[][] {
  if (!Number.isInteger(perDay) || perDay <= 0 || perDay % 2 !== 0) {
    throw new Error('E_WEEKS_COUNT');
  }
  const deal = dealt ?? dealWeeks(stream);
  const split: Split = { fold: stream, side: 'heldout' };
  const perWording = (DAYS_PER_WEEK * perDay) / 2;
  const weeks: WeekRow[][] = Array.from({ length: WEEKS }, () => []);
  const taken = new Set<string>();
  for (const name of Object.keys(WORDINGS) as WeekWording[]) {
    // Only kept tickets are built a second time, for their teaching copy.
    const swap = teach ? swapMapFor(stream, WORDINGS[name]) : undefined;
    const refs = templateRefsOf(name);
    const filled = Array.from({ length: WEEKS }, () => 0);
    let open = WEEKS;
    for (let index = 0; index < MAX_DRAWS && open > 0; index += 1) {
      const detail = generateTicketDetail(WEEK_SEEDS[name], index, split, WORDINGS[name]);
      const week = weekOfTicket(detail.templates, deal);
      if (week === undefined || (filled[week] ?? 0) >= perWording || taken.has(detail.ticket.text)) {
        continue;
      }
      taken.add(detail.ticket.text);
      const row: WeekRow = { week, day: 0, wording: name, ticket: detail.ticket };
      if (swap !== undefined) {
        row.teachText = teachingDetail(WEEK_SEEDS[name], index, split, WORDINGS[name], swap).teachText;
        row.templates = detail.templates.map((template) => refs.get(template) ?? '');
      }
      weeks[week]?.push(row);
      filled[week] = (filled[week] ?? 0) + 1;
      if (filled[week] === perWording) {
        open -= 1;
      }
    }
    if (open > 0) {
      throw new Error('E_WEEKS_SHORT');
    }
  }
  // Days are dealt in turn within each wording, so every day holds perDay / 2 of each.
  return weeks.map((rows) => {
    const seen: Record<WeekWording, number> = { 'built-in': 0, extra: 0 };
    return rows.map((row) => {
      const day = (seen[row.wording] % DAYS_PER_WEEK) + 1;
      seen[row.wording] += 1;
      return { ...row, day };
    });
  });
}
