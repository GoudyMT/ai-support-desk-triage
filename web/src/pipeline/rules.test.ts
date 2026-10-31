import { describe, expect, it } from 'vitest';
import type { ReviewReason } from '../domain/labels';
import { matchRules, REVIEW_RULES, RULE_PRIORITY } from './rules';

// One plain sentence per reason, as a customer would write it. Each must fire
// its own reason and no other, so a rule list that bleeds into a neighbour's
// topic shows up here.
const PLAIN_SENTENCES: [ReviewReason, string, string[]][] = [
  ['security incident', 'someone hacked my account last night', ['hacked']],
  ['accessibility issue', 'the screen reader skips the checkout button', ['screen reader']],
  ['billing dispute', 'i want a refund for this month', ['refund']],
  ['threatening language', 'fix this or i will sue you', ['will sue', 'sue you']],
  ['escalated complaint', 'this is unacceptable', ['unacceptable']],
  ['vague ticket', 'something is wrong with it', ['something is wrong']],
];

describe('matchRules', () => {
  it.each(PLAIN_SENTENCES)(
    'a plain %s sentence fires that reason alone, with the words it used',
    (reason, sentence, words) => {
      // The pipeline flags on these; a missed reason is a sensitive ticket nobody reviews.
      expect(matchRules(sentence)).toEqual([{ reason, words }]);
    },
  );

  it('does not read the word "card" inside a masked card number', () => {
    // Masked text carries tokens such as [CARD_NUMBER]; their inner words are
    // the masker's, not the customer's, and must never trigger a rule.
    expect(matchRules('my [CARD_NUMBER] was saved')).toEqual([]);
  });

  it('does not read "charge" inside "charger" as a billing dispute', () => {
    // A customer asking about a phone charger is not disputing a bill.
    expect(matchRules('is my charger covered?')).toEqual([]);
  });

  it('does not read "hack" inside "hackathon" as a security incident', () => {
    // A hackathon event is not a break-in; it would flag as Urgent for nothing.
    expect(matchRules('we are hosting a hackathon')).toEqual([]);
  });

  it.each([
    ['curly right quote', 0x2019],
    ['curly left quote', 0x2018],
  ])('reads a %s as an apostrophe', (_name, codePoint) => {
    // Phones and word processors turn typed apostrophes into curly ones; the
    // customer who writes it that way must flag like the one who does not.
    // Built from a code point so this file stays ASCII.
    const text = `i didn${String.fromCharCode(codePoint)}t log in`;
    expect(matchRules(text)).toEqual([{ reason: 'security incident', words: ["didn't log in"] }]);
  });

  it.each([
    ['a hyphen', 'the screen-reader skips the button'],
    ['a line break', 'the screen\nreader skips the button'],
  ])('matches a phrase written with %s between its words', (_name, text) => {
    // Pasted tickets wrap lines and people hyphenate; the phrase must still fire.
    expect(matchRules(text)).toEqual([{ reason: 'accessibility issue', words: ['screen reader'] }]);
  });

  it.each([
    ['i was charged twice', ['was charged', 'charged twice']],
    ['i paid twice for my plan', ['paid twice']],
    ['i was double charged', ['double charged']],
  ])('flags a duplicate charge: %s', (text, words) => {
    // The labeling rules count a duplicate charge as a billing dispute.
    expect(matchRules(text)).toEqual([{ reason: 'billing dispute', words }]);
  });

  it('files "useless" under a complaint, not a threat', () => {
    // A product called useless is an unhappy customer; calling it a threat
    // would raise the ticket to Urgent.
    expect(matchRules('the export button is useless when the file is large')).toEqual([
      { reason: 'escalated complaint', words: ['useless'] },
    ]);
  });

  it.each([
    'after switching to dark mode the app crashes',
    'how do i go about cancelling my order?',
    'in contrast to last month, the page loads slowly',
    'i use a password manager and autofill fails on login',
  ])('does not flag an everyday sentence: %s', (text) => {
    // Each uses a word that reads as a leaving, accessibility or manager cue in
    // other sentences; here it is routine and must not be flagged.
    expect(matchRules(text)).toEqual([]);
  });

  it('returns both reasons for a threat inside a billing dispute, in union order', () => {
    // Billing comes before threatening language in ReviewReason; the pipeline
    // records every reason and the higher priority must win later.
    expect(matchRules('refund my money or i will sue you')).toEqual([
      { reason: 'billing dispute', words: ['refund'] },
      { reason: 'threatening language', words: ['will sue', 'sue you'] },
    ]);
  });

  it('matches regardless of letter case', () => {
    // Customers shout; "HACKED" must flag like "hacked".
    expect(matchRules('SOMEONE HACKED MY ACCOUNT')).toEqual([
      { reason: 'security incident', words: ['hacked'] },
    ]);
  });
});

