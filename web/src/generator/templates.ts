import type { Category } from '../domain/labels';

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

// Every wording list is cut into FOLDS folds. A fold's 'heldout' side draws only
// from that fold's items and its 'train' side from the other folds', so a model
// scored on a fold is scored on wording it never trained on, and across the four
// folds every item is scored once. 'all' (live demo tickets) draws from everything.
export const FOLDS = 4;
export type Side = 'train' | 'heldout';
export type Split = 'all' | { fold: number; side: Side };

// The type alone does not stop a caller that passes a value from outside the
// type system, so every entry point checks at run time.
export function checkSplit(split: unknown): asserts split is Split {
  if (split === 'all') {
    return;
  }
  if (typeof split === 'object' && split !== null) {
    const { fold, side } = split as { fold?: unknown; side?: unknown };
    if (typeof fold === 'number' && Number.isInteger(fold) && fold >= 0 && fold < FOLDS && (side === 'train' || side === 'heldout')) {
      return;
    }
  }
  throw new Error('E_SPLIT_RANGE');
}

const TEMPLATE_FLAGS = ['grievance', 'severe', 'billingDispute', 'statusQuestion'] as const;

// A template's kind is which of its flags are set; anything else (a plain
// string) has one kind.
function kindOf(item: unknown): string {
  if (typeof item !== 'object' || item === null) {
    return '';
  }
  const flags = item as Partial<Record<(typeof TEMPLATE_FLAGS)[number], boolean>>;
  return TEMPLATE_FLAGS.map((flag) => (flags[flag] === true ? '1' : '0')).join('');
}

const foldCache = new WeakMap<readonly unknown[], readonly number[]>();

// The fold of each item of a list. Items of one kind go to consecutive folds in
// list order, so every kind is spread over the folds instead of landing in one.
// The count carries on from one kind to the next, which keeps the folds of a
// list within one item of each other in size. The order of a list therefore
// decides which items share a fold.
export function foldsOf(items: readonly unknown[]): readonly number[] {
  const known = foldCache.get(items);
  if (known !== undefined) {
    return known;
  }
  const kinds = new Map<string, number[]>();
  items.forEach((item, index) => {
    const kind = kindOf(item);
    kinds.set(kind, [...(kinds.get(kind) ?? []), index]);
  });
  const folds = items.map(() => 0);
  let counted = 0;
  for (const indices of kinds.values()) {
    for (const index of indices) {
      folds[index] = counted % FOLDS;
      counted += 1;
    }
  }
  foldCache.set(items, folds);
  return folds;
}

