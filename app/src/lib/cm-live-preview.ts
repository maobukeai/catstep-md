/**
 * CodeMirror 6 live-preview extensions for Markdown.
 *
 * Two pieces:
 *   1. `markdownRichStyle` — a HighlightStyle that makes headings bigger,
 *      bold actually bold, code monospaced with accent color, etc.
 *   2. `liveMarkdownPlugin` — a ViewPlugin that hides marker characters
 *      (`#`, `**`, `*`, `` ` ``, `[`, `]`, `(`, `)` …) on every line that
 *      does NOT currently contain (or touch) the user selection. Move the
 *      cursor onto a heading line and the `#` re-appears so you can edit it.
 *
 * Combined effect: a Typora / Obsidian Live Preview style experience while
 * keeping the underlying buffer as plain markdown source.
 */

import { syntaxTree, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { frozenDuringComposition, isImeSafeFlushTransaction } from './cm-ime-guard';
import { tags as t } from '@lezer/highlight';
import { isDragging, isDragEndTransaction } from './cm-drag-aware';
import { bulletDeco, hrDeco, listItemHasTask, caretTouchesInline, getInlineContainer, type MdSyntaxNode } from './cm-live-render';

// Marker node names (from @lezer/markdown) we want to hide off-line.
// LinkMark (brackets) and CodeMark (backticks) intentionally kept visible —
// hiding them makes `![alt](url)` and `` `code` `` look like plain text and
// loses the visual hint that it's a link or inline code.
const HIDDEN_MARK_NODES = new Set<string>([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
]);

const hideDeco = Decoration.replace({});

const liveMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      // IME composition guard (#108) — see cm-ime-guard.ts. Rebuilding the
      // marker-hiding decorations on the composing line aborts the Sogou IME
      // on Windows; freeze + map-through-changes until composition commits.
      const frozen = frozenDuringComposition(update, this.decorations);
      if (frozen) {
        this.decorations = frozen;
        return;
      }
      // Skip marker-toggle rebuilds during pointer drag-selection — see
      // cm-drag-aware.ts for the Windows WebView2 pointer-capture reason.
      const dragEnded = update.transactions.some(isDragEndTransaction);
      const imeFlush = update.transactions.some(isImeSafeFlushTransaction);
      if (update.docChanged || update.viewportChanged || dragEnded || imeFlush) {
        this.decorations = this.build(update.view);
        return;
      }
      if (update.selectionSet && !isDragging(update.state)) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const sel = view.state.selection.main;
      const fromLine = view.state.doc.lineAt(sel.from).number;
      const toLine = view.state.doc.lineAt(sel.to).number;
      const tree = syntaxTree(view.state);

      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            const name = node.name;
            const lineObj = view.state.doc.lineAt(node.from);
            const line = lineObj.number;
            // Keep everything raw on the line(s) the cursor / selection touches.
            const onCaretLine = line >= fromLine && line <= toLine;

            if (HIDDEN_MARK_NODES.has(name)) {
              const inlineContainer = getInlineContainer(node);
              const touches = inlineContainer
                ? caretTouchesInline(
                    inlineContainer.from,
                    inlineContainer.to,
                    sel.from,
                    sel.to,
                    lineObj.from,
                    lineObj.to,
                  )
                : onCaretLine;

              if (touches) return;
              // v4.3.5 #83 — gulp the single trailing space after the ATX
              // marker so H1..H6 text aligns at the same visual column. Each
              // heading line has its own font-size; a leftover " " character
              // at 1.85em vs 1.1em prints visibly different widths and made
              // the headings look staggered.
              let to_ = node.to;
              if (name === 'HeaderMark') {
                if (lineObj.from === node.from && node.to - node.from <= 6) {
                  const after = view.state.doc.sliceString(node.to, Math.min(node.to + 1, view.state.doc.length));
                  if (after === ' ') to_ = node.to + 1;
                }
              }
              builder.add(node.from, to_, hideDeco);
              return;
            }

            // v4.7.1 — same list / horizontal-rule rendering as the liveEdit
            // extension (cm-live-render.ts), so the edit-mode livePreview toggle
            // is consistent: a heading that renders shouldn't sit above a bullet
            // list that doesn't.
            if (name === 'ListMark') {
              if (onCaretLine || node.to <= node.from) return;
              const mark = view.state.doc.sliceString(node.from, node.to);
              const isBullet = mark === '-' || mark === '*' || mark === '+';
              if (!isBullet) return; // ordered list keeps its number
              if (listItemHasTask(node.node as unknown as MdSyntaxNode)) {
                const after = view.state.doc.sliceString(
                  node.to,
                  Math.min(node.to + 1, view.state.doc.length),
                );
                builder.add(node.from, after === ' ' ? node.to + 1 : node.to, hideDeco);
              } else {
                builder.add(node.from, node.to, bulletDeco);
              }
              return;
            }
            if (name === 'HorizontalRule') {
              if (onCaretLine || node.to <= node.from) return;
              builder.add(node.from, node.to, hrDeco);
              return;
            }
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations }
);

