import { CATEGORIES, PRIORITIES, ROUTES, type Category, type Priority } from '../domain/labels';
import { appendDetail } from './currentTicket';
import { el } from './stageRow';
import type { CurrentTicketView, NarrationView, TakeOverDefaults } from './view';

export interface Decision {
  category: Category;
  priority: Priority;
  route: string;
}

const PICK_SUFFIX = " (model's pick)";
const TEAMS = [...new Set(Object.values(ROUTES))];

function field(id: string, label: string, values: readonly string[]): { box: HTMLElement; select: HTMLSelectElement } {
  const box = el('div', 'field');
  const name = el('label', undefined, label);
  name.htmlFor = id;
  const select = el('select');
  select.id = id;
  select.append(...values.map((value) => {
    const option = el('option', undefined, value);
    option.value = value;
    return option;
  }));
  box.append(name, select);
  return { box, select };
}

function markPick(select: HTMLSelectElement, pick: string): void {
  for (const option of select.options) {
    option.textContent = option.value === pick ? `${option.value}${PICK_SUFFIX}` : option.value;
  }
  select.value = pick;
}

export function mountTakeOverForm(
  root: HTMLElement,
  onConfirm: (decision: Decision) => void,
): {
  render(defaults: TakeOverDefaults | undefined, ticket: CurrentTicketView | undefined, narration: NarrationView | undefined): void;
  focus(): void;
} {
  const title = el('h2', 'h2');
  const text = el('p', 'ticket-text');
  const why = el('p', 'why');
  const category = field('take-over-category', 'Category', CATEGORIES);
  const priority = field('take-over-priority', 'Priority', PRIORITIES);
  const team = field('take-over-team', 'Send to', TEAMS);
  const fields = el('div', 'fields');
  fields.append(category.box, priority.box, team.box);
  const confirm = el('button', 'btn btn-on', 'Confirm and continue');
  confirm.type = 'submit';
  const technical = el('details', 'technical');
  const detailList = el('dl', 'tech');
  technical.append(el('summary', undefined, 'Show technical detail'), detailList);
  const note = el('p', 'muted', "Your choices are scored against the true answer, like the simulated reviewer's.");
  const actions = el('div', 'actions');
  actions.append(confirm);
  root.replaceChildren(title, text, why, fields, actions, technical, note);

  // The team follows the category until the viewer picks a team themselves.
  let teamChosen = false;
  let shownFor = '';
  category.select.addEventListener('change', () => {
    if (!teamChosen) {
      team.select.value = ROUTES[category.select.value as Category];
    }
  });
  team.select.addEventListener('change', () => {
    teamChosen = true;
  });
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    onConfirm({
      category: category.select.value as Category,
      priority: priority.select.value as Priority,
      route: team.select.value,
    });
  });

  return {
    render(defaults, ticket, narration) {
      if (defaults === undefined || ticket === undefined || narration === undefined || ticket.id === shownFor) {
        return;
      }
      shownFor = ticket.id;
      teamChosen = false;
      title.textContent = `Review ${ticket.id}`;
      text.replaceChildren(
        ...ticket.segments.map((segment) =>
          segment.kind === 'mask' ? el('span', 'mask', segment.text) : document.createTextNode(segment.text),
        ),
      );
      why.textContent = `Why it was flagged: ${defaults.why}`;
      markPick(category.select, defaults.category);
      markPick(priority.select, defaults.priority);
      team.select.value = defaults.route;
      appendDetail(detailList, narration.detail);
      technical.open = false;
    },
    focus() {
      root.focus();
    },
  };
}
