import MarkdownIt from 'markdown-it';

// Use the same block grammar as the renderer. In particular, a shorter fence,
// a different fence character, or a fence inside a quote must not end code.
const blocks = new MarkdownIt({ html: true });
const cache = new Map<string, ReturnType<MarkdownIt['parse']>>();

export function parseMarkdownBlocks(source: string) {
  const cached = cache.get(source);
  if (cached) return cached;
  const parsed = blocks.parse(source, {});
  // A live render and several preprocessors inspect the same revision. Keep
  // only two revisions; large documents must not accumulate for a session.
  cache.set(source, parsed);
  if (cache.size > 2) cache.delete(cache.keys().next().value!);
  return parsed;
}

export function markdownCodeBlocks(source: string) {
  return parseMarkdownBlocks(source).filter(
    (token) => (token.type === 'fence' || token.type === 'code_block') && token.map,
  );
}

export function markdownCodeLines(source: string): Set<number> {
  const lines = new Set<number>();
  for (const token of markdownCodeBlocks(source)) {
    for (let i = token.map![0]; i < token.map![1]; i++) lines.add(i);
  }
  return lines;
}

/** Transform prose without ever handing code bytes to a leniency fixer. */
export function transformOutsideMarkdownCode(source: string, transform: (text: string) => string): string {
  const lines = source.split('\n');
  const starts = [0];
  for (let i = 0; i < lines.length; i++) starts.push(starts[i] + lines[i].length + 1);
  let end = 0;
  let result = '';
  for (const token of markdownCodeBlocks(source)) {
    const from = starts[token.map![0]];
    const to = Math.min(source.length, starts[token.map![1]]);
    result += transform(source.slice(end, from)) + source.slice(from, to);
    end = to;
  }
  return result + transform(source.slice(end));
}
