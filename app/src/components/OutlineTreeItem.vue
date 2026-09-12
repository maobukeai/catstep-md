<script setup lang="ts">
import { computed } from 'vue';
import type { OutlineItem } from '../lib/markdown';

defineOptions({ name: 'OutlineTreeItem' });

export interface OutlineNode {
  item: OutlineItem;
  children: OutlineNode[];
}

const props = withDefaults(
  defineProps<{
    node: OutlineNode;
    activeLine: number;
    collapsedLines: Set<number>;
    searchQuery: string;
    depth?: number;
    getLabel?: (line: number) => string;
  }>(),
  {
    depth: 0,
  }
);

const emit = defineEmits<{
  (e: 'goto', line: number): void;
  (e: 'toggle', line: number): void;
}>();

const hasChildren = computed(() => props.node.children.length > 0);
const isCollapsed = computed(
  () => !props.searchQuery.trim() && hasChildren.value && props.collapsedLines.has(props.node.item.line)
);
const isActive = computed(() => props.node.item.line === props.activeLine);

function splitMatch(text: string, query: string) {
  if (!query) return [{ text, isMatch: false }];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const result: Array<{ text: string; isMatch: boolean }> = [];
  let startIndex = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, startIndex);
  while (matchIndex !== -1) {
    if (matchIndex > startIndex) {
      result.push({ text: text.substring(startIndex, matchIndex), isMatch: false });
    }
    result.push({ text: text.substring(matchIndex, matchIndex + query.length), isMatch: true });
    startIndex = matchIndex + query.length;
    matchIndex = lowerText.indexOf(lowerQuery, startIndex);
  }
  if (startIndex < text.length) {
    result.push({ text: text.substring(startIndex), isMatch: false });
  }
  return result;
}
</script>

<template>
  <li
    class="outline-item-wrapper outline__item-wrapper"
    :class="[
      isCollapsed ? 'outline-item-closed' : 'outline-item-open',
      hasChildren ? 'has-children' : 'outline-item-single has-no-children'
    ]"
    :data-depth="depth"
  >
    <div
      class="outline-item outline__item"
      :class="{ 'outline-item-active outline__item--active': isActive }"
      @click="emit('goto', node.item.line)"
    >
      <span
        v-if="hasChildren"
        class="outline-expander outline__twisty"
        :class="{ 'is-expanded': !isCollapsed }"
        @click.stop="emit('toggle', node.item.line)"
      >
        <svg
          class="outline__twisty-icon"
          viewBox="0 0 16 16"
          width="6.5"
          height="6.5"
          aria-hidden="true"
        >
          <path
            d="M5.5 3.5l4.5 4.5L5.5 12.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span v-else class="outline-expander outline__twisty outline__twisty--spacer" aria-hidden="true"></span>

      <span
        v-if="getLabel && getLabel(node.item.line)"
        class="outline__keylabel"
        aria-hidden="true"
      >{{ getLabel(node.item.line) }}</span>

      <span
        class="outline-label outline__label"
        :title="node.item.text"
      >
        <template v-if="searchQuery.trim()">
          <template v-for="(part, pIdx) in splitMatch(node.item.text, searchQuery)" :key="pIdx">
            <mark v-if="part.isMatch" class="outline__mark">{{ part.text }}</mark>
            <span v-else>{{ part.text }}</span>
          </template>
        </template>
        <template v-else>{{ node.item.text }}</template>
      </span>
    </div>

    <!-- Recursive children tree list -->
    <ul
      v-if="hasChildren && !isCollapsed"
      class="outline-children outline__children"
    >
      <OutlineTreeItem
        v-for="child in node.children"
        :key="child.item.line"
        :node="child"
        :active-line="activeLine"
        :collapsed-lines="collapsedLines"
        :search-query="searchQuery"
        :depth="depth + 1"
        :get-label="getLabel"
        @goto="emit('goto', $event)"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>
