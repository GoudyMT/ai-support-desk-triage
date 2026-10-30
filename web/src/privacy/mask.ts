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
// position the alternatives are tried in this order, so a card number is never
// read as a phone number.
// Speed on long input: the gaps, the labels and the email local part are
// bounded, because a regex that scans back or forward over an unbounded gap
// from every position is quadratic. The repeats left unbounded (the card digits,
// the order digits and the order list) each consume a run greedily and nothing
// after them can fail, so they never back up across a long run.
// - card: any run of 13 or more digits with up to 3 spaces, dots, dashes or
//   parentheses between digits. There is no upper limit, so no digit of a long
//   run survives; two phone numbers written back to back are such a run.
// - email: up to 64 letters, digits or . _ % + - (the longest local part an
//   address may have), "@", then a dotted domain.
// - order: "ORD-" plus digits, or a number of 4+ digits (optionally after "#")
//   that follows the word "order", "orders" or "ord", with up to 3 labels
//   between them (number(s), no, nr, id, ref, reference, is, was, "#", ":").
//   Further 4+ digit numbers joined to it by "," / "and" / "or" / "&" / "/"
//   belong to the same order list and are masked with it. The word and labels
//   stay; only the numbers go.
// - date: yyyy-mm-dd / yyyy.mm.dd. It is matched only to be skipped, so its
//   digits are never taken for a phone number.
// - phone: 7 to 15 digits with optional "+", parentheses, spaces, dots or
//   dashes. It cannot start right after a digit: a digit run too long to be a
//   phone number is left to the card rule, instead of a phone being cut out of
//   the middle of it with the first digits left behind.
const PII =
  /(?<card>(?<!\d)\d(?:[ .()-]{0,3}\d){12,})|(?<email>[\w.%+-]{1,64}@[a-z\d-]+(?:\.[a-z\d-]+)+)|(?<order>\bord-\d+|(?<=\b(?:orders?|ord)(?:\s{0,3}(?:numbers?|no\.?|nr\.?|id|ref(?:erence)?|is|was|[#:])){0,3}\s{0,3})#?\d{4,}(?:\s{0,3}(?:,|and|or|&|\/)\s{0,3}#?\d{4,})*)|(?<date>(?<!\d)\d{4}[-.]\d{2}[-.]\d{2}(?!\d))|(?<phone>(?<!\d)\+?\(?\d(?:[ .()-]{0,3}\d){6,14}(?!\d))/gi;

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
