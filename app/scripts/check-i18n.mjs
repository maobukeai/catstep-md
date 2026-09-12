#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const I18N_DIR = path.resolve(import.meta.dirname, '../src/i18n');
const langs = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr', 'sv', 'uk'];

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
  console.log('🔍 Checking i18n dictionary coverage across all 14 languages...');
  const dicts = {};
  for (const lang of langs) {
    const fileUrl = pathToFileURL(path.join(I18N_DIR, `${lang}.ts`)).href;
    const mod = await import(fileUrl);
    dicts[lang] = flattenDict(mod[lang]);
  }

  const enKeys = new Set(dicts.en.keys());
  console.log(`Base locale (en): ${enKeys.size} keys`);

  let totalMissing = 0;
  for (const lang of langs) {
    if (lang === 'en') continue;
    const current = dicts[lang];
    const missing = [...enKeys].filter(k => !current.has(k));
    const coverage = ((current.size / enKeys.size) * 100).toFixed(1);
    if (missing.length === 0) {
      console.log(`  ✓ ${lang.padEnd(4)}: 100% (${current.size}/${enKeys.size} keys)`);
    } else {
      console.log(`  ✗ ${lang.padEnd(4)}: ${coverage}% (${current.size}/${enKeys.size} keys) — missing ${missing.length} keys`);
      totalMissing += missing.length;
    }
  }

  if (totalMissing > 0) {
    console.warn(`\n⚠️  Total missing translations across locales: ${totalMissing}`);
    process.exitCode = 1;
  } else {
    console.log('\n🎉 All 14 locales are 100% aligned with base locale!');
  }
}

run().catch((err) => {
  console.error('Fatal error checking i18n:', err);
  process.exit(1);
});
