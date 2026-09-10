<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { renderMarkdown } from '../lib/markdown';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toggleFullscreen } from '../lib/fullscreen';
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';

const STORAGE_KEY = 'solomd:slideshow:content';
const TITLE_KEY = 'solomd:slideshow:title';

// ---------------------------------------------------------------------------
// v3.5: full reveal.js migration. The previous slideshow was a hand-rolled
// `\n---\n` splitter + v-html. That worked but couldn't handle backgrounds,
// fragments, speaker notes, transitions — every additional ask was another
// patch. Switching to reveal.js gives all of those for free; the cost is a
// ~140 KB minified runtime, which is the right trade vs maintaining a
// home-grown presentation engine forever.
//
// Markdown rendering still goes through OUR markdown-it + KaTeX + Mermaid
// + highlight.js pipeline (so all existing in-doc features keep working);
// reveal only handles layout / transitions / backgrounds / navigation.
//
// Slide separator: a line with `---` (horizontal) or `--` (vertical sub-slide).
// Reveal's native conventions, applied here as input syntax.
// ---------------------------------------------------------------------------

const containerRef = ref<HTMLDivElement | null>(null);
const slidesRef = ref<HTMLDivElement | null>(null);
const total = ref(0);
const idx = ref(0);
const showHelp = ref(false);
const title = ref('');

function getLocale(): 'zh' | 'en' {
  try {
    const raw = localStorage.getItem('solomd.settings.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.language?.startsWith('en')) return 'en';
      if (parsed.language?.startsWith('zh')) return 'zh';
    }
  } catch {}
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.startsWith('zh') ? 'zh' : 'en';
}
const isZh = ref(getLocale() === 'zh');

type RevealDeck = InstanceType<typeof Reveal>;
let deck: RevealDeck | null = null;

interface SlideMeta {
  body: string;
  /** A single CSS color, gradient, or image URL. */
  bg?: string;
  /** Distinguishes URL-style backgrounds from color/gradient. */
  bgIsImage?: boolean;
  bgSize?: string;     // e.g. 'cover' (default), 'contain', '100% 100%'
  bgPosition?: string; // e.g. 'center', 'top left'
  bgOpacity?: string;  // 0–1
}

/**
 * Parse a single slide's leading HTML comments for background directives.
 * Recognised forms:
 *
 *   <!-- bg: ./assets/cover.jpg -->
 *   <!-- bg: #ff9f40 -->
 *   <!-- bg: linear-gradient(135deg,#ff9f40,#ffd166) -->
 *   <!-- bg-size: cover -->
 *   <!-- bg-position: center -->
 *   <!-- bg-opacity: 0.6 -->
 *
 * The directive line(s) are stripped from the slide body before rendering.
 */
function extractMeta(raw: string): SlideMeta {
  const meta: SlideMeta = { body: raw };
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  // Only consume directives at the *top* of the slide. Once we see a
  // non-directive non-empty line, the rest is the slide body verbatim.
  let inHeader = true;
  for (const line of lines) {
    if (inHeader) {
      const m = /^\s*<!--\s*(bg|bg-size|bg-position|bg-opacity)\s*:\s*(.+?)\s*-->\s*$/.exec(line);
      if (m) {
        const key = m[1];
        const value = m[2];
        if (key === 'bg') {
          meta.bg = value;
          meta.bgIsImage = /^(https?:\/\/|\.{0,2}\/|file:|data:image\/)/.test(value)
            || /\.(jpe?g|png|gif|webp|avif|svg)\b/i.test(value);
        } else if (key === 'bg-size') {
          meta.bgSize = value;
        } else if (key === 'bg-position') {
          meta.bgPosition = value;
        } else if (key === 'bg-opacity') {
          meta.bgOpacity = value;
        }
        continue;
      }
      if (line.trim() === '') {
        kept.push(line);
        continue;
      }
      inHeader = false;
    }
    kept.push(line);
  }
  meta.body = kept.join('\n');
  return meta;
}

/**
 * Split the source markdown into slide blocks. Reveal-style:
/**
 * Detect standard CommonMark horizontal rules and presentation breaks:
 * - 3 or more hyphens, asterisks, or underscores (with optional 0~3 leading spaces and spaces between symbols)
 *   e.g. `---`, `----`, `***`, `****`, `___`, `- - -`, `* * *`, `_ _ _`
 * - HTML `<hr>` / `<hr/>` / `<hr />`
 * - Marp / Remark slide break comments: `<!-- slide -->`, `<!-- pagebreak -->`
 * - Chinese em-dashes: `——` or `———`
 *
 * Excludes `--` which is reserved for vertical slides.
 */
