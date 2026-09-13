/**
 * Options page — pair the clipper with a running Catstep MD desktop instance.
 */
import { getHealth } from './lib/capture.js';
import { initI18n, t } from './lib/i18n.js';
import { loadSettings, patchSettings } from './lib/storage.js';

async function applyI18n(): Promise<void> {
  await initI18n();
  document.title = t('clipper.options.title');
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    const key = el.dataset.i18n;
    if (!key) continue;
    el.textContent = t(key);
  }
}

function $(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el as HTMLInputElement;
}

function updateSwatchActive(color: string): void {
  const swatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch-btn'));
  for (const btn of swatches) {
    btn.classList.toggle('active', btn.dataset.color === color);
  }
}

async function loadIntoForm(): Promise<void> {
  const s = await loadSettings();
  $('endpoint').value = s.endpoint || 'http://127.0.0.1:7777';
  $('token').value = s.token;
  $('subfolder').value = s.subfolder;
  $('notify').checked = s.notifyOnSuccess;
  ($('locale') as unknown as HTMLSelectElement).value = s.locale;

  const accent = s.accentColor || 'blue';
  $('accent-color').value = accent;
  document.documentElement.dataset.accent = accent;
  updateSwatchActive(accent);
}

function setStatus(text: string, kind: 'idle' | 'ok' | 'err'): void {
  const banner = document.getElementById('status-banner');
  const textEl = document.getElementById('status-text');
  if (!banner || !textEl) return;

  banner.classList.remove('hidden', 'status-banner--ok', 'status-banner--err');
  textEl.textContent = text;

  if (kind === 'ok') {
    banner.classList.add('status-banner--ok');
  } else if (kind === 'err') {
    banner.classList.add('status-banner--err');
  }
}

function updateGuideBanner(connected: boolean, workspace?: string, version?: string): void {
  const banner = document.getElementById('guide-banner');
  if (!banner) return;

  if (connected) {
    banner.className = 'guide-banner guide-banner--ok';
    const wsText = workspace ? ` · ${t('clipper.options.testOkPrefix')}${workspace}` : '';
    banner.innerHTML = `
      <div class="guide-banner__header">
        <svg class="guide-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span class="guide-banner__title">${t('clipper.popup.paired')} (v${version ?? '2.4.1'})</span>
      </div>
      <div class="guide-banner__steps">
        <span class="guide-step">${wsText || '已就绪，可随时通过快捷键或图标进行网页剪藏。'}</span>
      </div>
    `;
  }
}

async function readForm() {
  const localeSel = $('locale') as unknown as HTMLSelectElement;
  const accentVal = $('accent-color').value || 'blue';
  return {
    endpoint: $('endpoint').value.trim(),
    token: $('token').value.trim(),
    subfolder: $('subfolder').value.trim(),
    notifyOnSuccess: $('notify').checked,
    locale: (['auto', 'en', 'zh'].includes(localeSel.value)
      ? (localeSel.value as 'auto' | 'en' | 'zh')
      : 'auto') as 'auto' | 'en' | 'zh',
    accentColor: (['blue', 'amber', 'emerald', 'purple'].includes(accentVal)
      ? accentVal
      : 'blue') as 'blue' | 'amber' | 'emerald' | 'purple',
  };
}

async function onTest(): Promise<void> {
  const testBtn = document.getElementById('test-btn') as HTMLButtonElement | null;
  if (testBtn) testBtn.disabled = true;

  setStatus(t('clipper.options.testRunning'), 'idle');
  const form = await readForm();

  try {
    const res = await getHealth({
      ...(await loadSettings()),
      endpoint: form.endpoint,
      token: form.token,
    });
    if (res.ok) {
      if (res.data.workspace_open) {
        setStatus(`${t('clipper.options.testOkPrefix')}${res.data.workspace}`, 'ok');
        updateGuideBanner(true, res.data.workspace, res.data.version);
      } else {
        setStatus(t('clipper.options.testNoWorkspace'), 'err');
      }
    } else {
      setStatus(`${t('clipper.options.testFailPrefix')}${res.message}`, 'err');
    }
  } catch (e) {
    setStatus(`${t('clipper.options.testFailPrefix')}${e instanceof Error ? e.message : String(e)}`, 'err');
  } finally {
    if (testBtn) testBtn.disabled = false;
  }
}

async function onSave(e: Event): Promise<void> {
  e.preventDefault();
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement | null;
  if (saveBtn) saveBtn.disabled = true;

  try {
    const form = await readForm();
    await patchSettings(form);
    await applyI18n();
    setStatus(t('clipper.options.saved'), 'ok');

    // Also run a quiet background test
    const res = await getHealth(form);
    if (res.ok && res.data.workspace_open) {
      updateGuideBanner(true, res.data.workspace, res.data.version);
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function bindExtraControls(): void {
  // Reset endpoint
  document.getElementById('btn-reset-endpoint')?.addEventListener('click', () => {
    $('endpoint').value = 'http://127.0.0.1:7777';
  });

  // Toggle token password visibility
  const tokenInput = $('token');
  const toggleBtn = document.getElementById('btn-toggle-token');
  const eyeShow = document.getElementById('eye-icon-show');
  const eyeHide = document.getElementById('eye-icon-hide');

  toggleBtn?.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    eyeShow?.classList.toggle('hidden', isPassword);
    eyeHide?.classList.toggle('hidden', !isPassword);
  });

  // Paste token from clipboard
  document.getElementById('btn-paste-token')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        tokenInput.value = text.trim();
        tokenInput.focus();
      }
    } catch {
      // Clipboard read may be blocked if no permission, fallback to focusing
      tokenInput.focus();
    }
  });

  // Swatch click handlers
  const swatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch-btn'));
  for (const btn of swatches) {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color || 'blue';
      $('accent-color').value = color;
      document.documentElement.dataset.accent = color;
      updateSwatchActive(color);
    });
  }
}

(async () => {
  await applyI18n();
  await loadIntoForm();
  bindExtraControls();

  document.getElementById('settings-form')?.addEventListener('submit', onSave);
  document.getElementById('test-btn')?.addEventListener('click', onTest);

  // Initial passive test if settings exist
  const current = await loadSettings();
  if (current.endpoint && current.token) {
    void getHealth(current).then((res) => {
      if (res.ok && res.data.workspace_open) {
        updateGuideBanner(true, res.data.workspace, res.data.version);
      }
    });
  }
})();

