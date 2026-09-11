/**
 * Format a markdown document using Prettier (via the standalone build so we
 * don't pull in any Node-only dependencies).
 *
 * Front matter is preserved verbatim — Prettier's markdown parser doesn't
 * understand YAML front matter, and ad-hoc rewrites would corrupt it.
 */
const FRONT_MATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/;

let prettierModule: any = null;
let markdownPluginModule: any = null;

async function getPrettier() {
  if (!prettierModule || !markdownPluginModule) {
    const [p, m] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/markdown'),
    ]);
    prettierModule = p.default || p;
    markdownPluginModule = m.default || m;
  }
  return { prettier: prettierModule, markdownPlugin: markdownPluginModule };
}

export async function formatMarkdown(
  source: string,
  opts: { printWidth?: number } = {},
): Promise<string> {
  const printWidth = opts.printWidth ?? 100;
  const m = FRONT_MATTER_RE.exec(source);
  const fm = m ? m[1] : '';
  const body = m ? m[2] : source;

  const { prettier, markdownPlugin } = await getPrettier();

  const formatted = await prettier.format(body, {
    parser: 'markdown',
    plugins: [markdownPlugin],
    printWidth,
    proseWrap: 'preserve',
    tabWidth: 2,
  });

  // Prettier guarantees trailing newline. Strip an extra one if our concat
  // would produce a double-blank between FM and body.
  if (fm) {
    const bodyTrimmed = formatted.replace(/^\r?\n/, '');
    return fm + bodyTrimmed;
  }
  return formatted;
}
