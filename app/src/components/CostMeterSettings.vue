<script setup lang="ts">
/**
 * v4.0 BYOK cost meter — Settings → AI subsection.
 *
 * Per-provider cumulative tokens + USD totals across every panel chat and
 * scheduled recipe. Off by default; opt-in. Resetting starts the window
 * over from "now"; the per-provider rows follow what `pricing::estimate_cost_usd`
 * already writes into each `agent-runs/<id>/meta.json`.
 */
import { computed, onMounted, ref } from 'vue';
import { isTauri } from '../lib/platform';
import { safeInvoke } from '../lib/tauri-bridge';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';

interface ProviderTotals {
  input: number;
  output: number;
  cost_usd: number;
  runs: number;
}

interface CostMeter {
  enabled: boolean;
  since_epoch: number;
  providers: Record<string, ProviderTotals>;
}

const { t } = useI18n();
const toasts = useToastsStore();

const meter = ref<CostMeter>({
  enabled: false,
  since_epoch: 0,
  providers: {},
});

async function refresh() {
  if (!isTauri()) return;
  try {
    const res = await safeInvoke<CostMeter>('cost_meter_get');
    if (res) meter.value = res;
  } catch (e) {
    // Match the toast pattern used by onToggleEnabled / onReset below —
    // a silent console.warn means the user has no idea why the table is
    // stale after they hit "Refresh".
    toasts.error(t('cost.refreshFailed', { err: String(e) }));
  }
}

async function onToggleEnabled() {
  if (!isTauri()) return;
  const next = !meter.value.enabled;
  try {
    const res = await safeInvoke<CostMeter>('cost_meter_set_enabled', {
      enabled: next,
    });
    if (res) meter.value = res;
    toasts.info(next ? t('cost.enabled') : t('cost.disabled'));
  } catch (e) {
    toasts.error(`${e}`);
  }
}

async function onReset() {
  if (!isTauri()) return;
  try {
    const res = await safeInvoke<CostMeter>('cost_meter_reset');
    if (res) meter.value = res;
    toasts.success(t('cost.resetDone'));
  } catch (e) {
    toasts.error(`${e}`);
  }
}

const sinceLabel = computed(() => {
  if (!meter.value.since_epoch) return '—';
  const d = new Date(meter.value.since_epoch * 1000);
  return d.toLocaleString();
});

const rows = computed(() => {
  return Object.entries(meter.value.providers)
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => b.cost_usd - a.cost_usd || b.runs - a.runs);
});

const totalCost = computed(() => rows.value.reduce((s, r) => s + r.cost_usd, 0));
const totalIn = computed(() => rows.value.reduce((s, r) => s + r.input, 0));
const totalOut = computed(() => rows.value.reduce((s, r) => s + r.output, 0));
const totalRuns = computed(() => rows.value.reduce((s, r) => s + r.runs, 0));

function fmtUsd(n: number): string {
  // Cost estimates are dominated by sub-cent runs. Show 4 decimals so a
  // 0.0003 cost doesn't render as "$0.00".
  return `$${n.toFixed(4)}`;
}

function fmtTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

onMounted(refresh);
</script>

<template>
  <section class="cost">
    <div class="cost__head">
      <div class="cost__info">
        <h4 class="cost__heading">{{ t('cost.heading') }}</h4>
        <p class="cost__sub">{{ t('cost.enable') }}</p>
      </div>
      <label class="cost__toggle" :title="t('cost.enable')">
        <input
          type="checkbox"
          class="micro-toggle"
          :checked="meter.enabled"
          @change="onToggleEnabled"
        />
      </label>
    </div>
    <p class="cost__hint">{{ t('cost.hint') }}</p>

    <div v-if="meter.enabled" class="cost__body">
      <div class="cost__since">
        {{ t('cost.since', { ts: sinceLabel }) }}
        <button class="cost__btn" @click="refresh">{{ t('cost.refresh') }}</button>
        <button class="cost__btn" @click="onReset">{{ t('cost.reset') }}</button>
      </div>

      <div class="cost__table-container">
        <table v-if="rows.length" class="cost__table">
          <thead>
            <tr>
              <th>{{ t('cost.provider') }}</th>
              <th class="cost__num">{{ t('cost.runs') }}</th>
              <th class="cost__num">{{ t('cost.input') }}</th>
              <th class="cost__num">{{ t('cost.output') }}</th>
              <th class="cost__num">{{ t('cost.cost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.name">
              <td>{{ r.name }}</td>
              <td class="cost__num">{{ r.runs }}</td>
              <td class="cost__num">{{ fmtTok(r.input) }}</td>
              <td class="cost__num">{{ fmtTok(r.output) }}</td>
              <td class="cost__num">{{ fmtUsd(r.cost_usd) }}</td>
            </tr>
            <tr class="cost__total">
              <td>{{ t('cost.total') }}</td>
              <td class="cost__num">{{ totalRuns }}</td>
              <td class="cost__num">{{ fmtTok(totalIn) }}</td>
              <td class="cost__num">{{ fmtTok(totalOut) }}</td>
              <td class="cost__num">{{ fmtUsd(totalCost) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="cost__empty">{{ t('cost.empty') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cost {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-hover) 25%, transparent);
}
.cost__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.cost__info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.cost__heading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
}
.cost__sub {
  margin: 0;
  font-size: 11.5px;
  color: var(--text);
  opacity: 0.85;
  line-height: 1.35;
}
.cost__toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  padding-top: 2px;
}
.cost__hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.cost__table-container {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.micro-toggle {
  appearance: none;
  -webkit-appearance: none;
  width: 30px !important;
  height: 17px !important;
  border-radius: 17px !important;
  background: color-mix(in srgb, var(--text-faint) 45%, transparent) !important;
  cursor: pointer;
  position: relative;
  outline: none;
  border: none;
  flex-shrink: 0;
  margin: 0;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.micro-toggle::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 11px !important;
  height: 11px !important;
  border-radius: 50% !important;
  background: #ffffff !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
.micro-toggle:checked {
  background: var(--accent) !important;
}
.micro-toggle:checked::after {
  transform: translateX(13px) !important;
}
.cost__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.cost__since {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.cost__btn {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  cursor: pointer;
}
.cost__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.cost__table th,
.cost__table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.cost__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.cost__total td {
  font-weight: 600;
  border-top: 1px solid var(--border);
}
.cost__empty {
  margin: 4px 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
