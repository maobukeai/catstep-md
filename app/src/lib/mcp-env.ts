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

/** Parse the multi-line `KEY=value` editor text into a record. Lines
 *  without a `=` (or with an empty key/value) are dropped. Values may
 *  contain `=` — only the first one separates. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/\r?\n/)) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/** Serialize the env record back to the one `KEY=value` per line editor
 *  format (order preserved). Undefined/empty records yield ''. */
export function formatEnvText(env: Record<string, string> | undefined): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
