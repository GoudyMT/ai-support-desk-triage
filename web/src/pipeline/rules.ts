import type { Priority, ReviewReason } from '../domain/labels';
import { MASK_TOKENS } from '../privacy/mask';

// Keyword rules for the tickets a person must see. The category model reads a
// billing dispute as plain "Billing" and a vague ticket as plain "Other", so
// only the words themselves can flag them. Each list is what a support lead
// listens for under that reason. Lists lean toward catching: a false flag
// costs a reviewer a glance, a missed sensitive ticket costs far more.
//
// Entries are lowercase ASCII. A space inside an entry matches any run of
// spaces or a hyphen, and an apostrophe matches a straight or curly one.
// The key order below follows the ReviewReason union, which is the order
// matchRules reports in.
export const REVIEW_RULES: Record<ReviewReason, readonly string[]> = {
  'security incident': [
    'hack',
    'hacked',
    'hacker',
    'hackers',
    'hacking',
    'breach',
    'breached',
    'data breach',
    'compromised',
    'unauthorized',
    'unauthorised',
    'stolen',
    'theft',
    'identity theft',
    'phishing',
    'phished',
    'scam',
    'scammed',
    'fraud',
    'fraudulent',
    'malware',
    'ransomware',
    'virus',
    'leaked',
    'data leak',
    'account takeover',
    'taken over',
    'suspicious login',
    'suspicious activity',
    'someone else logged in',
    'someone logged in',
    'someone is using my account',
    'someone accessed',
    'did not log in',
    "didn't log in",
    'security incident',
  ],
  'accessibility issue': [
    'accessibility',
    'accessible',
    'screen reader',
    'screen readers',
    'voiceover',
    'talkback',
    'nvda',
    'jaws',
    'keyboard only',
    'keyboard navigation',
    'color blind',
    'colour blind',
    'colorblind',
    'contrast',
    'low vision',
    'blind',
    'visually impaired',
    'deaf',
    'hard of hearing',
    'hearing impaired',
    'captions',
    'closed captions',
    'subtitles',
    'alt text',
    'screen magnifier',
    'magnifier',
    'assistive',
    'speech recognition',
    'voice control',
    'sign language',
    'dyslexia',
    'dyslexic',
    'disability',
    'disabilities',
    'motor impairment',
    'tremor',
    'wcag',
    'ada compliance',
    'cannot use a mouse',
    "can't use a mouse",
  ],
  'billing dispute': [
    'charge',
    'charges',
    'charged',
    'overcharged',
    'double billed',
    'billed twice',
    'billed incorrectly',
    'billing error',
    'billing mistake',
    'wrong amount',
    'incorrect amount',
    'invoice error',
    'dispute',
    'disputed',
    'disputing',
    'chargeback',
    'refund',
    'refunds',
    'refunded',
    'money back',
    'reimburse',
    'reimbursement',
  ],
  'threatening language': [
    'sue',
    'lawsuit',
    'lawyer',
    'attorney',
    'legal action',
    'legal team',
    'court',
    'attorney general',
    'consumer protection',
    'regulator',
    'report you',
    'reporting you',
    'make you pay',
    'you will pay',
    "you'll pay",
    'you will regret',
    "you'll regret",
    'will destroy',
    'ruin your',
    'destroy your',
    'i will hurt',
    "i'll hurt",
    'i will kill',
    "i'll kill",
    'kill you',
    'hurt you',
    'go public',
    'idiot',
    'idiots',
    'stupid',
    'moron',
    'morons',
    'incompetent',
    'pathetic',
    'useless',
    'screw you',
    'shut up',
    'go to hell',
  ],
  'escalated complaint': [
    'unacceptable',
    'furious',
    'outraged',
    'outrageous',
    'livid',
    'angry',
    'fed up',
    'had enough',
    'last straw',
    'disgusted',
    'disgraceful',
    'appalling',
    'ridiculous',
    'terrible',
    'awful',
    'worst',
    'frustrated',
    'unhappy',
    'dissatisfied',
    'disappointed',
    'complaint',
    'complain',
    'complaining',
    'formal complaint',
    'manager',
    'supervisor',
    'escalate',
    'escalated',
    'escalation',
    'third time',
    'fourth time',
    'still waiting',
    'no response',
    'ignored',
    'cancel my account',
    'cancelling',
    'canceling',
    'switching to',
    'never again',
    'never recommend',
    'take my business',
    'lose me as a customer',
    'i demand',
  ],
  'vague ticket': [
    'something is wrong',
    "something's wrong",
    'something went wrong',
    'something is off',
    'something is not right',
    "something isn't right",
    'something happened',
    'i have a problem',
    'i have an issue',
    'there is a problem',
    "there's a problem",
    'there is an issue',
    "there's an issue",
    'having a problem',
    'having an issue',
    'having issues',
    'having problems',
    'having trouble',
    'not sure what is wrong',
    "not sure what's wrong",
    "don't know what is wrong",
    "don't know what's wrong",
    'no idea what',
    'acting up',
    'acting weird',
    'weird',
    'strange',
    'it is not working',
    "it's not working",
    "it isn't working",
    "it doesn't work",
    'it does not work',
    "it won't work",
    'it stopped working',
    'it is broken',
    "it's broken",
    'this is not working',
    "this isn't working",
    "this doesn't work",
    'this is broken',
    'need help',
    'please help',
    'help me',
  ],
};

// The priority a rule raises a ticket to: the lowest priority the labeling
// rules give that kind of ticket. A rule only ever raises a priority; it never
// lowers one the model already set higher.
export const RULE_PRIORITY: Record<ReviewReason, Priority> = {
  'security incident': 'Urgent',
  'accessibility issue': 'High',
  'billing dispute': 'Medium',
  'threatening language': 'Urgent',
  'escalated complaint': 'High',
  'vague ticket': 'Medium',
};

// Reasons in the order of the ReviewReason union, which REVIEW_RULES follows.
const REASON_ORDER = Object.keys(REVIEW_RULES) as ReviewReason[];

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const CURLY_APOSTROPHE = new RegExp(String.fromCharCode(0x2019), 'g');

// The masker's tokens (such as [CARD_NUMBER]) hold words like "card" and
// "number" that the customer never wrote. They are blanked before matching.
const MASK_TOKEN_PATTERN = new RegExp(
  Object.values(MASK_TOKENS)
    .map((token) => token.replace(REGEX_SPECIALS, '\\$&'))
    .join('|'),
  'gi',
);

// A word matches only when no letter or digit touches it on either side, so
// "charge" never matches "charger" and "hack" never matches "hackathon".
// Underscore is not counted as a word character here on purpose: the mask
// blanking above is what keeps token words out, not a quirk of the regex.
function wholeWordPattern(entry: string): RegExp {
  const body = entry
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(/ /g, '[\\s-]+');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

const COMPILED_RULES = REASON_ORDER.map((reason) => ({
  reason,
  entries: REVIEW_RULES[reason].map((word) => ({ word, pattern: wholeWordPattern(word) })),
}));

// Never throws and never echoes its input: an empty or odd text just matches nothing.
export function matchRules(maskedText: string): { reason: ReviewReason; words: string[] }[] {
  const text = maskedText
    .replace(MASK_TOKEN_PATTERN, ' ')
    .toLowerCase()
    .replace(CURLY_APOSTROPHE, "'");
  const hits: { reason: ReviewReason; words: string[] }[] = [];
  for (const { reason, entries } of COMPILED_RULES) {
    const words = entries.filter(({ pattern }) => pattern.test(text)).map(({ word }) => word);
    if (words.length > 0) hits.push({ reason, words });
  }
  return hits;
}
