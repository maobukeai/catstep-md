<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DsModal } from '../ui';
import BrandMark from './BrandMark.vue';
import { copyPlainText } from '../lib/code-copy';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const VERSION = ref('…');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  try {
    VERSION.value = await getVersion();
  } catch {
    VERSION.value = '2.5.0';
  }
});

onBeforeUnmount(() => {
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = null;
  }
});

const links = {
  website: 'https://github.com/maobukeai/catstep-md',
  github: 'https://github.com/maobukeai/catstep-md',
  releases: 'https://github.com/maobukeai/catstep-md/releases',
  sponsor: 'https://github.com/sponsors/maobukeai',
};

// NOTE: this function intentionally is NOT named `open` because that
// collides with the `open` prop and the template would shadow it.
async function visit(url: string) {
  try {
    await openUrl(url);
  } catch (e) {
    console.error('failed to open url', e);
  }
}

async function copyVersion() {
  const text = `猫步 MD (Catstep MD) v${VERSION.value} · Tauri 2 · Vue 3 · Rust`;
  try {
    await copyPlainText(text);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (e) {
    console.error('failed to copy version', e);
  }
}
</script>

<template>
  <DsModal
    :model-value="open"
    width="460px"
    @update:model-value="emit('close')"
  >
    <div class="about">
      <!-- Floating close button in the top right -->
      <button
        class="about__close-btn"
        type="button"
        aria-label="关闭"
        title="关闭 (Esc)"
        @click="emit('close')"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- App Brand & Squircle Logo with ambient halo -->
      <div class="about__brand-wrap">
        <div class="about__brand-glow"></div>
        <BrandMark class="brand" :size="68" label="猫步 MD" />
      </div>

      <h2 class="about__name">
        猫步 MD
        <span class="about__subname">Catstep MD</span>
      </h2>

      <!-- Interactive Version Pill -->
      <button
        class="about__version-pill"
        :class="{ 'about__version-pill--copied': copied }"
        type="button"
        :title="copied ? '已复制版本信息' : '点击复制版本及运行环境'"
        @click="copyVersion"
      >
        <span class="about__version-dot"></span>
        <span class="about__version-text">v{{ VERSION }}</span>
        <svg
          v-if="!copied"
          class="about__version-copy-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <svg
          v-else
          class="about__version-check-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span v-if="copied" class="about__version-tip">已复制</span>
      </button>

      <!-- Slogans & Description -->
      <div class="about__text-block">
        <p class="about__slogan">
          用猫步，写好每一篇 Markdown
          <span class="about__motto">Silent steps. Fluid thoughts. Just write.</span>
        </p>
        <p class="about__desc">
          轻量 · 极简 · 跨平台 Markdown 与纯文本编辑器
        </p>
      </div>

      <!-- 2x2 Refined Action Cards with Custom SVG Icons -->
      <div class="about__grid">
        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.website)"
        >
          <div class="about__card-icon-wrap about__card-icon--web">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">项目主页</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">Website & 文档</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md"
          @click="visit(links.github)"
        >
          <div class="about__card-icon-wrap about__card-icon--github">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">GitHub 仓库</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">开源源码与 Star</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="https://github.com/maobukeai/catstep-md/releases"
          @click="visit(links.releases)"
        >
          <div class="about__card-icon-wrap about__card-icon--releases">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              <path d="M5 3v4" />
              <path d="M19 17v4" />
              <path d="M3 5h4" />
              <path d="M17 19h4" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">发行日志</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">What's New 版本动态</div>
          </div>
        </button>

        <button
          class="about__card"
          type="button"
          title="https://github.com/sponsors/maobukeai"
          @click="visit(links.sponsor)"
        >
          <div class="about__card-icon-wrap about__card-icon--sponsor">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <div class="about__card-content">
            <div class="about__card-title-row">
              <span class="about__card-title">赞助支持</span>
              <svg class="about__card-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </div>
            <div class="about__card-sub">助力独立开发</div>
          </div>
        </button>
      </div>

      <!-- Footer & Tech Stack Tags -->
      <div class="about__footer">
        <div class="about__stack-tags">
          <span class="about__tag">Tauri 2</span>
          <span class="about__tag">Rust</span>
          <span class="about__tag">Vue 3</span>
          <span class="about__tag">CodeMirror 6</span>
        </div>
        <div class="about__copyright">
          © 2026 maobukeai · Open Source under MIT License
        </div>
      </div>
    </div>
  </DsModal>
