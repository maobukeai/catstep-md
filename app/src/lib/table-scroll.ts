/** A second native scrollbar keeps the far columns reachable on a tall table.
 * The table itself remains in one labelled, keyboard-accessible scroll region. */
const frameDisposers = new WeakMap<HTMLElement, () => void>();

export function attachTableScrollFrame(
  frame: HTMLElement,
  table: HTMLTableElement,
  label: string,
  onLayoutChange?: () => void,
  existingScroller?: HTMLElement,
  onScroll?: () => void,
): () => void {
  frameDisposers.get(frame)?.();
  const doc = frame.ownerDocument || document;
  const scroller = existingScroller || doc.createElement('div');
  scroller.className = 'md-table-scroll';
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'region');
  const name = table.caption?.textContent?.trim() || label || table.querySelector('thead')?.textContent?.trim();
  if (name) scroller.setAttribute('aria-label', name);

  const bar = frame.querySelector<HTMLElement>('.md-table-scrollbar') || doc.createElement('div');
  bar.className = 'md-table-scrollbar';
  bar.setAttribute('aria-hidden', 'true');
  bar.tabIndex = -1;
  const spacer = bar.querySelector<HTMLElement>('.md-table-scrollbar__spacer') || doc.createElement('div');
  spacer.className = 'md-table-scrollbar__spacer';
  // Append only fresh nodes: this also preserves an existing scroller's offset.
  if (!spacer.parentElement) bar.appendChild(spacer);
  if (!bar.parentElement) {
    if (existingScroller?.parentElement === frame) existingScroller.before(bar);
    else frame.appendChild(bar);
  }
  if (!scroller.parentElement) frame.appendChild(scroller);
  if (table.parentElement !== scroller) scroller.appendChild(table);

  let disposed = false;
  let animation: number | null = null;
  const win = doc.defaultView || window;
  const fromTable = () => {
    if (Math.abs(bar.scrollLeft - scroller.scrollLeft) > 1) bar.scrollLeft = scroller.scrollLeft;
  };
  const fromBar = () => {
    if (Math.abs(scroller.scrollLeft - bar.scrollLeft) > 1) scroller.scrollLeft = bar.scrollLeft;
  };
  const onTableScroll = () => { fromTable(); onScroll?.(); };
  // Native scrollbar clicks must not activate the surrounding plain editor
  // block or leave reading mode. Cell clicks keep their normal edit behavior.
  const onBarClick = (event: Event) => event.stopPropagation();
  const onBodyClick = (event: Event) => { if (event.target === scroller) event.stopPropagation(); };
  const measure = () => {
    if (disposed) return;
    const row = table.rows?.[0] || table.querySelector('tr');
    const columns = row ? Array.from(row.children).reduce((count, cell) => {
      if (!/^(?:TH|TD)$/i.test(cell.tagName)) return count;
      return count + ((cell as HTMLTableCellElement).colSpan || 1);
    }, 0) : 0;
    const classes = frame.className.split(/\s+/).filter((name) => name && name !== 'md-table-frame--wide');
    if (columns >= 6) classes.push('md-table-frame--wide');
    const nextClass = classes.join(' ');
    if (frame.className !== nextClass) frame.className = nextClass;
    const width = scroller.scrollWidth || 0;
    const hidden = width <= (scroller.clientWidth || 0) + 1;
    const changed = bar.hidden !== hidden;
    bar.hidden = hidden;
    const value = `${width}px`;
    if (spacer.style.width !== value) spacer.style.width = value;
    fromTable();
    // CM measures widget height. Request only when the extra strip changes it.
    if (changed) onLayoutChange?.();
  };
  bar.addEventListener('scroll', fromBar, { passive: true });
  scroller.addEventListener('scroll', onTableScroll, { passive: true });
  bar.addEventListener('click', onBarClick);
  bar.addEventListener('dblclick', onBarClick);
  scroller.addEventListener('click', onBodyClick);
  scroller.addEventListener('dblclick', onBodyClick);
  win.addEventListener('resize', measure, { passive: true });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(scroller);
  observer?.observe(table);
  measure();
  // toDOM is measured before CM inserts it. RO handles the real browser path;
  // the next frame also supports engines without ResizeObserver.
  if (win.requestAnimationFrame) animation = win.requestAnimationFrame(measure);
  void doc.fonts?.ready.then(() => measure());

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    if (animation !== null) win.cancelAnimationFrame?.(animation);
    bar.removeEventListener?.('scroll', fromBar);
    scroller.removeEventListener?.('scroll', onTableScroll);
    bar.removeEventListener?.('click', onBarClick);
    bar.removeEventListener?.('dblclick', onBarClick);
    scroller.removeEventListener?.('click', onBodyClick);
    scroller.removeEventListener?.('dblclick', onBodyClick);
    win.removeEventListener('resize', measure);
    if (frameDisposers.get(frame) === dispose) frameDisposers.delete(frame);
  };
  frameDisposers.set(frame, dispose);
  return dispose;
}
