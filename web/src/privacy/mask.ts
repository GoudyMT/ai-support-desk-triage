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
// - card: 13 to 19 digits, single spaces or dashes between them.
// - order: "ORD-" plus digits, or 4+ digits (optionally after "#") that follow
//   the word "order" / "order number". The word stays, only the number goes.
// - phone: 7 to 15 digits with optional "+", parentheses, spaces, dots or
//   dashes. It cannot start right after a digit (so it never takes the tail of
//   a longer number or date) and skips yyyy-mm-dd / yyyy.mm.dd dates.
const PII =
  /(?<card>(?<!\d)\d(?:[ -]?\d){12,18}(?!\d))|(?<email>[\w.%+-]+@[a-z\d-]+(?:\.[a-z\d-]+)+)|(?<order>\bord-\d+|(?<=\border(?:\s+number)?\s*)#?\d{4,}(?!\d))|(?<phone>(?<!\d[ .-]?)(?!\d{4}[-.]\d{2}[-.]\d{2}(?!\d))\+?\(?\d(?:[ .()-]{0,2}\d){6,14}(?!\d))/gi;

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
