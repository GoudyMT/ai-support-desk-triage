// The review card: a modal over the desk for one ticket, starting at the model's picks. Every value goes in with
// textContent. The team follows the category until the viewer picks a team, and the card is filled once per ticket and
// then left alone, so a choice the viewer has made is never overwritten by a later draw.
import { CATEGORIES, PRIORITIES, ROUTES, type Category, type Priority } from '../domain/labels';
import { button, el } from '../page/dom';
import type { DeskReview } from './view';

export interface Decision {
  category: Category;
  priority: Priority;
  route: string;
}

export interface ReviewActions {
  send(decision: Decision, note: string): void;
  handBack(): void;
}

export interface ReviewCard {
  open(view: DeskReview): void;
  close(): void;
  isOpen(): boolean;
}

const NOTE_MAX = 500;
const PICK = " (model's pick)";
const SEND = 'Looks good, send it';
const SEND_CHANGED = 'Send with my changes';
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

function pick(select: HTMLSelectElement, value: string): void {
  for (const option of select.options) {
    option.textContent = option.value === value ? `${shown(option.value)}${PICK}` : shown(option.value);
  }
  select.value = value;
}

export function createReviewCard(actions: ReviewActions): ReviewCard {
  const title = el('h2', 'review-title', 'Review this ticket');
  title.id = 'review-title';
  const tag = el('span');
  const head = el('div', 'review-head');
  head.append(title, tag);
  const text = el('p', 'review-text');
  const why = el('p', 'review-why');
  const reason = el('div', 'review-reason');
  reason.append(el('h3', undefined, 'Why it came to you'), why);
  const category = field('review-category', 'Category', CATEGORIES);
  const priority = field('review-priority', 'Priority', PRIORITIES);
  const team = field('review-team', 'Team', TEAMS);
  const fields = el('div', 'review-fields');
  fields.append(category.box, priority.box, team.box);
  const noteBox = el('div', 'field');
  const noteLabel = el('label', undefined, 'Note for the team (optional)');
  noteLabel.htmlFor = 'review-note';
  const note = el('textarea');
  note.id = 'review-note';
  note.rows = 2;
  note.maxLength = NOTE_MAX;
  noteBox.append(noteLabel, note);
  const send = el('button', 'btn btn-solid', SEND);
  send.type = 'submit';
  const handBack = button('btn', 'Hand back to the reviewer');
  const actionRow = el('div', 'review-actions');
  actionRow.append(send, handBack);
  const help = el(
    'p',
    'review-help',
    'Change any box and the main button reads "Send with my changes". Your category and priority are checked against the true answer, and you see the result right after.',
  );
  const form = el('form', 'review-form');
  form.append(head, text, reason, fields, noteBox, actionRow, help);
  const dialog = el('dialog', 'review');
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.append(form);

  // The ticket that is open, or undefined when the card is closed or its ticket has been settled.
  let current: DeskReview | undefined;
  let teamChosen = false;
  let attached = false;

  function relabel(): void {
    const changed =
      current !== undefined &&
      (category.select.value !== current.category ||
        priority.select.value !== current.priority ||
        team.select.value !== current.route);
    send.textContent = changed ? SEND_CHANGED : SEND;
  }

  function handBackNow(): void {
    current = undefined;
    actions.handBack();
  }

  category.select.addEventListener('change', () => {
    if (!teamChosen) team.select.value = ROUTES[category.select.value as Category];
    relabel();
  });
  priority.select.addEventListener('change', relabel);
  team.select.addEventListener('change', () => {
    teamChosen = true;
    relabel();
  });
  handBack.addEventListener('click', handBackNow);
  // Escape is the same as Hand back. The browser would close the card itself, so it is told not to and the run's
  // answer closes it.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    handBackNow();
  });
  // A card closed any other way while a ticket is open is still a hand back, so the run is never held by a closed card.
  dialog.addEventListener('close', () => {
    if (current !== undefined) handBackNow();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (current === undefined) return;
    actions.send(
      {
        category: category.select.value as Category,
        priority: priority.select.value as Priority,
        route: team.select.value,
      },
      note.value.trim(),
    );
  });

  return {
    open(view) {
      if (current !== undefined) return;
      current = view;
      teamChosen = false;
      tag.className = `tag tag-${view.tag.level}`;
      tag.textContent = view.tag.word;
      text.textContent = view.text;
      why.textContent = view.why;
      pick(category.select, view.category);
      pick(priority.select, view.priority);
      pick(team.select, view.route);
      note.value = '';
      relabel();
      if (!attached) {
        document.body.append(dialog);
        attached = true;
      }
      dialog.showModal();
      send.focus();
    },
    close() {
      current = undefined;
      if (dialog.open) dialog.close();
    },
    isOpen: () => current !== undefined,
  };
}
