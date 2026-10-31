import { attachTableScrollFrame } from './table-scroll';

const rootDisposers = new WeakMap<HTMLElement, Map<HTMLTableElement, () => void>>();

/** Release observers even when Vue already replaced the previous v-html nodes. */
export function cleanupScrollableTables(root: HTMLElement): void {
  const entries = rootDisposers.get(root);
  entries?.forEach((dispose) => dispose());
  rootDisposers.delete(root);
}

/** Add local scrolling without replacing table/cell nodes or their handlers. */
export function wrapScrollableTables(root: HTMLElement, label: string): void {
  const tables = new Set(root.querySelectorAll<HTMLTableElement>('table'));
  const entries = rootDisposers.get(root) || new Map<HTMLTableElement, () => void>();
  rootDisposers.set(root, entries);
  for (const [table, dispose] of entries) {
    if (!tables.has(table)) { dispose(); entries.delete(table); }
  }
  for (const table of tables) {
    if (entries.has(table)) continue;
    const previous = table.parentElement?.classList.contains('md-table-scroll') ? table.parentElement : undefined;
    let frame = previous?.parentElement?.classList.contains('md-table-frame') ? previous.parentElement : undefined;
    if (!frame) {
      frame = table.ownerDocument.createElement('div');
      frame.className = 'md-table-frame';
      if (previous) { previous.before(frame); frame.appendChild(previous); }
      else table.before(frame);
    }
    entries.set(table, attachTableScrollFrame(frame, table, label, undefined, previous));
  }
}
