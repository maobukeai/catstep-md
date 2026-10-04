/**
 * Pure parsing and formatting functions for shortcut chords in markdown help.
 */

export function parseKeys(chordStr: string, isMac: boolean = false): string[] {
  const trimmed = chordStr.trim();
  if (!trimmed) return [];

  // If chord contains macOS modifier symbols, extract them into separate key tokens
  if (
    trimmed.startsWith('⌘') ||
    trimmed.startsWith('⌥') ||
    trimmed.startsWith('⇧') ||
    trimmed.startsWith('⌃')
  ) {
    const keys: string[] = [];
    let rem = trimmed;
    while (
      rem.length > 0 &&
      (rem.startsWith('⌘') || rem.startsWith('⌥') || rem.startsWith('⇧') || rem.startsWith('⌃'))
    ) {
      keys.push(rem[0]);
      rem = rem.slice(1);
    }
    if (keys.length > 0) {
      rem = rem.trim();
      if (rem) {
        if (rem.startsWith('+') && rem.length > 1) {
          const rest = rem.slice(1).trim();
          if (rest === '+' || !rest) {
            keys.push('+');
          } else if (rest.includes('+')) {
            keys.push(...parseKeys(rest, isMac));
          } else {
            keys.push(rest);
          }
        } else {
          keys.push(rem);
        }
      }
      return keys;
    }
  }

  if (trimmed === '+') {
    return ['+'];
  }

  if (trimmed.includes('+')) {
    // Handle edge case where last key is literal '+' (e.g. 'Ctrl++', 'Ctrl + +')
    if (/\+\s*\+$/.test(trimmed)) {
      const base = trimmed.replace(/\+\s*\+$/, '');
      const parts = base.split('+').map((s) => s.trim()).filter(Boolean);
      parts.push('+');
      return parts;
    }
    const parts = trimmed.split('+').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [trimmed];
  }

  return [trimmed];
}

export function parseShortcutChords(str: string, isMac: boolean): string[][] {
  if (!str) return [];
  // Alternative combos are separated by " / " (or " 或 "), never by literal bare "/" (e.g. "Ctrl+/" or "⌘/")
  const alternatives = str.split(/\s+\/\s+|\s+或\s+/).filter(Boolean);
  return alternatives
    .map((alt) => parseKeys(alt, isMac))
    .filter((chord) => chord.length > 0 && chord.some((k) => k.length > 0));
}

export function isModKey(k: string): boolean {
  return ['Ctrl', 'Alt', 'Shift', 'Mod', '⌘', '⌥', '⇧', '⌃', 'Cmd', 'Option'].includes(k);
}
