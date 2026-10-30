import type { Category } from '../domain/labels';
import type { Rng } from './rng';

// The flags are what labelTicket reads. A template sets one only when its own
// wording says so, because a flag that disagrees with the text mislabels every
// ticket built from it. `grievance` marks a template whose writer is already
// upset, the only kind a threat can follow without reading as absurd.
export interface Template {
  text: string;
  severe?: boolean;
  billingDispute?: boolean;
  statusQuestion?: boolean;
  grievance?: boolean;
}

// 'train' and 'heldout' draw from separate wording so a model scored on the
// held-out set is scored on wording it never trained on; 'all' (live demo
// tickets) draws from everything.
export type Pool = 'all' | 'train' | 'heldout';

// Every HELDOUT_EVERY-th item of a list (the last of each group) is held out,
// so about a quarter of any list. The order of a list therefore decides which
// items are held out.
export const HELDOUT_EVERY = 4;

export function poolOf<T>(items: readonly T[], pool: Pool): readonly T[] {
  if (pool === 'all') {
    return items;
  }
  const wantHeldout = pool === 'heldout';
  return items.filter((_item, index) => (index % HELDOUT_EVERY === HELDOUT_EVERY - 1) === wantHeldout);
}

export const CATEGORY_SHARES: Record<Category, number> = {
  'Technical Issue': 0.22,
  Billing: 0.18,
  'Account Access': 0.14,
  'Product Question': 0.12,
  'Shipping/Order Issue': 0.12,
  Other: 0.06,
  'Security Concern': 0.06,
  'Accessibility Support': 0.05,
  'Urgent Complaint': 0.05,
};

// Words that point at a category, v0's keywords and the obvious relatives. A
// vague ticket must carry none of them or it would not be vague.
export const CATEGORY_TRIGGER_WORDS: readonly string[] = [
  'charge', 'charged', 'charges', 'charging', 'billed', 'billing', 'bill', 'invoice', 'payment',
  'subscription', 'refund', 'refunded', 'price', 'pricing', 'renewal', 'receipt',
  'access', 'login', 'log in', 'sign in', 'password', 'account', 'credentials', 'locked',
  'someone', 'unauthorized', 'hacked', 'breach', 'stolen', 'permission', 'suspicious', 'security',
  'crash', 'crashes', 'error', 'bug', 'upload', 'not working', 'broken', 'slow', 'freezes',
  'screen reader', 'accessibility', 'ada', 'disability', 'keyboard',
  'feature', 'plan', 'upgrade',
  'unacceptable', 'terrible', 'manager', 'complaint',
  'order', 'shipping', 'shipped', 'delivery', 'delivered', 'package', 'tracking', 'parcel',
];

