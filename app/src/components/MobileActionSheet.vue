<script setup lang="ts">
/**
 * MobileActionSheet.vue
 *
 * Native iOS / Material 3 style bottom action sheet triggered by the `⋯` button
 * on mobile screens (<640px). Brings complete feature parity to mobile:
 * 1. Document Info & Live Statistics (Words, Characters, Lines, Reading Time)
 * 2. Quick Export Hub (Long Image, PDF, Word, HTML)
 * 3. Text & Writing Assistants (Clean AI Artifacts, CJK Proofreading, Outline)
 * 4. Help & About Quick Links
 */
import { computed } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { cjkWordCount } from '../lib/chinese';
import { useI18n } from '../i18n';
import BrandMark from './BrandMark.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'export', type: 'image' | 'pdf' | 'docx' | 'html'): void;
  (e: 'clean-ai'): void;
  (e: 'cjk-proofread'): void;
  (e: 'open-outline'): void;
  (e: 'open-help'): void;
  (e: 'open-about'): void;
  (e: 'open-settings', section?: string): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const { lang } = useI18n();

function toggleReadingMode() {
  if (settings.viewMode === 'reading') {
    settings.exitReadingMode();
  } else {
    settings.setTripleMode('reading');
  }
}

const isZh = computed(() => (lang?.value || '').startsWith('zh'));
const activeTab = computed(() => tabs.activeTab);

const stats = computed(() => {
  const content = activeTab.value?.content ?? '';
  return cjkWordCount(content);
});

const wordCount = computed(() => stats.value.total);
const charCount = computed(() => stats.value.chars);
const lineCount = computed(() => {
  const c = activeTab.value?.content ?? '';
  return c ? c.split('\n').length : 0;
});
const readingTime = computed(() => Math.max(1, Math.ceil(stats.value.total / 300)));

