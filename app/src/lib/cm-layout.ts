import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * Keep block layout tied to the viewport, including when a non-wrapping source
 * line makes the document intrinsically wider. ResizeObserver handles splitters,
 * theme/font changes and readable-column padding without hardcoded gutter sizes.
 */
export const editorLayoutExtension = ViewPlugin.fromClass(class {
  view: EditorView;
  observer: ResizeObserver;
  width = -1;
  constructor(view: EditorView) {
    this.view = view;
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(view.scrollDOM);
    this.observer.observe(view.contentDOM);
    this.measure();
  }
  measure() {
    const view = this.view;
    view.requestMeasure({
      key: this,
      read: () => {
        const gutter = view.scrollDOM.querySelector('.cm-gutters');
        const gutterWidth = gutter?.getBoundingClientRect().width ?? 0;
        const style = getComputedStyle(view.contentDOM);
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        return Math.max(0, Math.min(view.contentDOM.clientWidth, view.scrollDOM.clientWidth - gutterWidth) - padding);
      },
      write: (width) => {
        if (width > 0 && Math.abs(width - this.width) > 0.5) {
          this.width = width;
          view.dom.style.setProperty('--cm-text-width', width + 'px');
        }
      },
    });
  }
  update(update: ViewUpdate) {
    if (update.geometryChanged) this.measure();
  }
  destroy() {
    this.observer.disconnect();
    this.view.dom.style.removeProperty('--cm-text-width');
  }
});