// Rich syntax highlighting for markdown tokens. Sizes are in `em` so they
// scale with the user's font-size setting. Heading colors gradient from
// stronger (h1) to softer (h6) for visual hierarchy.
export const markdownRichStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.25', color: 'var(--md-h1)' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3', color: 'var(--md-h2)' },
  { tag: t.heading3, fontSize: '1.22em', fontWeight: '700', color: 'var(--md-h3)' },
  { tag: t.heading4, fontSize: '1.1em', fontWeight: '700', color: 'var(--md-h4)' },
  { tag: t.heading5, fontWeight: '700', color: 'var(--md-h5)' },
  { tag: t.heading6, fontWeight: '700', color: 'var(--md-h6)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--md-strong)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--md-em)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--md-link)' },
  { tag: t.url, color: 'var(--md-url)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: t.quote, color: 'var(--md-quote)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--text-faint)' },
  { tag: t.contentSeparator, color: 'var(--md-hr)' },
  // Code block syntax highlighting (provided by nested language packages)
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.function(t.variableName), color: 'var(--syn-function)' },
  { tag: t.variableName, color: 'var(--syn-variable)' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.className, color: 'var(--syn-type)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
  { tag: t.punctuation, color: 'var(--text-muted)' },
  { tag: t.bracket, color: 'var(--text-muted)' },
  { tag: t.bool, color: 'var(--syn-number)' },
  { tag: t.null, color: 'var(--syn-number)' },
  { tag: t.tagName, color: 'var(--syn-keyword)' },
  { tag: t.attributeName, color: 'var(--syn-property)' },
  { tag: t.attributeValue, color: 'var(--syn-string)' },
]);

// Visual polish: dim marker chars when they ARE visible (active line),
// give code blocks a subtle background.
const liveTheme = EditorView.theme({
  '.cm-line': {
    fontVariantLigatures: 'none',
  },
  '.tok-meta, .cm-formatting, .ͼe': {
    color: 'var(--text-faint)',
  },
  // CM6's `layer` extension writes inline `style="z-index: -2"` on
  // `.cm-selectionLayer`, parking selection beneath the per-char
  // backgrounds painted by `t.monospace`. Need `!important` to beat
  // the inline style; 45% alpha keeps glyphs readable underneath.
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg, rgba(56, 139, 253, 0.24)) !important',
    pointerEvents: 'none !important',
  },
});

/** Full live-preview extension bundle. Pass `[]` to disable. */
export function livePreviewExtension() {
  return [syntaxHighlighting(markdownRichStyle), liveMarkdownPlugin, liveTheme];
}


/** Typora-style Source Mode highlight style.
 * Uses semantic color coding harmonious with the user's active theme:
 * - Headings: theme accent color with clear size hierarchy
 * - Links and images: theme accent / link tone
 * - URLs: secondary muted tone
 * - Strong: deep contrast bold
 * - Monospace: clean code gray
 * - Punctuation: dimmed soft tone */
export const markdownPlainStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.45em', fontWeight: '700', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.heading2, fontSize: '1.28em', fontWeight: '700', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '600', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.heading4, fontSize: '1.05em', fontWeight: '600', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.heading5, fontSize: '1em', fontWeight: '600', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.heading6, fontSize: '1em', fontWeight: '600', color: 'var(--source-heading, color-mix(in srgb, var(--accent) 52%, var(--text)))' },
  { tag: t.strong, fontWeight: '700', color: 'var(--source-strong, var(--text))' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--text)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-muted)' },
  { tag: t.link, color: 'var(--source-link, color-mix(in srgb, var(--accent) 60%, var(--text)))' },
  { tag: t.url, color: 'var(--source-url, var(--text-muted))' },
  {
    tag: t.monospace,
    fontFamily: 'var(--font-mono)',
    color: 'var(--source-code, var(--text))',
    backgroundColor: 'var(--code-inline-bg, rgba(125, 125, 125, 0.08))',
    borderRadius: '3px',
  },
  { tag: t.quote, color: 'var(--md-quote, var(--text-muted))' },
  { tag: t.contentSeparator, color: 'var(--text-faint, #94a3b8)' },
  // Dim syntax markers (Typora's signature style: #, **, [], (), -, ` etc.)
  { tag: t.punctuation, color: 'var(--text-faint, #94a3b8)', opacity: '0.42' },
  { tag: t.bracket, color: 'var(--source-link, var(--accent))', opacity: '0.6' },
  { tag: t.processingInstruction, color: 'var(--source-heading-mark, color-mix(in srgb, var(--accent) 25%, var(--text-faint, #94a3b8)))' },
  // Fenced-code syntax — genuinely code, keep the colors
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: t.string, color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--syn-comment)' },
  { tag: t.function(t.variableName), color: 'var(--syn-function)' },
  { tag: t.variableName, color: 'var(--syn-variable)' },
  { tag: t.typeName, color: 'var(--syn-type)' },
  { tag: t.propertyName, color: 'var(--syn-property)' },
  { tag: t.operator, color: 'var(--syn-operator)' },
]);

/** Typora Source Mode theme for comfortable line height, subtle active-line bar and signature caret. */
export const typoraSourceTheme = EditorView.theme({
  '.cm-line': {
    lineHeight: '1.75',
    fontVariantLigatures: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--source-active-line, color-mix(in srgb, var(--accent) 2.5%, transparent)) !important',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--source-caret, var(--accent)) !important',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection-bg, color-mix(in srgb, var(--accent) 18%, transparent)) !important',
  },
});

export function richHighlightOnly() {
  return [syntaxHighlighting(markdownPlainStyle), typoraSourceTheme];
}
