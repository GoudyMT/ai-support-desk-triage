import type { Category } from '../domain/labels';
import type { Rng } from './rng';
import { poolOf, type Split } from './templates';

// Share of tickets that carry fake personal data, so the privacy masking step
// has something to find.
export const FAKE_DATA_SHARE = 0.15;

type Kind = 'email' | 'phone' | 'order' | 'card';

// Only Billing and Shipping/Order tickets talk about cards and orders. Every
// other category, vague tickets included, gets a kind whose sentence names no
// category word.
const DEFAULT_KINDS: readonly Kind[] = ['email', 'phone'];
const KINDS_BY_CATEGORY: Partial<Record<Category, readonly Kind[]>> = {
  Billing: ['card', 'order', 'email'],
  'Shipping/Order Issue': ['order', 'email', 'phone'],
};

const EMAIL_NAMES = ['jordan.lee', 'sam.rivera', 'priya.shah', 'marcus.cole', 'elena.petrova', 'tomas.novak', 'mei.tan', 'dana.brooks'];
// Reserved domains that can never reach a real inbox.
const EMAIL_DOMAINS = ['example.com', 'example.org'];

// Split between the training and held-out pools like every other wording list,
// so the same frame ("The card I used is") is not the cue for a category in
// both. Email and phone frames reach every category, vague tickets included, so
// they name no category word.
export const FAKE_SENTENCES: Record<Kind, readonly string[]> = {
  email: [
    'You can reach me at {value}.',
    'My email is {value}.',
    'Please reply to {value}.',
    'Write to me at {value} if that is easier.',
    'Best to email me on {value}.',
    'My address for replies is {value}.',
    'Send your answer to {value}.',
    'I check {value} every day.',
  ],
  phone: [
    'Call me on {value}.',
    'My number is {value}.',
    'You can phone me on {value}.',
    'I am easiest to reach on {value}.',
    'Ring me on {value} any weekday.',
    'The best number for me is {value}.',
    'Text or call {value}.',
    'Try me on {value} after lunch.',
  ],
  order: [
    'My order number is {value}.',
    'Order {value}.',
    'The reference is {value}.',
    'It was order {value}.',
    'I ordered under {value}.',
    'My reference number is {value}.',
    'The order I mean is {value}.',
    'This is about {value}.',
  ],
  card: [
    'The card I used is {value}.',
    'It was my card {value}.',
    'I paid with card {value}.',
    'The card on file is {value}.',
    'The card number is {value}.',
    'The payment came from {value}.',
    'I used this card: {value}.',
    'It went through on {value}.',
  ],
};

const CARD_PAYLOAD_DIGITS = 15;
const CARD_GROUP = 4;
const DIGITS_IN_BASE = 10;
const MAX_DIGIT = 9;
const MAX_EMAIL_NUMBER = 99;
// 555-0100 to 555-0199 is the block reserved for fiction.
const PHONE_PREFIX = '555-01';
const PHONE_SUFFIX_DIGITS = 2;
const MAX_PHONE_SUFFIX = 99;
const MIN_ORDER_NUMBER = 100000;
const MAX_ORDER_NUMBER = 999999;

function randomDigits(rng: Rng, count: number): string {
  let digits = '';
  for (let i = 0; i < count; i += 1) {
    digits += String(rng.int(0, MAX_DIGIT));
  }
  return digits;
}

// The digit that would make `payload` pass the Luhn check.
function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let position = 0; position < payload.length; position += 1) {
    let digit = Number(payload[payload.length - 1 - position]);
    if (position % 2 === 0) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
  }
  return (DIGITS_IN_BASE - (sum % DIGITS_IN_BASE)) % DIGITS_IN_BASE;
}

// Card-shaped but never valid: the last digit is moved off the Luhn check
// digit, so no payment system would accept it.
function fakeCard(rng: Rng): string {
  const payload = `4${randomDigits(rng, CARD_PAYLOAD_DIGITS - 1)}`;
  const wrong = (luhnCheckDigit(payload) + rng.int(1, MAX_DIGIT)) % DIGITS_IN_BASE;
  const digits = `${payload}${wrong}`;
  const groups: string[] = [];
  for (let at = 0; at < digits.length; at += CARD_GROUP) {
    groups.push(digits.slice(at, at + CARD_GROUP));
  }
  return groups.join(' ');
}

