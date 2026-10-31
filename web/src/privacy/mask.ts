export type MaskKind = 'email' | 'phone' | 'order' | 'card';

// Underscored so a model's tokenizer reads "card_number" and never the plain
// word "card", which would teach it a cue the real text does not carry.
export const MASK_TOKENS: Record<MaskKind, string> = {
  email: '[EMAIL_ADDRESS]',
  phone: '[PHONE_NUMBER]',
  order: '[ORDER_NUMBER]',
  card: '[CARD_NUMBER]',
};

export interface MaskResult {
  text: string;
  found: MaskKind[];
}

const KINDS: readonly MaskKind[] = ['card', 'email', 'order', 'phone'];

// One pass over the text, so `found` comes out in order of appearance. At any
// position the alternatives are tried in this order. The email goes first so a
// card-like run in front of "@" is part of an address; the order goes before the
// card so a labelled list such as "orders 48213/48214/48215", which is 15 digits
// with slashes, stays an order. Both go before the phone, so a card number is
// never read as a phone number.
// Speed on long input: the gaps, the labels and the email local part are
// bounded, because a regex that scans back or forward over an unbounded gap
// from every position is quadratic. The repeats left unbounded (the card digits,
// the order digits and the order list) each consume a run greedily and nothing
// after them can fail, so they never back up across a long run.
// - email: up to 64 letters (of any script, with combining marks), digits (of
//   any script), zero-width (non-)joiners or . _ % + - ' # (the longest local
//   part an address may have), "@", then a dotted domain of letters and digits.
//   The joiner is an alternative beside the class because the linter refuses
//   it inside one.
// - order: "ORD-" plus digits, or a number of 4+ digits (optionally after "#")
//   that follows the word "order", "orders" or "ord", with up to 3 labels
//   between them (number(s), no, nr, id, ref, reference, is, was, "#", ":").
//   Further 4+ digit numbers joined to it by "," / "and" / "or" / "&" / "/"
//   belong to the same order list and are masked with it. The word and labels
//   stay; only the numbers go.
// - card: any run of 13 or more digits with up to 3 spaces, dots, dashes,
//   slashes, underscores, parentheses, no-break spaces (U+00A0, U+202F) or en
//   dashes (U+2013) between digits. There is no upper limit, so no digit of a
//   long run survives; two phone numbers written back to back are such a run.
// - date: a plausible yyyy-mm-dd / yyyy.mm.dd (year 19xx or 20xx, month 01-12,
//   day 01-31) with no further "-" or "." group after it. It is matched only to
//   be skipped, so its digits are never taken for a phone number. Anything
//   else of that shape, such as 0475-12-34-56, is left to the phone rule.
// - phone: 7 to 15 digits with optional "+", parentheses, spaces, dots, dashes,
//   no-break spaces or en dashes. It cannot start right after a digit: a digit
//   run too long to be a phone number is left to the card rule, instead of a
//   phone being cut out of the middle of it with the first digits left behind.
const PII =
  /(?<email>(?:[\w.%+'#\p{L}\p{M}\p{Nd}\u{200C}-]|\u{200D}){1,64}@[\p{L}\p{M}\d-]+(?:\.[\p{L}\p{M}\d-]+)+)|(?<order>\bord-\d+|(?<=\b(?:orders?|ord)(?:\s{0,3}(?:numbers?|no\.?|nr\.?|id|ref(?:erence)?|is|was|[#:])){0,3}\s{0,3})#?\d{4,}(?:\s{0,3}(?:,|and|or|&|\/)\s{0,3}#?\d{4,})*)|(?<card>(?<!\d)\d(?:[ .()/_\u{A0}\u{202F}\u{2013}-]{0,3}\d){12,})|(?<date>(?<!\d)(?:19|20)\d{2}[-.](?:0[1-9]|1[0-2])[-.](?:0[1-9]|[12]\d|3[01])(?![-.]?\d))|(?<phone>(?<!\d)\+?\(?\d(?:[ .()\u{A0}\u{202F}\u{2013}-]{0,3}\d){6,14}(?!\d))/giu;

export function maskText(text: string): MaskResult {
  const found: MaskKind[] = [];
  let masked = '';
  let copiedTo = 0;
  for (const match of text.matchAll(PII)) {
    const kind = KINDS.find((candidate) => match.groups?.[candidate] !== undefined);
    if (kind === undefined) {
      continue;
    }
    found.push(kind);
    masked += text.slice(copiedTo, match.index) + MASK_TOKENS[kind];
    copiedTo = match.index + match[0].length;
  }
  return { text: masked + text.slice(copiedTo), found };
}
