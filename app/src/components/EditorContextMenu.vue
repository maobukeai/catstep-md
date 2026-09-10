<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from '../i18n';

export interface EditorContextInfo {
  hasSelection: boolean;
  selectedText: string;
  isTable: boolean;
  tableInfo?: {
    canDeleteRow: boolean;
    canDeleteCol: boolean;
    align: 'left' | 'center' | 'right' | null;
  };
  linkInfo?: {
    url: string;
    text: string;
  };
  imageInfo?: {
    src: string;
    alt: string;
  };
  mathInfo?: {
    latex: string;
    display: boolean;
  };
  isCodeBlock: boolean;
  codeText?: string;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  contextInfo: EditorContextInfo;
}>();

const emit = defineEmits<{
  (e: 'action', act: string, payload?: any): void;
  (e: 'close'): void;
}>();

const { t } = useI18n();

const rootRef = ref<HTMLElement | null>(null);
const activeSubmenu = ref<string | null>(null);
let submenuTimer: number | null = null;

// Track submenu positioning (flip left/right or up/down)
const submenuDirections = ref<Record<string, { flipX: boolean; flipY: boolean }>>({});

function openSubmenu(name: string, event?: MouseEvent) {
  if (submenuTimer) {
    clearTimeout(submenuTimer);
    submenuTimer = null;
  }
  activeSubmenu.value = name;

  // Calculate submenu flip based on trigger element
  if (event?.currentTarget) {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const estWidth = 212;
    const estHeight = 320;
    const flipX = rect.right + estWidth > window.innerWidth;
    const flipY = rect.top + estHeight > window.innerHeight;
    submenuDirections.value[name] = { flipX, flipY };
  }
}

function scheduleCloseSubmenu() {
  if (submenuTimer) clearTimeout(submenuTimer);
  submenuTimer = window.setTimeout(() => {
    activeSubmenu.value = null;
  }, 140);
}

function cancelCloseSubmenu() {
  if (submenuTimer) {
    clearTimeout(submenuTimer);
    submenuTimer = null;
  }
}

function dispatch(act: string, payload?: any) {
  activeSubmenu.value = null;
  emit('close');
  emit('action', act, payload);
}

// Global click outside / keydown dismiss & keyboard navigation
function onDocDismiss(e: Event) {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.editor-ctx-menu')) {
    emit('close');
  }
}

function onMenuContainerClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target === rootRef.value || target.classList.contains('ctx-sep') || target.closest('.ctx-item--disabled')) {
    emit('close');
  }
}

function toggleSubmenu(name: string, event?: MouseEvent) {
  if (activeSubmenu.value === name) {
    return;
  }
  openSubmenu(name, event);
}

function clearKeyboardFocus() {
  if (!rootRef.value) return;
  rootRef.value.querySelectorAll('.ctx-item--focused').forEach((el) => el.classList.remove('ctx-item--focused'));
}

function onDocMouseMove() {
  clearKeyboardFocus();
}

function onDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (activeSubmenu.value) {
      e.preventDefault();
      activeSubmenu.value = null;
    } else {
      emit('close');
    }
    return;
  }
  if (!props.visible) return;

  // Arrow keys navigation and Enter confirmation
  if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(e.key)) {
    const container = activeSubmenu.value
      ? (rootRef.value?.querySelector('.ctx-submenu') as HTMLElement | null)
      : rootRef.value;
    if (!container) return;

    const items = Array.from(container.querySelectorAll(':scope > .ctx-item:not(.ctx-item--disabled)')) as HTMLElement[];
    if (!items.length) return;

    let currentFocused = items.findIndex((el) => el.classList.contains('ctx-item--focused'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = currentFocused < items.length - 1 ? currentFocused + 1 : 0;
      items.forEach((el, idx) => el.classList.toggle('ctx-item--focused', idx === next));
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = currentFocused > 0 ? currentFocused - 1 : items.length - 1;
      items.forEach((el, idx) => el.classList.toggle('ctx-item--focused', idx === prev));
      items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowRight') {
      if (currentFocused >= 0 && items[currentFocused]?.classList.contains('ctx-item--has-sub')) {
        e.preventDefault();
        items[currentFocused].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        nextTick(() => {
          const sub = rootRef.value?.querySelector('.ctx-submenu') as HTMLElement | null;
          if (sub) {
            const subItems = Array.from(sub.querySelectorAll(':scope > .ctx-item:not(.ctx-item--disabled)')) as HTMLElement[];
            if (subItems[0]) {
              subItems.forEach((el, idx) => el.classList.toggle('ctx-item--focused', idx === 0));
            }
          }
        });
      }
    } else if (e.key === 'ArrowLeft') {
      if (activeSubmenu.value) {
        e.preventDefault();
        activeSubmenu.value = null;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 1. If an item is focused via keyboard
      if (currentFocused >= 0 && items[currentFocused]) {
        items[currentFocused].click();
        return;
      }
      // 2. If an item is hovered via mouse
      const hovered = container.querySelector(':scope > .ctx-item:hover:not(.ctx-item--disabled)') as HTMLElement | null;
      if (hovered) {
        hovered.click();
        return;
      }
      // 3. If in a submenu, execute the first actionable item
      if (activeSubmenu.value && items[0]) {
        items[0].click();
        return;
      }
      // 4. Default dismiss
      emit('close');
    }
  }
}

function onDocScroll() {
  emit('close');
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocDismiss, true);
  document.addEventListener('mousedown', onDocDismiss, true);
  window.addEventListener('keydown', onDocKeyDown, true);
  window.addEventListener('scroll', onDocScroll, true);
  window.addEventListener('blur', onDocScroll);
  window.addEventListener('resize', onDocScroll);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDismiss, true);
  document.removeEventListener('mousedown', onDocDismiss, true);
  window.removeEventListener('keydown', onDocKeyDown, true);
  window.removeEventListener('scroll', onDocScroll, true);
  window.removeEventListener('blur', onDocScroll);
  window.removeEventListener('resize', onDocScroll);
  if (submenuTimer) clearTimeout(submenuTimer);
});

// Viewport-aware clamped positioning of the main menu
const menuStyle = computed(() => {
  const menuWidth = 218;
  const menuHeight = 490;
  let posX = props.x;
  let posY = props.y;

  if (posX + menuWidth > window.innerWidth - 12) {
    posX = Math.max(12, posX - menuWidth);
  }
  if (posY + menuHeight > window.innerHeight - 12) {
    posY = Math.max(12, window.innerHeight - menuHeight - 12);
  }
  return {
    top: `${Math.round(posY)}px`,
    left: `${Math.round(posX)}px`,
  };
});

function getSubmenuStyle(name: string) {
  const dir = submenuDirections.value[name];
  if (!dir) return {};
  const style: Record<string, string> = {};
  if (dir.flipX) {
    style.right = '100%';
    style.left = 'auto';
    style.marginRight = '2px';
  } else {
    style.left = '100%';
    style.right = 'auto';
    style.marginLeft = '2px';
  }
  if (dir.flipY) {
    style.bottom = '-4px';
    style.top = 'auto';
  } else {
    style.top = '-4px';
    style.bottom = 'auto';
  }
  return style;
}
</script>

