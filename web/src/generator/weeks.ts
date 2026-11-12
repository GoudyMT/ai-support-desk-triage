import { CATEGORIES } from '../domain/labels';
import { EXTRA_WORDING } from './extraFrames';
import { BUILT_IN_WORDING, generateTicketDetail, type Ticket } from './generate';
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
export function buildWeeks(stream: number, perDay: number = TICKETS_PER_DAY): WeekRow[][] {
  if (!Number.isInteger(perDay) || perDay <= 0 || perDay % 2 !== 0) {
    throw new Error('E_WEEKS_COUNT');
  }
  const deal = dealWeeks(stream);
  const split: Split = { fold: stream, side: 'heldout' };
  const perWording = (DAYS_PER_WEEK * perDay) / 2;
  const weeks: WeekRow[][] = Array.from({ length: WEEKS }, () => []);
  const taken = new Set<string>();
  for (const name of Object.keys(WORDINGS) as WeekWording[]) {
    const filled = Array.from({ length: WEEKS }, () => 0);
    let open = WEEKS;
    for (let index = 0; index < MAX_DRAWS && open > 0; index += 1) {
      const detail = generateTicketDetail(WEEK_SEEDS[name], index, split, WORDINGS[name]);
      const week = weekOfTicket(detail.templates, deal);
      if (week === undefined || (filled[week] ?? 0) >= perWording || taken.has(detail.ticket.text)) {
        continue;
      }
      taken.add(detail.ticket.text);
      weeks[week]?.push({ week, day: 0, wording: name, ticket: detail.ticket });
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
