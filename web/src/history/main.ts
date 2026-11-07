import '../page/tokens.css';
import './history.css';
import { byId, el } from '../page/dom';
import { initTips } from '../desk/tips';
import history from './history.json';
import { NOT_MEASURED, historyView, type Change, type Direction } from './view';

const SVG = 'http://www.w3.org/2000/svg';
const MARK_SIZE = '9';
const WORD_JOINER = String.fromCharCode(0x2060);
// Each direction has its own shape, so a change never depends on its color: a triangle up, a triangle down, a flat bar.
const SHAPES: Record<Direction, string> = {
  up: 'M6 1l5 9H1z',
  down: 'M6 11L1 2h10z',
  same: 'M1 5h10v2H1z',
};

function mark(direction: Direction): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', MARK_SIZE);
  svg.setAttribute('height', MARK_SIZE);
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', SHAPES[direction]);
  svg.append(path);
  return svg;
}

// The words are the label, so a screen reader hears "up 23.7 points" and not the bare shape and number.
function change(value: Change): HTMLElement {
  const node = el('span', 'change');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', value.label);
  node.append(mark(value.direction), document.createTextNode(value.text));
  return node;
}

function draw(): void {
  const view = historyView(history);
  const blocks = byId('blocks');
  for (const block of view.blocks) {
    const note = el('div', 'block-note', block.baseline);
    if (block.change !== null) note.append(change(block.change));
    const node = el('div', 'block');
    node.append(el('div', 'block-title', block.title), el('div', 'block-value', block.value), note);
    blocks.append(node);
  }
  // Each tip written in the page goes after the title it names; its box goes with it. A word joiner stops the browser
  // starting a new line for the icon alone.
  for (const tip of document.querySelectorAll<HTMLElement>('.tip[data-for]')) {
    const title = [...blocks.querySelectorAll('.block-title')].find((node) => node.textContent === tip.dataset['for']);
    title?.append(WORD_JOINER, tip, byId(tip.getAttribute('aria-describedby') ?? ''));
  }
  const head = byId('head');
  head.append(el('th', 'version', 'Version'));
  for (const title of view.columns) {
    const cell = el('th', 'figure', title);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = byId('rows');
  for (const row of view.rows) {
    const name = el('th', 'version');
    name.scope = 'row';
    name.append(el('span', 'name', row.name), el('span', 'kind', row.kind));
    const line = el('tr', row.current ? 'current-row' : undefined);
    line.append(name);
    for (const cell of row.cells) {
      const td = el('td', 'figure');
      td.append(el('span', 'value', cell.value));
      if (cell.change !== null) td.append(change(cell.change));
      else if (cell.value === NOT_MEASURED) td.classList.add('unmeasured');
      line.append(td);
    }
    body.append(line);
  }
}

draw();
initTips();