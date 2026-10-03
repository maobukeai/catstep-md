import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

// Spotlight Beacon decorations for the two jump flows (extracted from
// Editor.vue; the dispatch/timer lifecycle lives in
// composables/useJumpSpotlight):
//   • `cm-proof-spotlight`     — proofread targets (auto-clears after 4s)
//   • `cm-agent-jump-spotlight`— agent edit jumps (sticky until cleared,
//     dismissed by the next click in the editor host)

export const setSpotlightEffect = StateEffect.define<{ from: number; to: number } | null>();

export const spotlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(underlines, tr) {
    if (tr.docChanged) {
      return Decoration.none;
    }
    underlines = underlines.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setSpotlightEffect)) {
        if (!e.value) {
          underlines = Decoration.none;
        } else {
          const mark = Decoration.mark({
            class: 'cm-proof-spotlight',
          });
          const safeEnd = Math.max(e.value.from + 1, e.value.to);
          underlines = Decoration.set([mark.range(e.value.from, safeEnd)]);
        }
      }
    }
    return underlines;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const setAgentJumpEffect = StateEffect.define<{ from: number; to: number } | null>();

export const agentJumpField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(underlines, tr) {
    if (tr.docChanged) {
      return Decoration.none;
    }
    underlines = underlines.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setAgentJumpEffect)) {
        if (!e.value) {
          underlines = Decoration.none;
        } else {
          const mark = Decoration.mark({
            class: 'cm-agent-jump-spotlight',
          });
          const safeEnd = Math.max(e.value.from + 1, e.value.to);
          underlines = Decoration.set([mark.range(e.value.from, safeEnd)]);
        }
      }
    }
    return underlines;
  },
  provide: (f) => EditorView.decorations.from(f),
});
