import type { EditorView } from '@codemirror/view';
import { setAgentJumpEffect, setSpotlightEffect } from '../lib/cm-spotlight-fields';

export interface UseJumpSpotlightOptions {
  getView: () => EditorView | null;
  /** Table-cell spotlight teardown (from useEditorTable), called on dismiss. */
  clearTableSpotlight: (viewOverride?: EditorView | null) => void;
}

/**
 * Jump-highlight lifecycle for Editor.vue (extracted verbatim):
 *   • proofread spotlight — set on the target range, auto-clears after 4s;
 *   • agent-jump spotlight — sticky until the user clicks the editor or the
 *     next navigation clears it;
 *   • `dismiss*` helpers push "clear" effects into gotoLine's pending effect
 *     list so everything lands in a single dispatch.
 *
 * The Decoration fields themselves live in lib/cm-spotlight-fields.
 */
export function useJumpSpotlight(options: UseJumpSpotlightOptions) {
  let spotlightTimer: ReturnType<typeof setTimeout> | null = null;
  let agentJumpTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mousedown on the editor host: kill any agent-jump beacon immediately. */
  function clearAgentJumpSpotlight(): void {
    if (agentJumpTimer) {
      clearTimeout(agentJumpTimer);
      agentJumpTimer = null;
    }
    const view = options.getView();
    if (view) {
      view.dispatch({ effects: setAgentJumpEffect.of(null) });
    }
  }

  /** Unmount / tab-switch teardown: only the proofread timer (no dispatch). */
  function clearSpotlightTimer(): void {
    if (spotlightTimer) {
      clearTimeout(spotlightTimer);
      spotlightTimer = null;
    }
  }

  /**
   * Agent jump: clear both beacons and cancel any pending proofread timer so
   * the new destination is highlighted alone. Effects go into `effects`.
   */
  function beginAgentJumpHighlight(effects: unknown[]): void {
    effects.push(setSpotlightEffect.of(null));
    effects.push(setAgentJumpEffect.of(null));
    if (agentJumpTimer) {
      clearTimeout(agentJumpTimer);
      agentJumpTimer = null;
    }
  }

  /** Proofread: clear any agent-jump beacon and underline `from..to` for 4s. */
  function beginProofreadSpotlight(effects: unknown[], from: number, to: number): void {
    effects.push(setAgentJumpEffect.of(null));
    effects.push(setSpotlightEffect.of({ from, to }));
    if (spotlightTimer) clearTimeout(spotlightTimer);
    spotlightTimer = setTimeout(() => {
      options.getView()?.dispatch({ effects: setSpotlightEffect.of(null) });
    }, 4000);
  }

  /**
   * Regular navigation (outline / chapter jump / search / backlinks): dismiss
   * both beacons so they never falsely label the destination chapter.
   */
  function dismissAllSpotlights(effects: unknown[]): void {
    effects.push(setSpotlightEffect.of(null));
    effects.push(setAgentJumpEffect.of(null));
    options.clearTableSpotlight(options.getView());
  }

  return {
    clearAgentJumpSpotlight,
    clearSpotlightTimer,
    beginAgentJumpHighlight,
    beginProofreadSpotlight,
    dismissAllSpotlights,
  };
}
