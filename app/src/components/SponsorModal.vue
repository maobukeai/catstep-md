<script setup lang="ts">
import { ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DsModal } from '../ui';
import { copyPlainText } from '../lib/code-copy';
import sponsorQr from '../assets/sponsor_qr.webp';
import contactQr from '../assets/contact_qr.webp';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    initialTab?: 'sponsor' | 'contact';
  }>(),
  {
    initialTab: 'sponsor',
  },
);

const emit = defineEmits<{
  'update:modelValue': [boolean];
}>();

const activeTab = ref<'sponsor' | 'contact'>(props.initialTab);
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const links = {
  githubSponsor: 'https://github.com/sponsors/maobukeai',
  email: '2026958851@qq.com',
};

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch (e) {
    console.error('Failed to open external URL:', e);
    window.open(url, '_blank');
  }
}

async function copyEmail() {
  try {
    await copyPlainText(links.email);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (e) {
    console.error('Failed to copy email:', e);
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>

<template>
  <DsModal
    :model-value="modelValue"
    width="390px"
    :z-index="12000"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="sponsor-modal">
      <!-- Floating close button -->
      <button
        class="sponsor-modal__close"
        type="button"
        aria-label="关闭"
        title="关闭 (Esc)"
        @click="close"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Segmented Tab Header -->
      <div class="sponsor-modal__tabs">
        <button
          type="button"
          class="sponsor-modal__tab"
          :class="{ 'sponsor-modal__tab--active': activeTab === 'sponsor' }"
          @click="activeTab = 'sponsor'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <span>赞助支持</span>
        </button>
        <button
          type="button"
          class="sponsor-modal__tab"
          :class="{ 'sponsor-modal__tab--active': activeTab === 'contact' }"
          @click="activeTab = 'contact'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          <span>联系作者</span>
        </button>
      </div>

      <!-- Tab 1: 赞助支持 (WeChat Sponsor QR) -->
      <div v-if="activeTab === 'sponsor'" class="sponsor-modal__content">
        <div class="sponsor-modal__qr-wrap">
          <img
            :src="sponsorQr"
            alt="猫步可爱 赞赏码"
            class="sponsor-modal__qr-img"
          />
        </div>
        <div class="sponsor-modal__info">
          <div class="sponsor-modal__author">“新年快乐”</div>
          <div class="sponsor-modal__sub">猫步可爱 (鲤蓝) 的赞赏码 · 感谢支持！</div>
          <p class="sponsor-modal__desc">
            您的支持是 猫步 MD 持续更新与维护的最大动力 ❤️
          </p>
        </div>

        <div class="sponsor-modal__actions">
          <button
            type="button"
            class="sponsor-modal__github-btn"
            @click="openExternal(links.githubSponsor)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>通过 GitHub Sponsors 赞助</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Tab 2: 联系作者 (WeChat Friend QR) -->
      <div v-else class="sponsor-modal__content">
        <div class="sponsor-modal__qr-wrap">
          <img
            :src="contactQr"
            alt="猫步可爱 微信二维码"
            class="sponsor-modal__qr-img"
          />
        </div>
        <div class="sponsor-modal__info">
          <div class="sponsor-modal__author">猫步可爱 (鲤蓝)</div>
          <div class="sponsor-modal__sub">扫二维码，添加微信好友（备注：猫步 MD）</div>
          <p class="sponsor-modal__desc">
            欢迎反馈功能建议、Bug 或交流 Markdown 写作技巧 💬
          </p>
        </div>

        <div class="sponsor-modal__actions">
          <button
            type="button"
            class="sponsor-modal__copy-btn"
            @click="copyEmail"
          >
            <svg v-if="!copied" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>{{ copied ? '已复制作者邮箱' : `复制作者邮箱 (${links.email})` }}</span>
          </button>
        </div>
      </div>
    </div>
  </DsModal>
</template>

<style scoped>
.sponsor-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 4px 2px;
}

.sponsor-modal__close {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 26px;
  height: 26px;
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
.sponsor-modal__close:hover {
  background: var(--bg-hover);
  border-color: var(--border);
  color: var(--text);
}

.sponsor-modal__tabs {
  display: inline-flex;
  padding: 3px;
  background: var(--bg-subtle, rgba(125, 125, 125, 0.08));
  border-radius: 9px;
  gap: 4px;
  margin-bottom: 16px;
}

.sponsor-modal__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sponsor-modal__tab:hover {
  color: var(--text);
}
.sponsor-modal__tab--active {
  background: var(--bg);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  font-weight: 600;
}
.sponsor-modal__tab--active:first-child svg {
  color: #e11d48;
}
.sponsor-modal__tab--active:last-child svg {
  color: #07c160;
}

.sponsor-modal__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.sponsor-modal__qr-wrap {
  background: #ffffff;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 240px;
  height: 240px;
}

.sponsor-modal__qr-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

.sponsor-modal__info {
  margin-top: 14px;
  text-align: center;
}

.sponsor-modal__author {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.sponsor-modal__sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
}

.sponsor-modal__desc {
  font-size: 11px;
  color: var(--text-subtle);
  margin: 8px 0 0;
  line-height: 1.4;
}

.sponsor-modal__actions {
  margin-top: 16px;
  width: 100%;
  display: flex;
  justify-content: center;
}

.sponsor-modal__github-btn,
.sponsor-modal__copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--control, var(--bg-hover));
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
}
.sponsor-modal__github-btn:hover,
.sponsor-modal__copy-btn:hover {
  background: var(--bg-active);
  border-color: var(--border-strong, var(--accent));
  color: var(--accent);
}
</style>