function fakeValue(rng: Rng, kind: Kind): string {
  switch (kind) {
    case 'email':
      return `${rng.pick(EMAIL_NAMES)}${rng.int(1, MAX_EMAIL_NUMBER)}@${rng.pick(EMAIL_DOMAINS)}`;
    case 'phone':
      return `${PHONE_PREFIX}${String(rng.int(0, MAX_PHONE_SUFFIX)).padStart(PHONE_SUFFIX_DIGITS, '0')}`;
    case 'order':
      return `ORD-${rng.int(MIN_ORDER_NUMBER, MAX_ORDER_NUMBER)}`;
    case 'card':
      return fakeCard(rng);
  }
}

// One sentence of fake personal data to append to a ticket about `category`.
export function fakeSnippet(rng: Rng, category: Category, split: Split = 'all'): string {
  const kind = rng.pick(KINDS_BY_CATEGORY[category] ?? DEFAULT_KINDS);
  return rng.pick(poolOf(FAKE_SENTENCES[kind], split)).replace('{value}', fakeValue(rng, kind));
}

// The made-up values a template's {slots} are filled with. Like the frames above,
// the names are cut into folds, so a product held out in one fold is a product
// the model never trained on.

// May is left out: it is also a common word ("it may concern"), so a model could
// not tell the month held out in one fold from the word in the others' wording.
export const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Slot values are coined names with no word a template uses elsewhere: a word
// that belongs to one fold's product but sits in the other folds' wording would
// let the model read the category off the product name.
export const PRODUCTS: readonly string[] = [
  'Nimbus Hub', 'Harbor Suite', 'Quillfold Studio', 'Orchard Console', 'Lantern Deck', 'Pebble Pad', 'Saffron Portal', 'Juniper Lab',
];
export const PLANS: readonly string[] = [
  'Pro plan', 'Crew plan', 'Starter plan', 'Business plan', 'Basic plan', 'Growth plan', 'Premium plan', 'Enterprise plan',
];
export const FEATURES: readonly string[] = [
  'kanban boards', 'weekly digest', 'idea maps', 'shared cursors', 'task templates', 'pinned views', 'burndown charts', 'gantt charts',
];

const CENTS_PER_DOLLAR = 100;
const CENTS_PAD = 2;
const MIN_AMOUNT_DOLLARS = 9;
const MAX_AMOUNT_DOLLARS = 299;
// Day 28 exists in every month, so no date is ever impossible.
const MAX_DAY_OF_MONTH = 28;
const MIN_WAIT_DAYS = 2;
const MAX_WAIT_DAYS = 21;
const MIN_LOAD_SECONDS = 8;
const MAX_LOAD_SECONDS = 40;

// `slot` looks up (and fixes) another slot's value, so one slot can depend on
// another.
type SlotFill = (rng: Rng, slot: (name: string) => string, split: Split) => string;

const SLOTS: Record<string, SlotFill> = {
  product: (rng, _slot, split) => rng.pick(poolOf(PRODUCTS, split)),
  plan: (rng, _slot, split) => rng.pick(poolOf(PLANS, split)),
  // A comparison between a plan and itself reads as nonsense.
  otherPlan: (rng, slot, split) => rng.pick(poolOf(PLANS, split).filter((plan) => plan !== slot('plan'))),
  feature: (rng, _slot, split) => rng.pick(poolOf(FEATURES, split)),
  amount: (rng) =>
    `$${rng.int(MIN_AMOUNT_DOLLARS, MAX_AMOUNT_DOLLARS)}.${String(rng.int(0, CENTS_PER_DOLLAR - 1)).padStart(CENTS_PAD, '0')}`,
  date: (rng, _slot, split) => `${rng.pick(poolOf(MONTHS, split))} ${rng.int(1, MAX_DAY_OF_MONTH)}`,
  days: (rng) => String(rng.int(MIN_WAIT_DAYS, MAX_WAIT_DAYS)),
  seconds: (rng) => String(rng.int(MIN_LOAD_SECONDS, MAX_LOAD_SECONDS)),
};

// A slot named twice in one template gets the same value both times, so the
// text never contradicts itself.
export function fillSlots(text: string, rng: Rng, split: Split = 'all'): string {
  const chosen = new Map<string, string>();
  const slot = (name: string): string => {
    const known = chosen.get(name);
    if (known !== undefined) {
      return known;
    }
    // An own-property check: a plain object also answers to names every object
    // inherits, such as constructor and __proto__.
    const fill = Object.hasOwn(SLOTS, name) ? SLOTS[name] : undefined;
    if (fill === undefined) {
      throw new Error('E_UNKNOWN_SLOT');
    }
    const value = fill(rng, slot, split);
    chosen.set(name, value);
    return value;
  };
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => slot(name));
}
