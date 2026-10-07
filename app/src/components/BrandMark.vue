<script setup lang="ts">
withDefaults(defineProps<{
  size?: number;
  label?: string;
}>(), {
  size: 24,
  label: '',
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 1024 1024"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    xmlns="http://www.w3.org/2000/svg"
    style="display: inline-block; vertical-align: middle; border-radius: 22%; overflow: hidden;"
  >
    <image
      href="/brand-mark.png"
      x="0"
      y="0"
      width="1024"
      height="1024"
      preserveAspectRatio="xMidYMid meet"
    />
  </svg>
</template>
