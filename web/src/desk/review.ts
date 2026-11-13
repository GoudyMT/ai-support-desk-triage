// The review card: a modal over the desk for one ticket, starting at the model's picks. Every value goes in with
// textContent. The team follows the category until the viewer picks a team, and the card is filled once per ticket and
// then left alone, so a choice the viewer has made is never overwritten by a later draw. The note box is a new one for
// each ticket, so what was typed on an earlier ticket cannot come back through undo and redo.
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
  // Whether the card opened or closed a moment ago: a press now is the second of a double press, not a new choice.
  settling(): boolean;
}

const SETTLE_MS = 400;
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
  // Each model's own answer, on demand: the suggestion is the sentence model's.
  const both = el('details', 'review-models');
  const wordAnswer = el('dd');
  const sentenceAnswer = el('dd');
  const answers = el('dl');
  answers.append(el('dt', undefined, 'Word model'), wordAnswer, el('dt', undefined, 'Sentence model'), sentenceAnswer);
  both.append(el('summary', undefined, "Show both models' answers"), answers);
  reason.append(el('h3', undefined, 'Why it came to you'), why, both);
  const category = field('review-category', 'Category', CATEGORIES);
  const priority = field('review-priority', 'Priority', PRIORITIES);
  const team = field('review-team', 'Team', TEAMS);
  const fields = el('div', 'review-fields');
  fields.append(category.box, priority.box, team.box);
  const noteBox = el('div', 'field');
  const noteLabel = el('label', undefined, 'Note for the team (optional)');
  noteLabel.htmlFor = 'review-note';
  let note = el('textarea');
  note.id = 'review-note';
  note.rows = 2;
  note.maxLength = NOTE_MAX;
  // The viewer's own words: no spelling service and no autofill list may take them.
  note.spellcheck = false;
  note.autocomplete = 'off';
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
  let changedAt = Number.NEGATIVE_INFINITY;

  // A box typed in keeps an edit history that undo and redo reach, and a box only given new text keeps it, so each
  // ticket gets a new box with the same attributes.
  function renewNote(): void {
    const next = note.cloneNode(false) as HTMLTextAreaElement;
    next.value = '';
    note.replaceWith(next);
    note = next;
  }

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
      both.hidden = view.models === undefined;
      both.open = false;
      wordAnswer.textContent = view.models?.word ?? '';
      sentenceAnswer.textContent = `${view.models?.sentence ?? ''} (the suggestion)`;
      pick(category.select, view.category);
      pick(priority.select, view.priority);
      pick(team.select, view.route);
      renewNote();
      relabel();
      if (!attached) {
        document.body.append(dialog);
        attached = true;
      }
      dialog.showModal();
      changedAt = performance.now();
      send.focus();
    },
    close() {
      current = undefined;
      if (dialog.open) {
        // What was typed goes with the card, whether it was sent or handed back.
        renewNote();
        dialog.close();
        changedAt = performance.now();
      }
    },
    isOpen: () => current !== undefined,
    settling: () => performance.now() - changedAt < SETTLE_MS,
  };
}
