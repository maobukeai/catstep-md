import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { attachTableScrollFrame } from './table-scroll';
import { wrapScrollableTables, cleanupScrollableTables } from './markdown-layout';

class Element extends EventTarget {
  tagName: string;
  className = '';
  textContent = '';
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  ownerDocument: TestDocument;
  hidden = false;
  tabIndex = -1;
  scrollLeft = 0;
  scrollWidth = 0;
  clientWidth = 0;
  caption: Element | null = null;
  colSpan = 1;
  constructor(tag: string, doc: TestDocument) { super(); this.tagName = tag; this.ownerDocument = doc; }
  get classList() { return { contains: (name: string) => this.className.split(' ').includes(name) }; }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  appendChild(node: Element) {
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  before(node: Element) {
    const parent = this.parentElement!;
    if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
    node.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this), 0, node);
  }
  replaceChildren(...nodes: Element[]) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }
  querySelectorAll(selector: string): Element[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return descendants.filter((element) => selector === '*' || (selector.startsWith('.')
      ? element.classList.contains(selector.slice(1)) : element.tagName === selector));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
}
class TestWindow extends EventTarget {
  frames = new Map<number, FrameRequestCallback>();
  sequence = 0;
  requestAnimationFrame(callback: FrameRequestCallback) { this.frames.set(++this.sequence, callback); return this.sequence; }
  cancelAnimationFrame(id: number) { this.frames.delete(id); }
  flush() { const callbacks = [...this.frames.values()]; this.frames.clear(); callbacks.forEach((callback) => callback(0)); }
}
interface TestDocument { defaultView: TestWindow; createElement: (tag: string) => Element; fonts: { ready: Promise<void> }; }

function setup(t: TestContext, resizeObserver = true) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const win = new TestWindow();
  let fontReady!: () => void;
  const doc: TestDocument = {
    defaultView: win,
    createElement: (tag) => new Element(tag, doc),
    fonts: { ready: new Promise<void>((resolve) => { fontReady = resolve; }) },
  };
  const observers: FakeObserver[] = [];
  class FakeObserver {
    callback: () => void;
    targets: Element[] = [];
    disconnected = false;
    constructor(callback: () => void) { this.callback = callback; observers.push(this); }
    observe(target: Element) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
    fire() { this.callback(); }
  }
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'ResizeObserver', { value: resizeObserver ? FakeObserver : undefined, configurable: true });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });
  return { win, doc, observers, fontReady };
}
const html = (element: Element) => element as unknown as HTMLElement;
const tableHtml = (element: Element) => element as unknown as HTMLTableElement;

test('both native scrollbars share the same viewport without replacing editable cells', (t) => {
  const { doc, observers } = setup(t);
  const frame = doc.createElement('div');
  const table = doc.createElement('table');
  const cell = doc.createElement('td');
  table.appendChild(cell);
  const dispose = attachTableScrollFrame(html(frame), tableHtml(table), 'Camera table');
  t.after(dispose);
  const [bar, body] = frame.children;
  assert.equal(bar.className, 'md-table-scrollbar');
  assert.equal(bar.attrs['aria-hidden'], 'true');
  assert.equal(bar.tabIndex, -1);
  assert.equal(body.attrs.role, 'region');
  assert.equal(body.attrs['aria-label'], 'Camera table');
  assert.equal(body.tabIndex, 0);
  assert.equal(body.children[0], table);
  assert.equal(table.children[0], cell);
  const click = new Event('click', { bubbles: true, cancelable: true });
  bar.dispatchEvent(click);
  assert.equal(click.cancelBubble, true, 'native scrollbar must not activate the outer block');
  assert.equal(click.defaultPrevented, false, 'native scrollbar defaults remain available');
  const doubleClick = new Event('dblclick', { bubbles: true, cancelable: true });
  body.dispatchEvent(doubleClick);
  assert.equal(doubleClick.cancelBubble, true, 'scrollbar gutter must not leave reading mode');
  assert.equal(doubleClick.defaultPrevented, false);
  body.clientWidth = 700;
  body.scrollWidth = 1400;
  observers[0].fire();
  assert.equal(bar.hidden, false);
  assert.equal(bar.children[0].style.width, '1400px');
  bar.scrollLeft = 375;
  bar.dispatchEvent(new Event('scroll'));
  assert.equal(body.scrollLeft, 375);
  body.scrollLeft = 690;
  body.dispatchEvent(new Event('scroll'));
  assert.equal(bar.scrollLeft, 690);
  // RTL engines use negative offsets; both native regions must keep them.
  bar.scrollLeft = -180;
  bar.dispatchEvent(new Event('scroll'));
  assert.equal(body.scrollLeft, -180);
});

