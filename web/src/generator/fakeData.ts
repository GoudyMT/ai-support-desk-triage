import type { Category } from '../domain/labels';
import type { Rng } from './rng';

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

const SENTENCES: Record<Kind, readonly string[]> = {
  email: ['You can reach me at {value}.', 'My email is {value}.', 'Please reply to {value}.'],
  phone: ['Call me on {value}.', 'My number is {value}.'],
  order: ['My order number is {value}.', 'Order {value}.'],
  card: ['The card I used is {value}.', 'It was my card {value}.'],
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
export function fakeSnippet(rng: Rng, category: Category): string {
  const kind = rng.pick(KINDS_BY_CATEGORY[category] ?? DEFAULT_KINDS);
  return rng.pick(SENTENCES[kind]).replace('{value}', fakeValue(rng, kind));
}
