import { MASK_TOKENS, type MaskKind } from '../privacy/mask';
import { CONFIDENCE_FLOOR } from '../pipeline/run';
import type { FlagReason, TicketTrail } from '../pipeline/types';
import type { Stage } from './stage';

export interface Narration {
  plain: string;
  detail: { label: string; value: string }[];
}

type DetailRow = Narration['detail'][number];

const PERCENT = 100;
const WEIGHT_DIGITS = 2;
// More than this many reasons or words would push a sentence past what a
// viewer reads at a glance; the technical detail lists them all.
const REASONS_SPOKEN = 2;
const WORDS_SPOKEN = 2;
const TOP_WORDS_SPOKEN = 2;

const KIND_NOUNS: Record<MaskKind, string> = {
  email: 'email address',
  phone: 'phone number',
  order: 'order number',
  card: 'card number',
};

// The masker looks for these four kinds and nothing else, so this is all a clean ticket can claim.
export const NONE_FOUND = 'no email, phone, order or card number found';

function percent(share: number): string {
  return `${Math.round(share * PERCENT)}%`;
}

function quoted(words: readonly string[]): string {
  return words.map((word) => `"${word}"`).join(' and ');
}

function joinList(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined || items.length === 1) {
    return last ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${last}`;
}

// One entry per kind, in the order each first appeared in the text.
function maskedCounts(found: readonly MaskKind[]): string[] {
  const counts = new Map<MaskKind, number>();
  for (const kind of found) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${n} ${KIND_NOUNS[kind]}${n === 1 ? '' : 's'}`);
}

function reasonPhrase(reason: FlagReason): string {
  switch (reason.kind) {
    case 'rule':
      return `the ${reason.reason} safety rule matched ${quoted(reason.words.slice(0, WORDS_SPOKEN))}`;
    case 'category':
      return `the model reads it as ${reason.category}, a kind that always goes to a person`;
    case 'low confidence':
      return `the model is only ${percent(reason.confidence)} sure, below the ${percent(CONFIDENCE_FLOOR)} line`;
  }
}

function guardrailsPlain(trail: TicketTrail): string {
  const { guard, category } = trail;
  if (guard.flagged) {
    const spoken = guard.reasons.slice(0, REASONS_SPOKEN).map(reasonPhrase);
    return `This ticket waits for a person because ${spoken.join(' and ')}.`;
  }
  if (guard.clearedBySecondCheck) {
    return (
      `The model's guess was weak (${percent(category.confidence)}), but a second check found ` +
      'its two best guesses are ordinary, so the ticket goes straight through.'
    );
  }
  return (
    `The model is ${percent(category.confidence)} sure and no safety rule matched, ` +
    'so the ticket goes straight through without a person looking at it.'
  );
}

// The model reads the masked text, where a label such as [CARD_NUMBER] is one word of its own (card_number). A
// label is the page's, not the customer's, so it is not spoken as a word the model leaned on; the technical
// detail still lists it.
const MASK_WORDS = new Set(Object.values(MASK_TOKENS).map((token) => token.slice(1, -1).toLowerCase()));

function spokenTerms(trail: TicketTrail): string[] {
  return trail.category.topTerms.map((top) => top.term).filter((term) => !term.split(' ').some((word) => MASK_WORDS.has(word)));
}

function plainFor(trail: TicketTrail, stage: Stage): string {
  switch (stage) {
    case 'intake':
      return 'The ticket arrived and passed the basic checks: it has some text and is not too long.';
    case 'privacy': {
      const counts = maskedCounts(trail.found);
      return counts.length === 0
        ? `Privacy: ${NONE_FOUND}, so nothing was hidden.`
        : `Privacy: hid ${joinList(counts)}.`;
    }
    case 'classify': {
      const leaning = spokenTerms(trail).slice(0, TOP_WORDS_SPOKEN);
      const leaned = leaning.length > 0 ? `, leaning on ${quoted(leaning)}` : '';
      return (
        `After the privacy step, the model picks ${trail.category.label}, ` +
        `${percent(trail.category.confidence)} sure${leaned}.`
      );
    }
    case 'guardrails':
      return guardrailsPlain(trail);
    case 'review':
      return trail.review === undefined
        ? 'No review was needed, so no person looked at this ticket.'
        : 'The simulated reviewer, a stand-in for a person, read the ticket and chose ' +
            `${trail.review.category} with ${trail.review.priority} priority.`;
    case 'done': {
      const { route, category, priority, by } = trail.final;
      return (
        `The ticket goes to ${route} as ${category}, priority ${priority}, ` +
        `decided by ${by === 'model' ? 'the model' : 'the reviewer'}.`
      );
    }
  }
}

function flagRow(reason: FlagReason): DetailRow {
  switch (reason.kind) {
    case 'rule':
      return {
        label: 'Flag: rule',
        value: `${reason.reason} (words: ${reason.words.map((word) => `"${word}"`).join(', ')})`,
      };
    case 'category':
      return { label: 'Flag: category check', value: `${reason.category} always goes to a person` };
    case 'low confidence':
      return {
        label: 'Flag: low confidence',
        value: `${reason.confidence.toFixed(2)} is below the ${CONFIDENCE_FLOOR.toFixed(2)} floor`,
      };
  }
}

function detailFor(trail: TicketTrail): DetailRow[] {
  const { category, guard } = trail;
  const flags: DetailRow[] =
    guard.reasons.length > 0
      ? guard.reasons.map(flagRow)
      : [{ label: 'Flags', value: guard.clearedBySecondCheck ? 'none (cleared by a second check)' : 'none' }];
  const counts = maskedCounts(trail.found);
  return [
    { label: 'Confidence', value: `${category.confidence.toFixed(2)} for ${category.label}` },
    { label: 'Confidence floor', value: CONFIDENCE_FLOOR.toFixed(2) },
    ...flags,
    ...category.topTerms.map(({ term, weight }) => ({
      label: 'Top word',
      value: `"${term}" (weight ${weight.toFixed(WEIGHT_DIGITS)})`,
    })),
    { label: 'Masked', value: counts.length > 0 ? counts.join(', ') : 'nothing' },
  ];
}

/**
 * Writes what one stage did to one ticket, for a viewer who is not technical.
 *
 * @param trail What the pipeline decided for the ticket.
 * @param stage The stage to speak for.
 * @returns One or two plain sentences, and the technical detail behind them
 *   (confidence, the floor, every flag reason, the top words and what was masked).
 */
export function narrate(trail: TicketTrail, stage: Stage): Narration {
  return { plain: plainFor(trail, stage), detail: detailFor(trail) };
}
