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
  { text: 'It stopped doing what it did yesterday and nobody knows what changed.' },
  { text: 'Can a real person call me back this afternoon? It is hard to explain in writing.' },
  { text: 'I tried what you told me last time and it did not help. Where do we go from here?' },
  { text: 'A friend said I should write to you about this. Maybe this is the wrong place.' },
  { text: 'Same thing as last week again. I would rather not go through it all in writing.' },
];

export const THREAT_PHRASES: readonly string[] = [
  'Fix this today or I will take this to my lawyer and every news outlet I can find.',
  'If I do not hear back by tomorrow you are going to be sorry.',
  'You people are useless. Get this sorted by tonight, or I will turn up at your office and cause a scene.',
  'I will make sure everyone I know hears what a rotten company you are.',
  'Fix it or I will dispute everything and ruin your reputation online.',
  'Do not ignore me again. You will pay for this.',
  'One more week of this and I am dropping you and telling every colleague I have why.',
  'I have screenshots of all of it and I will post them publicly if nobody fixes this.',
  'Consider this my final warning. The next message goes to your chief executive and the press.',
  'I am done being polite. Sort this out today, or this goes very public.',
  'My solicitor has already been told about this and will write to you if I hear nothing by Friday.',
  'Keep ignoring me and every review site will hear exactly what happened, I promise you.',
];

// Sentence-length joiners, so the second template keeps its own capital letter.
export const TWO_ISSUE_CONNECTORS: readonly string[] = [
  'Also.',
  'One more thing.',
  'Separate issue.',
  'And another thing.',
  'While I am writing.',
  'Unrelated, but.',
  'On another note.',
  'Second question.',
  'Something else.',
  'Meanwhile.',
  'Next problem.',
  'Totally different matter.',
];

