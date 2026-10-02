#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

/**
 * CJK literal gate (S19).
 *
 * Scans app/src (excluding the i18n dictionaries themselves) for hardcoded
 * CJK literals — i.e. user-visible copy that bypasses t(). The runtime falls
 * back to English for missing keys, but hardcoded Chinese shows up verbatim
 * for every other locale, so new literals must go through t() with en+zh keys.
 *
 * Allowlist: scripts/i18n-cjk-allowlist.json
 *   {
 *     "exemptFiles":  ["lib/agent-prompts.ts", …],   // CJK by design: LLM prompts, regex over CJK output, brand names, tests
 *     "exemptLines":  { "path": ["exact trimmed line", …] }, // individual legitimate lines (e.g. 한국어 in a language picker)
 *     "maxCjkLines":  { "path": 178 }                // outstanding translation debt, ratcheted: the file may hold
 *   }                                                // at most this many CJK lines — adding new ones fails the gate.
 *
 * Exit code: 0 when clean, 1 on any violation (unlisted CJK, ratchet exceeded, stale exemptLines).
 */

const SRC_DIR = path.resolve(import.meta.dirname, '../src');
const ALLOWLIST_PATH = path.resolve(import.meta.dirname, 'i18n-cjk-allowlist.json');
const EXTS = new Set(['.vue', '.ts', '.tsx', '.js']);

// Han ideographs (incl. Ext A + compatibility), kana, hangul.
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

// Lines that merely carry CJK inside a comment are not UI copy. Heuristic:
// block quotes of trimmed line starts (works for JS, TS and Vue SFC files).
const COMMENT_LINE_RE = /^(\/\/|\*|\/\*|<!--)/;

function toRel(absPath) {
  return path.relative(SRC_DIR, absPath).split(path.sep).join('/');
}

function listSourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'i18n') continue; // dictionaries legitimately hold CJK
      out.push(...listSourceFiles(p));
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

function scan() {
  const perFile = new Map(); // rel -> [{ line, text }]
  for (const file of listSourceFiles(SRC_DIR)) {
    const rel = toRel(file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      const trimmed = text.trim();
      if (!trimmed || COMMENT_LINE_RE.test(trimmed)) return;
      if (CJK_RE.test(trimmed)) {
        if (!perFile.has(rel)) perFile.set(rel, []);
        perFile.get(rel).push({ line: i + 1, text: trimmed });
      }
    });
  }
  return perFile;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { exemptFiles: [], exemptLines: {}, maxCjkLines: {} };
  }
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function run() {
  const allow = loadAllowlist();
  const exemptFiles = new Set(allow.exemptFiles || []);
  const exemptLines = allow.exemptLines || {};
  const maxCjkLines = allow.maxCjkLines || {};

  const perFile = scan();
  const violations = [];
  const debtRows = [];

  // Unlisted files with CJK → violation. Ratcheted files → debt row (violation if over budget).
  for (const [rel, hits] of [...perFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (exemptFiles.has(rel)) continue;
    const lineAllow = new Set(exemptLines[rel] || []);
    const remaining = hits.filter((h) => !lineAllow.has(h.text));
    if (remaining.length === 0) continue;

    if (!(rel in maxCjkLines)) {
      violations.push({
        rel,
        msg: `${remaining.length} hardcoded CJK line(s) and no allowlist entry — route copy through t() (en+zh keys) or update scripts/i18n-cjk-allowlist.json`,
        sample: remaining.slice(0, 5),
      });
    } else if (remaining.length > maxCjkLines[rel]) {
      violations.push({
        rel,
        msg: `${remaining.length} CJK lines exceed the ratcheted budget of ${maxCjkLines[rel]} — new literals must go through t()`,
        sample: remaining.slice(0, 5),
      });
    } else {
      debtRows.push({ rel, count: remaining.length, budget: maxCjkLines[rel] });
    }
  }

  // Stale allowlist upkeep (warnings only).
  for (const rel of exemptFiles) {
    if (!fs.existsSync(path.join(SRC_DIR, rel))) {
      console.warn(`⚠️  allowlist: exemptFiles entry '${rel}' points at a missing file — remove it`);
    }
  }
  for (const [rel, max] of Object.entries(maxCjkLines)) {
    if (exemptFiles.has(rel)) {
      console.warn(`⚠️  allowlist: '${rel}' is both exempt and ratcheted — drop the maxCjkLines entry`);
      continue;
    }
    const actual = perFile.get(rel)?.length ?? 0;
    if (actual === 0) {
      console.warn(`⚠️  allowlist: '${rel}' now has 0 CJK lines (budget ${max}) — remove the stale maxCjkLines entry`);
    } else if (actual < max) {
      console.warn(`⚠️  allowlist: '${rel}' shrank to ${actual} CJK lines (budget ${max}) — tighten maxCjkLines to ${actual}`);
    }
  }
  for (const [rel, entries] of Object.entries(exemptLines)) {
    const texts = new Set((perFile.get(rel) || []).map((h) => h.text));
    for (const entry of entries) {
      if (!texts.has(entry)) {
        console.warn(`⚠️  allowlist: exemptLines entry for '${rel}' matches no current line: ${JSON.stringify(entry.slice(0, 60))}`);
      }
    }
  }

  // Debt report (non-blocking): ratcheted files are the outstanding translation backlog.
  if (debtRows.length) {
    const total = debtRows.reduce((s, r) => s + r.count, 0);
    console.log(`\n📋 CJK translation debt: ${total} grandfathered literals across ${debtRows.length} files (ratcheted — adding new ones fails):`);
    for (const r of debtRows.sort((a, b) => b.count - a.count)) {
      console.log(`   ${String(r.count).padStart(4)} / ${String(r.budget).padEnd(4)}  ${r.rel}`);
    }
  }

  if (violations.length) {
    console.error(`\n❌ CJK literal gate failed — ${violations.length} file(s):`);
    for (const v of violations) {
      console.error(`\n  ✗ src/${v.rel}: ${v.msg}`);
      for (const s of v.sample) console.error(`      :${s.line}  ${s.text.slice(0, 100)}`);
    }
    console.error('\n  Fix: replace the literal with t(\'key\') + keys in src/i18n/en.ts & zh.ts,');
    console.error('  or (data/prompts/tests only) add an entry to scripts/i18n-cjk-allowlist.json.');
    process.exitCode = 1;
    return;
  }

  console.log('\n✅ CJK literal gate passed.');
}

run();
