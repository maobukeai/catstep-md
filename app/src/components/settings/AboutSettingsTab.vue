<script setup lang="ts">
import AboutSettings from '../AboutSettings.vue';
</script>

<template>
  <div class="settings-tab-pane">
    <AboutSettings />
  </div>
</template>

<style scoped>
@import './settings-common.css';

.settings-tab-pane {
  display: flex;
  flex-direction: column;
}
</style>
