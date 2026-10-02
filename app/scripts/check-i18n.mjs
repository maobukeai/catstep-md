#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const I18N_DIR = path.resolve(import.meta.dirname, '../src/i18n');
const langs = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr', 'sv', 'uk'];

/**
 * Graded i18n gate (S19).
 *
 * - Release locales (en, zh): every key in the base locale MUST exist or the
 *   script exits 1. These are the maintained languages; the runtime
 *   (src/i18n/index.ts) falls back activeDict -> enDict -> key, so a hole in
 *   en or zh is user-visible.
 * - Community locales (the other 12): missing keys are reported as debt and
 *   fall back to English at runtime. They do NOT fail the gate, so adding a
 *   UI string only requires the en + zh dictionaries.
 */
const RELEASE_LOCALES = new Set(['en', 'zh']);

function flattenDict(obj, prefix = '') {
  const result = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = flattenDict(v, full);
      for (const [nk, nv] of nested) {
        result.set(nk, nv);
      }
    } else {
      result.set(full, v);
    }
  }
  return result;
}

async function run() {
  console.log('🔍 Checking i18n dictionary coverage (graded gate: en/zh hard, others report-only)...');
  const dicts = {};
  for (const lang of langs) {
    const fileUrl = pathToFileURL(path.join(I18N_DIR, `${lang}.ts`)).href;
    const mod = await import(fileUrl);
    dicts[lang] = flattenDict(mod[lang]);
  }

  const enKeys = new Set(dicts.en.keys());
  console.log(`Base locale (en): ${enKeys.size} keys`);

  let releaseMissing = 0;
  let debtMissing = 0;
  const debtByLang = [];
  for (const lang of langs) {
    if (lang === 'en') continue;
    const current = dicts[lang];
    const missing = [...enKeys].filter((k) => !current.has(k));
    const coverage = ((current.size / enKeys.size) * 100).toFixed(1);
    if (missing.length === 0) {
      console.log(`  ✓ ${lang.padEnd(4)}: 100% (${current.size}/${enKeys.size} keys)`);
      continue;
    }
    if (RELEASE_LOCALES.has(lang)) {
      console.error(
        `  ✗ ${lang.padEnd(4)}: ${coverage}% (${current.size}/${enKeys.size} keys) — missing ${missing.length} keys (release locale, hard failure)`,
      );
      console.error(`      e.g. ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}`);
      releaseMissing += missing.length;
    } else {
      console.log(
        `  ○ ${lang.padEnd(4)}: ${coverage}% (${current.size}/${enKeys.size} keys) — ${missing.length} keys missing, falls back to en at runtime (debt, not blocking)`,
      );
      debtMissing += missing.length;
      debtByLang.push({ lang, missing });
    }
  }

  if (releaseMissing > 0) {
    console.error(
      `\n❌ Release locales (en/zh) are missing ${releaseMissing} keys — add them to src/i18n/en.ts and zh.ts before merging.`,
    );
    process.exitCode = 1;
    return;
  }

  if (debtMissing > 0) {
    console.log(
      `\n📋 Community-locale translation debt: ${debtMissing} keys across ${debtByLang.length} locales (report only — these fall back to English via src/i18n/index.ts).`,
    );
    console.log('   To pay some down, copy the missing keys from en.ts into the locale file and translate.');
  } else {
    console.log('\n🎉 All 14 locales are 100% aligned with base locale!');
  }
}

run().catch((err) => {
  console.error('Fatal error checking i18n:', err);
  process.exit(1);
});
