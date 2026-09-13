/**
 * Popup script — wires the action cards to the background worker,
 * renders platform-specific shortcuts, and shows a live pairing indicator.
 */
import browser from 'webextension-polyfill';

import { getHealth } from './lib/capture.js';
import { initI18n, t } from './lib/i18n.js';
import { loadSettings } from './lib/storage.js';

async function applyI18n(): Promise<void> {
  await initI18n();
  document.title = t('clipper.popup.title');
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.dataset.i18n;
    if (!key) continue;
    el.textContent = t(key);
  }
  const titleEl = document.getElementById('popup-title');
  if (titleEl) titleEl.textContent = t('clipper.popup.title');
}

function applyPlatformShortcuts(): void {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iP(hone|od|ad)/i.test(navigator.platform || navigator.userAgent);

  const selectionKbd = document.getElementById('kbd-selection');
  if (selectionKbd) {
    selectionKbd.textContent = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';
  }

  const linkKbd = document.getElementById('kbd-link');
  if (linkKbd) {
    linkKbd.textContent = isMac ? '⌘⇧L' : 'Ctrl+Shift+L';
  }
}

async function refreshPairStatus(): Promise<void> {
  const badge = document.getElementById('pair-status');
  const statusText = document.getElementById('pair-status-text');
  if (!badge || !statusText) return;

  badge.classList.remove('header__status--ok', 'header__status--err');
  statusText.textContent = t('clipper.popup.checking');

  const settings = await loadSettings();
  if (!settings.endpoint || !settings.token) {
    badge.classList.add('header__status--err');
    statusText.textContent = t('clipper.popup.unpaired');
    return;
  }

  try {
    const res = await getHealth(settings);
    if (res.ok) {
      badge.classList.add('header__status--ok');
      statusText.textContent = `${t('clipper.popup.paired')} · v${res.data.version}`;
    } else {
      badge.classList.add('header__status--err');
      statusText.textContent = t('clipper.popup.unpaired');
    }
  } catch {
    badge.classList.add('header__status--err');
    statusText.textContent = t('clipper.popup.unpaired');
  }
}

function bindActions(): void {
  for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.action-card'))) {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode as 'page' | 'selection' | 'link' | undefined;
      if (!mode) return;
      btn.disabled = true;
      try {
        await browser.runtime.sendMessage({ kind: 'capture', mode });
      } catch (e) {
        console.warn('[catstep-clipper popup] sendMessage failed', e);
      } finally {
        window.close();
      }
    });
  }

  // Clicking settings button or the status badge navigates to options
  const settingsBtn = document.getElementById('open-options');
  settingsBtn?.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });

  const statusBadge = document.getElementById('pair-status');
  statusBadge?.addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });
}

(async () => {
  await applyI18n();
  const settings = await loadSettings();
  document.documentElement.dataset.accent = settings.accentColor || 'blue';
  applyPlatformShortcuts();
  bindActions();
  await refreshPairStatus();
})();