export function poolOf<T>(items: readonly T[], split: Split): readonly T[] {
  checkSplit(split);
  if (split === 'all') {
    return items;
  }
  const folds = foldsOf(items);
  const wantHeldout = split.side === 'heldout';
  return items.filter((_item, index) => (folds[index] === split.fold) === wantHeldout);
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

// Each list is cut into folds by foldsOf: templates of one kind (the same flags)
// go to consecutive folds in list order, so a kind needs at least four templates
// to reach every fold. Billing's duplicate-charge templates (severe disputes)
// and Technical's repeated-crash templates come first in their lists, four each,
// so every fold holds out one of each.
export const TEMPLATES: Record<Category, readonly Template[]> = {
  Billing: [
    {
      text: '{amount} came out of my card twice for the {plan} in the same month. Please refund the extra charge.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    {
      text: 'I cancelled last month, yet my card was charged again today. This is the second time and I need it sorted out.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    {
      text: 'Two identical {amount} payments for the {plan} hit my account on {date}. I paid twice and want one returned.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    {
      text: 'The {plan} renewal went through on {date} and then again the same afternoon. That is a double charge, so refund one of them.',
      billingDispute: true,
      severe: true,
      grievance: true,
    },
    {
      text: 'A {amount} charge from {date} appeared on my statement for the {plan}. I did not sign up for it, so I want a refund.',
      billingDispute: true,
      grievance: true,
    },
    {
      text: 'I moved down to the {plan} in {date} but my invoice still shows the old price. Please refund the difference.',
      billingDispute: true,
      grievance: true,
    },
    {
      text: 'My free trial of the {plan} ended on {date} and a paid plan started with no warning. Please give me a refund.',
      billingDispute: true,
      grievance: true,
    },
    {
      text: 'I was quoted one fee and my statement shows {amount} for the {plan}, which is higher. I want that refunded.',
      billingDispute: true,
      grievance: true,
    },
    {
      text: 'Your invoice for the {plan} arrived a month late, and now our accounts team keeps chasing me about it.',
      grievance: true,
    },
    {
      text: 'Three weeks ago I asked for a corrected receipt and nobody has sent it. Our auditors are waiting on me.',
      grievance: true,
    },
    { text: 'Could you send me an invoice for my {plan} payment from {date}? I need it for my records.' },
    { text: 'I want to move my {plan} from monthly to yearly billing. Will my next invoice show the new price?' },
    { text: 'Please cancel my subscription before it renews on {date}. I do not want to pay for another month.' },
    { text: 'The receipt for {amount} lists a different company name than mine. Can you correct it?' },
    { text: 'Is sales tax included in the {amount} I paid for the {plan}? The receipt does not say.' },
    { text: 'Can you change the company name and address on all my past invoices? Our legal name changed this year.' },
    { text: 'Which card is the {plan} being paid with at the moment? I have two saved and have lost track.' },
    { text: 'Please send me a copy of the {amount} receipt from {date}, with the tax breakdown, for our expense report.' },
    { text: 'Can I pay my {plan} invoice by bank transfer instead of by card? Billing once a year would suit us better.' },
    { text: 'I need to update the billing contact for the {plan} because our finance person left the company.' },
  ],
  'Technical Issue': [
    { text: "{product} crashes every time a large file is opened. I can't work until this is fixed.", severe: true, grievance: true },
    {
      text: '{product} keeps crashing on my phone. It has happened every day this week and my team is waiting on me.',
      severe: true,
      grievance: true,
    },
    {
      text: 'The editor in {product} keeps crashing whenever I save, and my unsaved changes vanish.',
      severe: true,
      grievance: true,
    },
    {
      text: '{product} crashes every time my video call starts, and my customers see me drop out.',
      severe: true,
      grievance: true,
    },
    {
      text: 'Sync between my laptop and phone stopped yesterday. This is blocking my whole team.',
      severe: true,
      grievance: true,
    },
    {
      text: 'Since this morning {product} logs me out every few minutes and I lose what I was typing.',
      severe: true,
      grievance: true,
    },
    {
      text: 'The approve button in {product} greys out as soon as I tap it, which is blocking the entire sales team.',
      severe: true,
      grievance: true,
    },
    {
      text: '{product} freezes every time we open the ledger, so the finance team gets nothing done.',
      severe: true,
      grievance: true,
    },
    { text: 'The mobile app for {product} has stopped working on my tablet since the last update.', grievance: true },
    {
      text: 'The report I scheduled in {product} did not run for the third week in a row, and nobody told me why.',
      grievance: true,
    },
    { text: '{product} crashed once this morning, but it opened normally after a restart. Just letting you know.' },
    { text: 'The export button in {product} shows an error message and nothing downloads.' },
    { text: '{product} is slow today. Pages take about {seconds} seconds to load.' },
    { text: 'Uploads keep failing at 90 percent in {product}. I have tried three times.' },
    { text: 'The date filter in {product} resets whenever I refresh the page. Minor, but annoying.' },
    { text: 'The search box in {product} returns nothing for words I know are in my files.' },
    { text: 'Notifications from {product} arrive about an hour late on my laptop.' },
    { text: 'Dark text on a dark background: the new theme in {product} makes the menu unreadable.' },
    { text: 'Printing a report from {product} cuts off the right-hand column.' },
    { text: 'I cannot attach files over 10 MB in {product}. The progress circle spins and nothing happens.' },
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
      text: 'Every attempt to sign in says my details are wrong, yet they are the same ones I used yesterday.',
      grievance: true,
    },
    { text: 'Can I use one login for two different companies? I work for both and the email is the same.' },
    { text: 'I forgot which email address I signed up with. Can you look it up from my name and phone number?' },
    { text: 'Our contractor needs temporary entry to {product} for two weeks. How do we set that up without full rights?' },
    { text: 'After I changed my password the app on my tablet logged out and will not let me back in.', grievance: true },
  ],
  'Security Concern': [
    { text: 'I got a sign-in alert from a country I have never visited. My account has been hacked.', grievance: true },
    { text: 'Messages went out from my account that I never wrote. It was hacked, I am sure, so please lock it down.', grievance: true },
    { text: 'I received an email saying my data was part of a breach. Is my {product} data affected?' },
    { text: "Sessions at night from devices I don't own appear in my account, so someone else is signed in as me.", grievance: true },
    { text: 'My laptop was stolen and it was still signed in to {product}. Please lock my account.', grievance: true },
    { text: 'I think a contractor now has unauthorized access to our project folder in {product}. Please look into it today.' },
    { text: "A form on your site shows other people's names in the web address. This looks like a security hole." },
    { text: 'A text message gave me a login code I never asked for, three times in ten minutes.', grievance: true },
    { text: 'Our {product} audit shows a former employee still has an active session. Please end it today.' },
    { text: 'My email address was changed in my profile and I did not change it. I think another person got in.', grievance: true },
    { text: 'An email claiming to come from your billing team has a link in it. Should I click it? It looks a little odd.' },
    { text: 'I found a file in {product} that I never uploaded, and it has a strange name. Could it be a virus?', grievance: true },
    { text: 'The signed-in device list in {product} shows a tablet and a desktop I have never owned. Please remove them.', grievance: true },
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
      text: 'The login timer runs out before I can finish typing with my one working hand. Can the limit be longer?',
      grievance: true,
    },
    { text: 'Can I get your user guide as a plain text file? My braille display cannot read the PDF.' },
    { text: 'The animations in {product} make me dizzy. Can they be switched off somewhere?' },
    {
      text: 'Your phone support line offers no text relay, so as a deaf customer I cannot reach anyone.',
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
    { text: 'Does {product} support {feature}? The settings page does not show it anywhere.' },
    { text: 'Do students get a lower price? Not urgent, just curious.' },
    { text: 'Can several people edit the same report in {product} at once?' },
    { text: 'How many seats are included in the {plan}?' },
    { text: 'Is there an API for {product}? We would like to connect it to our internal tools.' },
    { text: 'Neither sales nor support ever explained what the {plan} actually includes. Does it cover {feature}?', grievance: true },
    { text: 'I asked about {feature} twice already and got two different answers. Which of them is right?', grievance: true },
    { text: 'Does {product} work on a tablet, or only on a desktop computer?' },
    { text: 'How long do you keep deleted files in {product} before they are gone for good?' },
    { text: 'Can I add a second admin to {product} without paying for another seat?' },
    { text: 'If I decide to leave, can I export all my data from {product}?' },
    { text: 'What happens to my files in {product} if I move from the {plan} to the {otherPlan}?' },
    { text: 'Will {product} still be supported next year? We are choosing tools for the whole company.' },
    {
      text: 'Your roadmap promised {feature} this quarter. Is there a date yet? I keep waiting and hearing nothing.',
      grievance: true,
    },
    {
      text: 'Your sales rep quoted one price for the {plan} and your website shows a higher one. Which is right?',
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
      text: "I've been a customer for years and this is the worst experience I have had. Have a manager call me.",
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
    { text: 'Please send my order to my office address instead of my home address.' },
    {
      text: 'Could someone give me any update on the parcel? The website has said processing for {days} days now.',
      statusQuestion: true,
      grievance: true,
    },
    {
      text: 'What is the order status for my lamp? The tracking page has shown nothing for {days} days.',
      statusQuestion: true,
      grievance: true,
    },
    { text: 'I need to return an item that does not fit. Is there a prepaid label I can print?' },
    { text: 'The label on my parcel had the wrong flat number, so it went back to your warehouse.', grievance: true },
    { text: 'Please can you deliver after 6pm? Nobody is home during the day and I keep missing the courier.' },
    { text: 'Half of my order is here and the other half is marked as out of stock. Will it ship separately?' },
    { text: 'Does the courier need a signature when my package arrives? I would rather have it left with the concierge.' },
    { text: 'My gift came in a box with the sender slip inside. Can the next one go without it?' },
    { text: 'The parcel locker you picked for me is across town. Can you send it to the one by my office instead?' },
  ],
  Other: [
    { text: 'Do you have a phone number for your head office? I want to post a letter.' },
    { text: 'We think our company and yours could partner up. Who should I talk to about that?' },
    { text: 'A quick thank you to your team for helping me last week. It went really well.' },
    { text: 'Are you hiring? Your site has no careers page that I can see.' },
    { text: 'Please remove me from your marketing emails. I have asked before.', grievance: true },
    { text: 'I am a journalist writing about small software companies. Who handles press requests?' },
    { text: 'Is your office open on {date}? I wanted to drop something off.' },
    { text: 'Your newsletter still lands in my inbox every week even though I unsubscribed last spring.', grievance: true },
    { text: 'Is it possible to arrange a visit to your office for a school group in the spring?' },
    { text: 'I found a typo on your website homepage. Who should I tell?' },
    { text: 'We are organising a charity run and would love your company to sponsor a team.' },
    { text: 'Please send your logo files. I am writing a blog post about local businesses.' },
    { text: 'I think I sent my CV to the wrong email address last week. Who reads applications?' },
    { text: 'Congratulations on your award this week. Well deserved!' },
    { text: 'The phone number on your contact page seems to have a digit missing.' },
    { text: 'My company would like to translate your help pages into Spanish for free. Who can we speak to about that?' },
    { text: 'I asked three times to be taken off your call list and the calls keep coming.', grievance: true },
    { text: 'A survey from your company reached my old address again, though I gave you the new one last year.', grievance: true },
  ],
};

// Every polite phrase the generator knows lives in these three lists, never in
// the wording of one category, so politeness shows up in every category and
// never tells the model which one a ticket belongs to. A polite security ticket
// takes its politeness from them too (see addVoice). None of these names a
// category.
export const OPENERS: readonly string[] = [
  'Hi,', 'Hello,', 'Hi there,', 'Good morning,', 'To whom it may concern,', 'Hey,',
  'Good afternoon,', 'Dear support,', 'Hello team,', 'Good evening,', 'Hello there,', 'Dear team,',
  'Sorry to bother you,', 'Sorry to trouble you,', 'I hope you are well.', 'I hope your week is going well.',
];

export const CLOSERS: readonly string[] = [
  'Thanks.', 'Thank you.', 'Please advise.', 'Appreciate any help.', 'Cheers.', 'Regards.',
  'Thank you so much.', 'Many thanks.', 'Thanks a lot.', 'I would be very grateful.', 'No rush at all.',
  'You were so helpful last time.',
];

// A polite ask that names no category, added to a ticket of any category with
// the same chance, so "could you please" and "would you mind" never lean toward
// one of them.
export const REQUESTS: readonly string[] = [
  'Could you please check on this when you can?',
  'Could you please say what happens next?',
  'Would you mind taking a look at this?',
  'Would you mind getting back to me soon?',
  'Could you help me with this?',
  'Could somebody please take a look?',
  'Would you be able to help?',
  'Kindly let me know how this goes.',
];