function handleAction(callback: () => void) {
  emit('close');
  // Defer slightly for smooth sheet dismiss animation
  setTimeout(callback, 120);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet-fade">
      <div
        v-if="open"
        class="mobile-sheet-backdrop"
        @click="emit('close')"
        aria-hidden="true"
      />
    </Transition>

    <Transition name="sheet-slide">
      <aside
        v-if="open"
        class="mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="更多操作"
      >
        <!-- Drag Handle Indicator -->
        <div class="mobile-sheet__handle-wrap">
          <div class="mobile-sheet__handle" />
        </div>

        <div class="mobile-sheet__scrollable">
          <!-- 1. Document Info & Live Statistics Card -->
          <section class="mobile-sheet__card mobile-sheet__card--docinfo">
            <div class="docinfo-header">
              <div class="docinfo-title-wrap">
                <span class="docinfo-icon">📄</span>
                <span class="docinfo-filename" :title="activeTab?.fileName || '未命名文档'">
                  {{ activeTab?.fileName || (isZh ? '未命名文档' : 'Untitled') }}
                </span>
                <span v-if="activeTab && tabs.isDirty(activeTab.id)" class="docinfo-dirty-badge" title="未保存修改">●</span>
              </div>
              <button
                type="button"
                class="docinfo-close-btn"
                @click="emit('close')"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div class="docinfo-grid">
              <div class="docinfo-stat">
                <div class="stat-value">{{ wordCount.toLocaleString() }}</div>
                <div class="stat-label">{{ isZh ? '总字数' : 'Words' }}</div>
              </div>
              <div class="docinfo-stat">
                <div class="stat-value">{{ charCount.toLocaleString() }}</div>
                <div class="stat-label">{{ isZh ? '字符数' : 'Chars' }}</div>
              </div>
              <div class="docinfo-stat">
                <div class="stat-value">{{ lineCount.toLocaleString() }}</div>
                <div class="stat-label">{{ isZh ? '行数' : 'Lines' }}</div>
              </div>
              <div class="docinfo-stat">
                <div class="stat-value">{{ readingTime }}<span class="stat-unit">{{ isZh ? '分' : 'm' }}</span></div>
                <div class="stat-label">{{ isZh ? '预计阅读' : 'Read Time' }}</div>
              </div>
            </div>
          </section>

          <!-- 2. Export Quick Grid -->
          <div class="mobile-sheet__section-title">{{ isZh ? '分享与导出' : 'Share & Export' }}</div>
          <div class="mobile-sheet__grid">
            <button
              type="button"
              class="mobile-sheet__grid-btn"
              @click="handleAction(() => emit('export', 'image'))"
            >
              <div class="grid-btn-icon grid-btn-icon--image">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <span class="grid-btn-label">{{ isZh ? '导出长图' : 'Long Image' }}</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__grid-btn"
              @click="handleAction(() => emit('export', 'pdf'))"
            >
              <div class="grid-btn-icon grid-btn-icon--pdf">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <span class="grid-btn-label">{{ isZh ? '导出 PDF' : 'PDF' }}</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__grid-btn"
              @click="handleAction(() => emit('export', 'docx'))"
            >
              <div class="grid-btn-icon grid-btn-icon--word">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="7 9 9 15 12 10 15 15 17 9" />
                </svg>
              </div>
              <span class="grid-btn-label">{{ isZh ? '导出 Word' : 'Word DOCX' }}</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__grid-btn"
              @click="handleAction(() => emit('export', 'html'))"
            >
              <div class="grid-btn-icon grid-btn-icon--html">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <span class="grid-btn-label">{{ isZh ? '导出 HTML' : 'HTML' }}</span>
            </button>
          </div>

          <!-- 3. Text & Writing Assistants (List Items) -->
          <div class="mobile-sheet__section-title">{{ isZh ? '排版与写作辅助' : 'Writing & Tools' }}</div>
          <div class="mobile-sheet__list-card">
            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(() => emit('clean-ai'))"
            >
              <div class="list-item__icon-box list-item__icon-box--clean">
                🧹
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ isZh ? '去 AI 味 / 清理 AI 痕迹' : 'Clean AI Artifacts' }}</div>
                <div class="list-item__desc">{{ isZh ? '智能清除 AI 对话客套话、残留 Markdown 围栏等' : 'Remove conversational clutter' }}</div>
              </div>
              <span class="list-item__arrow">›</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(() => emit('cjk-proofread'))"
            >
              <div class="list-item__icon-box list-item__icon-box--cjk">
                ✍️
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ isZh ? '中英文标点与排版规范化' : 'CJK Typographic Proofread' }}</div>
                <div class="list-item__desc">{{ isZh ? '自动纠正全半角标点、中英盘古空格等' : 'Fix punctuation & spacing' }}</div>
              </div>
              <span class="list-item__arrow">›</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(() => emit('open-outline'))"
            >
              <div class="list-item__icon-box list-item__icon-box--outline">
                📑
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ isZh ? '文档结构与大纲目录' : 'Table of Contents' }}</div>
                <div class="list-item__desc">{{ isZh ? '快速浏览各级标题并定位跳转' : 'Jump to headings' }}</div>
              </div>
              <span class="list-item__arrow">›</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(toggleReadingMode)"
            >
              <div class="list-item__icon-box list-item__icon-box--reading">
                📖
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ settings.viewMode === 'reading' ? (isZh ? '退出阅读模式 (返回实时编辑)' : 'Exit Reading Mode') : (isZh ? '沉浸阅读模式' : 'Zen Reading Mode') }}</div>
                <div class="list-item__desc">{{ settings.viewMode === 'reading' ? (isZh ? '返回可编辑输入模式' : 'Return to editor') : (isZh ? '无干扰全屏排版与纯净阅读' : 'Clean distraction-free typography') }}</div>
              </div>
              <span class="list-item__arrow">{{ settings.viewMode === 'reading' ? '✓' : '›' }}</span>
            </button>
          </div>

          <!-- 4. Help & About -->
          <div class="mobile-sheet__section-title">{{ isZh ? '指南与关于' : 'Help & About' }}</div>
          <div class="mobile-sheet__list-card">
            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(() => emit('open-help'))"
            >
              <div class="list-item__icon-box list-item__icon-box--help">
                ❓
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ isZh ? 'Markdown 语法速查手册' : 'Markdown Cheat Sheet' }}</div>
              </div>
              <span class="list-item__arrow">›</span>
            </button>

            <button
              type="button"
              class="mobile-sheet__list-item"
              @click="handleAction(() => emit('open-about'))"
            >
              <div class="list-item__icon-box list-item__icon-box--about">
                <BrandMark :size="18" />
              </div>
              <div class="list-item__info">
                <div class="list-item__name">{{ isZh ? '关于 猫步 MD (Catstep MD)' : 'About Catstep MD' }}</div>
              </div>
              <span class="list-item__arrow">›</span>
            </button>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9998;
}

