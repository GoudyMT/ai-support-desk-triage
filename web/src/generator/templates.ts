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

// The item at index 3, 7, 11, ... of a list is held out and the rest train, so
// one item in four is held out (exactly four of a list of 16). The order of a
// list therefore decides which items are held out.
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
    {
      text: 'I moved down to the {plan} in {date} but my invoice still shows the old price. Please refund the difference.',
      billingDispute: true,
      grievance: true,
    },
    { text: 'Can you change the company name and address on all my past invoices? Our legal name changed this year.' },
    { text: 'Which card is the {plan} being paid with at the moment? I have two saved and I am not sure.' },
    { text: 'Please send me a copy of the {amount} receipt from {date}, with the tax breakdown, for our expense report.' },
    {
      text: 'My free trial of the {plan} ended on {date} and I was moved to a paid plan with no warning. I would like a refund.',
      billingDispute: true,
      grievance: true,
    },
    { text: 'How does annual billing work for the {plan}? We would like to pay by bank transfer instead of by card.' },
    { text: 'I need to update the billing contact for the {plan} because our finance person left the company.' },
    {
      text: 'Your invoice for the {plan} arrived a month late, and now our accounts team keeps chasing me about it.',
      grievance: true,
    },
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
    { text: 'The search box in {product} returns nothing for words I know are in my files.' },
    { text: 'Notifications from {product} arrive about an hour late on my laptop.' },
    {
      text: 'Since this morning {product} logs me out every few minutes and I lose what I was typing.',
      grievance: true,
    },
    { text: 'Dark text on a dark background: the new theme in {product} makes the menu unreadable.' },
    { text: 'Printing a report from {product} cuts off the right-hand column.' },
    { text: 'I cannot attach files over 10 MB in {product}. The progress circle spins and nothing happens.' },
    {
      text: 'Approvals in {product} are blocking my whole team: the button greys out as soon as I tap it.',
      severe: true,
      grievance: true,
    },
  ],
  'Account Access': [
    { text: "I can't log in to {product}, and the email to reset my password never shows up.", grievance: true },
    { text: 'Locked out after too many password attempts. Please unlock my account.', grievance: true },
    { text: 'How do I change the email address on my account? I no longer use the old one.' },
    {
      text: 'The verification code from my authenticator app is rejected when I sign in, so I am locked out of {product}.',
      grievance: true,
    },
    { text: 'My name disappeared from our company user list by mistake. Can you restore my access?' },
    { text: 'A new hire needs access to {product}. Our admin is away. What can we do?' },
    { text: 'cant get in, it says my account is disabled' },
    {
      text: 'My invitation link expired before I could use it, so I still have no way into {product}.',
      grievance: true,
    },
    { text: 'How do I turn on two-step sign-in? The setting is not where the help page says it is.' },
    { text: 'My colleague left and I need to take over her login for our support mailbox. What is the process?' },
    { text: 'I changed my phone number and now the text message codes go to the old one. How do I update it?' },
    {
      text: 'The sign-in page keeps telling me my details are wrong, but they are the same ones I used yesterday.',
      grievance: true,
    },
    { text: 'Can I use one login for two different companies? I work for both and the email is the same.' },
    { text: 'I forgot which email address I signed up with. Can you look it up from my name and phone number?' },
    { text: 'Our contractor needs temporary entry to {product} for two weeks. How do we set that up without full rights?' },
    { text: 'After I changed my password the app on my tablet logged out and will not let me back in.', grievance: true },
  ],
  'Security Concern': [
    { text: 'I got a sign-in alert from a country I have never visited. Someone has hacked my account.', grievance: true },
    { text: 'My account sent messages I never wrote. I think it was hacked and I need it locked down.', grievance: true },
    { text: 'I received an email saying my data was part of a breach. Is my {product} data affected?' },
    { text: "Someone is using my login at night. I see sessions from devices I don't own.", grievance: true },
    { text: 'My laptop was stolen and it was still signed in to {product}. Please lock my account.', grievance: true },
    { text: 'I think a contractor now has unauthorized access to our project folder in {product}. Please look into it today.' },
    { text: "A form on your site shows other people's names in the web address. This looks like a security hole." },
    { text: 'A text message gave me a login code I never asked for, three times in ten minutes.', grievance: true },
    { text: 'Our {product} audit shows a former employee still has an active session. Please end it today.' },
    { text: 'My email address was changed in my profile and I did not change it. I think another person got in.', grievance: true },
    { text: 'Is it safe to click the link in an email that claims to be from your billing team? It looks a little odd.' },
    { text: 'I found a file in {product} that I never uploaded, and it has a strange name. Could it be a virus?', grievance: true },
    { text: 'How do I see which devices are signed in to my login right now? I want to remove the old ones.' },
    { text: 'My neighbour says her messages from me looked odd. I think a scammer has copied my phone number.', grievance: true },
    { text: 'A stranger phoned me pretending to be from your company and asked for my login code. I hung up.', grievance: true },
    {
      text: 'Two people from outside our company have been added to our project in {product}, and nobody here added them.',
      grievance: true,
    },
  ],
  'Accessibility Support': [
    { text: 'With a screen reader, the buttons in {product} are announced only as "button", so I cannot tell them apart.', grievance: true },
    { text: "I'm colorblind and the red and green status labels look the same in {product}. Can you add another indicator?" },
    { text: "Can {product} be used with only a keyboard? I can't use a mouse because of a hand injury." },
    { text: "The text in the {product} app is too small and I can't make it larger. I have low vision.", grievance: true },
    { text: "The tutorials on your site come without captions. I am deaf, so I can't follow along.", grievance: true },
    { text: 'Our company must meet ADA requirements. Does {product} have an accessibility statement?' },
    { text: 'The pop-up in {product} traps my keyboard focus and I have to restart my computer to get out of it.', grievance: true },
    {
      text: 'The error messages in {product} disappear after two seconds, and my dyslexia means I cannot read them that fast.',
      grievance: true,
    },
    { text: 'Is there a dark theme in {product} that is easier on the eyes? Bright screens give me migraines.' },
    { text: 'I use voice control, and half of the buttons in {product} have no name I can say out loud.' },
    {
      text: 'The sign-in page times out before I can finish typing with my one working hand. Can the limit be longer?',
      grievance: true,
    },
    { text: 'Can I get your user guide as a plain text file? My braille display cannot read the PDF.' },
    { text: 'The animations in {product} make me dizzy. Is there a way to turn them off?' },
    {
      text: 'Your phone support line has no text relay option, so I cannot reach anyone as a deaf customer.',
      grievance: true,
    },
    { text: 'The link colours on your help pages match the text around them, so I cannot find them with my colour blindness.' },
    {
      text: 'Zoomed in at 200 percent, the table in {product} runs off the screen and I cannot scroll to the last columns.',
      grievance: true,
    },
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
    { text: 'Does {product} work on a Chromebook, or only on Windows and Mac?' },
    { text: 'How long do you keep deleted files in {product} before they are gone for good?' },
    { text: 'Can I add a second admin to {product} without paying for another seat?' },
    { text: 'Is there a way to export all my data from {product} if I decide to leave?' },
    { text: 'What happens to my files in {product} if I move from the {plan} to the {otherPlan}?' },
    { text: 'Will {product} still be supported next year? We are choosing tools for the whole company.' },
    {
      text: 'I was told {feature} would arrive this quarter. Is there a date yet? I keep waiting and hearing nothing.',
      grievance: true,
    },
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
    {
      text: 'This is the fourth time I am explaining the same problem to a new person. Does anyone there keep notes?',
      grievance: true,
    },
    {
      text: 'I was told a senior person would phone me last week. Nobody did, and I have lost faith in your company.',
      grievance: true,
    },
    {
      text: 'My problem is still not fixed after {days} days, and your replies keep asking for details I already gave.',
      grievance: true,
    },
    { text: 'Your latest email says my case is closed. It is not closed. Nothing has been solved.', grievance: true },
    {
      text: 'I am sick of waiting. Every time I call, the line drops, and every time I write, I get a template.',
      grievance: true,
    },
    {
      text: 'I expected much better from a company I have recommended to friends. Today I regret that.',
      grievance: true,
    },
    {
      text: 'Whoever handled my request clearly did not read it. I want a different person to look at it today.',
      grievance: true,
    },
    {
      text: 'I booked a callback for {date} and sat by the phone all day. It never rang, and nobody has said sorry.',
      grievance: true,
    },
    {
      text: 'You promised an answer by the end of the week. It is now the following week and I have heard nothing at all.',
      grievance: true,
    },
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
    { text: 'I need to change my delivery address before the order goes out.' },
    { text: 'One item was missing from my order. The rest arrived on {date}.', grievance: true },
    {
      text: 'The courier marked my parcel as delivered, but it went to the wrong house and the neighbours do not have it.',
      grievance: true,
    },
    { text: 'Can I pick up my order from a local store instead of waiting for delivery? I will be away on {date}.' },
    { text: 'I ordered two items together and only one box turned up. When will the second one arrive?', grievance: true },
    { text: 'The shipping fee at checkout was higher than the one in my basket. Can you check what I owe for delivery?' },
    {
      text: 'Any update on my parcel? The website has said processing for {days} days now.',
      statusQuestion: true,
      grievance: true,
    },
    { text: 'I need to return an item that does not fit. Is there a prepaid label I can print?' },
    { text: 'The label on my parcel had the wrong flat number, so it went back to your warehouse.', grievance: true },
    { text: 'Please can you deliver after 6pm? Nobody is home during the day and I keep missing the courier.' },
    { text: 'Half of my order is here and the other half is marked as out of stock. Will it ship separately?' },
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
    { text: 'Is it possible to arrange a visit to your office for a school group in the spring?' },
    { text: 'I found a typo on your website homepage. Who should I tell?' },
    { text: 'We are organising a charity run and would love your company to sponsor a team.' },
    { text: 'Could you send me your logo files? I am writing a blog post about local businesses.' },
    { text: 'I think I sent my CV to the wrong email address last week. Who reads applications?' },
    { text: 'Congratulations on your award this week. Well deserved!' },
    { text: 'The phone number on your contact page seems to have a digit missing.' },
    { text: 'My company would like to translate your help pages into Spanish for free. Who can we speak to about that?' },
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

export const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const PRODUCTS: readonly string[] = [
  'Nimbus sync', 'Harbor reports', 'Quillfold dashboard', 'Team workspace', 'Orchard scheduler', 'Lantern calendar',
  'Pebble notes', 'Saffron board',
];
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
  date: (rng, _slot, pool) => `${rng.pick(poolOf(MONTHS, pool))} ${rng.int(1, MAX_DAY_OF_MONTH)}`,
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
