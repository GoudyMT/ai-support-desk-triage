import type { StageCell } from './view';

/** Creates an element with an optional class and text; text is always set as text, never as markup. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

interface CellNodes {
  box: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
}

export function mountStageRow(root: HTMLElement): { render(cells: StageCell[]): void } {
  let nodes: CellNodes[] = [];
  return {
    render(cells) {
      if (nodes.length !== cells.length) {
        nodes = cells.map(() => ({ box: el('div', 'stage'), name: el('div', 'stage-name'), count: el('div', 'stage-count num') }));
        for (const node of nodes) {
          node.box.append(node.name, node.count);
        }
        root.replaceChildren(...nodes.map((node) => node.box));
      }
      for (const [i, cell] of cells.entries()) {
        const node = nodes[i];
        if (node === undefined) continue;
        node.box.className = cell.lit ? 'stage stage-lit' : 'stage';
        if (cell.lit) {
          node.box.setAttribute('aria-current', 'step');
        } else {
          node.box.removeAttribute('aria-current');
        }
        node.name.textContent = cell.title;
        node.count.textContent = cell.caption;
      }
    },
  };
}