function isVerticalSeparator(line: string): boolean {
  return /^(?:[ ]{0,3}--[ ]*|<!--\s*vertical\s*-->)$/i.test(line);
}

function isHorizontalSeparator(line: string): boolean {
  if (isVerticalSeparator(line)) return false;
  return /^(?:[ ]{0,3}(?:(?:-[ ]*){3,}|(?:\*[ ]*){3,}|(?:_[ ]*){3,})\s*|<hr\s*\/?>|<!--\s*(?:slide|pagebreak)\s*-->|(?:——+|———+)\s*)$/i.test(line);
}

/**
 * Split the source markdown into slide blocks. Reveal-style:
 *   Horizontal separator (`---`, `***`, `___`, `<hr>`, etc.) → next horizontal slide
 *   Vertical separator (`--`) → next vertical sub-slide (within the current horizontal stack)
 * Fence-aware: separators inside ``` blocks are content, not slide breaks.
 */
function splitSlides(src: string): string[][] {
  if (!src) return [['']];
  const lines = src.split(/\r?\n/);
  const decks: string[][] = [];
  let stack: string[][] = [[]]; // current horizontal slide's vertical stack
  let buf: string[] = [];
  let inFence = false;

  function pushBuf() {
    stack[stack.length - 1].push(buf.join('\n'));
    buf = [];
  }
  function pushHorizontal() {
    pushBuf();
    decks.push(stack[0]);
    stack = [[]];
  }

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && isHorizontalSeparator(line)) {
      pushHorizontal();
    } else if (!inFence && isVerticalSeparator(line)) {
      pushBuf();
      stack[0].push(''); // start a new vertical slide; we'll fill it on subsequent lines
    } else {
      buf.push(line);
    }
  }
  pushBuf();
  decks.push(stack[0]);

  // Drop a leading empty horizontal slide (front-matter is also stripped
  // upstream but be defensive).
  if (decks.length > 1 && decks[0].every((s) => s.trim() === '')) {
    decks.shift();
  }
  return decks;
}

function buildSection(meta: SlideMeta): HTMLElement {
  const section = document.createElement('section');
  if (meta.bg) {
    if (meta.bgIsImage) {
      section.setAttribute('data-background-image', meta.bg);
      if (meta.bgSize) section.setAttribute('data-background-size', meta.bgSize);
      if (meta.bgPosition) section.setAttribute('data-background-position', meta.bgPosition);
      if (meta.bgOpacity) section.setAttribute('data-background-opacity', meta.bgOpacity);
    } else {
      section.setAttribute('data-background', meta.bg);
      if (meta.bgOpacity) section.setAttribute('data-background-opacity', meta.bgOpacity);
    }
  }
  section.innerHTML = renderMarkdown(meta.body);
  return section;
}

function buildDeck(src: string, host: HTMLElement) {
  // Clear any prior content (re-init path).
  while (host.firstChild) host.removeChild(host.firstChild);
  const decks = splitSlides(src);
  for (const stack of decks) {
    const horiz = stack.length > 1
      ? document.createElement('section') // wraps a vertical sub-stack
      : null;
    if (horiz) host.appendChild(horiz);
    for (const slideSrc of stack) {
      const meta = extractMeta(slideSrc);
      const slide = buildSection(meta);
      (horiz || host).appendChild(slide);
    }
  }
  total.value = host.querySelectorAll(':scope > section').length
    + host.querySelectorAll(':scope > section section').length;
  // Above counts both top-level slides and nested verticals; for the HUD
  // we want the absolute slide count which is what reveal exposes via
  // getTotalSlides(). Real HUD update happens in `slidechanged` below.
}