// Each polite ticket is a real security report with none of hacked,
// unauthorized, breach or stolen, so a keyword rule cannot find it. The report
// itself is plain; its politeness comes from the shared openers, requests and
// closers (see addVoice), because a polite phrase found only in these templates
// would tell the model "security" by its manners.
export const POLITE_SECURITY_TEMPLATES: readonly Template[] = [
  { text: 'The alert on my phone says a sign-in happened from a city far from where I live, and nobody here did that.' },
  { text: 'My {product} sent invitations to people I do not know, though I never sent them.' },
  { text: 'My settings changed overnight although I had not touched them, so someone else may know my password.' },
  { text: 'My phone was lost on the train this morning and it still has {product} open on it.' },
  { text: 'A password reset email reached me twice today that nobody here requested, and somebody may be trying to enter my account.' },
  { text: 'Two devices in my {product} device list are not ones I have ever used.' },
  { text: 'A one-time code from {product} arrived by text just now, though nobody here tried to log in.' },
  { text: 'The recovery email on my profile was replaced with an address I do not recognise.' },
  { text: 'My {product} page lists a recent session on a computer that was never mine.' },
  { text: 'A friend told me her messages seemed to come from my {product} login, and I sent none of them.' },
  { text: 'Two-step verification on my {product} was switched off and I certainly did not do it.' },
  { text: 'My saved payment details were changed without me touching them, so I wonder who else is in my profile.' },
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
// whose suggested category is not the template's own. Every list has eight, two
// per fold, so no fold's held-out side is empty.
export const TRAP_TEMPLATES: Record<Category, readonly Template[]> = {
  Billing: [
    { text: 'Adam in our finance team needs the {plan} receipt from {date}. Where can he download it?' },
    {
      text: 'I was billed twice for the {product} licence for our Nevada office. Please refund the second payment.',
      billingDispute: true,
      severe: true,
    },
    { text: 'The accountant at our Canada branch says the invoice for the {plan} shows the wrong total. Can you send a corrected one?' },
    { text: 'The pricing page has a bug: it lists a different price for the {plan} than my invoice shows.' },
    { text: 'Adam asked me to pay for the {plan} on his company card. Can you split the payment between two cards?' },
    { text: 'The receipt for the {plan} does not mention the Canada sales tax. Can you add it?' },
    { text: 'Our accounting software rejects the file format of your invoices. Can you send them as a spreadsheet?' },
    { text: 'I cannot find the access link to download my invoice for the {plan}, only a blank page.' },
  ],
  'Technical Issue': [
    { text: '{product} drains my battery. I have to charge my phone three times a day now, even on a quiet afternoon.' },
    { text: 'Since the update, {product} cannot load the accounting data we imported. The progress bar just sits there.' },
    { text: 'The old adapters for our {product} integration stopped answering on Tuesday.' },
    { text: 'I tried to recharge my tablet and now {product} shows a blank screen when I open it.' },
    { text: 'Photos in {product} take forever to upload from Canada, though other sites are fine.' },
    { text: 'Importing contacts into {product} fails on rows with accented names. The account column is skipped.' },
    { text: 'My laptop gets slower whenever it is being charged and {product} is open.' },
    { text: 'Access to the settings page in {product} just shows a spinning wheel. I tried three browsers.' },
  ],
  'Account Access': [
    { text: 'Ada on my team cannot get into {product}. Her password reset link says it expired.' },
    { text: 'My colleague Adam never got his invitation email, so he is unable to enter {product}.' },
    { text: 'Locked out of {product} again: the login screen shows a small bug icon and no message.' },
    { text: 'My card was not charged, but {product} on my new phone keeps refusing my sign-in.' },
    { text: 'I cannot sign in to {product} from the airport in Granada because the code arrives late.' },
    { text: 'The reset form has a bug that wipes the new password I type, so I am shut out of {product}.' },
    { text: 'I was charged a fee on my phone when the login code text arrived, and I have been unable to sign in to {product} since.' },
    { text: 'Our admin in Canada cannot reset the password for {product}.' },
  ],
  'Security Concern': [
    { text: 'A sign-in from Canada showed up at 3am and I have not set foot there. Somebody else is on my login.' },
    { text: 'My accountant says a stranger signed in to {product} from overseas yesterday.' },
    { text: 'An email says there is a charge on my card and asks me to click a link to dispute it. I did not click.' },
    { text: 'Adam got a text with a link to reset a password he never asked for. Is it safe to ignore?' },
    { text: 'A delivery firm in Canada asks me to pay a small fee by link to release my parcel. Is that real?' },
    { text: 'A pop-up claimed there was a bug in my browser and told me to install a fix. I closed it.' },
    { text: 'Somebody has been adding charges to a card I only saved in {product}. I think the card details leaked.' },
    { text: 'An email from my accountant looks off: the writing is odd and the attachment is a zip file.' },
  ],
  'Accessibility Support': [
    { text: 'The Pay button at checkout stays silent when my screen reader reaches it, so the charge cannot be completed.' },
    { text: 'The captcha on your sign-up page has no audio option, so I cannot get into my account.' },
    { text: 'A bug in the {product} chart makes my screen reader skip every second row.' },
    { text: 'I use a magnifier, and the access code box in {product} is cut off at 200 percent zoom.' },
    { text: 'The video call for our account review has no live captions, so I cannot follow what is said.' },
    { text: 'My screen reader reads the account number field as one long number, with no pauses.' },
    { text: 'The charge breakdown table in {product} has no column headings for my screen reader to announce.' },
    { text: 'High contrast mode in {product} has a bug: the buttons turn white on white.' },
  ],
  'Product Question': [
    { text: 'Will the {plan} account for time zones when scheduling reports?' },
    { text: 'Ada from your sales team said the {plan} includes {feature}. Is that right?' },
    { text: 'Can the API help me debug my own scripts against sample data?' },
    { text: 'Will the {plan} charge me more if I add seats later?' },
    { text: 'Is there a special rate for accounting firms like ours?' },
    { text: 'Can I add Adam from finance as a viewer without giving him edit rights in {product}?' },
    { text: 'Does {product} have a bug tracker I can send feedback to?' },
    { text: 'How do I get access to the {feature} setting? It is not in my menu.' },
  ],
  'Urgent Complaint': [
    { text: 'Your Canada support line never picks up. I have called five times and I am fed up with this company.' },
    { text: 'I was charged for support I never received and nobody has called me back.' },
    { text: 'Getting access to a real person is a farce. I have been on hold for an hour and nobody picks up.' },
    { text: 'Adam from your team promised me a callback and never phoned. I am done with this company.' },
    { text: 'I have lodged a complaint three times about the Canada office and nobody has written back.' },
    { text: 'You charged my company for a support plan that never happened and I am furious that nobody has fixed it.' },
    { text: 'This is the last time I will deal with your account team. They are rude and slow.' },
    { text: 'Adam on your help desk hung up on me twice today. I want an apology.' },
  ],
  'Shipping/Order Issue': [
    { text: 'My order to Canada has been stuck at customs for {days} days. Any update?', statusQuestion: true },
    { text: 'The phone accessory I ordered came without the cable.' },
    { text: 'The charger I ordered arrived with a cracked plug.' },
    { text: 'The courier left my package with Adam next door and I never got it.' },
    { text: 'My order lists Nevada as the state instead of Nebraska. Can you correct that before it goes out?' },
    { text: 'My parcel was left at the access gate of our building, but the gate is locked and nobody saw it.' },
    { text: 'The debugging kit I ordered arrived in a box that is crushed at one corner.' },
    { text: 'The courier left a note saying my phone charger needs a signature, but nobody knocked.' },
  ],
  Other: [
    { text: 'Our team in Canada would love to put your logo in a case study. Who handles that?' },
    { text: 'Our accounting club would like to visit your office. Who arranges tours?' },
    { text: 'Our school would like to feature {product} in a debugging workshop. Who should we contact?' },
    { text: 'Adam from our events team would like to invite someone from your company to speak at a meetup. Who should he contact?' },
    { text: 'Who is in charge of partnerships? I would like to send a proposal.' },
    { text: 'Our university in Granada is hoping one of your team can give a talk next spring.' },
    { text: 'Is there an account manager I can send a thank-you note to?' },
    { text: 'I run a podcast about software bugs and would love to interview someone from your team.' },
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
