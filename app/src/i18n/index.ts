/**
 * App-level i18n. Lightweight: no library, just a translations map + a
 * reactive `t()` function driven by the settings store's `language` field.
 *
 * All languages are loaded dynamically on demand to minimize initial bundle size.
 */

import { computed, shallowReactive } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { isMacOS } from '../lib/platform';

export type Lang =
  | 'en'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt'
  | 'it'
  | 'pl'
  | 'nl'
  | 'tr'
  | 'sv'
  | 'uk';

const loaders: Record<Lang, () => Promise<any>> = {
  en: () => import('./en').then((m) => m.en),
  zh: () => import('./zh').then((m) => m.zh),
  ja: () => import('./ja').then((m) => m.ja),
  ko: () => import('./ko').then((m) => m.ko),
  de: () => import('./de').then((m) => m.de),
  fr: () => import('./fr').then((m) => m.fr),
  es: () => import('./es').then((m) => m.es),
  pt: () => import('./pt').then((m) => m.pt),
  it: () => import('./it').then((m) => m.it),
  pl: () => import('./pl').then((m) => m.pl),
  nl: () => import('./nl').then((m) => m.nl),
  tr: () => import('./tr').then((m) => m.tr),
  sv: () => import('./sv').then((m) => m.sv),
  uk: () => import('./uk').then((m) => m.uk),
};

const dicts = shallowReactive<Partial<Record<Lang, any>>>({});
const pendingLoads = new Map<Lang, Promise<any>>();

export async function loadLanguage(lang: Lang): Promise<any> {
  const target: Lang = loaders[lang] ? lang : 'en';
  if (dicts[target]) return dicts[target];

  const pending = pendingLoads.get(target);
  if (pending) return pending;

  const promise = loaders[target]()
    .then((dict) => {
      dicts[target] = dict;
      return dict;
    })
    .catch((err) => {
      console.error(`[i18n] Failed to load language dictionary for '${target}':`, err);
      return dicts.en || {};
    })
    .finally(() => {
      pendingLoads.delete(target);
    });

  pendingLoads.set(target, promise);
  return promise;
}

export function useI18n() {
  let settings: ReturnType<typeof useSettingsStore> | null = null;
  try {
    settings = useSettingsStore();
  } catch {
    // pinia not active (e.g. isolated unit test or pre-init)
  }

  const lang = computed(() => (settings?.language as Lang) || 'en');

  const dict = computed(() => {
    const current = lang.value;
    if (!dicts[current]) {
      void loadLanguage(current);
    }
    if (current !== 'en' && !dicts.en) {
      void loadLanguage('en');
    }
    return dicts[current] || dicts.en || {};
  });

  function lookup(d: any, parts: string[]): string | undefined {
    let cur: any = d;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return typeof cur === 'string' ? cur : undefined;
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const parts = key.split('.');
    const activeDict = dict.value;
    const enDict = dicts.en;
    // Try active language first, then fall back to English, then to the raw key.
    let str = lookup(activeDict, parts) ?? (activeDict !== enDict ? lookup(enDict, parts) : undefined) ?? key;
    const merged: Record<string, string | number> = {
      key: isMacOS() ? '⌘⇧F' : 'Ctrl+Shift+F',
      folderKey: isMacOS() ? '⌘B' : 'Ctrl+B',
      ...params,
    };
    for (const [k, v] of Object.entries(merged)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return str;
  }

  return { t, lang };
}
