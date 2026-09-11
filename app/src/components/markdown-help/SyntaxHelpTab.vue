<script setup lang="ts">
import { ref, computed } from 'vue';
import { syntaxItems } from './syntax.data';

const props = defineProps<{
  searchQuery: string;
}>();

const filteredSyntax = computed(() => {
  const q = props.searchQuery.trim().toLowerCase();
  if (!q) return syntaxItems;
  return syntaxItems.filter((it) => {
    const hay = `${it.category} ${it.syntax} ${it.example} ${it.zh} ${it.en}`.toLowerCase();
    return q.split(/\s+/).every((tok) => hay.includes(tok));
  });
});

const syntaxCategories = computed(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of filteredSyntax.value) {
    if (!seen.has(it.category)) {
      seen.add(it.category);
      out.push(it.category);
    }
  }
  return out;
});

function syntaxItemsOf(cat: string) {
  return filteredSyntax.value.filter((it) => it.category === cat);
}

const copiedNotice = ref<string | null>(null);
let copyTimer = 0;

async function copyExample(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedNotice.value = text;
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedNotice.value = null;
    }, 1500);
  } catch {}
}
</script>

<template>
  <div class="syntax-tab-pane">
    <section v-for="cat in syntaxCategories" :key="cat" class="syntax-section">
      <h3 class="syntax-section__title">{{ cat }}</h3>
      <div class="syntax-grid">
        <div v-for="(it, i) in syntaxItemsOf(cat)" :key="i" class="syntax-card">
          <div class="syntax-card__hdr">
            <span class="syntax-card__code">{{ it.syntax }}</span>
            <span v-if="copiedNotice === it.example" class="syntax-card__copied">已复制!</span>
          </div>
          <div class="syntax-card__desc">{{ it.zh }}</div>
          <pre
            class="syntax-card__example"
            @click="copyExample(it.example)"
            title="点击复制代码范例"
          >{{ it.example }}</pre>
        </div>
      </div>
    </section>
    <div v-if="filteredSyntax.length === 0" class="help-empty">
      <div class="help-empty__icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </div>
      <div class="help-empty__text">没有匹配的 Markdown 语法</div>
    </div>
  </div>
</template>

<style scoped>
@import './markdown-help.css';

.syntax-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