// One sentence per kind of wording the widened lists add, as a customer would
// write it. Each must fire its own reason alone, so a new entry that bleeds
// into another reason's topic shows up here.
const WIDENED_SENTENCES: [ReviewReason, string, string[]][] = [
  ['security incident', 'i got a login alert from a country i have never visited', ['login alert']],
  ['security incident', 'i do not recognize this device on my account', ['recognize this device']],
  [
    'security incident',
    'my password was changed without my permission',
    ['without my permission', 'password was changed'],
  ],
  ['security incident', 'i am writing to report a security concern', ['security']],
  ['security incident', 'an email asked for my password and it looks fishy', ['fishy']],
  ['security incident', 'someone else has access to my profile', ['someone else has access']],
  ['security incident', 'a verification code arrived that i did not request', ['did not request']],
  ['security incident', 'our site has a vulnerability in the login form', ['vulnerability']],
  ['security incident', 'my account was accessed from another country', ['was accessed']],
  ['security incident', 'a scammer is impersonating your staff', ['scammer', 'impersonating']],
  ['accessibility issue', 'my vision is poor and the font is tiny', ['my vision']],
  ['accessibility issue', 'the font size cannot be changed on the order page', ['font size cannot']],
  ['accessibility issue', 'the video has no captioning', ['captioning']],
  ['accessibility issue', 'i use a wheelchair and the store map has no ramp info', ['wheelchair']],
  ['accessibility issue', 'my hand tremors make the small buttons impossible to press', ['hand tremors']],
  ['accessibility issue', 'the animation triggers my seizures', ['seizures']],
  ['accessibility issue', 'please add a screenreader label to the cart icon', ['screenreader']],
  ['accessibility issue', 'the page does not work without a mouse', ['without a mouse']],
  ['billing dispute', 'there is a duplicate charge on my statement', ['charge on my', 'duplicate charge']],
  ['billing dispute', 'you billed me after i cancelled', ['billed me']],
  ['billing dispute', 'there is an unexpected fee on my bill', ['unexpected fee']],
  ['billing dispute', 'the money was taken twice from my account', ['taken twice']],
  ['billing dispute', 'i was overbilled for march', ['overbilled']],
  ['billing dispute', 'the total on my invoice is wrong', ['invoice is wrong']],
  ['threatening language', 'i am talking to my lawyers about this', ['lawyers']],
  ['threatening language', 'i will call the police', ['police']],
  ['threatening language', 'you will be sorry for this', ['be sorry']],
  ['threatening language', 'this is my final warning', ['final warning']],
  ['threatening language', 'you are all liars and crooks', ['liars', 'crooks']],
  ['threatening language', 'what the hell is going on with you', ['the hell']],
  ['escalated complaint', 'the service has been horrible', ['horrible']],
  ['escalated complaint', 'i am tired of waiting for an answer', ['tired of']],
  ['escalated complaint', 'nobody replied to my last three emails', ['nobody replied']],
  ['escalated complaint', 'this is a waste of money', ['waste of money']],
  ['escalated complaint', 'i want to speak with a manager', ['speak with a manager']],
  ['escalated complaint', 'this is not acceptable', ['not acceptable']],
  ['escalated complaint', 'i have already told you twice', ['already told']],
  ['vague ticket', 'nothing works', ['nothing works']],
  ['vague ticket', 'the app is not working', ['the app is not working']],
  ['vague ticket', 'it is acting funny', ['acting funny']],
  ['vague ticket', 'i need some help', ['need some help']],
  ['vague ticket', 'it is hard to explain', ['hard to explain']],
  ['vague ticket', 'it was fine yesterday and now it is not right', ['it is not right']],
  ['vague ticket', 'there seems to be a problem', ['seems to be a problem']],
  ['vague ticket', 'could someone help', ['someone help']],
  ['vague ticket', 'please fix it', ['please fix']],
  ['vague ticket', "i can't figure out what is going on", ["can't figure out"]],
];