</template>

<style scoped>
.about {
  position: relative;
  text-align: center;
  padding: 4px 4px 0;
}

/* Floating top-right close button */
.about__close-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 28px;
  height: 28px;
  border-radius: var(--r-full);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--dur-fast) var(--ease);
  z-index: 10;
}
.about__close-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text);
  transform: scale(1.05);
}
.about__close-btn:active {
  background: var(--bg-active);
  transform: scale(0.95);
}
.about__close-btn:focus-visible {
  outline: none;
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text);
}

/* Brand logo & ambient glow */
.about__brand-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 6px 0 12px;
}
.about__brand-glow {
  position: absolute;
  inset: -14px;
  background: radial-gradient(circle, var(--accent-soft, rgba(255, 159, 64, 0.2)) 0%, transparent 72%);
  border-radius: 50%;
  pointer-events: none;
  filter: blur(10px);
}
.brand {
  position: relative;
  width: 68px;
  height: 68px;
  border-radius: 18px;
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--border);
  transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.brand:hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--accent-ring);
}

/* App Title */
.about__name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
}
.about__subname {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  opacity: 0.85;
}

/* Interactive Version Pill */
.about__version-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 8px 0 14px;
  padding: 3px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.about__version-pill:hover {
  border-color: var(--accent);
  color: var(--text);
  background: var(--bg-hover);
}
.about__version-pill:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.about__version-pill--copied {
  background: var(--accent-soft);
  border-color: var(--accent-ring);
  color: var(--accent);
}
.about__version-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}
.about__version-text {
  font-weight: 600;
}
.about__version-copy-icon {
  opacity: 0.5;
  transition: opacity var(--dur-fast) var(--ease);
}
.about__version-pill:hover .about__version-copy-icon {
  opacity: 0.9;
}
.about__version-check-icon {
  color: var(--accent);
}
.about__version-tip {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}

/* Slogan & Description */
.about__text-block {
  margin-bottom: 18px;
}
.about__slogan {
  margin: 0 0 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.5;
}
.about__motto {
  display: block;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--text-muted);
  margin-top: 2px;
  font-style: italic;
  letter-spacing: 0.01em;
}
.about__desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.5;
}

/* 2x2 Action Cards Grid */
.about__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 20px;
}
.about__card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
  transition: all var(--dur) var(--ease);
  position: relative;
  overflow: hidden;
}
.about__card:hover {
  border-color: var(--accent-ring);
  background: var(--bg-hover);
  transform: translateY(-1px);
  box-shadow: var(--sh-1);
}
.about__card:active {
  transform: translateY(0) scale(0.98);
}
.about__card:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.about__card-icon-wrap {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform var(--dur-fast) var(--ease);
}
.about__card:hover .about__card-icon-wrap {
  transform: scale(1.08);
}
.about__card-icon--web {
  background: rgba(2, 132, 199, 0.12);
  color: #0284c7;
}
.about__card-icon--github {
  background: rgba(217, 119, 6, 0.12);
  color: #d97706;
}
.about__card-icon--releases {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}
.about__card-icon--sponsor {
  background: rgba(244, 63, 94, 0.12);
  color: #f43f5e;
}
.about__card-content {
  flex: 1;
  min-width: 0;
}
.about__card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.about__card-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.about__card-arrow {
  color: var(--text-muted);
  opacity: 0.35;
  flex-shrink: 0;
  transition: all var(--dur-fast) var(--ease);
}
.about__card:hover .about__card-arrow {
  opacity: 1;
  color: var(--accent);
  transform: translate(1px, -1px);
}
.about__card-sub {
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

/* Footer & Tech Tags */
.about__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.about__stack-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.about__tag {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: var(--r-full);
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  letter-spacing: 0.02em;
  transition: all var(--dur-fast) var(--ease);
}
.about__tag:hover {
  border-color: var(--accent-ring);
  color: var(--text);
}
.about__copyright {
  font-size: 10.5px;
  color: var(--text-faint);
  line-height: 1.5;
}
</style>