.mobile-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  border-top: 1px solid var(--border);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.22);
  z-index: 9999;
  user-select: none;
  box-sizing: border-box;
}

.mobile-sheet__handle-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 22px;
  flex-shrink: 0;
  cursor: pointer;
}

.mobile-sheet__handle {
  width: 38px;
  height: 4.5px;
  border-radius: 3px;
  background: var(--border, rgba(125, 125, 125, 0.35));
}

.mobile-sheet__scrollable {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 14px calc(24px + env(safe-area-inset-bottom, 20px)) 14px;
}

/* 1. Document Info Card */
.mobile-sheet__card--docinfo {
  background: color-mix(in srgb, var(--accent, #ea580c) 8%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--accent, #ea580c) 25%, var(--border));
  border-radius: 16px;
  padding: 12px 14px;
  margin-bottom: 14px;
}

.docinfo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.docinfo-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.docinfo-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.docinfo-filename {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.docinfo-dirty-badge {
  color: var(--accent, #ea580c);
  font-size: 9px;
  flex-shrink: 0;
}

.docinfo-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 26px;
  height: 26px;
  border-radius: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
}

.docinfo-close-btn:active {
  background: var(--bg-hover);
}

.docinfo-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  background: var(--bg-elev);
  border-radius: 12px;
  padding: 10px 4px;
  border: 1px solid var(--border);
}

.docinfo-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.stat-value {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono, monospace);
  line-height: 1.2;
}

.stat-unit {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 2px;
}

.stat-label {
  font-size: 10.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Section Titles */
.mobile-sheet__section-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.03em;
  margin: 12px 0 6px 6px;
}

/* 2. Export Grid */
.mobile-sheet__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.mobile-sheet__grid-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px 4px;
  cursor: pointer;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.mobile-sheet__grid-btn:active {
  transform: scale(0.95);
  background: var(--bg-hover);
}

.grid-btn-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.grid-btn-icon--image {
  background: rgba(234, 88, 12, 0.12);
  color: #ea580c;
}

.grid-btn-icon--pdf {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.grid-btn-icon--word {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.grid-btn-icon--html {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.grid-btn-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}

/* 3. List Cards */
.mobile-sheet__list-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 12px;
}

.mobile-sheet__list-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 11px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease;
}

.mobile-sheet__list-item:last-child {
  border-bottom: none;
}

.mobile-sheet__list-item:active {
  background: var(--bg-hover);
}

.list-item__icon-box {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  margin-right: 12px;
  flex-shrink: 0;
}

.list-item__icon-box--clean {
  background: rgba(245, 158, 11, 0.12);
}

.list-item__icon-box--cjk {
  background: rgba(14, 165, 233, 0.12);
}

.list-item__icon-box--outline {
  background: rgba(139, 92, 246, 0.12);
}

.list-item__icon-box--reading {
  background: rgba(16, 185, 129, 0.12);
}

.list-item__icon-box--help {
  background: rgba(107, 114, 128, 0.12);
}

.list-item__icon-box--about {
  background: rgba(234, 88, 12, 0.12);
}

.list-item__info {
  flex: 1;
  min-width: 0;
}

.list-item__name {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.25;
}

.list-item__desc {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item__arrow {
  color: var(--text-faint);
  font-size: 16px;
  margin-left: 8px;
  flex-shrink: 0;
}

/* Animations */
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 0.22s ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}

.sheet-slide-enter-active {
  transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.sheet-slide-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.sheet-slide-enter-from,
.sheet-slide-leave-to {
  transform: translateY(100%);
}
</style>
