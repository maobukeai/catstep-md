import { Facet } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { renderMarkdown } from './markdown';
import { attachCodeCopyButtons } from './code-copy';
import { prepareImeSafeReveal } from './cm-ime-guard';

export const renderedCodeBlocks = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/** A read surface over the original source range. Entering it reveals the
 * existing CodeMirror document, retaining one history and IME implementation. */
export class CodeBlockWidget extends WidgetType {
  source: string;
  from: number;
  to: number;
  editFrom: number;
  label: string;
  constructor(source: string, from: number, to: number, editFrom: number, label: string) {
    super();
    this.source = source;
    this.from = from;
    this.to = to;
    this.editFrom = editFrom;
    this.label = label;
  }
  eq(other: CodeBlockWidget) {
    return this.source === other.source && this.from === other.from &&
      this.to === other.to && this.editFrom === other.editFrom && this.label === other.label;
  }
  private currentEditFrom(view: EditorView): number | null {
    // The IME/input quiet period maps decorations without rebuilding widget
    // values. Equal values can also reuse this DOM without updateDOM. Resolve
    // the current source range before turning a pointer action into a caret.
    let target: number | null = null;
    for (const decorations of view.state.facet(EditorView.decorations)) {
      if (typeof decorations === 'function') continue;
      decorations.between(0, view.state.doc.length, (from, to, decoration) => {
        const candidate = decoration.spec.widget;
        if (candidate === this || (candidate instanceof CodeBlockWidget && this.eq(candidate))) {
          if (view.state.doc.sliceString(from, to) === this.source) {
            target = Math.min(to, from + this.editFrom - this.from);
          }
          return false;
        }
      });
      if (target !== null) break;
    }
    return target;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-block cm-live-block--code';
    wrapper.innerHTML = renderMarkdown(this.source);
    attachCodeCopyButtons(wrapper, { label: this.label });
    wrapper.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || (event.target as Element).closest('button, a')) return;
      const editFrom = this.currentEditFrom(view);
      if (editFrom === null) return;
      const reveal = prepareImeSafeReveal(view);
      if (!reveal) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: editFrom }, effects: reveal, scrollIntoView: false });
      view.focus();
    });
    return wrapper;
  }
  ignoreEvent() { return true; }
}
