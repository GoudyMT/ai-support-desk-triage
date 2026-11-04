import { CATEGORIES, PRIORITIES, ROUTES, type Category, type Priority } from '../domain/labels';
import { el, segmentNodes } from './dom';
import type { reviewView } from './view';

export interface Decision {
  category: Category;
  priority: Priority;
  route: string;
}

export interface ReviewActions {
  confirm(decision: Decision): void;
  handBack(): void;
}

type ReviewData = NonNullable<ReturnType<typeof reviewView>>;

const PICK_SUFFIX = " (model's pick)";
const RAISED_SUFFIX = ' (raised by a rule)';
const TEAMS = [...new Set(Object.values(ROUTES))];

// The tags say Critical for the Urgent priority, so the choices do too.
const shown = (value: string): string => (value === 'Urgent' ? 'Critical' : value);

function field(id: string, label: string, values: readonly string[]): { box: HTMLElement; select: HTMLSelectElement } {
  const box = el('div', 'field');
  const name = el('label', undefined, label);
  name.htmlFor = id;
  const select = el('select');
  select.id = id;
  select.append(
    ...values.map((value) => {
      const option = el('option', undefined, shown(value));
      option.value = value;
      return option;
    }),
  );
  box.append(name, select);
  return { box, select };
}

function markPick(select: HTMLSelectElement, pick: string, suffix = PICK_SUFFIX): void {
  for (const option of select.options) {
    option.textContent = option.value === pick ? `${shown(option.value)}${suffix}` : shown(option.value);
  }
  select.value = pick;
}

function buildForm(root: HTMLElement) {
  const title = el('h2', 'ticket-title');
  title.tabIndex = -1;
  const why = el('p', 'why');
  const text = el('p', 'ticket-text');
  const category = field('review-category', 'Category', CATEGORIES);
  const priority = field('review-priority', 'Priority', PRIORITIES);
  const team = field('review-team', 'Team', TEAMS);
  const fields = el('div', 'fields');
  fields.append(category.box, priority.box, team.box);
  const confirm = el('button', 'btn btn-solid', 'Confirm');
  confirm.type = 'submit';
  const handBack = el('button', 'btn btn-line', 'Hand back to the reviewer');
  handBack.type = 'button';
  const buttons = el('div', 'actions');
  buttons.append(confirm, handBack);
  const note = el('p', 'muted', "Your choices are scored against the true answer, like the simulated reviewer's.");
  root.replaceChildren(title, why, text, fields, buttons, note);
  return { title, why, text, category, priority, team, handBack };
}

/**
 * The review form that takes the center's place while the viewer reviews an open ticket.
 * Its choices start at the model's picks; the team follows the category until the viewer
 * picks a team. The form is filled once per review and left alone while it is open, so a
 * choice the viewer has made is never overwritten by a later render.
 */
export function mountReviewForm(
  root: HTMLElement,
  actions: ReviewActions,
): { render(view: ReviewData | undefined): void; focus(): void } {
  const { title, why, text, category, priority, team, handBack } = buildForm(root);
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
  handBack.addEventListener('click', actions.handBack);
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.confirm({
      category: category.select.value as Category,
      priority: priority.select.value as Priority,
      route: team.select.value,
    });
  });

  return {
    render(view) {
      if (view === undefined) {
        shownFor = '';
        return;
      }
      if (view.id === shownFor) {
        return;
      }
      shownFor = view.id;
      teamChosen = false;
      title.textContent = `You are reviewing ${view.id}`;
      why.textContent = `Why it was flagged: ${view.why}`;
      text.replaceChildren(...segmentNodes(view.segments));
      markPick(category.select, view.category);
      markPick(priority.select, view.priority, view.priorityRaised ? RAISED_SUFFIX : PICK_SUFFIX);
      team.select.value = view.route;
    },
    focus() {
      title.focus();
    },
  };
}