test('responsive/content sizing toggles the upper strip and only requests changed widget heights', (t) => {
  const { doc, observers, win } = setup(t);
  const frame = doc.createElement('div');
  const table = doc.createElement('table');
  let layouts = 0;
  const dispose = attachTableScrollFrame(html(frame), tableHtml(table), 'Table', () => { layouts++; });
  t.after(dispose);
  const [bar, body] = frame.children;
  assert.equal(bar.hidden, true);
  assert.deepEqual(observers[0].targets, [body, table]);
  layouts = 0;
  body.clientWidth = 600;
  body.scrollWidth = 1200;
  win.flush();
  assert.equal(bar.hidden, false);
  assert.equal(layouts, 1);
  body.scrollWidth = 1400;
  observers[0].fire();
  assert.equal(bar.children[0].style.width, '1400px');
  assert.equal(layouts, 1, 'width updates do not loop CM height measurement');
  body.clientWidth = 1500;
  observers[0].fire();
  assert.equal(bar.hidden, true);
  assert.equal(layouts, 2);
});

test('cleanup detaches both directions, observer, pending animation and late fonts', async (t) => {
  const { doc, observers, win, fontReady } = setup(t);
  const frame = doc.createElement('div');
  const table = doc.createElement('table');
  const dispose = attachTableScrollFrame(html(frame), tableHtml(table), 'Table');
  const [bar, body] = frame.children;
  dispose();
  dispose();
  assert.equal(observers[0].disconnected, true);
  assert.equal(win.frames.size, 0);
  body.clientWidth = 400;
  body.scrollWidth = 1800;
  bar.scrollLeft = 250;
  bar.dispatchEvent(new Event('scroll'));
  assert.equal(body.scrollLeft, 0);
  body.scrollLeft = 100;
  body.dispatchEvent(new Event('scroll'));
  assert.equal(bar.scrollLeft, 250);
  win.dispatchEvent(new Event('resize'));
  observers[0].fire();
  fontReady();
  await Promise.resolve();
  assert.equal(bar.hidden, true);
  assert.equal(bar.children[0].style.width, '0px');
});

test('a browser without ResizeObserver still measures mounted and resized tables', (t) => {
  const { doc, win } = setup(t, false);
  const frame = doc.createElement('div');
  const dispose = attachTableScrollFrame(html(frame), tableHtml(doc.createElement('table')), 'Table');
  t.after(dispose);
  const [bar, body] = frame.children;
  body.clientWidth = 400;
  body.scrollWidth = 1000;
  win.flush();
  assert.equal(bar.hidden, false);
  body.clientWidth = 1200;
  win.dispatchEvent(new Event('resize'));
  assert.equal(bar.hidden, true);
});

test('only wide grids opt into the reading-pane breakout, including colspan and later grid changes', (t) => {
  const { doc, observers } = setup(t);
  const frame = doc.createElement('div');
  frame.className = 'md-table-frame';
  const table = doc.createElement('table');
  const row = doc.createElement('tr');
  table.appendChild(row);
  for (let column = 0; column < 5; column++) row.appendChild(doc.createElement('th'));
  const dispose = attachTableScrollFrame(html(frame), tableHtml(table), 'Table');
  t.after(dispose);
  assert.equal(frame.classList.contains('md-table-frame--wide'), false);
  row.appendChild(doc.createElement('th'));
  observers[0].fire();
  assert.equal(frame.classList.contains('md-table-frame--wide'), true);
  row.replaceChildren(doc.createElement('th'), doc.createElement('th'));
  row.children[0].colSpan = 3;
  row.children[1].colSpan = 3;
  observers[0].fire();
  assert.equal(frame.classList.contains('md-table-frame--wide'), true);
  row.children[0].colSpan = 1;
  row.children[1].colSpan = 1;
  observers[0].fire();
  assert.equal(frame.className, 'md-table-frame');
});

test('wrapping is idempotent, upgrades old regions and disposes replaced v-html tables', (t) => {
  const { doc, observers } = setup(t);
  const root = doc.createElement('article');
  const oldRegion = doc.createElement('div');
  oldRegion.className = 'md-table-scroll';
  const first = doc.createElement('table');
  oldRegion.appendChild(first);
  root.appendChild(oldRegion);
  wrapScrollableTables(html(root), 'Table');
  const frame = root.children[0];
  assert.equal(frame.children[0].className, 'md-table-scrollbar');
  assert.equal(frame.children[1], oldRegion);
  wrapScrollableTables(html(root), 'Table');
  assert.equal(root.children[0], frame);
  assert.equal(root.querySelectorAll('.md-table-frame').length, 1);
  assert.equal(root.querySelectorAll('.md-table-scroll').length, 1);
  assert.equal(observers.length, 1);
  const second = doc.createElement('table');
  root.replaceChildren(second);
  wrapScrollableTables(html(root), 'Table');
  assert.equal(observers[0].disconnected, true);
  assert.equal(observers[1].disconnected, false);
  cleanupScrollableTables(html(root));
  assert.equal(observers[1].disconnected, true);
  wrapScrollableTables(html(root), 'Table');
  assert.equal(root.querySelectorAll('.md-table-frame').length, 1);
  assert.equal(root.querySelectorAll('.md-table-scrollbar').length, 1);
  assert.equal(root.querySelectorAll('.md-table-scroll').length, 1);
  cleanupScrollableTables(html(root));
});
