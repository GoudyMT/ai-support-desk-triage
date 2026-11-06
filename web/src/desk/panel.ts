// The side panel's second half: more numbers, the two assumptions the viewer can change, and Generate report. The
// markup is in the page; this fills it. The assumptions live here, in the page's memory, and are never stored or sent.
import { byId, setText } from '../page/dom';
import { HOURLY_PAY_USD, MINUTES_PER_TICKET, dollarsText, minutesText } from '../run/valueSaved';
import { fadeNumber } from './motion';
import type { DeskNumbers, MoreNumbers } from './view';

const MINUTES_PER_HOUR = 60;
const CENTS = 100;

export interface Assumptions {
  minutes: number;
  pay: number;
}

// Past this a value is no estimate and its text would print as Infinity or NaN.
const ASSUMPTION_MAX = 100_000;

// The viewer's value if it is a number of 0 or more and not past the ceiling; otherwise the last good one, with a line that
// says so.
export function parseAssumption(raw: string, last: number): { value: number; message: string } {
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (Number.isFinite(value) && value >= 0 && value <= ASSUMPTION_MAX) return { value, message: '' };
  return { value: last, message: `Kept ${last}. Enter a number of 0 or more.` };
}

// What `counted` tickets are worth at these assumptions. Minutes are rounded to hundredths so 0.1 a ticket does not
// print as 0.30000000000000004.
export function estimate(counted: number, a: Assumptions): { minutes: number; dollars: number } {
  const minutes = Math.round(counted * a.minutes * CENTS) / CENTS;
  return { minutes, dollars: (minutes / MINUTES_PER_HOUR) * a.pay };
}

const valueText = (counted: number, a: Assumptions): string => {
  const { minutes, dollars } = estimate(counted, a);
  return `${minutesText(minutes)}, ${dollarsText(dollars)}`;
};

export interface Panel {
  assumptions(): Assumptions;
  draw(numbers: DeskNumbers, more: MoreNumbers): void;
  generate: HTMLButtonElement;
}

// `onEdit` is called after each change to an assumption, so a report that is open can follow it.
export function createPanel(onEdit: () => void): Panel {
  const current: Assumptions = { minutes: MINUTES_PER_TICKET, pay: HOURLY_PAY_USD };
  const generate = byId('generate') as HTMLButtonElement;
  let counted = 0;
  const showValue = (): void => fadeNumber(byId('value-now'), valueText(counted, current));

  for (const key of ['minutes', 'pay'] as const) {
    const input = byId(`in-${key}`) as HTMLInputElement;
    input.value = String(current[key]);
    input.addEventListener('input', () => {
      const { value, message } = parseAssumption(input.value, current[key]);
      current[key] = value;
      setText(byId(`err-${key}`), message);
      showValue();
      onEdit();
    });
  }

  const more = byId('more');
  const block = byId('more-block');
  more.addEventListener('click', () => {
    block.hidden = !block.hidden;
    more.setAttribute('aria-expanded', String(!block.hidden));
    // The button holds both labels, More numbers and Fewer numbers, and shows the one that fits.
    for (const word of more.children) (word as HTMLElement).hidden = !(word as HTMLElement).hidden;
  });

  return {
    assumptions: () => ({ ...current }),
    draw(numbers, extra) {
      counted = numbers.rightNoPerson;
      fadeNumber(byId('n-sent'), extra.sent);
      fadeNumber(byId('n-ms'), extra.ms);
      showValue();
      generate.disabled = numbers.closed === 0;
    },
    generate,
  };
}
