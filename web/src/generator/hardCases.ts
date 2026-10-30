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
  { text: 'It stopped doing what it did yesterday. I am not sure what changed.' },
  { text: 'Can a real person call me back this afternoon? It is hard to explain in writing.' },
  { text: 'I tried what you told me last time and it did not help. Where do we go from here?' },
  { text: 'A friend said I should write to you about this. I am not sure I have the right place.' },
  { text: 'Same thing as last week again. I would rather not go through it all in writing.' },
];

export const THREAT_PHRASES: readonly string[] = [
  'Fix this today or I will take this to my lawyer and every news outlet I can find.',
  'If I do not hear back by tomorrow you are going to be sorry.',
  'You people are useless. Sort this out today or I will turn up at your office and cause a scene.',
  'I will make sure everyone I know hears what a rotten company you are.',
  'Fix it or I will dispute everything and ruin your reputation online.',
  'Do not ignore me again. You will pay for this.',
  'One more week of this and I am dropping you and telling every colleague I have why.',
  'I have screenshots of all of it and I will post them publicly if nobody fixes this.',
  'Consider this my final warning. The next message goes to your chief executive and the press.',
  'I am done being polite. Sort this out today, or this goes very public.',
  'My solicitor has already been told about this and will write to you if I hear nothing by Friday.',
  'Keep ignoring me and I will make sure every review site hears exactly what happened.',
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
// unauthorized, breach or stolen, so a keyword rule cannot find it.
export const POLITE_SECURITY_TEMPLATES: readonly Template[] = [
  {
    text: 'Hello, I hope you are having a good day. An alert says someone signed in from a city I have never been to, but I did not do that. Could someone please look at whether another person is using my login? Thank you so much.',
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
  {
    text: 'Good morning. I am sure it is nothing, but a login code I never requested arrived by text just now. Could you please check whether anyone else is trying to use my {product} login? Many thanks.',
  },
  {
    text: 'Hello, I hope your week is going well. The recovery email on my profile was replaced with one I do not recognise. Would you be able to put the old one back and tell me how it happened? Thank you.',
  },
  {
    text: 'Hi, quick question when you have a moment. The last sign-in shown on my {product} page is from a device I have never owned. Is there a way to sign it out? Appreciate any help.',
  },
  {
    text: 'Dear team, I am writing politely because a friend told me her messages seemed to come from my {product} login, and I did not send any of them. Could you look into it, please? Regards.',
  },
  {
    text: 'Good evening, and sorry to trouble you. Two-step verification on my {product} was switched off and I certainly did not do it. Please could you turn it back on and check how this happened? Cheers.',
  },
  {
    text: 'Hello there, you were so helpful before. My saved payment details were changed and I did not touch them, so I worry that another person is using my login. Could you please freeze it until we know more? Thank you.',
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
// whose suggested category is not the template's own. Every list has at least
// four, so the held-out pool (every fourth) is never empty.
export const TRAP_TEMPLATES: Record<Category, readonly Template[]> = {
  Billing: [
    { text: 'Adam in our finance team needs the {plan} receipt from {date}. Where can he download it?' },
    {
      text: 'I was billed twice for the {product} licence for our Nevada office. Please refund one of them.',
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
    { text: '{product} drains my battery. I have to charge my phone three times a day since the last update.' },
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
    { text: 'My colleague Adam never got his invitation email, so he cannot sign in to {product}.' },
    { text: 'I am locked out of {product}. The sign-in page shows a small bug icon and no message.' },
    { text: 'My card was not charged, but I cannot sign in to {product} on my new phone.' },
    { text: 'I cannot sign in to {product} from the airport in Granada because the code arrives late.' },
    { text: 'A bug in the reset form wipes the new password I type, so I cannot get back into {product}.' },
    { text: 'I was charged a fee on my phone when the login code text arrived, and I have been unable to sign in to {product} since.' },
    { text: 'Our admin in Canada cannot reset the password for {product}.' },
  ],
  'Security Concern': [
    { text: 'A sign-in from Canada showed up at 3am and I have never been there. Someone else is using my login.' },
    { text: 'My accountant says a stranger signed in to {product} from overseas yesterday.' },
    { text: 'An email says there is a charge on my card and asks me to click a link to dispute it. I did not click.' },
    { text: 'Adam got a text with a link to reset a password he never asked for. Is it safe to ignore?' },
    { text: 'A delivery firm in Canada asks me to pay a small fee by link to release my parcel. Is that real?' },
    { text: 'A pop-up claimed there was a bug in my browser and told me to install a fix. I closed it.' },
    { text: 'Somebody has been adding charges to a card I only saved in {product}. I think the card details leaked.' },
    { text: 'An email from my accountant looks off: the writing is odd and the attachment is a zip file.' },
  ],
  'Accessibility Support': [
    { text: 'The Pay button at checkout is silent for my screen reader, so I cannot complete the charge.' },
    { text: 'The captcha on your sign-up page has no audio option, so I cannot get into my account.' },
    { text: 'A bug in the {product} chart makes my screen reader skip every second row.' },
    { text: 'I use a magnifier, and the access code box in {product} is cut off at 200 percent zoom.' },
    { text: 'The video call for our account review has no live captions, so I cannot follow what is said.' },
    { text: 'My screen reader reads the account number field as one long number, with no pauses.' },
    { text: 'The charge breakdown table in {product} has no column headings for my screen reader to announce.' },
    { text: 'There is a bug in the high contrast mode of {product}: the buttons turn white on white.' },
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
    { text: 'Your access to a real person is a joke. I have been on hold for an hour and nobody picks up.' },
    { text: 'Adam from your team promised me a callback and never phoned. I am done with this company.' },
    { text: 'I have lodged a complaint three times about the Canada office and nobody has written back.' },
    { text: 'You charged my company for support I never received and I am furious that nobody has fixed it.' },
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
    { text: 'The courier added a surcharge at the door that I did not agree to.' },
  ],
  Other: [
    { text: 'Our team in Canada would love to put your logo in a case study. Who handles that?' },
    { text: 'Our accounting club would like to visit your office. Who arranges tours?' },
    { text: 'Our school would like to feature {product} in a debugging workshop. Who should we contact?' },
    { text: 'Adam from our events team would like to invite someone from your company to speak at a meetup. Who should he contact?' },
    { text: 'Who is in charge of partnerships? I would like to send a proposal.' },
    { text: 'Our university in Granada would like to invite one of your team to a talk next spring.' },
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
