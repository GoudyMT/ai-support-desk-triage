import { button, el } from './dom';
import type { SourceView } from './view';

// Room kept between a panel and the edge of the screen.
const EDGE_PX = 8;

/**
 * How far to move a panel sideways from its row's left edge so all of it is on the screen. A panel wider
 * than the screen keeps its left edge in view: the start of the words matters more than the end.
 */
export function panelOffset(rowLeft: number, panelWidth: number, screenWidth: number): number {
  const mostRight = screenWidth - EDGE_PX - panelWidth - rowLeft;
  const mostLeft = EDGE_PX - rowLeft;
  return Math.max(mostLeft, Math.min(0, mostRight));
}

// The words with each link set inside the phrase it names, so the panel reads the same without the links. The
// phrases are found in the order they are given, each after the last.
function panelNodes(source: SourceView): Node[] {
  const nodes: Node[] = [];
  let from = 0;
  for (const link of source.links ?? []) {
    const at = source.text.indexOf(link.phrase, from);
    if (at === -1) continue;
    const anchor = el('a', undefined, link.phrase);
    anchor.href = link.href;
    // A link is the visitor's choice, and it must not hand the new page this one.
    anchor.rel = 'noopener noreferrer';
    anchor.target = '_blank';
    nodes.push(document.createTextNode(source.text.slice(from, at)), anchor);
    from = at + link.phrase.length;
  }
  nodes.push(document.createTextNode(source.text.slice(from)));
  return nodes;
}

/**
 * A small button beside a number and the panel it opens under it. The panel shows while the pointer is over
 * the row, while the keyboard has focus in it, and after a tap or a press; Escape, a second press or a tap
 * elsewhere close it. It floats over the page, so opening it moves nothing.
 *
 * @param row The row the panel hangs from; it must be positioned.
 * @param id The panel's id, which the button names in aria-controls.
 * @param name What the button is called for a screen reader.
 */
export function mountSource(row: HTMLElement, source: SourceView, id: string, name: string): HTMLElement[] {
  const trigger = button('btn source-btn');
  trigger.setAttribute('aria-label', name);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);
  const panel = el('div', 'source-panel');
  panel.id = id;
  panel.hidden = true;
  panel.append(...panelNodes(source));

  let hover = false;
  let focus = false;
  let pinned = false;
  const isOpen = (): boolean => hover || focus || pinned;
  const close = (): void => {
    hover = false;
    focus = false;
    pinned = false;
  };

  function refresh(): void {
    const open = isOpen();
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.style.left = '0px';
      panel.style.left = `${panelOffset(row.getBoundingClientRect().left, panel.offsetWidth, document.documentElement.clientWidth)}px`;
    }
  }

  // A touch screen sends mouse events after a tap; only a real mouse hovers.
  row.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    hover = true;
    refresh();
  });
  row.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    hover = false;
    refresh();
  });
  // Only keyboard focus opens it: a click or a tap also focuses the button, and that must not open it twice.
  row.addEventListener('focusin', (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return;
    focus = true;
    refresh();
  });
  row.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
    focus = false;
    pinned = false;
    refresh();
  });
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return;
    close();
    refresh();
  });
  // A press on the button while its panel shows (a keyboard press, whatever opened it) closes it; a click
  // on a panel the pointer opened keeps it open until the next one, so it can be read after the pointer leaves.
  trigger.addEventListener('click', (event) => {
    if (pinned || (event.detail === 0 && isOpen())) close();
    else pinned = true;
    refresh();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!pinned || (event.target instanceof Node && row.contains(event.target))) return;
    pinned = false;
    refresh();
  });
  return [trigger, panel];
}
