import yaml from 'js-yaml';

/** Edit the live document, preserving every body character. Invalid YAML is
 * rejected instead of silently replacing unrelated properties with an empty map. */
export function editFrontmatterProperty(text: string, key: string, value: unknown): string {
  const match = /^(\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  const bom = match?.[1] ?? (text.startsWith('\uFEFF') ? '\uFEFF' : '');
  const parsed = match ? yaml.load(match[2]) : null;
  if (parsed !== undefined && parsed !== null &&
      (typeof parsed !== 'object' || Array.isArray(parsed) || parsed instanceof Date)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }
  const data: Record<string, unknown> = Object.assign(Object.create(null), parsed ?? {});
  if (value === undefined) delete data[key];
  else data[key] = value;
  if (!match && value === undefined) return text;
  const body = match ? text.slice(match[0].length) : text.slice(bom.length);
  const block = yaml.dump(data, { lineWidth: -1, noRefs: true }).replace(/\n$/, '');
  if (match) return `${bom}---\n${block}\n---${match[3]}${body}`;
  return `${bom}---\n${block}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}
