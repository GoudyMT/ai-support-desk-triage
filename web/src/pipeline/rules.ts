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
// A subject that names nothing and a trouble that says nothing, joined, make
// the vague ticket "the app is not working": the customer never says what
// does not work. A specific subject ("the export button") is a technical
// ticket, so it is not in the subject list.
const NAMELESS_SUBJECTS = [
  'that', 'everything', 'the app', 'the site', 'the website', 'the system', 'the software',
  'the thing', 'my thing',
];
const NAMELESS_TROUBLES = [
  'is not working', "isn't working", "doesn't work", 'does not work', "won't work",
  'stopped working', 'is broken', 'is acting up',
];

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
    // How a polite or worried customer says someone got in or tricked them.
    'security', 'suspicious', 'sketchy', 'fishy', 'hijack', 'hijacked', 'intruder', 'intrusion',
    'cyberattack', 'cyber attack', 'ddos', 'spyware', 'trojan', 'keylogger', 'viruses', 'infected',
    'exploit', 'exploited', 'vulnerability', 'vulnerabilities', 'exposed', 'stole', 'steal',
    'stealing', 'thief', 'phish', 'scammer', 'scammers', 'scams', 'fraudster', 'impersonate',
    'impersonating', 'impersonation', 'impersonator', 'impostor', 'imposter', 'spoofed', 'spoofing',
    'unrecognized', 'unrecognised', 'unfamiliar', 'unknown device', 'unknown location', 'dark web',
    "don't recognize", "don't recognise", 'do not recognize', 'do not recognise',
    'without my permission', 'without my consent', 'without my knowledge',
    'without my authorization', 'without my authorisation', 'not authorized', 'not authorised',
    'did not authorize', "didn't authorize", 'did not authorise', "didn't authorise",
    'never authorized', "wasn't me", 'was not me', 'login alert', 'login attempt',
    'login attempts', 'sign in attempt', 'signed in from', 'logged in from', 'login from',
    'got into my account', 'broke into', 'broken into', 'been accessed', 'was accessed',
    'were accessed', 'being accessed', 'someone is using', 'someone else is using',
    'someone using my', 'used by someone else', 'someone tried to log', 'someone tried to access',
    'someone has access', 'someone else has access', 'password was changed',
    'password has been changed', 'password was reset', 'password has been reset',
    'email was changed', 'email address was changed', 'did not make any', "didn't make any",
    'did not make this', "didn't make this", 'did not make that', "didn't make that",
    'did not request', "didn't request", 'never requested', 'did not sign up', "didn't sign up",
    'never signed up',
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
    'low contrast',
    'poor contrast',
    'high contrast',
    'contrast ratio',
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
    // Sight, hearing, movement and attention, and the words people use for them.
    'screenreader', 'screenreaders', 'screen reading', 'blindness', 'legally blind',
    'partially sighted', 'sighted', 'eyesight', 'vision loss', 'vision impairment',
    'visual impairment', 'impaired', 'impairment', 'poor vision', 'my vision', 'color contrast',
    'colour contrast', 'color blindness', 'colour blindness', 'color vision', 'colour vision',
    'text size', 'font size', 'larger text', 'large text', 'bigger text', 'text is too small',
    'too small to read', 'zoom in', 'zooming in', 'zoom level', 'zoom text', "can't zoom", 'cannot zoom', 'unable to zoom',
    'magnify', 'magnification', 'magnified', 'inaccessible', 'tab key', 'tab order',
    'focus order', 'focus indicator', 'without a mouse', 'without using a mouse',
    "can't use my mouse", 'cannot use my mouse', 'unable to use a mouse', 'one handed',
    'limited mobility', 'wheelchair', 'arthritis', "parkinson's", 'parkinsons', 'cerebral palsy',
    'paralysed', 'paralyzed', 'shaky hands', 'hand tremors', 'dexterity', 'switch control',
    'eye tracking', 'dictation', 'dictate', 'text to speech', 'speech to text', 'read aloud',
    'reads aloud', 'braille', 'seizure', 'seizures', 'epilepsy', 'flashing', 'flickering',
    'reduce motion', 'reduced motion', 'autism', 'autistic', 'adhd', 'cognitive', 'hearing loss',
    'hearing aid', 'deafness', 'captioning', 'audio description', 'audio descriptions',
    'alternative text', 'aria', 'aria label', 'aria labels', 'section 508', '508 compliance',
    'ada compliant', 'handicap', 'handicapped', 'disabled users', 'disabled people',
    'disabled person', 'americans with disabilities', 'reasonable accommodation',
    'reasonable accommodations',
  ],
  'billing dispute': [
    'charge',
    'charges',
    'charged',
    'charged twice',
    'double charged',
    'paid twice',
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
    // Extra, wrong, repeated or unknown money taken, as people word it.
    'overbilled', 'overbilling', 'overcharge', 'overcharging', 'overpaid', 'double charge',
    'duplicate charge', 'duplicate charges', 'duplicate payment', 'duplicate billing',
    'double payment', 'paid again', 'pay twice', 'paying twice', 'payed twice', 'charged again',
    'billed again', 'charged me', 'billed me', 'charging me', 'billing me', 'keeps charging',
    'still charging', 'still being charged', 'still charged', 'extra charge', 'extra charges',
    'extra fee', 'unexpected charge', 'unexpected fee', 'unknown charge', 'mystery charge',
    'hidden charge', 'hidden charges', 'hidden fee', 'hidden fees', 'wrong charge',
    'incorrect charge', 'wrongly charged', 'wrongly billed', 'incorrectly charged',
    'incorrectly billed', 'wrong bill', 'incorrect bill', 'bill is wrong', 'bill is incorrect',
    'wrong invoice', 'incorrect invoice', 'invoice is wrong', 'invoice is incorrect',
    'taken twice', 'deducted', 'deducted twice', 'debited', 'debited twice', 'withdrawn twice',
    'two charges', 'multiple charges', 'several charges', 'want my money', 'my money back',
    'return my money', 'reverse the charge', 'reverse this charge', 'reverse the payment',
    'remove the charge', 'credit back', 'credited back', 'compensation', 'compensate',
    'refunding', 'repayment', 'reimbursed', 'payment dispute', 'charge dispute',
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
    'screw you',
    'shut up',
    'go to hell',
    // Legal, public, physical and abusive threats, and plain insults.
    'suing', 'sued', 'lawyers', 'attorneys', 'solicitor', 'litigation', 'law suit', 'class action',
    'small claims', 'legal proceedings', 'legal counsel', 'legal recourse', 'legal remedies',
    'legal steps', 'legal consequences', 'take legal', 'taking legal', 'pursue legal', 'my rights',
    'consumer rights', 'breach of contract', 'police', 'authorities', 'ftc', 'fcc', 'fbi',
    'ombudsman', 'trading standards', 'consumer affairs', 'better business bureau',
    'report this to', 'report you to', 'reported to', 'file a lawsuit', 'file charges',
    'press charges', 'pressing charges', 'threat', 'threats', 'threaten', 'threatening',
    'threatened', 'be sorry', 'will regret', 'pay dearly', 'pay the price', 'make them pay',
    'make this company pay', 'or else', 'last warning', 'final warning', "i am warning you",
    "i'm warning you", 'face the consequences', 'there will be consequences',
    'serious consequences', 'severe consequences', 'expose you', 'expose your', 'expose this',
    'tell everyone', 'warn others', 'warn everyone', 'warn people', 'post about this',
    'all over the internet', 'go viral', 'bad press', 'bad review', 'negative review', 'one star',
    '1 star', 'ruin you', 'destroy you', 'destroy this', 'come after you', 'i know where you',
    'kill yourself', 'kill someone', 'kill them', 'drop dead', 'hope you die', 'piss off',
    'get lost', 'the hell', 'burn in hell', 'rot in hell', 'damn', 'damned',
    'crap', 'crappy', 'shit', 'shitty', 'bullshit', 'fuck', 'fucking', 'fucked', 'asshole',
    'bastard', 'bitch', 'dumb', 'dumbass', 'idiotic', 'moronic', 'jerk', 'scum', 'scumbag',
    'liar', 'liars', 'crook', 'crooks', 'crooked', 'criminals', 'loser', 'losers', 'clueless',
    'worthless', 'ignorant', 'imbecile', 'imbeciles',
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
    'useless',
    'frustrated',
    'unhappy',
    'dissatisfied',
    'disappointed',
    'complaint',
    'complain',
    'complaining',
    'formal complaint',
    'speak to a manager',
    'talk to a manager',
    'your manager',
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
    'switching to another',
    'switching to a competitor',
    'switching providers',
    'never again',
    'never recommend',
    'take my business',
    'lose me as a customer',
    'i demand',
    // Anger, contempt and "I have asked before", as people word them.
    'horrible', 'horrendous', 'dreadful', 'abysmal', 'atrocious', 'shocking', 'shameful',
    'rubbish', 'a joke', 'unbelievable', 'absurd', 'laughable', 'insulting', 'rude', 'rudeness',
    'unprofessional', 'incompetence', 'negligent', 'poor service', 'poor support', 'bad service',
    'bad support', 'not acceptable', 'not good enough', 'not happy', 'not satisfied',
    'not pleased', 'very upset', 'really upset', 'upset', 'annoyed', 'irritated', 'irate',
    'fuming', 'enraged', 'sick of', 'sick and tired', 'tired of', 'enough is enough',
    'losing patience', 'lost patience', 'my patience', 'nightmare', 'disaster', 'demand',
    'frustrating', 'frustration', 'disgusting', 'appalled', 'dismissive', 'disrespectful',
    'yet again', 'once again', 'again and again', 'over and over', 'three times', 'four times',
    'five times', 'for weeks', 'already told', 'already contacted', 'already emailed',
    'already called', 'for the second time', 'for the third time', 'never replied',
    'never responded', 'never answered', 'never heard back', 'nobody replied', 'nobody responded',
    'nobody answered', 'no one replied', 'no one responded', 'no one answered', 'no reply',
    'no answer', 'not heard back', "haven't heard back", 'have not heard back',
    'without a response', 'no help', 'not helpful', 'unhelpful', 'waste of time',
    'waste of money', 'wasting my time', 'wasted my time', 'rip off', 'ripped off',
    'going elsewhere', 'go elsewhere', 'switch to another', 'switch to a competitor',
    'leave you', 'speak with a manager', 'speak with your manager', 'speak with a supervisor',
    'someone senior', 'senior management', 'higher up', 'head office',
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
    // Other ways to say "something is wrong" or "help" without saying what.
    'something wrong', 'something seems wrong', 'something seems off', 'something looks wrong',
    'something looks off', 'something feels off', 'something feels wrong', 'something weird',
    'something odd', 'something strange', 'something broke', 'went wrong', 'gone wrong',
    'goes wrong', 'going wrong', 'not right', "isn't right", "doesn't seem right",
    'does not seem right', 'not working right', 'not working properly', 'not working correctly',
    'not working as expected', 'not working as it should', 'not behaving', 'misbehaving',
    'acting funny', 'acting strange', 'acting odd', 'behaving strangely', 'behaving oddly',
    'behaving weirdly', 'odd', 'oddly', 'weirdly', 'strangely', 'glitch', 'glitchy', 'glitching',
    'buggy', 'messed up', 'nothing works', 'nothing is working', 'nothing seems to work',
    'everything stopped', 'everything is wrong', 'no idea why',
    'no clue', 'have no idea', 'not sure why', 'not sure what happened', 'not sure what to do',
    'not sure how to explain', 'not sure how to describe', 'hard to explain', 'hard to describe',
    'difficult to explain', "can't explain", 'cannot explain', "can't figure out",
    'cannot figure out', "can't tell what", 'cannot tell what', 'need some help',
    'need assistance', 'need your help', 'help needed', 'help please', 'please assist',
    'can you help', 'could you help', 'can anyone help', 'somebody help', 'someone help', 'help with this', 'help with something', 'kindly help',
    'kindly assist', 'please look into', 'look into this', 'look into it', 'please fix',
    'please resolve', 'please sort', 'sort it out', 'sort this out', 'seems to be a problem',
    'seems to be an issue', 'seems to be something', 'some issue', 'some issues', 'some problem',
    'some problems', 'facing an issue', 'facing a problem', 'facing issues', 'facing problems',
    'experiencing an issue', 'experiencing a problem', 'experiencing issues',
    'experiencing problems', 'ran into a problem', 'ran into an issue', 'run into a problem',
    'run into an issue', 'encountered a problem', 'encountered an issue', 'got a problem',
    'got an issue',
    ...NAMELESS_SUBJECTS.flatMap((subject) =>
      NAMELESS_TROUBLES.map((trouble) => `${subject} ${trouble}`),
    ),
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
// Curly quotes (U+2018 and U+2019) are what phones and word processors type
// for an apostrophe; they are built from code points to keep this file ASCII.
const CURLY_APOSTROPHE = new RegExp(
  `[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`,
  'g',
);

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
// An apostrophe in an entry is optional in the text: "didnt" is "didn't"
// typed fast on a phone.
function wholeWordPattern(entry: string): RegExp {
  const body = entry
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(/ /g, '[\\s-]+')
    .replace(/'/g, "'?");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

// Slipped spellings. People type fast, so a word of 6 or more letters also
// matches a word one slip away: a letter dropped, doubled or two swapped
// ("hakced", "accesibility"). A word of 8 or more may also have one letter
// replaced ("compromized", "unnacceptable"). Shorter words stay exact because
// one letter turns them into everyday words ("sue" and "use", "scam" and
// "scan"), and shorter words are not replaced either: "charged" and "changed"
// are one letter apart. The first letter must be right, which people rarely get
// wrong and which keeps "reach" away from "breach". Only the word that slipped
// counts: a phrase needs every other word exactly, and one slip in total.
const SLIP_MIN_LENGTH = 6;
const SLIP_REPLACE_MIN_LENGTH = 8;

// Everyday words one slip from a rule word, which a slip must never read as
// the rule word: ignore/ignored, compromise/compromised, charger/charge,
// beach/breach, layer/lawyer, compliant/complaint, treat/threat, artistic/
// autistic, steaming/sealing/stealing, expose/exposed, regulatory/regulator,
// caption/captions, subtitle/subtitles, sketch/sketchy, stranger/strange,
// cautions/captions.
const NOT_A_SLIP = new Set([
  'ignore', 'compromise', 'compromises', 'charger', 'chargers', 'beach', 'beached',
  'layer', 'layers', 'compliant', 'treat', 'treats', 'artistic', 'steaming', 'sealing', 'expose',
  'regulatory', 'caption', 'subtitle', 'sketch', 'stranger', 'strangers', 'cautions',
]);

function isOneSlip(wanted: string, written: string): boolean {
  if (wanted[0] !== written[0] || NOT_A_SLIP.has(written)) return false;
  const lengthGap = written.length - wanted.length;
  if (Math.abs(lengthGap) > 1) return false;
  let first = 0;
  while (wanted[first] === written[first] && first < Math.min(wanted.length, written.length)) {
    first += 1;
  }
  if (lengthGap !== 0) {
    const [longer, shorter] = lengthGap > 0 ? [written, wanted] : [wanted, written];
    return longer.slice(first + 1) === shorter.slice(first);
  }
  if (first === wanted.length) return false;
  if (wanted[first] === written[first + 1] && wanted[first + 1] === written[first]) {
    return wanted.slice(first + 2) === written.slice(first + 2);
  }
  return (
    wanted.length >= SLIP_REPLACE_MIN_LENGTH && wanted.slice(first + 1) === written.slice(first + 1)
  );
}

interface TextWord {
  word: string;
  start: number;
  end: number;
}

// Words as the customer wrote them, apostrophes dropped ("don't" is "dont"),
// with where each sits so a phrase can demand that only spaces or a hyphen
// separate its words.
function wordsOf(text: string): TextWord[] {
  return [...text.matchAll(/[a-z0-9]+(?:'[a-z0-9]+)*/g)].map((found) => ({
    word: found[0].replace(/'/g, ''),
    start: found.index,
    end: found.index + found[0].length,
  }));
}

// True when the entry's words appear in a row with exactly one slipped word.
function matchesWithOneSlip(entryWords: string[], text: string, written: TextWord[]): boolean {
  for (let from = 0; from + entryWords.length <= written.length; from += 1) {
    let slips = 0;
    let fits = true;
    for (const [offset, wanted] of entryWords.entries()) {
      const here = written[from + offset];
      const before = written[from + offset - 1];
      if (!here || (before && !/^[\s-]+$/.test(text.slice(before.end, here.start)))) {
        fits = false;
        break;
      }
      if (here.word === wanted) continue;
      if (wanted.length < SLIP_MIN_LENGTH || !isOneSlip(wanted, here.word)) {
        fits = false;
        break;
      }
      slips += 1;
    }
    if (fits && slips === 1) return true;
  }
  return false;
}

// A vague ticket says something is wrong without saying what. When the whole
// message is only a few words and one of them is "problem", "issue" or the
// like, there is nothing more to read, whatever the exact words. "Not working"
// is not a cue here: a short sentence with it usually says what ("the page
// does not work without a mouse").
const SHORT_TICKET_MAX_WORDS = 12;
const SHORT_TICKET_WORD = 'short ticket without detail';
const SHORT_TICKET_CUES = ['problem', 'problems', 'issue', 'issues', 'trouble', 'glitch'].map(
  wholeWordPattern,
);

const COMPILED_RULES = REASON_ORDER.map((reason) => ({
  reason,
  entries: REVIEW_RULES[reason].map((word) => {
    const entryWords = word.replace(/'/g, '').split(' ');
    const canSlip = entryWords.some((part) => part.length >= SLIP_MIN_LENGTH) && /^[a-z0-9' ]+$/.test(word);
    return { word, pattern: wholeWordPattern(word), entryWords: canSlip ? entryWords : null };
  }),
}));

// Never throws and never echoes its input: an empty or odd text just matches nothing.
export function matchRules(maskedText: string): { reason: ReviewReason; words: string[] }[] {
  const text = maskedText
    .replace(MASK_TOKEN_PATTERN, ' ')
    .toLowerCase()
    .replace(CURLY_APOSTROPHE, "'");
  const written = wordsOf(text);
  const hits: { reason: ReviewReason; words: string[] }[] = [];
  for (const { reason, entries } of COMPILED_RULES) {
    let words = entries.filter(({ pattern }) => pattern.test(text)).map(({ word }) => word);
    // A slipped spelling is only a fallback: where a rule word was written
    // right, its neighbours ("hacker" beside "hackers") add nothing to show.
    if (words.length === 0) {
      words = entries
        .filter(({ entryWords }) => entryWords && matchesWithOneSlip(entryWords, text, written))
        .map(({ word }) => word);
    }
    if (
      words.length === 0 &&
      reason === 'vague ticket' &&
      written.length <= SHORT_TICKET_MAX_WORDS &&
      SHORT_TICKET_CUES.some((cue) => cue.test(text))
    ) {
      words = [SHORT_TICKET_WORD];
    }
    if (words.length > 0) hits.push({ reason, words });
  }
  return hits;
}