describe('widened lists', () => {
  it.each(WIDENED_SENTENCES)(
    'a plain %s sentence fires that reason alone: %s',
    (reason, sentence, words) => {
      // Real tickets rarely use the textbook phrase; each wording is one way a
      // person says it, and a miss is a ticket nobody reviews.
      expect(matchRules(sentence)).toEqual([{ reason, words }]);
    },
  );

  it.each(Object.entries(REVIEW_RULES))('every %s entry can fire when written alone', (reason, entries) => {
    // A mistyped entry (capital letter, stray space) would never match and
    // nobody would notice; a duplicate would list one word twice.
    expect(new Set(entries).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry).toMatch(/^[a-z0-9' -]+$/);
      const hit = matchRules(entry).find((found) => found.reason === reason);
      expect(hit?.words).toContain(entry);
    }
  });

  it.each([
    ['i didnt log in', 'security incident', ["didn't log in"]],
    ['it doesnt work', 'vague ticket', ["it doesn't work"]],
  ])('reads %j without its apostrophe', (text, reason, words) => {
    // Typed fast on a phone, "didn't" often loses its apostrophe.
    expect(matchRules(text)).toEqual([{ reason, words }]);
  });
});

describe('misspelling tolerance', () => {
  it.each([
    ['security incident', 'my account was hakced yesterday', ['hacked']],
    ['security incident', 'our records were compromized', ['compromised']],
    ['accessibility issue', 'the site has bad accesibility for me', ['accessibility']],
    ['escalated complaint', 'this is totally unnacceptable', ['unacceptable']],
    ['billing dispute', 'i want a refnud for this month', ['refund']],
    ['threatening language', 'i will contact my lawer', ['lawyer']],
    ['vague ticket', 'somthing is wrong with it', ['something is wrong']],
  ] as [ReviewReason, string, string[]][])(
    'a slipped spelling still fires %s: %s',
    (reason, text, words) => {
      // Customers type fast on phones; a dropped, doubled or swapped letter
      // must not hide a sensitive ticket from review.
      expect(matchRules(text)).toEqual([{ reason, words }]);
    },
  );

  it.each([
    'how do i use this',
    'can i scan a barcode with the app',
    'the battery is dead',
    'does it blend ice',
  ])('keeps short words exact: %s', (text) => {
    // "sue", "scam", "deaf" and "blind" sit one letter from everyday words;
    // letting them stretch would flag "use", "scan", "dead" and "blend".
    expect(matchRules(text)).toEqual([]);
  });

  it.each([
    'we changed the plan last week and the changes look right on my account',
    'the support agent was polite and quick',
    'please ignore my earlier message',
    'we reached a compromise on the price',
    'how do i reach the support team',
    'is there a beach towel in the summer range',
    'there is a layer of foam inside the case',
    'the item is compliant with the eu rules',
    'the charger arrived with the wrong plug',
  ])('does not stretch a spelling onto an everyday word: %s', (text) => {
    // Each word is one letter from a rule word (changed/charged, polite/police,
    // ignore/ignored, compromise/compromised, reach and beach/breach, layer/lawyer,
    // compliant/complaint); reading it as the rule word would flag an ordinary
    // customer.
    expect(matchRules(text)).toEqual([]);
  });

  it.each([
    'how do i change my shipping address before it ships',
    'what is the difference between the basic and premium plans',
    'can you tell me when my order will arrive',
    'how do i reset my password from the login page',
    'is the blue jacket available in a larger size',
    'the tracking page shows my parcel left the warehouse yesterday',
    'please change the delivery date to friday',
    'i would like to update the email on my profile',
    'does the premium plan include extra storage and priority delivery',
    'how long does standard shipping take to canada',
    'where can i find the user guide for the camera',
    'can i add a second user to my team account',
    'how do i download my receipt as a pdf',
    'where is my order',
  ])('does not flag an ordinary product or shipping question: %s', (text) => {
    // The false flags the new tolerance and lists must not cause: a reviewer's
    // time is spent on each one.
    expect(matchRules(text)).toEqual([]);
  });
});

describe('slipped spelling next to punctuation', () => {
  it.each([
    ['Help, hakced', 'security incident', ['hacked']],
    ['urgent: hakced', 'security incident', ['hacked']],
    ['ok, somthing is wrong with it', 'vague ticket', ['something is wrong']],
  ] as [string, ReviewReason, string[]][])('reads %j after punctuation', (text, reason, words) => {
    // A comma or a colon before a misspelled word is how people write; the word
    // after it must read like the same word in the middle of a sentence.
    expect(matchRules(text)).toEqual([{ reason, words }]);
  });

  it('still wants a phrase written as one run, punctuation or not', () => {
    // Only spaces or a hyphen may sit between a phrase's words, so a comma
    // splits "something is wrong" into two thoughts.
    expect(matchRules('somthing, is wrong')).toEqual([]);
  });
});

describe('long tickets', () => {
  const LONG_TEXT = 20_000;
  const TIMING_RUNS = 5;
  const TIME_LIMIT_MS = 40;
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[TIMING_RUNS >> 1] ?? 0;

  it.each([
    ['a letter and a line break, repeated', 'a\n'.repeat(LONG_TEXT / 2)],
    ['a letter and a space, repeated', 'i '.repeat(LONG_TEXT / 2)],
    [
      'ordinary prose',
      'the export page loads slowly when the report has many rows and the filter is set to last month. '
        .repeat(LONG_TEXT)
        .slice(0, LONG_TEXT),
    ],
  ])('reads 20,000 characters of %s well inside the limit', (_name, text) => {
    // A ticket pasted from a long email thread must not freeze the page: the
    // slipped-spelling search once compared every word with every rule word.
    // The limit is generous (the real time is a fraction of it) so a slow
    // machine passes, while a return of the all-pairs scan does not.
    matchRules(text);
    const times = Array.from({ length: TIMING_RUNS }, () => {
      const start = performance.now();
      matchRules(text);
      return performance.now() - start;
    });
    expect(median(times)).toBeLessThan(TIME_LIMIT_MS);
  });
});

describe('short tickets', () => {
  it('flags a few words that only say there is a problem', () => {
    // A vague ticket says something is wrong without saying what; when the whole
    // message is a few words, there is nothing else to read.
    expect(matchRules('my account has a problem')).toEqual([
      { reason: 'vague ticket', words: ['short ticket without detail'] },
    ]);
  });

  it('leaves a long ticket alone when it names the problem', () => {
    // The same word in a ticket that goes on to explain is a described issue.
    expect(
      matchRules(
        'the problem seems limited to the mobile checkout page where the discount code box is hidden behind the keyboard on small screens',
      ),
    ).toEqual([]);
  });

  it('leaves a short ticket with no trouble word alone', () => {
    // Short is not vague: a status question names what it wants.
    expect(matchRules('what time does the store open')).toEqual([]);
  });

  // The rule counts what the customer wrote: filler words after the cue.
  const FILLER_WORD = 'okay';
  const SHORT = [{ reason: 'vague ticket', words: ['short ticket without detail'] }];

  it('flags a ticket of 12 words and leaves one of 13', () => {
    // The limit is where "a few words" ends; one word either side shows it.
    const ticket = (count: number) => ['problem', ...Array(count - 1).fill(FILLER_WORD)].join(' ');
    expect(matchRules(ticket(12))).toEqual(SHORT);
    expect(matchRules(ticket(13))).toEqual([]);
  });

  it('does not count the words inside a masked token', () => {
    // [ORDER_NUMBER] is the masker's, so a 12-word ticket with one stays at 12
    // words and is still flagged; counted as words it would read as 14.
    const filler = Array(11).fill(FILLER_WORD).join(' ');
    expect(matchRules(`[ORDER_NUMBER] ${filler} problem`)).toEqual(SHORT);
  });

  it.each(['a problem', 'problems', 'an issue', 'issues', 'trouble'])(
    'reads %j as the whole complaint in a short ticket',
    (cue) => {
      // Each of these says something is wrong and nothing more.
      expect(matchRules(`my account has ${cue}`)).toEqual(SHORT);
    },
  );

  it.each([
    ['thanks, no issues so far', 'a customer saying nothing is wrong'],
    ['how do i issue a credit note?', 'issue as a verb'],
    ["i'm having trouble resetting my password", 'trouble that names what failed'],
    ['i am without any problems this week', 'no trouble at all'],
    ['not any issues so far, thanks', 'a customer saying nothing is wrong'],
    ['never any trouble until today, all good', 'a customer saying nothing was wrong'],
  ])('does not flag %j (%s)', (text) => {
    // The cue word is there but the ticket is not vague; a flag here would send
    // a clear question or a thank-you to a reviewer as a vague ticket.
    expect(matchRules(text)).toEqual([]);
  });

  it('flags a very short plea for help but not a request that names its task', () => {
    // "Help me" says nothing; "help me export my contacts" says what to do.
    expect(matchRules('can anyone help me out')).toEqual(SHORT);
    expect(matchRules('can anyone help me out here')).toEqual([]);
    expect(matchRules('help me')).toEqual(SHORT);
  });
});

// Ordinary sentences a sweep found wrongly flagged. A flag sends the ticket to a
// person, can raise its priority (security and threats to Urgent) and records a
// reason, so each of these must come back empty.
const NOT_FLAGGED = [
  // Security words used for plain product talk.
  "i can't login from my phone since the update",
  'i logged in from my work laptop and the page is blank',
  "i didn't make any changes and now the report is blank",
  'import fails with an unrecognized file format error',
  "i'm unfamiliar with the new layout",
  "i don't recognize this setting",
  'i get a not authorized error when i open the report',
  'the new banner has taken over half the screen',
  'is there a hack to bulk edit tags?',
  'the script is injected into the page twice',
  // Threat and insult words used innocently.
  'my settings get lost when i log out',
  'should i use the csv import or else enter them by hand?',
  'i reported to your team last week and it is fixed now',
  'do you expose your api?',
  'our legal team needs a copy of the dpa',
  'the logo looks crooked',
  'can i get my rights back on the shared folder?',
  'dumb question, but where is the export button?',
  "i'm clueless about the new dashboard",
  'damn, i forgot to attach the screenshot',
  // Money words in a question about price, or a word one slip from a billing word.
  'the language keeps changing to french',
  'my profile picture keeps changing back',
  'the tooltip is overlaid on the save button',
  'is there a charge for adding a second user?',
  'will i be charged when the trial ends?',
  'please add sue to our team',
  'who is in charge of my account?',
  // Anger words used innocently.
  'move the logout button higher up please',
  'can i add our head office address to invoices?',
  'do you support disaster recovery backups?',
  'can i get the on-demand report for march?',
  'thanks once again for your help!',
  'i clicked save three times and nothing happened',
  'the page reloads over and over',
  'the date filter is ignored when i export',
  'how do i give the supervisor role access?',
  "i'll leave you my number",
  'the app is unbelievably fast now, thanks!',
  // Screen words used for ordinary layout and settings.
  'the settings page is not accessible from my phone',
  'the dashboard is inaccessible since this morning',
  'the screen is flickering when i scroll',
  'when i zoom in on the chart the labels overlap',
  'can i change the font size on printed invoices?',
  'aria from our team cannot see the shared reports',
  'do the window blinds come in white?',
  // Requests that name their task.
  'can you help me export my contacts to csv?',
  'the totals are not right on the march invoice',
  // Everyday words one slip from a rule word (the NOT_A_SLIP list).
  'how do i treat a leather stain',
  'add a caption to my photo',
  'is the steaming function safe',
  'i like the sketch tool',
  'a stranger sent me a gift card',
  'the artistic photo filter looks great',
  'the sealing tape came off in the post',
  'does the report expose a public link',
  'this is a regulatory form',
  'add a subtitle under the heading',
  'read the safety cautions in the manual',
  'the cover layers and treats are stored here',
];

// Wrong-reason cases: the ticket is sensitive, but not in the way the old list said.
const REASSIGNED: [string, ReviewReason, string[]][] = [
  ['my antivirus flags a threat in your installer', 'security incident', ['threat']],
  ['i will leave a one star review if this keeps crashing', 'escalated complaint', ['one star']],
  ['i will post a bad review if nobody helps', 'escalated complaint', ['bad review']],
];

// Plainly sensitive wording that the narrowed lists must keep catching.
const KEPT_SENSITIVE: [ReviewReason, string, string[]][] = [
  ['security incident', 'someone logged into my account from another country', ['someone logged into']],
  ['security incident', 'i think my account has been taken over', ['account has been taken over']],
  ['security incident', 'someone tried to hack my account', ['hack my']],
  ['security incident', 'there are unrecognized logins on my account', ['unrecognized logins']],
  ['security incident', 'my account shows a login from brazil that i do not recognize', ['that i do not recognize']],
  ['security incident', "i see a purchase on my account i don't recognize", ["on my account i don't recognize"]],
  ['accessibility issue', 'your checkout is not accessible, i am a keyboard user and cannot reach the pay button', ['keyboard user']],
  ['billing dispute', 'that charge was a mistake, i cancelled last month', ['that charge']],
  ['billing dispute', 'i was billed $49 instead of $29 this month', ['was billed']],
  ['billing dispute', 'i cancelled in march but was still billed for april', ['still billed']],
  ['accessibility issue', 'i use a screen reader and the form is unreadable', ['screen reader']],
  ['accessibility issue', 'the checkout is not accessible to keyboard users', ['not accessible to', 'keyboard users']],
  ['accessibility issue', 'i cannot zoom the page to 200 percent', ['zoom the page', 'cannot zoom']],
  ['accessibility issue', 'the flashing lights on the home page trigger my seizures', ['seizures', 'flashing lights']],
  ['billing dispute', 'i see a charge on my card that i never agreed to', ['charge on my']],
  ['billing dispute', 'my card was charged for a plan i cancelled', ['was charged']],
  ['billing dispute', 'they charged me again', ['they charged', 'charged me']],
  ['threatening language', 'i will sue you', ['will sue', 'sue you']],
  ['threatening language', 'my lawyer will be in touch', ['lawyer']],
  ['threatening language', 'my legal team will contact you', ['legal team will']],
  ['threatening language', 'pay me back or else you will regret it', ['you will regret', 'will regret', 'or else you will']],
  ['escalated complaint', 'i want to speak to a supervisor', ['speak to a supervisor']],
  ['escalated complaint', 'i have emailed you three times and nobody replied', ['emailed you three times', 'nobody replied']],
  ['escalated complaint', 'i told you over and over', ['told you over and over']],
  ['escalated complaint', 'i feel ignored by your team', ['feel ignored']],
  ['vague ticket', 'sorry, it is not right', ['it is not right']],
];

describe('sweep fixes', () => {
  it.each(NOT_FLAGGED)('does not flag an ordinary sentence: %s', (text) => {
    expect(matchRules(text)).toEqual([]);
  });

  it.each(REASSIGNED)('files %j under the right reason only', (text, reason, words) => {
    // A bad-review warning is an unhappy customer, and an antivirus alert is a
    // security matter; neither is a threat that would raise the ticket to Urgent.
    expect(matchRules(text)).toEqual([{ reason, words }]);
  });

  it.each(KEPT_SENSITIVE)('still flags %s: %s', (reason, text, words) => {
    // Narrowing the lists must not hide a ticket a person has to see.
    expect(matchRules(text)).toEqual([{ reason, words }]);
  });
});

describe('RULE_PRIORITY', () => {
  it('holds the priority each reason raises a ticket to', () => {
    // These are the owner-set floors shown before a reviewer sees the ticket.
    expect(RULE_PRIORITY).toEqual({
      'security incident': 'Urgent',
      'threatening language': 'Urgent',
      'accessibility issue': 'High',
      'escalated complaint': 'High',
      'billing dispute': 'Medium',
      'vague ticket': 'Medium',
    });
  });
});
