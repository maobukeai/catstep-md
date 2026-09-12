<script setup lang="ts">
import Icon from './Icons.vue';
import { useI18n } from '../i18n';

const { t } = useI18n();

defineProps<{
  activeTab?: string;
  isAiActive?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open-files'): void;
  (e: 'open-outline'): void;
  (e: 'open-agent'): void;
  (e: 'open-search'): void;
  (e: 'open-settings'): void;
  (e: 'new-file'): void;
}>();
</script>

<template>
  <nav class="mobile-bottom-dock" role="navigation" aria-label="Mobile Navigation Dock">
    <!-- 1. 目录 -->
    <button
      class="mobile-bottom-dock__btn"
      type="button"
      @click="emit('open-files')"
      :title="t('toolbar.fileTree')"
    >
      <Icon name="sidebar" :size="18" />
      <span class="mobile-bottom-dock__label">{{ t('toolbar.fileTree') || '目录' }}</span>
    </button>

    <!-- 2. 大纲 -->
    <button
      class="mobile-bottom-dock__btn"
      type="button"
      @click="emit('open-outline')"
      :title="t('toolbar.outline')"
    >
      <Icon name="outline" :size="18" />
      <span class="mobile-bottom-dock__label">{{ t('toolbar.outline') || '大纲' }}</span>
    </button>

    <!-- 3. 猫步 AI 居中微升按钮 -->
    <button
      class="mobile-bottom-dock__btn mobile-bottom-dock__btn--ai"
      type="button"
      @click="emit('open-agent')"
      :title="t('toolbar.aiAssistant') || '猫步 AI'"
    >
      <div class="mobile-bottom-dock__ai-circle" :class="{ 'is-active': isAiActive }">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 2L12.5 8.5L19 11L12.5 13.5L10 20L7.5 13.5L1 11L7.5 8.5L10 2Z" />
          <path d="M19 16L20.2 19L23 20L20.2 21L19 24L17.8 21L15 20L17.8 19L19 16Z" opacity="0.88" />
        </svg>
      </div>
      <span class="mobile-bottom-dock__label mobile-bottom-dock__label--ai">猫步 AI</span>
    </button>

    <!-- 4. 查找 -->
    <button
      class="mobile-bottom-dock__btn"
      type="button"
      @click="emit('open-search')"
      :title="t('find.find') || '查找'"
    >
      <Icon name="search" :size="18" />
      <span class="mobile-bottom-dock__label">{{ t('find.find') || '查找' }}</span>
    </button>

    <!-- 5. 设置 -->
    <button
      class="mobile-bottom-dock__btn"
      type="button"
      @click="emit('open-settings')"
      :title="t('settings.title') || '设置'"
    >
      <Icon name="settings" :size="18" />
      <span class="mobile-bottom-dock__label">{{ t('settings.title') || '设置' }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-bottom-dock {
  position: absolute;
  bottom: 8px;
  left: 10px;
  right: 10px;
  height: 52px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: 0 6px 20px -2px rgba(0, 0, 0, 0.14), 0 2px 6px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 0 4px;
  z-index: 45;
  user-select: none;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

[data-theme="dark"] .mobile-bottom-dock {
  background: rgba(35, 34, 31, 0.95);
  box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 165, 77, 0.16);
}

.mobile-bottom-dock__btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 10px;
  transition: color 0.15s ease, transform 0.1s ease;
  -webkit-tap-highlight-color: transparent;
}

.mobile-bottom-dock__btn:active {
  transform: scale(0.92);
  color: var(--accent);
}

.mobile-bottom-dock__label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.mobile-bottom-dock__btn--ai {
  margin-top: -14px;
  padding: 0 6px;
}

.mobile-bottom-dock__ai-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffa54d 0%, #ff8800 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(255, 136, 0, 0.38);
  border: 2px solid var(--bg-elev);
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s ease;
}

.mobile-bottom-dock__btn--ai:active .mobile-bottom-dock__ai-circle {
  transform: scale(0.92);
  box-shadow: 0 2px 6px rgba(255, 136, 0, 0.25);
}

.mobile-bottom-dock__label--ai {
  color: var(--brand-accent, #ff9f40);
  font-weight: 600;
  margin-top: 1px;
}
</style>
