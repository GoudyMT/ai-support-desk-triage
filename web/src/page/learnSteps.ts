import type { LearnStep } from './learnView';

// The seven steps of Learn The Process, in order: what is lit, what the engine holds so the live
// ticket is where the words say it is, and the words themselves.
const LINE = '.lines-detail > .line-detail:nth-child';

export const STEPS: readonly LearnStep[] = [
  {
    title: 'Messages come in',
    text: 'A company gets hundreds of customer messages a week. Each new one joins this line. The messages here are made up, so nobody real is involved.',
    lit: ['#incoming'],
    tab: 'in',
    hold: 'line',
    ready: (s) => s.current === undefined && s.incoming.length > 0,
  },
  {
    title: 'One message at a time',
    text: 'The top message, called a ticket, moves to the middle so the system can work on it. This is what the customer wrote, with some private details already covered. The bars along the top show its steps.',
    lit: ['.now-head', '.track', '.ticket-text'],
    hold: 'intake',
    ready: (s) => s.current?.stage === 'intake',
  },
  {
    title: 'Private details get hidden',
    text: 'This step is called Privacy. Before the model reads the message, any email addresses, phone numbers, order numbers and card numbers it finds are swapped for labels.',
    lit: [`${LINE}(1)`],
    hold: 'privacy',
    ticketStage: 'privacy',
    ready: (s) => s.current?.stage === 'privacy',
  },
  {
    title: 'The computer makes its best guess',
    text: 'This step is called Classify, and the part doing it is the model. It has studied thousands of example messages and counts which words usually go together. It says what the message is about, how urgent it is, and how sure it is.',
    lit: [`${LINE}(2)`],
    hold: 'classify',
    ticketStage: 'classify',
    ready: (s) => s.current?.stage === 'classify',
  },
  {
    title: 'Safety rules check the guess',
    text: 'These checks are called guardrails. The team wrote a short list of things that must always go to a person. The rules can overrule the computer. The computer can never overrule the rules.',
    lit: [`${LINE}(3)`],
    hold: 'guardrails',
    ticketStage: 'guardrails',
    ready: (s) => s.current?.stage === 'guardrails',
  },
  {
    title: 'A person has the final say',
    text: 'Doubtful messages wait here for a person. In this demo a simulated reviewer stands in. In See The Process, you can press Review to take its place. The rest go straight to the team the model picked, which is sometimes the wrong one. The demo stops once the ticket reaches its team. The team writes the reply.',
    lit: ['#outgoing'],
    tab: 'out',
    // The simulated reviewer would close the card within 1.5 seconds, long before these words are read.
    hold: 'reviewer',
    ready: (s) => s.open.length > 0,
  },
  {
    title: 'Keeping score',
    text: 'Because we know the true answer for each made-up message, these numbers are measured, not claimed. They include the mistakes.',
    lit: ['#stats'],
    hold: null,
    ready: (s) => s.done.length > 0,
  },
];
