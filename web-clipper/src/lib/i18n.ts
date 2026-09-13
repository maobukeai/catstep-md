/**
 * Lightweight i18n for the clipper.
 *
 * Mirrors the desktop app's `t('clipper.foo')` lookup style — but loaded
 * synchronously from a hard-coded map so the popup paints without a flicker.
 */
import browser from 'webextension-polyfill';

import { loadSettings } from './storage.js';

type Dict = Record<string, string>;

const EN: Dict = {
  'clipper.popup.title': 'Catstep MD Web Clipper',
  'clipper.popup.clipPage': 'Clip whole page',
  'clipper.popup.clipPageHint': 'Reader-extracted main content → Markdown',
  'clipper.popup.clipSelection': 'Clip selection',
  'clipper.popup.clipSelectionHint': 'Just the highlighted text',
  'clipper.popup.saveLink': 'Save link',
  'clipper.popup.saveLinkHint': 'Title + URL only — for read-later',
  'clipper.popup.openOptions': 'Settings',
  'clipper.popup.paired': 'Paired with Catstep MD',
  'clipper.popup.unpaired': 'Not paired — click Settings to set it up',
  'clipper.popup.checking': 'Checking…',
  'clipper.popup.shortcut.selection': '⌘⇧S',
  'clipper.popup.shortcut.link': '⌘⇧L',

  'clipper.popup.brand': 'Catstep MD',
  'clipper.popup.targetInbox': 'Saves to local inbox',

  'clipper.options.title': 'Catstep MD Web Clipper · Settings',
  'clipper.options.heading': 'Pair with Catstep MD',
  'clipper.options.subtitle':
    'Seamlessly save web content into your local Catstep MD knowledge base. 100% private, loopback only.',
  'clipper.options.intro':
    'In Catstep MD, open Settings → Integrations → HTTP capture endpoint, toggle it on, and copy the bearer token here.',
  'clipper.options.quickGuide': 'Quick Pairing Guide',
  'clipper.options.step1': '1. Open the Catstep MD desktop app.',
  'clipper.options.step2': '2. Go to Settings → Integrations and enable "HTTP capture endpoint".',
  'clipper.options.step3': '3. Copy the bearer token and paste it below.',
  'clipper.options.sectionEndpoint': 'Desktop Connection',
  'clipper.options.sectionCapture': 'Storage & Preferences',
  'clipper.options.endpoint': 'Endpoint URL',
  'clipper.options.endpointHint': 'Default: http://127.0.0.1:7777 (loopback only — never leaves your machine).',
  'clipper.options.resetDefault': 'Reset default',
  'clipper.options.token': 'Bearer Token',
  'clipper.options.tokenHint': 'Paste the token from Catstep MD Settings → Integrations.',
  'clipper.options.paste': 'Paste',
  'clipper.options.tokenVisibility': 'Toggle visibility',
  'clipper.options.subfolder': 'Sub-folder (optional)',
  'clipper.options.subfolderHint': 'Relative to the workspace inbox. Leave blank to drop into the inbox root.',
  'clipper.options.subfolderPlaceholder': 'e.g. web-clips (leave blank for inbox root)',
  'clipper.options.notifyOnSuccess': 'Show desktop notification',
  'clipper.options.notifyHint': 'Display a system notification when capture is completed.',
  'clipper.options.locale': 'Language',
  'clipper.options.localeAuto': 'Auto (browser default)',
  'clipper.options.localeEn': 'English',
  'clipper.options.localeZh': '中文 (Chinese)',
  'clipper.options.themeColor': 'Theme Accent Color',
  'clipper.options.themeBlue': 'Classic Blue',
  'clipper.options.themeAmber': 'Amber Orange',
  'clipper.options.themeEmerald': 'Emerald',
  'clipper.options.themePurple': 'Purple',
  'clipper.options.test': 'Test Connection',
  'clipper.options.save': 'Save Settings',
  'clipper.options.saved': 'Settings saved successfully.',
  'clipper.options.testRunning': 'Testing connection…',
  'clipper.options.testOkPrefix': 'Connected · Active workspace: ',
  'clipper.options.testNoWorkspace': 'Connected, but no workspace folder is open in Catstep MD.',
  'clipper.options.testFailPrefix': 'Connection failed: ',

  'clipper.toast.savedPrefix': 'Saved to Catstep MD inbox: ',
  'clipper.toast.error.generic': 'Capture failed: ',
  'clipper.toast.error.notConfigured': 'Set up your endpoint URL + token first (open Settings).',
  'clipper.toast.error.endpointDown':
    'Catstep MD capture endpoint is not running — open Catstep MD and toggle it on in Settings → Integrations.',
  'clipper.toast.error.badToken': 'Wrong token — copy it again from Catstep MD Settings → Integrations.',
  'clipper.toast.error.noWorkspace': 'No workspace folder open in Catstep MD — open a folder first.',
  'clipper.toast.error.timeout': 'Catstep MD did not respond within 10 seconds.',
  'clipper.toast.error.network': 'Network error — is Catstep MD running?',

  'clipper.menu.clipPage': 'Catstep MD: Clip whole page',
  'clipper.menu.clipSelection': 'Catstep MD: Clip selection',
  'clipper.menu.saveLink': 'Catstep MD: Save link',

  'clipper.frontmatter.captured': 'captured',
};

