/** Add a keyboard-accessible, local scroll boundary without changing table HTML. */
export function wrapScrollableTables(root: HTMLElement, label: string): void {
  for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
    if (table.parentElement?.classList.contains('md-table-scroll')) continue;
    const wrapper = table.ownerDocument.createElement('div');
    wrapper.className = 'md-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', table.caption?.textContent?.trim() || label);
    table.before(wrapper);
    wrapper.appendChild(table);
  }
}
