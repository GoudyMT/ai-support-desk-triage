import type { Category } from '../domain/labels';
import type { Rng } from './rng';
import type { Template } from './templates';

export type HardCase = 'vague' | 'threatening' | 'two-issues' | 'typos' | 'keyword-trap' | 'polite-security';

// Fixed before any training so the model is never tuned to its own test mix.
// At most one hard case per ticket; the rest of the stream is plain tickets.
export const HARD_CASE_SHARES: Record<HardCase, number> = {
  vague: 0.06,
  threatening: 0.04,
  'two-issues': 0.08,
  typos: 0.1,
  'keyword-trap': 0.04,
  'polite-security': 0.04,
};

// No category word may appear here: see CATEGORY_TRIGGER_WORDS.
export const VAGUE_TEMPLATES: readonly Template[] = [
  { text: 'Something is wrong. Please help.' },
  { text: 'I have a problem. Can you call me?' },
  { text: 'Hi, I need help with my thing. Thanks.' },
  { text: 'Hello? Is anyone there? I have been trying to get this sorted for a while.' },
  { text: 'Please fix it. You know what I mean.' },
  { text: "Not sure who to ask. It happened again today and I don't know what to do." },
  { text: 'I have a question but it is complicated. Can we talk?' },
];

export const THREAT_PHRASES: readonly string[] = [
  'Fix this today or I will take this to my lawyer and every news outlet I can find.',
  'If I do not hear back by tomorrow you will regret it.',
  'You people are useless. Sort this out now or I will come down to your office and make a scene.',
  'I will make sure everyone I know hears what a rotten company you are.',
  'Fix it or I will dispute everything and ruin your reputation online.',
  'Do not ignore me again. You will pay for this.',
];

// Sentence-length joiners, so the second template keeps its own capital letter.
export const TWO_ISSUE_CONNECTORS: readonly string[] = [
  'Also.',
  'One more thing.',
  'Separate issue.',
  'And another thing.',
  'While I am writing.',
  'Unrelated, but.',
];

// Each polite ticket is a real security report with none of hacked,
// unauthorized, breach or stolen, so a keyword rule cannot find it.
export const POLITE_SECURITY_TEMPLATES: readonly Template[] = [
  {
    text: 'Hello, I hope you are having a good day. I noticed a sign-in alert from a city I have never been to, and it was not me. Could someone please look at whether another person is using my login? Thank you so much.',
  },
  {
    text: "Good afternoon. Sorry to bother you, but my {product} sent invitations to people I don't know. I did not send them. Would you mind checking what happened? I would be very grateful.",
  },
  {
    text: "Hi, thank you for your help last time. I think someone else may know my password, because my settings changed overnight and I didn't change them. Could you please secure my account when you have a moment?",
  },
  {
    text: 'Hello team, a quick and polite note: my phone was lost on the train this morning and it is still signed in to {product}. Could you please end that session so nobody else can use it?',
  },
  {
    text: "Dear support, I wanted to flag, kindly, that I received a password reset email I never asked for, twice today. I'm a little worried that somebody is trying to get into my account. Many thanks.",
  },
  {
    text: "Hi there! No rush at all, but I found two devices in my {product} device list that I don't recognize. Could you help me remove them and make sure my account is safe? Thanks a lot.",
  },
];

// What v0's text.includes() rules would answer for each innocent substring.
// Matching is by substring on purpose: that is how "Canada" fooled "ada".
export const TRAP_WORDS: Record<string, Category> = {
  ada: 'Accessibility Support',
  charge: 'Billing',
  account: 'Account Access',
  access: 'Account Access',
  bug: 'Technical Issue',
};

// One or more per category so the category draw (and so every category share)
// does not change when a ticket becomes a trap. Each text carries a trap word
// whose suggested category is not the template's own.
export const TRAP_TEMPLATES: Record<Category, readonly Template[]> = {
  Billing: [
    {
      text: 'I was billed twice for the {product} licence for our Nevada office. Please refund one of them.',
      billingDispute: true,
      severe: true,
    },
  ],
  'Technical Issue': [
    { text: '{product} drains my battery. I have to charge my phone three times a day since the last update.' },
  ],
  'Account Access': [
    { text: 'Ada on my team cannot get into {product}. Her password reset link says it expired.' },
  ],
  'Security Concern': [
    { text: 'A sign-in from Canada showed up at 3am and I have never been there. Someone else is using my login.' },
  ],
  'Accessibility Support': [
    { text: 'My screen reader will not read the Pay button at checkout, so I cannot complete the charge.' },
  ],
  'Product Question': [
    { text: 'Does the {plan} account for time zones when scheduling reports?' },
    { text: 'Ada from your sales team said the {plan} includes {feature}. Is that right?' },
    { text: 'Can the API help me debug my own scripts against sample data?' },
  ],
  'Urgent Complaint': [
    { text: 'Your Canada support line never picks up. I have called five times and I am fed up with this company.' },
  ],
  'Shipping/Order Issue': [
    { text: 'My order to Canada has been stuck at customs for {days} days. Any update?', statusQuestion: true },
    { text: 'The phone accessory I ordered came without the cable.' },
  ],
  Other: [
    { text: 'Our team in Canada would love to put your logo in a case study. Who handles that?' },
  ],
};

const WORD_PATTERN = /[A-Za-z]{4,}/g;
const TYPO_RATE = 0.125;
const SWAP_CHANCE = 0.5;

function mangle(rng: Rng, word: string): string {
  const swapAt = rng.int(0, word.length - 2);
  if (rng.chance(SWAP_CHANCE) && word[swapAt] !== word[swapAt + 1]) {
    return word.slice(0, swapAt) + word[swapAt + 1] + word[swapAt] + word.slice(swapAt + 2);
  }
  // Drops any letter but the first (the last one can go too). Removing one
  // letter always changes the word, even from a double like "ee" or "ll",
  // which a swap would leave as it was.
  const dropAt = rng.int(1, word.length - 1);
  return word.slice(0, dropAt) + word.slice(dropAt + 1);
}

// Roughly one word in eight is swapped or loses a letter; one is forced if
// chance picked none, so a typos ticket never comes out clean. Digits,
// punctuation and spacing are untouched.
export function introduceTypos(rng: Rng, text: string): string {
  const words = text.match(WORD_PATTERN) ?? [];
  const chosen = new Set<number>();
  words.forEach((_word, position) => {
    if (rng.chance(TYPO_RATE)) {
      chosen.add(position);
    }
  });
  if (chosen.size === 0 && words.length > 0) {
    chosen.add(rng.int(0, words.length - 1));
  }
  let position = -1;
  return text.replace(WORD_PATTERN, (word) => {
    position += 1;
    return chosen.has(position) ? mangle(rng, word) : word;
  });
}
