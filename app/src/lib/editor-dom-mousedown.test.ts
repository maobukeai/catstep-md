import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the native listener from the actual SFC. CodeMirror's widget tests
// alone cannot catch a second view.dom listener overriding its selection.
const sfc = readFileSync(new URL('../components/Editor.vue', import.meta.url), 'utf8');
const script = sfc.slice(sfc.indexOf('>') + 1, sfc.indexOf('</script>'));
const ast = ts.createSourceFile('Editor.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let initializer: string | undefined;
function findHandler(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'onEditorDomMouseDown') {
    initializer = node.initializer?.getText(ast);
  }
  ts.forEachChild(node, findHandler);
}
findHandler(ast);
assert.ok(initializer, 'the actual Editor native mousedown listener must be present');
const compiled = ts.transpileModule(`const handler = ${initializer};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function surface(position: number | null = 37) {
  const contained = new Set<unknown>();
  const selections: unknown[] = [];
  const coordinates: unknown[] = [];
  let focusCount = 0;
  const view = {
    dom: { contains: (target: unknown) => contained.has(target) },
    state: { doc: { length: 200 } },
    posAtCoords: (point: unknown, precise: boolean) => {
      coordinates.push({ point, precise });
      return position;
    },
    dispatch: (transaction: unknown) => { selections.push(transaction); },
    focus: () => { focusCount++; },
  };
  const handler = new Function('view', `${compiled}\nreturn handler;`)(view) as (event: any) => void;
  const target = (match?: string) => {
    const node = { closest: (selector: string) => selector === match ? node : null };
    contained.add(node);
    return node;
  };
  const event = (node: unknown, extra: Record<string, unknown> = {}) => ({
    button: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
    defaultPrevented: false, target: node, clientX: 100, clientY: 240, ...extra,
  });
  return { handler, target, event, contained, selections, coordinates, get focusCount() { return focusCount; } };
}

test('a widget-handled press cannot be reselected after its synchronous source reveal', () => {
  const s = surface();
  const detached = { closest() { assert.fail('handled events must not inspect the removed widget'); } };
  s.handler(s.event(detached, { defaultPrevented: true }));
  assert.deepEqual(s.selections, []);
  assert.deepEqual(s.coordinates, []);
  assert.equal(s.focusCount, 0);
});

test('a detached or foreign widget target is never treated as current editor blank space', () => {
  const s = surface();
  const detached = { closest() { assert.fail('foreign targets must not be inspected for blank-space fallback'); } };
  s.handler(s.event(detached));
  assert.deepEqual(s.selections, []);
  assert.deepEqual(s.coordinates, []);
});

test('ordinary blank editor space still positions and focuses the caret', () => {
  const s = surface(37);
  s.handler(s.event(s.target()));
  assert.deepEqual(s.coordinates, [{ point: { x: 100, y: 240 }, precise: false }]);
  assert.deepEqual(s.selections, [{ selection: { anchor: 37, head: 37 }, scrollIntoView: false }]);
  assert.equal(s.focusCount, 1);
});

test('blank clicks without a coordinate position still fall back to document end', () => {
  const s = surface(null);
  s.handler(s.event(s.target()));
  assert.deepEqual(s.selections, [{ selection: { anchor: 200, head: 200 }, scrollIntoView: false }]);
  assert.equal(s.focusCount, 1);
});

test('content, gutters and interactive controls keep their existing event handling', () => {
  const s = surface();
  for (const selector of [
    '.cm-content', '.cm-gutters',
    'button, input, select, textarea, [role="button"], .cm-foldGutter',
  ]) s.handler(s.event(s.target(selector)));
  assert.deepEqual(s.selections, []);
  assert.deepEqual(s.coordinates, []);
});

test('modified and secondary presses do not trigger blank-space caret placement', () => {
  const s = surface();
  const target = s.target();
  for (const extra of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { button: 2 }]) {
    s.handler(s.event(target, extra));
  }
  s.handler(s.event(null));
  assert.deepEqual(s.selections, []);
  assert.deepEqual(s.coordinates, []);
});
