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
  ['threatening language', 'fix this or i will sue you', ['sue']],
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
    ['i was charged twice', ['charged', 'charged twice']],
    ['i paid twice for my plan', ['paid twice']],
    ['i was double charged', ['charged', 'double charged']],
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
      { reason: 'threatening language', words: ['sue'] },
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
  ['security incident', 'i do not recognize this device on my account', ['do not recognize']],
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
  ['accessibility issue', 'the font size cannot be changed on the order page', ['font size']],
  ['accessibility issue', 'the video has no captioning', ['captioning']],
  ['accessibility issue', 'i use a wheelchair and the store map has no ramp info', ['wheelchair']],
  ['accessibility issue', 'my hand tremors make the small buttons impossible to press', ['hand tremors']],
  ['accessibility issue', 'the animation triggers my seizures', ['seizures']],
  ['accessibility issue', 'please add a screenreader label to the cart icon', ['screenreader']],
  ['accessibility issue', 'the page does not work without a mouse', ['without a mouse']],
  ['billing dispute', 'there is a duplicate charge on my statement', ['charge', 'duplicate charge']],
  ['billing dispute', 'you billed me after i cancelled', ['billed me']],
  ['billing dispute', 'there is an unexpected fee on my bill', ['unexpected fee']],
  ['billing dispute', 'the money was taken twice from my account', ['taken twice']],
  ['billing dispute', 'i was overbilled for march', ['overbilled']],
  ['billing dispute', 'the total on my invoice is wrong', ['invoice is wrong']],
  ['threatening language', 'i am talking to my lawyers about this', ['lawyers']],
  ['threatening language', 'i will call the police', ['police']],
  ['threatening language', 'you will be sorry for this', ['be sorry']],
  ['threatening language', 'this is my final warning', ['final warning']],
  ['threatening language', 'i will leave a bad review everywhere', ['bad review']],
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
  ['vague ticket', 'it was fine yesterday and now it is not right', ['not right']],
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
