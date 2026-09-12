<script setup lang="ts">
/**
 * v2.6.1 — Cloud-folder banner shown in the Settings panel above
 * GithubSyncSettings. Surfaces the fact that the current workspace is
 * already in iCloud / Dropbox / OneDrive / Google Drive and explains the
 * trade-off vs GitHub sync (cloud-folder = automatic but no version
 * history; GitHub sync = explicit history per file).
 *
 * Self-hides when no workspace is open or the path isn't a known cloud
 * folder.
 */
import { useCloudSyncStore } from '../stores/cloudSync';
import { useI18n } from '../i18n';

const cloud = useCloudSyncStore();
const { t } = useI18n();

const PROVIDER_TAG: Record<string, string> = {
  icloud: 'iCloud',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  google_drive: 'Google Drive',
  none: '',
};
</script>

<template>
  <section v-if="cloud.isInCloudFolder" class="cfb">
    <div class="cfb__row">
      <span v-if="PROVIDER_TAG[cloud.cloud.provider]" class="cfb__tag">
        {{ PROVIDER_TAG[cloud.cloud.provider] }}
      </span>
      <div class="cfb__copy">
        <strong>{{ t('cloudSync.detectedTitle', { label: cloud.cloud.label }) }}</strong>
        <p>{{ t('cloudSync.detectedHint') }}</p>
        <p v-if="cloud.siblings.length > 0" class="cfb__siblings">
          {{ t('cloudSync.siblingCount', { n: String(cloud.siblings.length) }) }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cfb {
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  background: var(--bg-soft, var(--bg));
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
}
.cfb__row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.cfb__tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  flex-shrink: 0;
  margin-top: 1px;
}
.cfb__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cfb__copy strong {
  font-size: 12px;
  color: var(--text);
  font-weight: 600;
}
.cfb__copy p {
  margin: 0;
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.4;
}
.cfb__siblings {
  color: var(--text-muted) !important;
}
</style>
