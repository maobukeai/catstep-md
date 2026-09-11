/**
 * Phone-shaped viewport detection (#168).
 *
 * "在手机上的操作逻辑是 pc 的…所有 UI 都挤到一块了" — the desktop shell puts the
 * file tree, the editor and the right sidebar side by side. At 390 CSS px the
 * two side panes leave the editor a sliver, which is the whole complaint.
 *
 * The phone layout keys off ONE reactive flag rather than a mix of media
 * queries and UA sniffing, so the CSS and the behaviour (auto-closing a drawer
 * after picking a file, never opening both at once) can never disagree.
 *
 * The flag is a function of the viewport, never of the UA. `isMobile()` is
 * true on iPad and on Android tablets, and routing those to the phone shell
 * would break the one thing the reporter said already worked ("平板挺好").
 * Two cases count as a phone:
 *
 *   - width ≤ 600 — every phone in portrait, and a desktop window dragged
 *     narrow, which is also how this layout gets tested;
 *   - height ≤ 480 with a coarse pointer — a phone in landscape, where the
 *     width would pass for a desktop but there is no vertical room for
 *     stacked chrome. A short *mouse-driven* window is not included; that's
 *     a desktop user who resized, not a phone.
 *
 * iPad portrait (820×1180) and landscape (1180×820) match neither.
 */
import { onScopeDispose, readonly, ref } from 'vue';

/** Below this the three-column shell stops fitting (phone viewport). */
export const NARROW_BREAKPOINT_PX = 640;
/** A phone held sideways: wide enough, but no vertical room. */
export const SHORT_BREAKPOINT_PX = 480;
/** Compact tablet (iPad portrait 768px/820px/834px) breakpoint where 56px Rail activates. */
export const COMPACT_TABLET_BREAKPOINT_PX = 960;
/** Expanded tablet (iPad landscape 1024px/1180px) breakpoint. */
export const EXPANDED_TABLET_BREAKPOINT_PX = 1200;

const MEDIA_QUERY_NARROW =
  `(max-width: ${NARROW_BREAKPOINT_PX}px), ` +
  `((max-height: ${SHORT_BREAKPOINT_PX}px) and (pointer: coarse))`;

const MEDIA_QUERY_COMPACT_TABLET =
  `(min-width: ${NARROW_BREAKPOINT_PX + 1}px) and (max-width: ${COMPACT_TABLET_BREAKPOINT_PX}px)`;

const MEDIA_QUERY_TABLET =
  `(min-width: ${NARROW_BREAKPOINT_PX + 1}px) and (max-width: ${EXPANDED_TABLET_BREAKPOINT_PX}px)`;

// Module-level singletons: one listener set for the whole app
const narrow = ref(false);
const compactTablet = ref(false);
const tablet = ref(false);
const desktop = ref(false);

let mqlNarrow: MediaQueryList | null = null;
let mqlCompactTablet: MediaQueryList | null = null;
let mqlTablet: MediaQueryList | null = null;

const ROOT_CLASS_NARROW = 'narrow-viewport';
const ROOT_CLASS_COMPACT_TABLET = 'tablet-compact';
const ROOT_CLASS_TABLET = 'tablet-viewport';
const ROOT_CLASS_DESKTOP = 'desktop-viewport';

function evaluate(): void {
  const isNarrowNow = mqlNarrow?.matches ?? (typeof window !== 'undefined' ? window.innerWidth <= NARROW_BREAKPOINT_PX : false);
  const isCompactNow = mqlCompactTablet?.matches ?? (typeof window !== 'undefined' ? (window.innerWidth > NARROW_BREAKPOINT_PX && window.innerWidth <= COMPACT_TABLET_BREAKPOINT_PX) : false);
  const isTabletNow = mqlTablet?.matches ?? (typeof window !== 'undefined' ? (window.innerWidth > NARROW_BREAKPOINT_PX && window.innerWidth <= EXPANDED_TABLET_BREAKPOINT_PX) : false);
  const isDesktopNow = !isNarrowNow && !isTabletNow;

  narrow.value = isNarrowNow;
  compactTablet.value = isCompactNow;
  tablet.value = isTabletNow;
  desktop.value = isDesktopNow;

  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle(ROOT_CLASS_NARROW, isNarrowNow);
    document.documentElement.classList.toggle(ROOT_CLASS_COMPACT_TABLET, isCompactNow);
    document.documentElement.classList.toggle(ROOT_CLASS_TABLET, isTabletNow);
    document.documentElement.classList.toggle(ROOT_CLASS_DESKTOP, isDesktopNow);
  }
}

function ensureWatching(): void {
  if (mqlNarrow || typeof window === 'undefined' || !window.matchMedia) return;
  mqlNarrow = window.matchMedia(MEDIA_QUERY_NARROW);
  mqlCompactTablet = window.matchMedia(MEDIA_QUERY_COMPACT_TABLET);
  mqlTablet = window.matchMedia(MEDIA_QUERY_TABLET);

  evaluate();

  mqlNarrow.addEventListener('change', evaluate);
  mqlCompactTablet.addEventListener('change', evaluate);
  mqlTablet.addEventListener('change', evaluate);
  window.addEventListener('resize', evaluate);
}

ensureWatching();

export function useViewport() {
  ensureWatching();
  evaluate();
  onScopeDispose(() => {
    // Shared module lifecycle
  });
  return {
    isNarrow: readonly(narrow),
    isPhone: readonly(narrow),
    isCompactTablet: readonly(compactTablet),
    isTablet: readonly(tablet),
    isDesktop: readonly(desktop),
  };
}

/** Non-reactive read, for call sites outside a component scope. */
export function isNarrowViewport(): boolean {
  ensureWatching();
  evaluate();
  return narrow.value;
}

export function isCompactTabletViewport(): boolean {
  ensureWatching();
  evaluate();
  return compactTablet.value;
}