<template>
  <Teleport to="body">
    <!-- Transparent backdrop for 100% reliable click-outside dismiss -->
    <div
      v-if="visible"
      class="editor-ctx-backdrop"
      @mousedown.stop="emit('close')"
      @pointerdown.stop="emit('close')"
      @contextmenu.stop.prevent="emit('close')"
    />
    <Transition name="ctx-fade">
      <div
        v-if="visible"
        ref="rootRef"
        class="editor-ctx-menu"
        :style="menuStyle"
        role="menu"
        tabindex="-1"
        @contextmenu.prevent
        @click="onMenuContainerClick"
        @mousemove="onDocMouseMove"
      >
        <!-- ── 1. Basic Clipboard Actions (Clean Minimalist) ── -->
        <div
          class="ctx-item"
          :class="{ 'ctx-item--disabled': !contextInfo.hasSelection }"
          @click="contextInfo.hasSelection && dispatch('cut')"
        >
          <span class="ctx-item__label">{{ t('editorCtx.cut') || '剪切' }}</span>
          <span class="ctx-item__kbd">Ctrl+X</span>
        </div>

        <div
          class="ctx-item"
          :class="{ 'ctx-item--disabled': !contextInfo.hasSelection }"
          @click="contextInfo.hasSelection && dispatch('copy')"
        >
          <span class="ctx-item__label">{{ t('editorCtx.copy') || '复制' }}</span>
          <span class="ctx-item__kbd">Ctrl+C</span>
        </div>

        <!-- Copy As Submenu -->
        <div
          class="ctx-item ctx-item--has-sub"
          :class="{ 'ctx-item--disabled': !contextInfo.hasSelection, 'ctx-item--active': activeSubmenu === 'copyAs' }"
          @click.stop="contextInfo.hasSelection && toggleSubmenu('copyAs', $event)"
          @mouseenter="contextInfo.hasSelection && openSubmenu('copyAs', $event)"
          @mouseleave="scheduleCloseSubmenu"
        >
          <span class="ctx-item__label">{{ t('editorCtx.copyAs') || '复制为' }}</span>
          <span class="ctx-item__arrow">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
              <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <!-- Submenu: Copy As -->
          <div
            v-if="activeSubmenu === 'copyAs' && contextInfo.hasSelection"
            class="ctx-submenu"
            :style="getSubmenuStyle('copyAs')"
            :data-flip-x="submenuDirections['copyAs']?.flipX"
            @mouseenter="cancelCloseSubmenu"
            @mouseleave="scheduleCloseSubmenu"
          >
            <div class="ctx-item" @click="dispatch('copyAsMarkdown')">
              <span class="ctx-item__label">{{ t('editorCtx.copyAsMarkdown') || '复制为 Markdown' }}</span>
            </div>
            <div class="ctx-item" @click="dispatch('copyAsHtml')">
              <span class="ctx-item__label">{{ t('editorCtx.copyAsHtml') || '复制为 HTML 代码' }}</span>
            </div>
            <div class="ctx-item" @click="dispatch('copyAsPlainText')">
              <span class="ctx-item__label">{{ t('editorCtx.copyAsPlainText') || '复制为纯文本' }}</span>
            </div>
          </div>
        </div>

        <div class="ctx-item" @click="dispatch('paste')">
          <span class="ctx-item__label">{{ t('editorCtx.paste') || '粘贴' }}</span>
          <span class="ctx-item__kbd">Ctrl+V</span>
        </div>

        <div class="ctx-item" @click="dispatch('pasteAsPlainText')">
          <span class="ctx-item__label">{{ t('editorCtx.pasteAsPlainText') || '粘贴为纯文本' }}</span>
          <span class="ctx-item__kbd">Ctrl+Shift+V</span>
        </div>

        <!-- ── 2. Smart Context-Aware Section ────────────────── -->
        <!-- Case A: Inside Table -->
        <template v-if="contextInfo.isTable">
          <div class="ctx-sep"></div>
          <div
            class="ctx-item ctx-item--has-sub"
            :class="{ 'ctx-item--active': activeSubmenu === 'table' }"
            @click.stop="toggleSubmenu('table', $event)"
            @mouseenter="openSubmenu('table', $event)"
            @mouseleave="scheduleCloseSubmenu"
          >
            <span class="ctx-item__label">{{ t('editorCtx.table') || '表格' }}</span>
            <span class="ctx-item__arrow">
              <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
                <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>

            <!-- Submenu: Table Operations -->
            <div
              v-if="activeSubmenu === 'table'"
              class="ctx-submenu"
              :style="getSubmenuStyle('table')"
              :data-flip-x="submenuDirections['table']?.flipX"
              @mouseenter="cancelCloseSubmenu"
              @mouseleave="scheduleCloseSubmenu"
            >
              <div class="ctx-item" @click="dispatch('tableAction', 'insertRowAbove')">
                <span class="ctx-item__label">{{ t('editorCtx.insertRowAbove') || '在上方插入行' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('tableAction', 'insertRowBelow')">
                <span class="ctx-item__label">{{ t('editorCtx.insertRowBelow') || '在下方插入行' }}</span>
              </div>
              <div
                class="ctx-item"
                :class="{ 'ctx-item--disabled': contextInfo.tableInfo && !contextInfo.tableInfo.canDeleteRow }"
                @click="dispatch('tableAction', 'deleteRow')"
              >
                <span class="ctx-item__label">{{ t('editorCtx.deleteRow') || '删除当前行' }}</span>
              </div>
              <div class="ctx-sep"></div>
              <div class="ctx-item" @click="dispatch('tableAction', 'insertColLeft')">
                <span class="ctx-item__label">{{ t('editorCtx.insertColLeft') || '在左侧插入列' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('tableAction', 'insertColRight')">
                <span class="ctx-item__label">{{ t('editorCtx.insertColRight') || '在右侧插入列' }}</span>
              </div>
              <div
                class="ctx-item"
                :class="{ 'ctx-item--disabled': contextInfo.tableInfo && !contextInfo.tableInfo.canDeleteCol }"
                @click="dispatch('tableAction', 'deleteCol')"
              >
                <span class="ctx-item__label">{{ t('editorCtx.deleteCol') || '删除当前列' }}</span>
              </div>
              <div class="ctx-sep"></div>
              <div class="ctx-item" @click="dispatch('tableAction', 'alignLeft')">
                <span class="ctx-item__label">{{ t('editorCtx.alignLeft') || '左对齐' }}</span>
                <span v-if="contextInfo.tableInfo?.align === 'left'" class="ctx-item__check">
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path d="M2 6.5L4.5 9L10 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </div>
              <div class="ctx-item" @click="dispatch('tableAction', 'alignCenter')">
                <span class="ctx-item__label">{{ t('editorCtx.alignCenter') || '居中对齐' }}</span>
                <span v-if="contextInfo.tableInfo?.align === 'center'" class="ctx-item__check">
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path d="M2 6.5L4.5 9L10 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </div>
              <div class="ctx-item" @click="dispatch('tableAction', 'alignRight')">
                <span class="ctx-item__label">{{ t('editorCtx.alignRight') || '右对齐' }}</span>
                <span v-if="contextInfo.tableInfo?.align === 'right'" class="ctx-item__check">
                  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                    <path d="M2 6.5L4.5 9L10 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
              </div>
              <div class="ctx-sep"></div>
              <div class="ctx-item" @click="dispatch('tableAction', 'openTableEditor')">
                <span class="ctx-item__label">{{ t('editorCtx.openTableEditor') || '打开表格网格编辑器' }}</span>
              </div>
              <div class="ctx-item ctx-item--danger" @click="dispatch('tableAction', 'deleteTable')">
                <span class="ctx-item__label">{{ t('editorCtx.deleteTable') || '删除整个表格' }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Case B: Link -->
        <template v-if="contextInfo.linkInfo">
          <div class="ctx-sep"></div>
          <div class="ctx-item" @click="dispatch('linkAction', 'openLink')">
            <span class="ctx-item__label">{{ t('editorCtx.openLink') || '打开链接' }}</span>
          </div>
          <div class="ctx-item" @click="dispatch('linkAction', 'copyLinkAddress')">
            <span class="ctx-item__label">{{ t('editorCtx.copyLinkAddress') || '复制链接地址' }}</span>
          </div>
          <div class="ctx-item" @click="dispatch('linkAction', 'editLink')">
            <span class="ctx-item__label">{{ t('editorCtx.editLink') || '编辑链接' }}</span>
          </div>
        </template>

        <!-- Case C: Image -->
        <template v-if="contextInfo.imageInfo">
          <div class="ctx-sep"></div>
          <div class="ctx-item" @click="dispatch('imageAction', 'copyImagePath')">
            <span class="ctx-item__label">{{ t('editorCtx.copyImagePath') || '复制图片路径' }}</span>
          </div>
        </template>

        <!-- Case D: Math Block / Inline Math -->
        <template v-if="contextInfo.mathInfo">
          <div class="ctx-sep"></div>
          <div class="ctx-item" @click="dispatch('mathAction', 'copyLatex')">
            <span class="ctx-item__label">{{ t('editorCtx.copyLatex') || '复制 LaTeX 源码' }}</span>
          </div>
          <div class="ctx-item" @click="dispatch('mathAction', 'editFormula')">
            <span class="ctx-item__label">{{ t('editorCtx.editFormula') || '在公式编辑器中编辑' }}</span>
          </div>
        </template>

        <!-- Case E: Code Block -->
        <template v-if="contextInfo.isCodeBlock">
          <div class="ctx-sep"></div>
          <div class="ctx-item" @click="dispatch('codeAction', 'copyCode')">
            <span class="ctx-item__label">{{ t('editorCtx.copyCodeContent') || '复制代码块内容' }}</span>
          </div>
        </template>

        <!-- Case F: Selected Text (Catstep AI + Case transformation) -->
        <template v-if="contextInfo.hasSelection">
          <div class="ctx-sep"></div>
          <!-- AI Writing Assistant -->
          <div
            class="ctx-item ctx-item--has-sub"
            :class="{ 'ctx-item--active': activeSubmenu === 'ai' }"
            @click.stop="toggleSubmenu('ai', $event)"
            @mouseenter="openSubmenu('ai', $event)"
            @mouseleave="scheduleCloseSubmenu"
          >
            <span class="ctx-item__label">{{ t('editorCtx.aiAssistant') || 'AI 智能写作助手' }}</span>
            <span class="ctx-item__arrow">
              <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
                <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>

            <div
              v-if="activeSubmenu === 'ai'"
              class="ctx-submenu"
              :style="getSubmenuStyle('ai')"
              :data-flip-x="submenuDirections['ai']?.flipX"
              @mouseenter="cancelCloseSubmenu"
              @mouseleave="scheduleCloseSubmenu"
            >
              <div class="ctx-item" @click="dispatch('aiAction', 'catstepPolish')">
                <span class="ctx-item__label">{{ t('editorCtx.aiPolish') || '润色文风' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('aiAction', 'catstepExpand')">
                <span class="ctx-item__label">{{ t('editorCtx.aiExpand') || '扩写展开' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('aiAction', 'catstepFix')">
                <span class="ctx-item__label">{{ t('editorCtx.aiFix') || '修复语病与错别字' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('aiAction', 'catstepDeAI')">
                <span class="ctx-item__label">{{ t('editorCtx.aiDeAI') || '去除 AI 味 (口语化)' }}</span>
              </div>
            </div>
          </div>

          <!-- Transform Case -->
          <div
            class="ctx-item ctx-item--has-sub"
            :class="{ 'ctx-item--active': activeSubmenu === 'case' }"
            @click.stop="toggleSubmenu('case', $event)"
            @mouseenter="openSubmenu('case', $event)"
            @mouseleave="scheduleCloseSubmenu"
          >
            <span class="ctx-item__label">{{ t('editorCtx.transformCase') || '英文大小写转换' }}</span>
            <span class="ctx-item__arrow">
              <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
                <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>

            <div
              v-if="activeSubmenu === 'case'"
              class="ctx-submenu"
              :style="getSubmenuStyle('case')"
              :data-flip-x="submenuDirections['case']?.flipX"
              @mouseenter="cancelCloseSubmenu"
              @mouseleave="scheduleCloseSubmenu"
            >
              <div class="ctx-item" @click="dispatch('caseAction', 'uppercase')">
                <span class="ctx-item__label">{{ t('editorCtx.uppercase') || '全部大写 (UPPERCASE)' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('caseAction', 'lowercase')">
                <span class="ctx-item__label">{{ t('editorCtx.lowercase') || '全部小写 (lowercase)' }}</span>
              </div>
              <div class="ctx-item" @click="dispatch('caseAction', 'titleCase')">
                <span class="ctx-item__label">{{ t('editorCtx.titleCase') || '首字母大写 (Title Case)' }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- ── 3. Insert / Format / Paragraph Submenus ────────── -->
        <div class="ctx-sep"></div>

        <!-- Insert Submenu -->
        <div
          class="ctx-item ctx-item--has-sub"
          :class="{ 'ctx-item--active': activeSubmenu === 'insert' }"
          @click.stop="toggleSubmenu('insert', $event)"
          @mouseenter="openSubmenu('insert', $event)"
          @mouseleave="scheduleCloseSubmenu"
        >
          <span class="ctx-item__label">{{ t('editorCtx.insert') || '插入' }}</span>
          <span class="ctx-item__arrow">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
              <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <div
            v-if="activeSubmenu === 'insert'"
            class="ctx-submenu"
            :style="getSubmenuStyle('insert')"
            :data-flip-x="submenuDirections['insert']?.flipX"
            @mouseenter="cancelCloseSubmenu"
            @mouseleave="scheduleCloseSubmenu"
          >
            <div class="ctx-item" @click="dispatch('insertAction', 'table')">
              <span class="ctx-item__label">{{ t('editorCtx.insertTable') || '表格' }}</span>
              <span class="ctx-item__kbd">Ctrl+T</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'codeBlock')">
              <span class="ctx-item__label">{{ t('editorCtx.insertCodeBlock') || '代码块' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+K</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'mathBlock')">
              <span class="ctx-item__label">{{ t('editorCtx.insertMathBlock') || '公式块' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+M</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'quote')">
              <span class="ctx-item__label">{{ t('editorCtx.insertQuote') || '引用区块' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+Q</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'link')">
              <span class="ctx-item__label">{{ t('editorCtx.insertLink') || '超链接' }}</span>
              <span class="ctx-item__kbd">Ctrl+K</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'image')">
              <span class="ctx-item__label">{{ t('editorCtx.insertImage') || '图片' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+I</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'hr')">
              <span class="ctx-item__label">{{ t('editorCtx.insertHorizontalLine') || '水平分割线' }}</span>
              <span class="ctx-item__kbd">---</span>
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" @click="dispatch('insertAction', 'bulletList')">
              <span class="ctx-item__label">{{ t('editorCtx.insertBulletList') || '无序列表' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+]</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'numberedList')">
              <span class="ctx-item__label">{{ t('editorCtx.insertNumberedList') || '有序列表' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+[</span>
            </div>
            <div class="ctx-item" @click="dispatch('insertAction', 'taskList')">
              <span class="ctx-item__label">{{ t('editorCtx.insertTaskList') || '任务列表' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+X</span>
            </div>
          </div>
        </div>

        <!-- Format Submenu -->
        <div
          class="ctx-item ctx-item--has-sub"
          :class="{ 'ctx-item--active': activeSubmenu === 'format' }"
          @click.stop="toggleSubmenu('format', $event)"
          @mouseenter="openSubmenu('format', $event)"
          @mouseleave="scheduleCloseSubmenu"
        >
          <span class="ctx-item__label">{{ t('editorCtx.format') || '格式' }}</span>
          <span class="ctx-item__arrow">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
              <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <div
            v-if="activeSubmenu === 'format'"
            class="ctx-submenu"
            :style="getSubmenuStyle('format')"
            :data-flip-x="submenuDirections['format']?.flipX"
            @mouseenter="cancelCloseSubmenu"
            @mouseleave="scheduleCloseSubmenu"
          >
            <div class="ctx-item" @click="dispatch('formatAction', 'bold')">
              <span class="ctx-item__label"><b>{{ t('editorCtx.bold') || '加粗' }}</b></span>
              <span class="ctx-item__kbd">Ctrl+B</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'italic')">
              <span class="ctx-item__label"><i>{{ t('editorCtx.italic') || '斜体' }}</i></span>
              <span class="ctx-item__kbd">Ctrl+I</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'underline')">
              <span class="ctx-item__label"><u>{{ t('editorCtx.underline') || '下划线' }}</u></span>
              <span class="ctx-item__kbd">Ctrl+U</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'strikethrough')">
              <span class="ctx-item__label"><s>{{ t('editorCtx.strikethrough') || '删除线' }}</s></span>
              <span class="ctx-item__kbd">Alt+Shift+5</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'inlineCode')">
              <span class="ctx-item__label"><code>{{ t('editorCtx.inlineCode') || '行内代码' }}</code></span>
              <span class="ctx-item__kbd">Ctrl+Shift+`</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'inlineMath')">
              <span class="ctx-item__label">{{ t('editorCtx.inlineMath') || '行内公式' }}</span>
              <span class="ctx-item__kbd">Ctrl+Shift+E</span>
            </div>
            <div class="ctx-item" @click="dispatch('formatAction', 'highlight')">
              <span class="ctx-item__label">{{ t('editorCtx.highlight') || '高亮文本' }}</span>
              <span class="ctx-item__kbd">==</span>
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" @click="dispatch('formatAction', 'clearFormat')">
              <span class="ctx-item__label">{{ t('editorCtx.clearFormat') || '清除格式' }}</span>
              <span class="ctx-item__kbd">Ctrl+\</span>
            </div>
          </div>
        </div>

        <!-- Paragraph Submenu -->
        <div
          class="ctx-item ctx-item--has-sub"
          :class="{ 'ctx-item--active': activeSubmenu === 'paragraph' }"
          @click.stop="toggleSubmenu('paragraph', $event)"
          @mouseenter="openSubmenu('paragraph', $event)"
          @mouseleave="scheduleCloseSubmenu"
        >
          <span class="ctx-item__label">{{ t('editorCtx.paragraph') || '段落' }}</span>
          <span class="ctx-item__arrow">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
              <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <div
            v-if="activeSubmenu === 'paragraph'"
            class="ctx-submenu"
            :style="getSubmenuStyle('paragraph')"
            :data-flip-x="submenuDirections['paragraph']?.flipX"
            @mouseenter="cancelCloseSubmenu"
            @mouseleave="scheduleCloseSubmenu"
          >
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h1')">
              <span class="ctx-item__label">{{ t('editorCtx.heading1') || '一级标题 (H1)' }}</span>
              <span class="ctx-item__kbd">Ctrl+1</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h2')">
              <span class="ctx-item__label">{{ t('editorCtx.heading2') || '二级标题 (H2)' }}</span>
              <span class="ctx-item__kbd">Ctrl+2</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h3')">
              <span class="ctx-item__label">{{ t('editorCtx.heading3') || '三级标题 (H3)' }}</span>
              <span class="ctx-item__kbd">Ctrl+3</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h4')">
              <span class="ctx-item__label">{{ t('editorCtx.heading4') || '四级标题 (H4)' }}</span>
              <span class="ctx-item__kbd">Ctrl+4</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h5')">
              <span class="ctx-item__label">{{ t('editorCtx.heading5') || '五级标题 (H5)' }}</span>
              <span class="ctx-item__kbd">Ctrl+5</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'h6')">
              <span class="ctx-item__label">{{ t('editorCtx.heading6') || '六级标题 (H6)' }}</span>
              <span class="ctx-item__kbd">Ctrl+6</span>
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'paragraph')">
              <span class="ctx-item__label">{{ t('editorCtx.normalParagraph') || '普通段落' }}</span>
              <span class="ctx-item__kbd">Ctrl+0</span>
            </div>
            <div class="ctx-sep"></div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'headingUp')">
              <span class="ctx-item__label">{{ t('editorCtx.promoteHeading') || '提升标题级别' }}</span>
              <span class="ctx-item__kbd">Alt+Shift+←</span>
            </div>
            <div class="ctx-item" @click="dispatch('paragraphAction', 'headingDown')">
              <span class="ctx-item__label">{{ t('editorCtx.demoteHeading') || '降低标题级别' }}</span>
              <span class="ctx-item__kbd">Alt+Shift+→</span>
            </div>
          </div>
        </div>

        <!-- ── 4. Select & Find (Typora Standard) ─────────────── -->
        <div class="ctx-sep"></div>

        <!-- Select Submenu -->
        <div
          class="ctx-item ctx-item--has-sub"
          :class="{ 'ctx-item--active': activeSubmenu === 'select' }"
          @click.stop="toggleSubmenu('select', $event)"
          @mouseenter="openSubmenu('select', $event)"
          @mouseleave="scheduleCloseSubmenu"
        >
          <span class="ctx-item__label">{{ t('editorCtx.select') || '选择' }}</span>
          <span class="ctx-item__arrow">
            <svg viewBox="0 0 6 10" width="6" height="10" aria-hidden="true">
              <path d="M1 1.5L4.5 5L1 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <div
            v-if="activeSubmenu === 'select'"
            class="ctx-submenu"
            :style="getSubmenuStyle('select')"
            :data-flip-x="submenuDirections['select']?.flipX"
            @mouseenter="cancelCloseSubmenu"
            @mouseleave="scheduleCloseSubmenu"
          >
            <div class="ctx-item" @click="dispatch('selectAction', 'word')">
              <span class="ctx-item__label">{{ t('editorCtx.selectWord') || '选择当前词' }}</span>
            </div>
            <div class="ctx-item" @click="dispatch('selectAction', 'line')">
              <span class="ctx-item__label">{{ t('editorCtx.selectLine') || '选择当前行' }}</span>
            </div>
            <div class="ctx-item" @click="dispatch('selectAction', 'paragraph')">
              <span class="ctx-item__label">{{ t('editorCtx.selectParagraph') || '选择当前段落' }}</span>
            </div>
          </div>
        </div>

        <div class="ctx-item" @click="dispatch('selectAll')">
          <span class="ctx-item__label">{{ t('editorCtx.selectAll') || '全选' }}</span>
          <span class="ctx-item__kbd">Ctrl+A</span>
        </div>

        <div class="ctx-sep"></div>

        <div class="ctx-item" @click="dispatch('find')">
          <span class="ctx-item__label">{{ t('editorCtx.findAndReplace') || '查找和替换...' }}</span>
          <span class="ctx-item__kbd">Ctrl+F</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.editor-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: transparent;
  pointer-events: auto;
}

.editor-ctx-menu,
.ctx-submenu {
  position: fixed;
  z-index: 9999;
  width: 218px;
  background: rgba(255, 255, 255, 0.90);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 9px;
  padding: 4px;
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.13),
    0 3px 8px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.7);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 12.5px;
  user-select: none;
  outline: none;
}

.ctx-submenu {
  position: absolute;
  z-index: 10000;
  width: 208px;
}

/* Mouse Safe-Path Bridge for Submenus: prevents cursor from dropping hover */
.ctx-submenu::before {
  content: '';
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 14px;
  left: -10px;
  pointer-events: auto;
}
.ctx-submenu[data-flip-x='true']::before {
  left: auto;
  right: -10px;
}

/* Dark Mode Appearance */
:root[data-theme="dark"] .editor-ctx-menu,
:root[data-theme="dark"] .ctx-submenu,
body.dark .editor-ctx-menu,
body.dark .ctx-submenu {
  background: rgba(30, 29, 27, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow:
    0 20px 42px rgba(0, 0, 0, 0.5),
    0 4px 12px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.ctx-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 27px;
  padding: 4.5px 9px;
  border-radius: 6px;
  color: var(--text, #262626);
  cursor: pointer;
  line-height: 1.35;
  font-weight: 450;
  transition: background-color 0.06s ease, color 0.06s ease;
}

.ctx-item:hover,
.ctx-item--active,
.ctx-item--focused {
  background: var(--bg-hover, rgba(0, 0, 0, 0.055));
  color: var(--text, #111827);
}

:root[data-theme="dark"] .ctx-item,
body.dark .ctx-item {
  color: var(--text, #e4e2de);
}

:root[data-theme="dark"] .ctx-item:hover,
:root[data-theme="dark"] .ctx-item--active,
:root[data-theme="dark"] .ctx-item--focused,
body.dark .ctx-item:hover,
body.dark .ctx-item--active,
body.dark .ctx-item--focused {
  background: rgba(255, 255, 255, 0.085);
  color: #ffffff;
}

.ctx-item--disabled {
  opacity: 0.38;
  cursor: default;
  pointer-events: none;
}

.ctx-item--danger {
  color: var(--danger, #e53e3e);
}

.ctx-item--danger:hover,
.ctx-item--danger.ctx-item--focused {
  background: rgba(229, 62, 62, 0.1);
  color: var(--danger, #dc2626);
}

.ctx-item__label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item__kbd {
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted, #787774);
  opacity: 0.55;
  letter-spacing: 0.15px;
  margin-left: auto;
  padding-left: 12px;
  flex-shrink: 0;
  user-select: none;
  transition: opacity 0.06s ease;
}

.ctx-item:hover .ctx-item__kbd,
.ctx-item--active .ctx-item__kbd,
.ctx-item--focused .ctx-item__kbd {
  opacity: 0.82;
}

.ctx-item__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #787774);
  opacity: 0.5;
  margin-left: auto;
  padding-left: 10px;
  flex-shrink: 0;
  transition: opacity 0.06s ease;
}

.ctx-item:hover .ctx-item__arrow,
.ctx-item--active .ctx-item__arrow,
.ctx-item--focused .ctx-item__arrow {
  opacity: 0.85;
}

.ctx-item__check {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent, #ff9f40);
  margin-left: auto;
  padding-left: 8px;
  flex-shrink: 0;
}

.ctx-sep {
  height: 1px;
  background: var(--border, rgba(0, 0, 0, 0.06));
  margin: 3.5px 4px;
}

:root[data-theme="dark"] .ctx-sep,
body.dark .ctx-sep {
  background: rgba(255, 255, 255, 0.07);
}

/* Transitions */
.ctx-fade-enter-active {
  transition: opacity 0.09s ease-out, transform 0.09s cubic-bezier(0.16, 1, 0.3, 1);
}
.ctx-fade-leave-active {
  transition: opacity 0.06s ease-in;
}
.ctx-fade-enter-from {
  opacity: 0;
  transform: scale(0.97);
}
.ctx-fade-leave-to {
  opacity: 0;
}
</style>
