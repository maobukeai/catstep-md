/**
 * Shortcut Recorder Utilities (#quick-capture-optimizer)
 *
 * Normalizes, validates, and renders global keyboard shortcuts formatted
 * for Tauri accelerator syntax (e.g. `CmdOrCtrl+Alt+C`).
 */

export interface KeycapToken {
  id: string;
  label: string;
  isModifier: boolean;
}

export interface ModifierState {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/**
 * Parses a Tauri accelerator string (e.g. `CmdOrCtrl+Alt+C`) into individual
 * keycap tokens suitable for rendering `<kbd>` badges.
 */
export function parseAcceleratorToTokens(accel: string, isMac: boolean): KeycapToken[] {
  const val = (accel || '').trim();
  if (!val) return [];

  const rawTokens = val.split('+').map((s) => s.trim()).filter(Boolean);
  const result: KeycapToken[] = [];

  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (lower === 'cmdorctrl' || lower === 'commandorcontrol') {
      result.push({
        id: token,
        label: isMac ? '⌘' : 'Ctrl',
        isModifier: true,
      });
    } else if (lower === 'alt' || lower === 'option') {
      result.push({
        id: token,
        label: isMac ? '⌥' : 'Alt',
        isModifier: true,
      });
    } else if (lower === 'shift') {
      result.push({
        id: token,
        label: isMac ? '⇧' : 'Shift',
        isModifier: true,
      });
    } else if (lower === 'ctrl' || lower === 'control') {
      result.push({
        id: token,
        label: isMac ? '⌃' : 'Ctrl',
        isModifier: true,
      });
    } else if (lower === 'super' || lower === 'meta' || lower === 'win') {
      result.push({
        id: token,
        label: isMac ? '⌘' : 'Win',
        isModifier: true,
      });
    } else {
      let label = token;
      const keyMap: Record<string, string> = {
        Space: isMac ? '␣' : 'Space',
        Enter: isMac ? '↵' : 'Enter',
        Tab: isMac ? '⇥' : 'Tab',
        Backspace: isMac ? '⌫' : 'Backspace',
        Delete: isMac ? '⌦' : 'Delete',
        PageUp: isMac ? '⇞' : 'PgUp',
        PageDown: isMac ? '⇟' : 'PgDn',
        Home: isMac ? '↖' : 'Home',
        End: isMac ? '↘' : 'End',
        Insert: 'Ins',
        Minus: '-',
        Equal: '=',
        BracketLeft: '[',
        BracketRight: ']',
        Backslash: '\\',
        Semicolon: ';',
        Quote: "'",
        Backquote: '`',
        Comma: ',',
        Period: '.',
        Slash: '/',
        Up: '↑',
        Down: '↓',
        Left: '←',
        Right: '→',
      };
      if (keyMap[token]) {
        label = keyMap[token];
      }
      result.push({
        id: token,
        label,
        isModifier: false,
      });
    }
  }

  // Canonical sort order for UI display:
  // On macOS: Control (⌃) -> Option (⌥) -> Shift (⇧) -> Command (⌘) -> Key
  // On Win/Linux: Ctrl -> Win -> Alt -> Shift -> Key
  const getOrder = (token: KeycapToken): number => {
    if (!token.isModifier) return 100;
    if (isMac) {
      if (token.label === '⌃') return 1;
      if (token.label === '⌥') return 2;
      if (token.label === '⇧') return 3;
      if (token.label === '⌘') return 4;
      return 10;
    } else {
      if (token.label === 'Ctrl') return 1;
      if (token.label === 'Win') return 2;
      if (token.label === 'Alt') return 3;
      if (token.label === 'Shift') return 4;
      return 10;
    }
  };

  result.sort((a, b) => getOrder(a) - getOrder(b));

  return result;
}

/** Formats a Tauri accelerator into a concise human-readable chord */
export function formatTauriChord(accel: string, isMac = false): string {
  const tokens = parseAcceleratorToTokens(accel, isMac);
  if (!tokens.length) return '';
  return tokens.map((t) => t.label).join(isMac ? '' : '+');
}

/**
 * Resolves a normalized primary key name from keyboard event properties,
 * avoiding dead keys / composition mutations on macOS Option key.
 */
export function resolveKeyName(code: string, rawKey: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3).toUpperCase();
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad\d$/.test(code)) {
    return code.slice(6);
  }
  if (/^F\d{1,2}$/.test(rawKey) || /^F\d{1,2}$/.test(code)) {
    return (rawKey || code).toUpperCase();
  }
  if (code === 'Space' || rawKey === ' ') {
    return 'Space';
  }
  if (code === 'Enter' || rawKey === 'Enter') return 'Enter';
  if (code === 'Tab' || rawKey === 'Tab') return 'Tab';
  if (code === 'Backspace' || rawKey === 'Backspace') return 'Backspace';
  if (code === 'Delete' || rawKey === 'Delete') return 'Delete';

  if (code === 'PageUp' || rawKey === 'PageUp') return 'PageUp';
  if (code === 'PageDown' || rawKey === 'PageDown') return 'PageDown';
  if (code === 'Home' || rawKey === 'Home') return 'Home';
  if (code === 'End' || rawKey === 'End') return 'End';
  if (code === 'Insert' || rawKey === 'Insert') return 'Insert';

  if (code === 'ArrowUp' || rawKey === 'ArrowUp') return 'Up';
  if (code === 'ArrowDown' || rawKey === 'ArrowDown') return 'Down';
  if (code === 'ArrowLeft' || rawKey === 'ArrowLeft') return 'Left';
  if (code === 'ArrowRight' || rawKey === 'ArrowRight') return 'Right';

  const codeMap: Record<string, string> = {
    Minus: 'Minus',
    Equal: 'Equal',
    BracketLeft: 'BracketLeft',
    BracketRight: 'BracketRight',
    Backslash: 'Backslash',
    Semicolon: 'Semicolon',
    Quote: 'Quote',
    Backquote: 'Backquote',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
  };
  if (codeMap[code]) return codeMap[code];

  if (rawKey && rawKey.length === 1 && rawKey !== ' ') {
    return rawKey.toUpperCase();
  }

  return null;
}

/**
 * Ensures that a global shortcut has at least one modifier key.
 * Prevents accidental registration of bare characters or Shift+Letter
 * which would intercept normal text entry system-wide.
 */
export function validateModifierRequirement(mods: ModifierState, keyName?: string): boolean {
  // Must have at least one primary modifier (Ctrl, Alt, Meta/Cmd)
  if (mods.ctrl || mods.alt || mods.meta) return true;
  // Shift alone is only acceptable if combined with a function key (e.g. Shift+F1)
  if (mods.shift && keyName && /^F\d{1,2}$/.test(keyName)) return true;
  return false;
}

/**
 * Builds a standardized cross-platform Tauri accelerator string
 * e.g. `CmdOrCtrl+Alt+C`.
 */
export function buildTauriAccelerator(
  mods: ModifierState,
  keyName: string,
  isMac: boolean,
): string {
  const parts: string[] = [];

  if (isMac) {
    if (mods.meta) parts.push('CmdOrCtrl');
    if (mods.ctrl) parts.push('Control');
    if (mods.alt) parts.push('Alt');
    if (mods.shift) parts.push('Shift');
  } else {
    if (mods.ctrl) parts.push('CmdOrCtrl');
    if (mods.alt) parts.push('Alt');
    if (mods.shift) parts.push('Shift');
    if (mods.meta) parts.push('Super');
  }

  parts.push(keyName);
  return parts.join('+');
}
