/**
 * Pure text ⇄ record helpers for the Agent MCP server `env` editor.
 *
 * The settings UI edits stdio environment variables as one `KEY=value`
 * per line (a textarea — values may contain spaces, so unlike the
 * one-line `Key: Value; ...` headers editor there is no `;` packing).
 * The parsing pattern mirrors `parseHeadersText` in AISettings.vue:
 * split on the separator, cut at the *first* separator, trim both sides,
 * drop entries with an empty key or value.
 */

/** C21 — parse result that also counts what was dropped, so the settings
 *  UI can tell the user which lines silently used to vanish. Blank lines
 *  (whitespace-only) are not counted as dropped. */
export interface ParsedEnvText {
  env: Record<string, string>;
  /** Non-blank lines that did not yield a `KEY=value` pair. */
  dropped: number;
}

/** Parse the multi-line `KEY=value` editor text into a record plus a count
 *  of dropped non-blank lines. Lines without a `=` (or with an empty
 *  key/value) are dropped. Values may contain `=` — only the first one
 *  separates. */
export function parseEnvTextDetailed(text: string): ParsedEnvText {
  const env: Record<string, string> = {};
  let dropped = 0;
  for (const part of text.split(/\r?\n/)) {
    const idx = part.indexOf('=');
    const k = idx > 0 ? part.slice(0, idx).trim() : '';
    const v = idx > 0 ? part.slice(idx + 1).trim() : '';
    if (k && v) {
      env[k] = v;
    } else if (part.trim()) {
      dropped++;
    }
  }
  return { env, dropped };
}

/** Parse the multi-line `KEY=value` editor text into a record. Lines
 *  without a `=` (or with an empty key/value) are dropped. Values may
 *  contain `=` — only the first one separates. */
export function parseEnvText(text: string): Record<string, string> {
  return parseEnvTextDetailed(text).env;
}

/** Serialize the env record back to the one `KEY=value` per line editor
 *  format (order preserved). Undefined/empty records yield ''. */
export function formatEnvText(env: Record<string, string> | undefined): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