/**


async function exitShow() {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const win = getCurrentWindow();
      if (await win.isFullscreen()) {
        await win.setFullscreen(false);
        await new Promise((r) => setTimeout(r, 350));
      }
      await win.close();
      return;
    } catch (e) {
      console.warn('slideshow exit failed', e);
    }
  }
  window.close();
}

function onKey(e: KeyboardEvent) {
  // If current slide has overflowing content, ArrowDown / j and ArrowUp / k
  // scroll the slide smoothly first, rather than instantly jumping slides.
  if (e.key === 'ArrowDown' || e.key === 'j') {
    const curSlide = (deck as any)?.getCurrentSlide?.();
    if (curSlide && curSlide.scrollHeight - curSlide.scrollTop - curSlide.clientHeight > 15) {
      e.preventDefault();
      e.stopPropagation();
      curSlide.scrollBy({ top: 120, behavior: 'smooth' });
      return;
    }
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    const curSlide = (deck as any)?.getCurrentSlide?.();
    if (curSlide && curSlide.scrollTop > 15) {
      e.preventDefault();
      e.stopPropagation();
      curSlide.scrollBy({ top: -120, behavior: 'smooth' });
      return;
    }
  }

  // Reveal handles arrow keys / space / page-up/down natively. We only
  // need our own escape-hatch shortcuts: F (fullscreen), Esc (exit),
  // ? (help overlay).
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleFullscreen();
  } else if (e.key === '?') {
    e.preventDefault();
    showHelp.value = !showHelp.value;
  } else if (e.key === 'Escape') {
    if (showHelp.value) {
      showHelp.value = false;
      return;
    }
    e.preventDefault();
    exitShow();
  }
}

onMounted(async () => {
  let source = '';
  try {
    source = localStorage.getItem(STORAGE_KEY) || '';
    title.value = localStorage.getItem(TITLE_KEY) || 'Slideshow';
  } catch {}
  // Strip front matter (first --- ... --- block) ONLY if it actually looks like
  // YAML front-matter (key: value pairs, metadata), so we never accidentally
  // swallow a user's first slide if they started the presentation with `---`.
  const fmMatch = /^(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)\r?\n/.exec(source);
  if (fmMatch) {
    const body = fmMatch[1];
    const lines = body.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const isYaml = lines.length > 0 && lines.every((l) => {
      const t = l.trim();
      return t.startsWith('#') || /^[\w.-]+\s*:/.test(t);
    });
    if (isYaml) {
      source = source.slice(fmMatch[0].length);
    }
  }
  document.title = `${title.value} — SoloMD Slideshow`;

  // Build the DOM once into the .slides container, then init Reveal on
  // the wrapper. Reveal expects the structure to be present at init time.
  if (slidesRef.value) {
    buildDeck(source, slidesRef.value);
  }

  if (containerRef.value) {
    deck = new Reveal(containerRef.value, {
      embedded: false,
      hash: false,
      controls: false,           // we draw a minimal HUD ourselves
      progress: true,
      slideNumber: false,
      keyboard: true,            // Reveal handles arrow / space / pgup
      transition: 'slide',
      backgroundTransition: 'fade',
      autoSlide: 0,
      width: 1200,
      height: 720,
      margin: 0.04,
      minScale: 0.2,
      maxScale: 2.0,
      center: false,
      // Plugins are intentionally NOT loaded — our markdown is already
      // rendered (with KaTeX, Mermaid, highlight.js). Reveal's own
      // markdown / highlight plugins would just duplicate work.
      plugins: [],
    });
    await deck.initialize();
    deck.on('slidechanged', (event: any) => {
      idx.value = (event?.indexh ?? 0);
      total.value = deck?.getTotalSlides() ?? 0;
      // Reset scroll position on newly active slide so it starts from top
      if (event?.currentSlide) {
        event.currentSlide.scrollTop = 0;
      }
    });
    total.value = deck.getTotalSlides();
  }

  window.addEventListener('keydown', onKey, true);

  // Try to enter fullscreen on launch via Tauri.
  try {
    const win = getCurrentWindow();
    await new Promise((r) => setTimeout(r, 100));
    await win.setFullscreen(true);
  } catch {}
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true);
  if (deck) {
    deck.destroy();
    deck = null;
  }
});
</script>

<template>
  <div ref="containerRef" class="reveal solomd-slideshow">
    <div ref="slidesRef" class="slides" />

    <!-- Interactive Glass Capsule HUD in Bottom Right -->
    <div class="slide__hud" @click.stop>
      <div class="slide__hud-capsule">
        <span class="slide__pos">
          <span class="slide__pos-cur">{{ idx + 1 }}</span>
          <span class="slide__pos-sep">/</span>
          <span class="slide__pos-total">{{ total }}</span>
        </span>
        <span class="slide__hud-divider" />
        <button
          class="slide__hud-btn"
          :title="isZh ? '全屏放映 (F)' : 'Toggle Fullscreen (F)'"
          @click.stop="toggleFullscreen"
        >
          <kbd>F</kbd>
          <span>{{ isZh ? '全屏' : 'Full' }}</span>
        </button>
        <button
          class="slide__hud-btn"
          :title="isZh ? '快捷键帮助 (?)' : 'Shortcuts Help (?)'"
          @click.stop="showHelp = !showHelp"
        >
          <kbd>?</kbd>
          <span>{{ isZh ? '帮助' : 'Help' }}</span>
        </button>
        <button
          class="slide__hud-btn slide__hud-btn--exit"
          :title="isZh ? '退出放映 (Esc)' : 'Exit Slideshow (Esc)'"
          @click.stop="exitShow"
        >
          <kbd>Esc</kbd>
          <span>{{ isZh ? '退出' : 'Exit' }}</span>
        </button>
      </div>
    </div>

    <!-- Localized Shortcuts Help Modal -->
    <div v-if="showHelp" class="slide__help" @click.self="showHelp = false">
      <div class="slide__help-card">
        <div class="slide__help-head">
          <h2>{{ isZh ? '幻灯片放映快捷键指南' : 'Slideshow Shortcuts' }}</h2>
          <button class="slide__help-close" @click="showHelp = false">✕</button>
        </div>
        <table>
          <tbody>
            <tr>
              <td>{{ isZh ? '下一页幻灯片' : 'Next slide' }}</td>
              <td><kbd>→</kbd> <kbd>↓</kbd> <kbd>Space</kbd> <kbd>PageDown</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '上一页幻灯片' : 'Previous slide' }}</td>
              <td><kbd>←</kbd> <kbd>↑</kbd> <kbd>PageUp</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '第一页 / 最后一页' : 'First / last slide' }}</td>
              <td><kbd>Home</kbd> / <kbd>End</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '切换全屏模式' : 'Toggle fullscreen' }}</td>
              <td><kbd>F</kbd> / <kbd>F11</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '显示 / 隐藏帮助' : 'Show / hide help' }}</td>
              <td><kbd>?</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '退出放映模式' : 'Exit slideshow' }}</td>
              <td><kbd>Esc</kbd></td>
            </tr>
            <tr>
              <td>{{ isZh ? '垂直下级幻灯片' : 'Vertical sub-slides' }}</td>
              <td><code>--</code> {{ isZh ? '分页标记' : 'separator' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="slide__help-foot">
          {{ isZh
            ? '💡 提示：支持使用单独一行的 ---、***、___、---- 或 HTML <hr> 水平分页，使用 -- 垂直子分页。顶部支持 <!-- bg: 图片URL或颜色代码 --> 自定义每页背景。'
            : '💡 Tip: Split slides with a line containing ---, ***, ___, or <hr>. Add <!-- bg: ./image.jpg --> at the top of a slide to customize its background.' }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.solomd-slideshow {
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at 50% 25%, #1e222d 0%, #111318 100%);
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Reveal progress bar in SoloMD brand orange */
.solomd-slideshow :deep(.reveal .progress) {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
}
.solomd-slideshow :deep(.reveal .progress span) {
  background: linear-gradient(90deg, #ff9f40, #ff7a18);
}

.solomd-slideshow :deep(.slides) {
  text-align: left !important;
}

.solomd-slideshow :deep(.slides section) {
  height: 720px;
  max-height: 720px;
  box-sizing: border-box;
  overflow-y: auto;
  overflow-x: hidden;
  top: 0 !important;
  font-size: clamp(17px, 1.8vw, 24px);
  line-height: 1.68;
  padding: 24px 44px 36px;
  text-align: left;
  letter-spacing: 0.005em;
  word-break: normal;
  overflow-wrap: break-word;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 159, 64, 0.4) transparent;
}
.solomd-slideshow :deep(.slides section)::-webkit-scrollbar {
  width: 6px;
}
.solomd-slideshow :deep(.slides section)::-webkit-scrollbar-track {
  background: transparent;
}
.solomd-slideshow :deep(.slides section)::-webkit-scrollbar-thumb {
  background: rgba(255, 159, 64, 0.35);
  border-radius: 4px;
}
.solomd-slideshow :deep(.slides section)::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 159, 64, 0.65);
}

