<script setup lang="ts">
import { computed } from 'vue';
import { useTabsStore } from '../stores/tabs';
import { useSettingsStore } from '../stores/settings';
import { useAgentPanelStore } from '../stores/agentPanel';
import AgentPanel from './AgentPanel.vue';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-settings', section?: string): void;
}>();

const tabs = useTabsStore();
const settings = useSettingsStore();
const agent = useAgentPanelStore();

const docTitle = computed(() => {
  return tabs.activeTab?.fileName || '未命名文档';
});

const selectionCount = computed(() => {
  return tabs.activeEditorSelection?.text?.trim().length || 0;
});

function toggleMode() {
  settings.agentAllowWrite = !settings.agentAllowWrite;
  settings.persist();
}
</script>

<template>
  <div class="mobile-agent-view" role="dialog" aria-modal="true" aria-label="猫步智能体">
    <!-- 1. 移动端独立全屏顶栏 -->
    <header class="mobile-agent-view__header">
      <button
        class="mobile-agent-view__back-btn"
        type="button"
        @click="emit('close')"
        title="返回正文"
      >
        <span class="mobile-agent-view__back-arrow">‹</span>
        <span class="mobile-agent-view__back-text">返回正文</span>
      </button>

      <div class="mobile-agent-view__title">
        <span class="mobile-agent-view__brand-paw">🐾</span>
        <span class="mobile-agent-view__brand-text">猫步智能体</span>
        <span
          class="mobile-agent-view__status-dot"
          :class="{ 'is-streaming': agent.isStreaming }"
          :title="agent.isStreaming ? '正在思考与生成...' : '在线就绪'"
        />
      </div>

      <div class="mobile-agent-view__actions">
        <button
          class="mobile-agent-view__mode-capsule"
          :class="{ 'is-write': settings.agentAllowWrite }"
          type="button"
          @click="toggleMode"
          :title="settings.agentAllowWrite ? '智能体模式：允许自动修改文档' : '建议模式：仅输出修改建议'"
        >
          <span>{{ settings.agentAllowWrite ? '⚡ 智能体' : '🛡️ 建议' }}</span>
        </button>
      </div>
    </header>

    <!-- 2. 文档上下文提示条 -->
    <div class="mobile-agent-view__context-bar">
      <div class="mobile-agent-view__context-doc">
        <span class="mobile-agent-view__context-icon">📄</span>
        <span class="mobile-agent-view__context-name" :title="docTitle">{{ docTitle }}</span>
      </div>
      <span v-if="selectionCount > 0" class="mobile-agent-view__selection-badge">
        📌 选区 ({{ selectionCount }}字)
      </span>
    </div>

    <!-- 3. 智能体全屏主内容区 (100% 满屏宽度与深度) -->
    <main class="mobile-agent-view__body">
      <AgentPanel
        :mobile-mode="true"
        @open-settings="(sec?: string) => emit('open-settings', sec)"
        @close="emit('close')"
      />
    </main>
  </div>
</template>

<style scoped>
.mobile-agent-view {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
  animation: mobile-agent-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes mobile-agent-fade-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 顶栏 */
.mobile-agent-view__header {
  height: 44px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  flex-shrink: 0;
}

.mobile-agent-view__back-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 8px 6px 2px;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}

.mobile-agent-view__back-btn:active {
  background: var(--bg-hover);
  color: var(--text);
  transform: scale(0.97);
}

.mobile-agent-view__back-arrow {
  font-size: 18px;
  line-height: 1;
}

.mobile-agent-view__title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  font-weight: 700;
  color: #ea580c;
}

.mobile-agent-view__brand-paw {
  font-size: 14px;
}

.mobile-agent-view__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  margin-left: 2px;
  display: inline-block;
  transition: background 0.2s ease;
}

.mobile-agent-view__status-dot.is-streaming {
  background: #3b82f6;
  animation: mobile-pulse 1.2s infinite ease-in-out;
}

@keyframes mobile-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.4);
    opacity: 0.5;
  }
}

.mobile-agent-view__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mobile-agent-view__mode-capsule {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mobile-agent-view__mode-capsule.is-write {
  background: rgba(249, 115, 22, 0.12);
  border-color: rgba(249, 115, 22, 0.35);
  color: #ea580c;
}

.mobile-agent-view__mode-capsule:active {
  transform: scale(0.96);
}

/* 上下文提示条 */
.mobile-agent-view__context-bar {
  height: 28px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.mobile-agent-view__context-doc {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
}

.mobile-agent-view__context-icon {
  font-size: 12px;
}

.mobile-agent-view__context-name {
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}

.mobile-agent-view__selection-badge {
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  color: #ea580c;
  background: rgba(249, 115, 22, 0.1);
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid rgba(249, 115, 22, 0.25);
  white-space: nowrap;
}

/* 主内容容器 */
.mobile-agent-view__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mobile-agent-view__body :deep(.agent-panel) {
  border-left: none;
  width: 100%;
  height: 100%;
}
</style>
