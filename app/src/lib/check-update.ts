import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { reactive } from 'vue';

/**
 * Catstep MD GitHub Release Update Protocol & In-App Auto-Updater.
 *
 * Checks official GitHub repository: maobukeai/catstep-md
 * Supports:
 *  - Checking latest release metadata and changelog
 *  - Resolving best platform asset (.msi/.exe on Windows, .dmg on macOS, .AppImage on Linux)
 *  - Native streaming download with real-time progress & speed
 *  - Silent/one-click background installation & restart
 */

const REPO_OWNER = 'maobukeai';
const REPO_NAME = 'catstep-md';
const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const LATEST_RELEASE_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const JSDELIVR_MIRROR_URL = `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@main/app/package.json`;
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/app/package.json`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
}

export interface UpdateResult {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  url: string;
  /** True when no update source could be reached (offline). */
  error: boolean;
  releaseTitle?: string;
  releaseNotes?: string;
  publishedAt?: string;
  matchedAsset?: ReleaseAsset | null;
  assets?: ReleaseAsset[];
}

export interface PlatformInfo {
  os: string;
  arch: string;
}

export interface UpdateProgressPayload {
  status: 'started' | 'downloading' | 'completed' | 'error' | 'cancelled';
  downloaded: number;
  total: number | null;
  percent: number;
  speed_bps: number;
  file_path: string | null;
  error: string | null;
}

export interface UpdaterSharedState {
  isDownloading: boolean;
  status: 'idle' | 'started' | 'downloading' | 'completed' | 'error' | 'cancelled';
  downloaded: number;
  total: number | null;
  percent: number;
  speedBps: number;
  filePath: string | null;
  error: string | null;
  targetVersion: string | null;
  matchedAsset: ReleaseAsset | null;
}

/** Global reactive updater state shared across components */
export const sharedUpdaterState = reactive<UpdaterSharedState>({
  isDownloading: false,
  status: 'idle',
  downloaded: 0,
  total: null,
  percent: 0,
  speedBps: 0,
  filePath: null,
  error: null,
  targetVersion: null,
  matchedAsset: null,
});

let unlistenProgress: UnlistenFn | null = null;

/** Setup listener for native updater events */
export async function initUpdaterEventListener(): Promise<void> {
  if (unlistenProgress) return;
  try {
    unlistenProgress = await listen<UpdateProgressPayload>('updater-progress', (event) => {
      const p = event.payload;
      sharedUpdaterState.status = p.status;
      sharedUpdaterState.downloaded = p.downloaded;
      sharedUpdaterState.total = p.total;
      sharedUpdaterState.percent = p.percent;
      sharedUpdaterState.speedBps = p.speed_bps;
      sharedUpdaterState.filePath = p.file_path;
      sharedUpdaterState.error = p.error;

      if (p.status === 'started' || p.status === 'downloading') {
        sharedUpdaterState.isDownloading = true;
      } else {
        sharedUpdaterState.isDownloading = false;
      }
    });
  } catch (e) {
    console.warn('Failed to listen to updater-progress event:', e);
  }
}

/** Returns semver comparison: 1 if a > b, -1 if a < b, 0 if equal */
export function compareSemver(a: string, b: string): number {
  const clean = (s: string) => s.replace(/^v/, '').split('-')[0].trim();
  const pa = clean(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = clean(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

const MAS_BUILD = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAS_BUILD === '1');
export const isMasBuild = (): boolean => MAS_BUILD;

/** Get platform and architecture from Rust backend */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  try {
    return await invoke<PlatformInfo>('updater_get_platform_info');
  } catch {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const os = /android/i.test(ua)
      ? 'android'
      : /iphone|ipad|ipod/i.test(ua)
        ? 'ios'
        : /windows/i.test(ua)
          ? 'windows'
          : /mac/i.test(ua)
            ? 'macos'
            : /linux/i.test(ua)
              ? 'linux'
              : 'unknown';
    const arch = /arm64|aarch64/i.test(ua) ? 'aarch64' : /arm/i.test(ua) ? 'arm' : 'x86_64';
    return { os, arch };
  }
}

/** Select the best download asset for current OS and architecture */
export function pickBestAsset(assets: ReleaseAsset[], platform: PlatformInfo): ReleaseAsset | null {
  if (!assets || assets.length === 0) return null;
  const os = platform.os.toLowerCase();
  const arch = platform.arch.toLowerCase();

  const isArm = arch.includes('arm') || arch.includes('aarch64');

  if (os === 'windows') {
    // Priority: .msi matching architecture, then .exe matching architecture, then any .msi, then any .exe
    const msiArm = assets.find(a => a.name.endsWith('.msi') && (a.name.includes('arm64') || a.name.includes('arm')));
    const msiX64 = assets.find(a => a.name.endsWith('.msi') && (a.name.includes('x64') || a.name.includes('x86_64')));
    const exeArm = assets.find(a => a.name.endsWith('.exe') && (a.name.includes('arm64') || a.name.includes('arm')));
    const exeX64 = assets.find(a => a.name.endsWith('.exe') && (a.name.includes('x64') || a.name.includes('setup')));

    if (isArm && (msiArm || exeArm)) return msiArm || exeArm || null;
    if (msiX64) return msiX64;
    if (exeX64) return exeX64;
    const anyMsi = assets.find(a => a.name.endsWith('.msi'));
    if (anyMsi) return anyMsi;
    const anyExe = assets.find(a => a.name.endsWith('.exe'));
    if (anyExe) return anyExe;
  } else if (os === 'macos') {
    const dmgArm = assets.find(a => a.name.endsWith('.dmg') && (a.name.includes('aarch64') || a.name.includes('arm64')));
    const dmgX64 = assets.find(a => a.name.endsWith('.dmg') && a.name.includes('x64'));
    if (isArm && dmgArm) return dmgArm;
    if (!isArm && dmgX64) return dmgX64;
    const anyDmg = assets.find(a => a.name.endsWith('.dmg'));
    if (anyDmg) return anyDmg;
  } else if (os === 'linux') {
    const appImage = assets.find(a => a.name.endsWith('.AppImage') && (isArm ? (a.name.includes('arm') || a.name.includes('aarch64')) : !a.name.includes('arm')));
    if (appImage) return appImage;
    const deb = assets.find(a => a.name.endsWith('.deb'));
    if (deb) return deb;
  } else if (os === 'android') {
    // Android APK assets:
    // Priority: arch-specific (arm64-v8a / aarch64, armeabi-v7a / armv7, x86_64) -> universal -> any .apk
    const isArm64 = arch.includes('arm64') || arch.includes('aarch64') || arch.includes('v8a');
    const isArmV7 = arch.includes('armv7') || arch.includes('v7a') || (arch.includes('arm') && !isArm64);
    const isX86_64 = arch.includes('x86_64') || arch.includes('x64');

    if (isArm64) {
      const apkArm64 = assets.find(a => a.name.endsWith('.apk') && (a.name.includes('arm64') || a.name.includes('v8a') || a.name.includes('aarch64')));
      if (apkArm64) return apkArm64;
    } else if (isArmV7) {
      const apkArmV7 = assets.find(a => a.name.endsWith('.apk') && (a.name.includes('v7a') || a.name.includes('armv7') || a.name.includes('armeabi')));
      if (apkArmV7) return apkArmV7;
    } else if (isX86_64) {
      const apkX86 = assets.find(a => a.name.endsWith('.apk') && (a.name.includes('x86_64') || a.name.includes('x64')));
      if (apkX86) return apkX86;
    }

    // Universal APK fallback
    const apkUniversal = assets.find(a => a.name.endsWith('.apk') && a.name.includes('universal'));
    if (apkUniversal) return apkUniversal;

    // Any APK fallback
    const anyApk = assets.find(a => a.name.endsWith('.apk'));
    if (anyApk) return anyApk;
  }

  // Fallback: pick any common installer or archive
  return assets[0] || null;
}

interface GitHubReleaseJson {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  assets?: Array<{
    name: string;
    browser_download_url: string;
    size: number;
    content_type?: string;
  }>;
}

/** Fetch latest release info from GitHub official Releases API */
async function fetchFromGitHubApi(): Promise<UpdateResult | null> {
  try {
    const current = await getVersion().catch(() => '1.0.1');
    const res = await fetch(GITHUB_API_URL, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CatstepMD-App',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubReleaseJson;
    const tag = (data.tag_name || '').replace(/^v/, '').trim();
    if (!tag) return null;

    const assets: ReleaseAsset[] = (data.assets || []).map(a => ({
      name: a.name,
      browser_download_url: a.browser_download_url,
      size: a.size,
      content_type: a.content_type,
    }));

    const platform = await getPlatformInfo();
    const matchedAsset = pickBestAsset(assets, platform);
    const hasUpdate = compareSemver(tag, current) > 0;

    return {
      current,
      latest: tag,
      hasUpdate,
      url: data.html_url || LATEST_RELEASE_PAGE,
      error: false,
      releaseTitle: data.name || `v${tag}`,
      releaseNotes: data.body || '',
      publishedAt: data.published_at || '',
      matchedAsset,
      assets,
    };
  } catch {
    return null;
  }
}

/** Fetch latest release by following GitHub's web release redirect (fallback) */
async function fetchFromGitHubWebRedirect(): Promise<UpdateResult | null> {
  try {
    const current = await getVersion().catch(() => '1.0.1');
    const res = await fetch(LATEST_RELEASE_PAGE, {
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const tagMatch = res.url.match(/\/releases\/tag\/v?([^/?#]+)/);
    if (tagMatch && tagMatch[1]) {
      const tag = tagMatch[1].replace(/^v/, '').trim();
      const hasUpdate = compareSemver(tag, current) > 0;
      return {
        current,
        latest: tag,
        hasUpdate,
        url: res.url,
        error: false,
        releaseTitle: `v${tag}`,
        releaseNotes: '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch repository latest package version from GitHub Raw / jsDelivr mirror (fallback) */
async function fetchFromRepoMirror(): Promise<UpdateResult | null> {
  const current = await getVersion().catch(() => '1.0.1');
  for (const url of [GITHUB_RAW_URL, JSDELIVR_MIRROR_URL]) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const pkg = (await res.json()) as { version?: string };
        if (pkg.version) {
          const tag = pkg.version.replace(/^v/, '').trim();
          const hasUpdate = compareSemver(tag, current) > 0;
          return {
            current,
            latest: tag,
            hasUpdate,
            url: LATEST_RELEASE_PAGE,
            error: false,
            releaseTitle: `v${tag}`,
            releaseNotes: '',
          };
        }
      }
    } catch {
      // Continue to next mirror
    }
  }
  return null;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = await getVersion().catch(() => '1.0.1');
  if (MAS_BUILD) {
    return { current, latest: null, hasUpdate: false, url: '', error: false };
  }

  // Multi-tier check: GitHub API (full assets + notes) -> Web Redirect -> Fast Mirror
  let info = await fetchFromGitHubApi();
  if (!info) info = await fetchFromGitHubWebRedirect();
  if (!info) info = await fetchFromRepoMirror();

  if (!info) {
    return {
      current,
      latest: null,
      hasUpdate: false,
      url: RELEASES_PAGE,
      error: true,
    };
  }

  return info;
}

/** Start downloading update package with real-time progress */
export async function startUpdateDownload(asset: ReleaseAsset, version: string): Promise<string> {
  await initUpdaterEventListener();

  sharedUpdaterState.targetVersion = version;
  sharedUpdaterState.matchedAsset = asset;
  sharedUpdaterState.isDownloading = true;
  sharedUpdaterState.status = 'started';
  sharedUpdaterState.error = null;
  sharedUpdaterState.downloaded = 0;
  sharedUpdaterState.total = asset.size || null;
  sharedUpdaterState.percent = 0;

  try {
    const downloadedPath = await invoke<string>('updater_start_download', {
      url: asset.browser_download_url,
      filename: asset.name,
    });
    sharedUpdaterState.filePath = downloadedPath;
    sharedUpdaterState.status = 'completed';
    sharedUpdaterState.percent = 100;
    sharedUpdaterState.isDownloading = false;
    return downloadedPath;
  } catch (e) {
    sharedUpdaterState.isDownloading = false;
    sharedUpdaterState.status = 'error';
    sharedUpdaterState.error = String(e);
    throw e;
  }
}

/** Cancel ongoing download */
export async function cancelUpdateDownload(): Promise<void> {
  try {
    await invoke('updater_cancel_download');
    sharedUpdaterState.isDownloading = false;
    sharedUpdaterState.status = 'cancelled';
  } catch (e) {
    console.error('Failed to cancel update download:', e);
  }
}

/** Execute installer and gracefully restart app */
export async function installUpdateAndRestart(filePath?: string, silent: boolean = false): Promise<void> {
  const path = filePath || sharedUpdaterState.filePath;
  if (!path) {
    throw new Error('No downloaded installer file available');
  }
  await invoke('updater_install_and_restart', {
    filePath: path,
    silent,
  });
}

/** Format bytes into human-readable size */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/** Open GitHub Release page in external browser */
export async function openReleaseUrl(url?: string): Promise<void> {
  const target = url && url.startsWith('http') ? url : LATEST_RELEASE_PAGE;
  try {
    await openUrl(target);
  } catch (e) {
    console.error('Failed to open release url', e);
  }
}

/** Store the last-checked timestamp so we don't query excessively on launch */
const LS_KEY = 'catstep.update.last-check';
const CHECK_INTERVAL = 24 * 3600 * 1000; // 24 hours

export async function checkForUpdateOnStartup(): Promise<UpdateResult | null> {
  if (MAS_BUILD) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const ts = Number(raw);
      if (Date.now() - ts < CHECK_INTERVAL) return null;
    }
  } catch {}
  const result = await checkForUpdate();
  if (!result.error) {
    try {
      localStorage.setItem(LS_KEY, String(Date.now()));
    } catch {}
  }
  return result;
}