export const TEMPLATES: Record<Category, readonly Template[]> = {
  Billing: [
    {
      text: '{amount} came out of my card twice for the {plan} in the same month. Please refund the extra charge.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    { text: 'Could you send me an invoice for my {plan} payment from {date}? I need it for my records.' },
    { text: 'I would like to move my {plan} from monthly to yearly billing. How will the price change?' },
    {
      text: 'A {amount} charge from {date} appeared on my statement for the {plan}. I did not sign up for it, so I want a refund.',
      billingDispute: true,
      grievance: true,
    },
    { text: 'Please cancel my subscription before it renews on {date}. I do not want to pay for another month.' },
    {
      text: 'I cancelled last month, yet my card was charged again today. This is the second time and I need it sorted out.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    { text: 'The receipt for {amount} lists a different company name than mine. Can you correct it?' },
    { text: 'Is sales tax included in the {amount} I paid for the {plan}? The receipt does not say.' },
  ],
  'Technical Issue': [
    { text: "{product} crashes every time a large file is opened. I can't work until this is fixed.", severe: true, grievance: true },
    {
      text: '{product} keeps crashing on my phone. It has happened every day this week and my team is waiting on me.',
      severe: true,
      grievance: true,
    },
    { text: '{product} crashed once this morning, but it opened normally after a restart. Just letting you know.' },
    { text: 'The export button in {product} shows an error message and nothing downloads.' },
    { text: '{product} is slow today. Pages take about {seconds} seconds to load.' },
    { text: 'Uploads keep failing at 90 percent in {product}. I have tried three times.' },
    { text: 'The mobile app for {product} has stopped working on my tablet since the last update.', grievance: true },
    {
      text: 'Sync between my laptop and phone stopped yesterday. This is blocking my whole team.',
      severe: true,
      grievance: true,
    },
    { text: 'There is a bug where the date filter in {product} resets when I refresh the page. Minor, but annoying.' },
  ],
  'Account Access': [
    { text: "I can't log in to {product}, and the email to reset my password never shows up.", grievance: true },
    { text: 'Locked out after too many password attempts. Please unlock my account.', grievance: true },
    { text: 'How do I change the email address on my account? I no longer use the old one.' },
    {
      text: 'The verification code from my authenticator app is rejected when I sign in, so I am locked out of {product}.',
      grievance: true,
    },
    { text: 'I was removed from our company workspace by mistake. Can you restore my access?' },
    { text: 'A new hire needs access to {product}. Our admin is away. What can we do?' },
    { text: 'cant get in, it says my account is disabled' },
  ],
  'Security Concern': [
    { text: 'I got a sign-in alert from a country I have never visited. Someone has hacked my account.', grievance: true },
    { text: 'My account sent messages I never wrote. I think it was hacked and I need it locked down.', grievance: true },
    { text: 'I received an email saying my data was part of a breach. Is my {product} data affected?' },
    { text: "Someone is using my login at night. I see sessions from devices I don't own.", grievance: true },
    { text: 'My laptop was stolen and it was still signed in to {product}. Please lock my account.', grievance: true },
    { text: 'I think a contractor now has unauthorized access to our shared folder in {product}. Please look into it today.' },
    { text: "A form on your site shows other people's names in the web address. This looks like a security hole." },
  ],
  'Accessibility Support': [
    { text: 'With a screen reader, the buttons in {product} are announced only as "button", so I cannot tell them apart.', grievance: true },
    { text: "I'm colorblind and the red and green status labels look the same in {product}. Can you add another indicator?" },
    { text: "Can {product} be used with only a keyboard? I can't use a mouse because of a hand injury." },
    { text: "The text in the {product} app is too small and I can't make it larger. I have low vision.", grievance: true },
    { text: "The tutorials on your site come without captions. I am deaf, so I can't follow along.", grievance: true },
    { text: 'Our company must meet ADA requirements. Does {product} have an accessibility statement?' },
    { text: 'The pop-up in {product} traps my keyboard focus and I have to restart my computer to get out of it.', grievance: true },
  ],
  'Product Question': [
    { text: 'Is {feature} included in the {plan}? Trying to decide before I upgrade.' },
    { text: 'What is the difference between the {plan} and the {otherPlan}?' },
    { text: 'Does {product} support {feature}? I could not find it in the settings.' },
    { text: 'Do students get a lower price? Not urgent, just curious.' },
    { text: 'Can several people edit the same report in {product} at once?' },
    { text: 'How many seats are included in the {plan}?' },
    { text: 'Is there an API for {product}? We would like to connect it to our internal tools.' },
    { text: 'Nobody has told me what the {plan} actually includes. Does it include {feature}?', grievance: true },
    { text: 'I asked about {feature} twice already and got two different answers. Which of them is right?', grievance: true },
  ],
  'Urgent Complaint': [
    {
      text: "I have emailed three times about one problem and no one has replied. I'm very unhappy with your service.",
      grievance: true,
    },
    {
      text: "Your support is a joke. I waited {days} days for a reply and the answer didn't even address my question.",
      grievance: true,
    },
    {
      text: 'I am extremely frustrated. Your last update broke my workflow and nobody at your company seems to care.',
      grievance: true,
    },
    { text: 'Absolutely unacceptable. I was promised a callback on {date} and never got one.', grievance: true },
    {
      text: "I've been a customer for years and this is the worst experience I have had. I would like a manager to call me.",
      grievance: true,
    },
    {
      text: 'Nobody has told me what is going on with my case. I need a real person to take responsibility for it today.',
      grievance: true,
    },
    { text: 'Terrible service! I was passed between three agents and each one told me something different.', grievance: true },
  ],
  'Shipping/Order Issue': [
    {
      text: 'Is there any update on my order? The delivery was due on {date} and the tracking has not changed.',
      statusQuestion: true,
      grievance: true,
    },
    { text: 'My package was badly dented when it arrived and the item inside is damaged.', grievance: true },
    { text: 'They sent me the wrong size. Can I exchange it?' },
    {
      text: 'Order status please. I placed it {days} days ago and have heard nothing since.',
      statusQuestion: true,
      grievance: true,
    },
    { text: 'The tracking says delivered, but nothing is at my door.', grievance: true },
    { text: 'I need to change my delivery address before the order ships.' },
    { text: 'One item was missing from my order. The rest arrived on {date}.', grievance: true },
  ],
  Other: [
    { text: 'Do you have a phone number for your head office? I would like to send a letter.' },
    { text: 'I would like to suggest a partnership between our company and yours. Who should I talk to?' },
    { text: 'A quick thank you to your team for helping me last week. It went really well.' },
    { text: 'Are you hiring? I could not find a careers page.' },
    { text: 'Please remove me from your marketing emails. I have asked before.', grievance: true },
    { text: 'I am a journalist writing about small software companies. Who handles press requests?' },
    { text: 'Is your office open on {date}? I wanted to drop something off.' },
    { text: 'Your newsletter still lands in my inbox every week even though I unsubscribed last spring.', grievance: true },
  ],
};

// Short and plain on purpose: none of these names a category. The formal and
// grateful ones are here too, so politeness shows up in every category and
// never tells the model which one a ticket belongs to.
export const OPENERS: readonly string[] = [
  'Hi,', 'Hello,', 'Hi there,', 'Good morning,', 'To whom it may concern,', 'Hey,',
  'Good afternoon,', 'Dear support,', 'Hello team,',
];

export const CLOSERS: readonly string[] = [
  'Thanks.', 'Thank you.', 'Please advise.', 'Appreciate any help.', 'Cheers.', 'Regards.',
  'Thank you so much.', 'Many thanks.',
];

// A polite ask that names no category, added to a ticket of any category with
// the same chance, so "could you please" and "would you mind" never lean toward
// one of them.
export const REQUESTS: readonly string[] = [
  'Could you please check on this when you can?',
  'Could you please let me know what to do next?',
  'Would you mind taking a look at this?',
  'Would you mind getting back to me soon?',
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const PRODUCTS: readonly string[] = ['Nimbus sync', 'Harbor reports', 'Quillfold dashboard', 'Team workspace', 'Orchard scheduler'];
export const PLANS: readonly string[] = [
  'Pro plan', 'Team plan', 'Starter plan', 'Business plan', 'Basic plan', 'Growth plan', 'Premium plan', 'Enterprise plan',
];
export const FEATURES: readonly string[] = ['dark mode', 'audit logs', 'scheduled reports', 'shared folders', 'single sign-on', 'CSV export', 'offline mode', 'custom roles'];

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
type SlotFill = (rng: Rng, slot: (name: string) => string, pool: Pool) => string;

const SLOTS: Record<string, SlotFill> = {
  product: (rng, _slot, pool) => rng.pick(poolOf(PRODUCTS, pool)),
  plan: (rng, _slot, pool) => rng.pick(poolOf(PLANS, pool)),
  // A comparison between a plan and itself reads as nonsense.
  otherPlan: (rng, slot, pool) => rng.pick(poolOf(PLANS, pool).filter((plan) => plan !== slot('plan'))),
  feature: (rng, _slot, pool) => rng.pick(poolOf(FEATURES, pool)),
  amount: (rng) =>
    `$${rng.int(MIN_AMOUNT_DOLLARS, MAX_AMOUNT_DOLLARS)}.${String(rng.int(0, CENTS_PER_DOLLAR - 1)).padStart(CENTS_PAD, '0')}`,
  date: (rng) => `${rng.pick(MONTHS)} ${rng.int(1, MAX_DAY_OF_MONTH)}`,
  days: (rng) => String(rng.int(MIN_WAIT_DAYS, MAX_WAIT_DAYS)),
  seconds: (rng) => String(rng.int(MIN_LOAD_SECONDS, MAX_LOAD_SECONDS)),
};

// A slot named twice in one template gets the same value both times, so the
// text never contradicts itself.
export function fillSlots(text: string, rng: Rng, pool: Pool = 'all'): string {
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
    const value = fill(rng, slot, pool);
    chosen.set(name, value);
    return value;
  };
  return text.replace(/\{(\w+)\}/g, (_match, name: string) => slot(name));
}