/* Title Slide / Cover Slide (starts with h1) */
.solomd-slideshow :deep(section:has(> h1:first-child)) {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  min-height: 100% !important;
  text-align: center;
}
.solomd-slideshow :deep(section:has(> h1:first-child) h1) {
  margin-top: 0;
  margin-bottom: 0.6em;
}
.solomd-slideshow :deep(section:has(> h1:first-child) p) {
  text-align: center;
  max-width: 920px;
  margin-left: auto;
  margin-right: auto;
  color: #94a3b8;
  font-size: 1.15em;
  line-height: 1.8;
}

.solomd-slideshow :deep(h1) {
  font-size: clamp(32px, 3.6vw, 48px);
  margin: 0 0 0.55em;
  text-align: center;
  font-weight: 800;
  text-transform: none;
  line-height: 1.28;
  letter-spacing: -0.015em;
  color: #ffffff;
  text-wrap: balance;
}

.solomd-slideshow :deep(h2) {
  font-size: clamp(22px, 2.4vw, 32px);
  margin: 0 0 0.45em;
  font-weight: 700;
  text-transform: none;
  line-height: 1.35;
  color: #f8fafc;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 12px;
}
.solomd-slideshow :deep(h2::before) {
  content: '';
  display: inline-block;
  width: 6px;
  height: 0.85em;
  background: linear-gradient(180deg, #ff9f40, #ff7a18);
  border-radius: 3px;
  flex-shrink: 0;
}

.solomd-slideshow :deep(h3) {
  font-size: clamp(16px, 1.7vw, 22px);
  margin: 0.4em 0 0.22em;
  font-weight: 600;
  color: #e2e8f0;
  text-transform: none;
}

.solomd-slideshow :deep(p),
.solomd-slideshow :deep(ul),
.solomd-slideshow :deep(ol) {
  font-size: 1em;
  margin: 0.45em 0;
  line-height: 1.65;
  color: #cbd5e1;
}

.solomd-slideshow :deep(ul),
.solomd-slideshow :deep(ol) {
  padding-left: 1.2em;
}

.solomd-slideshow :deep(li) {
  margin: 0.28em 0;
  line-height: 1.62;
}
.solomd-slideshow :deep(li::marker) {
  color: #ff9f40;
}

.solomd-slideshow :deep(strong),
.solomd-slideshow :deep(b) {
  color: #ffffff;
  font-weight: 600;
}

.solomd-slideshow :deep(code) {
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fed7aa;
  padding: 0.15em 0.45em;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
}

.solomd-slideshow :deep(pre) {
  background: #0d1117 !important;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 12px 18px;
  margin: 0.45em 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow-x: auto;
  font-size: 0.72em;
  line-height: 1.45;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.solomd-slideshow :deep(pre code) {
  background: transparent;
  border: none;
  color: inherit;
  padding: 0;
  font-size: 1em;
  display: block;
}

.solomd-slideshow :deep(blockquote) {
  background: rgba(255, 159, 64, 0.08);
  border-left: 4px solid #ff9f40;
  border-radius: 0 10px 10px 0;
  padding: 14px 20px;
  margin: 1.2em 0;
  color: #fed7aa;
  font-style: normal;
  line-height: 1.7;
}

.solomd-slideshow :deep(table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  margin: 1.2em 0;
  font-size: 0.88em;
}
.solomd-slideshow :deep(th) {
  background: rgba(255, 159, 64, 0.12);
  color: #ffffff;
  font-weight: 600;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.solomd-slideshow :deep(td) {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}
.solomd-slideshow :deep(tr:last-child td) {
  border-bottom: none;
}

.solomd-slideshow :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.solomd-slideshow :deep(a) {
  color: #ff9f40;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.solomd-slideshow :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  margin: 1.5em 0;
}

/* Glass Capsule HUD in Bottom Right */
.slide__hud {
  position: fixed;
  bottom: 20px;
  right: 24px;
  z-index: 100;
}
.slide__hud-capsule {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(22, 25, 32, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9999px;
  padding: 5px 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  user-select: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.slide__hud-capsule:hover {
  background: rgba(26, 30, 40, 0.92);
  border-color: rgba(255, 255, 255, 0.2);
}
.slide__pos {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 3px;
}
.slide__pos-cur {
  color: #ff9f40;
  font-weight: 700;
}
.slide__pos-sep {
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
}
.slide__pos-total {
  color: rgba(255, 255, 255, 0.55);
}
.slide__hud-divider {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.15);
}
.slide__hud-btn {
  background: transparent;
  border: none;
  outline: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  transition: all 0.15s ease;
}
.slide__hud-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.slide__hud-btn kbd {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.slide__hud-btn--exit:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.slide__hud-btn--exit:hover kbd {
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

/* Help Modal Card */
.slide__help {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.15s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.slide__help-card {
  background: #1e222b;
  border: 1px solid rgba(255, 255, 255, 0.14);
  padding: 28px 36px;
  border-radius: 16px;
  max-width: 600px;
  width: 90%;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  color: #f1f5f9;
}
.slide__help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.slide__help-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #ff9f40;
}
.slide__help-close {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #94a3b8;
  font-size: 14px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.slide__help-close:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
.slide__help-card table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.slide__help-card td {
  padding: 9px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 14px;
}
.slide__help-card td:first-child {
  color: #94a3b8;
  width: 45%;
}
.slide__help-card td:last-child {
  text-align: right;
}
.slide__help-card kbd {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  padding: 2px 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #f8fafc;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  margin-left: 4px;
}
.slide__help-foot {
  margin: 14px 0 0;
  font-size: 12.5px;
  color: #94a3b8;
  line-height: 1.6;
  background: rgba(255, 255, 255, 0.03);
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