const ZH: Dict = {
  'clipper.popup.title': '猫步 MD 网页剪藏',
  'clipper.popup.brand': '猫步 MD',
  'clipper.popup.clipPage': '剪藏整页',
  'clipper.popup.clipPageHint': '使用阅读模式提取正文 → Markdown',
  'clipper.popup.clipSelection': '剪藏选中内容',
  'clipper.popup.clipSelectionHint': '只剪藏当前选中的文字',
  'clipper.popup.saveLink': '仅保存链接',
  'clipper.popup.saveLinkHint': '只记录标题和链接 — 适合稍后阅读',
  'clipper.popup.openOptions': '设置',
  'clipper.popup.paired': '已连接到 猫步 MD',
  'clipper.popup.unpaired': '未连接 · 点击进入设置',
  'clipper.popup.checking': '正在检测…',
  'clipper.popup.shortcut.selection': '⌘⇧S',
  'clipper.popup.shortcut.link': '⌘⇧L',
  'clipper.popup.targetInbox': '保存至本地知识库收件箱',

  'clipper.options.title': '猫步 MD 网页剪藏 · 设置',
  'clipper.options.heading': '与 猫步 MD 配对',
  'clipper.options.subtitle':
    '将网页内容极速保存至本地猫步 MD 知识库。100% 隐私安全，纯本地回环运行。',
  'clipper.options.intro':
    '在 猫步 MD 里打开「设置 → 集成 → HTTP 捕获端点」，启用它，然后把令牌粘贴到这里。',
  'clipper.options.quickGuide': '配对指引',
  'clipper.options.step1': '1. 打开「猫步 MD」桌面客户端。',
  'clipper.options.step2': '2. 进入「设置 → 集成」，开启「HTTP 捕获端点」。',
  'clipper.options.step3': '3. 复制显示的专属令牌，并粘贴到下方输入框中。',
  'clipper.options.sectionEndpoint': '桌面端连接',
  'clipper.options.sectionCapture': '存储与偏好',
  'clipper.options.endpoint': '端点地址',
  'clipper.options.endpointHint': '默认：http://127.0.0.1:7777（仅本机回环 — 数据绝不离开你的电脑）。',
  'clipper.options.resetDefault': '恢复默认',
  'clipper.options.token': '专属令牌 (Bearer Token)',
  'clipper.options.tokenHint': '从 猫步 MD 桌面端「设置 → 集成」中复制粘贴。',
  'clipper.options.paste': '粘贴',
  'clipper.options.tokenVisibility': '显示/隐藏令牌',
  'clipper.options.subfolder': '目标子文件夹（可选）',
  'clipper.options.subfolderHint': '相对于工作区收件箱目录。留空则直接保存在收件箱根目录。',
  'clipper.options.subfolderPlaceholder': '例如：web-clips（留空为收件箱根目录）',
  'clipper.options.notifyOnSuccess': '启用桌面通知',
  'clipper.options.notifyHint': '剪藏成功保存到知识库时弹出系统桌面通知。',
  'clipper.options.locale': '界面语言',
  'clipper.options.localeAuto': '自动（跟随浏览器）',
  'clipper.options.localeEn': 'English',
  'clipper.options.localeZh': '简体中文',
  'clipper.options.themeColor': '主题强调色',
  'clipper.options.themeBlue': '经典蓝',
  'clipper.options.themeAmber': '琥珀橙',
  'clipper.options.themeEmerald': '翠绿',
  'clipper.options.themePurple': '罗兰紫',
  'clipper.options.test': '测试连接',
  'clipper.options.save': '保存配置',
  'clipper.options.saved': '配置已成功保存。',
  'clipper.options.testRunning': '正在测试连接…',
  'clipper.options.testOkPrefix': '已连接 · 当前工作区：',
  'clipper.options.testNoWorkspace': '已成功连接，但 猫步 MD 尚未打开任何工作区文件夹。',
  'clipper.options.testFailPrefix': '连接失败：',

  'clipper.toast.savedPrefix': '已保存到 猫步 MD 收件箱：',
  'clipper.toast.error.generic': '剪藏失败：',
  'clipper.toast.error.notConfigured': '请先在「设置」里填写端点地址和令牌。',
  'clipper.toast.error.endpointDown':
    '猫步 MD 捕获端点未运行 — 请打开 猫步 MD，在「设置 → 集成」里启用它。',
  'clipper.toast.error.badToken': '令牌不正确 — 请从 猫步 MD「设置 → 集成」重新复制。',
  'clipper.toast.error.noWorkspace': '猫步 MD 还没打开任何工作区文件夹 — 请先在客户端打开一个文件夹。',
  'clipper.toast.error.timeout': '猫步 MD 在 10 秒内没有响应。',
  'clipper.toast.error.network': '网络错误 — 猫步 MD 是否正在运行？',

  'clipper.menu.clipPage': '猫步 MD：剪藏整页',
  'clipper.menu.clipSelection': '猫步 MD：剪藏选中内容',
  'clipper.menu.saveLink': '猫步 MD：保存链接',

  'clipper.frontmatter.captured': '剪藏于',
};

const DICTS: Record<string, Dict> = { en: EN, zh: ZH };

let activeDict: Dict = EN;

function pickLocale(prefer: 'auto' | 'en' | 'zh'): 'en' | 'zh' {
  if (prefer === 'en' || prefer === 'zh') return prefer;
  // browser.i18n.getUILanguage returns e.g. "zh-CN", "zh-TW", "en-US".
  let ui = 'en';
  try {
    ui = browser.i18n.getUILanguage() ?? 'en';
  } catch {
    /* options page in some browsers */
  }
  return ui.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * Initialise the active dictionary from settings + browser locale. Safe to
 * call multiple times (re-reads on each call). Call once early in each
 * extension entry point.
 */
export async function initI18n(): Promise<'en' | 'zh'> {
  try {
    const s = await loadSettings();
    const lang = pickLocale(s.locale);
    activeDict = DICTS[lang] ?? EN;
    return lang;
  } catch {
    activeDict = EN;
    return 'en';
  }
}

export function t(key: string, vars?: Record<string, string>): string {
  let out = activeDict[key] ?? EN[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, v);
    }
  }
  return out;
}
