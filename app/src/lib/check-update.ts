import { getVersion } from '@tauri-apps/api/app';
// Deliberate raw `invoke` — this module IS the single facade for the updater_*
// family; see the tail note in lib/commands.ts. Its error strings (e.g. the
// "Command updater_start_download not found" downgrade hint below) are matched
// verbatim by the UI, so the bridge must not re-wrap the rejection shape.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { reactive, watch } from 'vue';
import { isAndroid, isIOS, isMacOS } from './platform';

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
  status: 'started' | 'downloading' | 'verifying' | 'completed' | 'error' | 'cancelled';
  downloaded: number;
  total: number | null;
  percent: number;
  speed_bps: number;
  file_path: string | null;
  error: string | null;
}

export interface UpdaterSharedState {
  isDownloading: boolean;
  status: 'idle' | UpdateProgressPayload['status'] | 'preparing' | 'installing';
  isInstalling: boolean;
  downloaded: number;
  total: number | null;
  percent: number;
  speedBps: number;
  filePath: string | null;
  error: string | null;
  targetVersion: string | null;
  matchedAsset: ReleaseAsset | null;
  updateInfo: UpdateResult | null;
  installError: string | null;
  autoInstallCountdown: number | null;
  autoInstallDeferred: boolean;
}

/** Global reactive updater state shared across components */
export const sharedUpdaterState = reactive<UpdaterSharedState>({
  isDownloading: false,
  status: 'idle',
  isInstalling: false,
  downloaded: 0,
  total: null,
  percent: 0,
  speedBps: 0,
  filePath: null,
  error: null,
  targetVersion: null,
  matchedAsset: null,
  updateInfo: null,
  installError: null,
  autoInstallCountdown: null,
  autoInstallDeferred: false,
});

let unlistenProgress: UnlistenFn | null = null;
let listenerPromise: Promise<void> | null = null;
let downloadPromise: Promise<string> | null = null;
let installPromise: Promise<boolean> | null = null;
let downloadCancelled = false;

/** Setup listener for native updater events */
export function initUpdaterEventListener(): Promise<void> {
  if (unlistenProgress) return Promise.resolve();
  if (listenerPromise) return listenerPromise;
  listenerPromise = listen<UpdateProgressPayload>('updater-progress', (event) => {
      // Rust directs progress to the downloading window. Keep late terminal
      // events from changing a later install or a completed cancellation.
      if (!downloadPromise || sharedUpdaterState.isInstalling) return;
      const p = event.payload;
      if (downloadCancelled && p.status !== 'cancelled') return;
      if (p.status === 'cancelled') downloadCancelled = true;
      // Completion is actionable only after the owning IPC has returned its
      // verified path. Until then keep the UI in the non-installable phase.
      sharedUpdaterState.status = p.status === 'completed' ? 'verifying' : p.status;
      sharedUpdaterState.downloaded = p.downloaded;
      sharedUpdaterState.total = p.total;
      sharedUpdaterState.percent = p.percent;
      sharedUpdaterState.speedBps = p.speed_bps;
      sharedUpdaterState.filePath = p.file_path;
      sharedUpdaterState.error = p.error;

      if (p.status === 'started' || p.status === 'downloading' || p.status === 'verifying' || p.status === 'completed') {
        sharedUpdaterState.isDownloading = true;
      } else {
        sharedUpdaterState.isDownloading = false;
      }
    }).then((unlisten) => { unlistenProgress = unlisten; })
    .finally(() => { listenerPromise = null; });
  return listenerPromise;
}

/** Returns semver comparison: 1 if a > b, -1 if a < b, 0 if equal */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string) => value.trim().replace(/^[vV]/, '').match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  const pa = parse(a);
  const pb = parse(b);
  // An invalid/unavailable version must never manufacture an upgrade.
  if (!pa || !pb) return 0;
  const compareNumeric = (left: string, right: string) => {
    const l = left.replace(/^0+(?=\d)/, '');
    const r = right.replace(/^0+(?=\d)/, '');
    return l.length !== r.length ? Math.sign(l.length - r.length) : l === r ? 0 : l > r ? 1 : -1;
  };
  for (let i = 1; i <= 3; i++) {
    const result = compareNumeric(pa[i], pb[i]);
    if (result) return result;
  }
  if (!pa[4] || !pb[4]) return pa[4] === pb[4] ? 0 : pa[4] ? -1 : 1;
  const left = pa[4].split('.');
  const right = pb[4].split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const ln = /^\d+$/.test(left[i]);
    const rn = /^\d+$/.test(right[i]);
    const result = ln && rn ? compareNumeric(left[i], right[i])
      : ln !== rn ? ln ? -1 : 1 : left[i] === right[i] ? 0 : left[i] > right[i] ? 1 : -1;
    if (result) return result;
  }
  return 0;
}

const MAS_BUILD = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAS_BUILD === '1');
export const isMasBuild = (): boolean => MAS_BUILD;

let cachedPlatform: PlatformInfo | null = null;

/** Synchronously resolve platform info from navigator UA or cache */
export function getPlatformInfoSync(): PlatformInfo {
  if (cachedPlatform) return cachedPlatform;
  if (typeof process !== 'undefined' && process.platform) {
    const os =
      process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
          ? 'macos'
          : process.platform === 'linux'
            ? 'linux'
            : process.platform === 'android'
              ? 'android'
              : 'unknown';
    const arch =
      process.arch === 'arm64' ? 'aarch64' : process.arch === 'arm' ? 'arm' : 'x86_64';
    if (os !== 'unknown') {
      return { os, arch };
    }
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = isAndroid()
    ? 'android'
    : isIOS()
      ? 'ios'
      : /windows/i.test(ua)
        ? 'windows'
        : isMacOS()
          ? 'macos'
          : /linux/i.test(ua)
            ? 'linux'
            : 'unknown';
  const arch = /\b(arm64|aarch64)\b/i.test(ua)
    ? 'aarch64'
    : /\b(arm|armv7l|armv8l|armeabi)\b/i.test(ua)
      ? 'arm'
      : 'x86_64';
  return { os, arch };
}

/** Get platform and architecture from Rust backend */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (cachedPlatform) return cachedPlatform;
  try {
    cachedPlatform = await invoke<PlatformInfo>('updater_get_platform_info');
    return cachedPlatform;
  } catch {
    cachedPlatform = getPlatformInfoSync();
    return cachedPlatform;
  }
}

/**
 * Synthesizes standard release asset metadata for Catstep MD official GitHub releases.
 * Naming templates for CI metadata/tests only. Update resolution deliberately
 * never uses these templates as evidence that a downloadable asset exists.
 */
export function synthesizeReleaseAssets(tag: string): ReleaseAsset[] {
  const cleanTag = tag.replace(/^v/, '').trim();
  const baseUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${cleanTag}`;

  const assetNames: string[] = [
    // Windows: MSI installers, portable archives and setup executables
    `CatstepMD_${cleanTag}_x64_en-US.msi`,
    `CatstepMD_${cleanTag}_arm64_en-US.msi`,
    `CatstepMD_${cleanTag}_x64.msi`,
    `CatstepMD_${cleanTag}_arm64.msi`,
    `CatstepMD_${cleanTag}_x64-setup.exe`,
    `CatstepMD_${cleanTag}_arm64-setup.exe`,
    // macOS: Apple Silicon and Intel disk images
    `CatstepMD_${cleanTag}_aarch64.dmg`,
    `CatstepMD_${cleanTag}_x64.dmg`,
    `CatstepMD_${cleanTag}_universal.dmg`,
    // Linux: AppImage bundles, deb packages and rpm packages
    `CatstepMD_${cleanTag}_amd64.AppImage`,
    `CatstepMD_${cleanTag}_aarch64.AppImage`,
    `CatstepMD_${cleanTag}_amd64.deb`,
    `CatstepMD_${cleanTag}_arm64.deb`,
    `CatstepMD-${cleanTag}-1.x86_64.rpm`,
    `CatstepMD-${cleanTag}-1.aarch64.rpm`,
    // Android: universal APK matches official CI release artifact (CatstepMD_<version>_universal.apk)
    `CatstepMD_${cleanTag}_universal.apk`,
  ];

  return assetNames.map((name) => ({
    name,
    browser_download_url: `${baseUrl}/${name}`,
    size: 0,
  }));
}

/**
 * Resolves the best matching asset for current or specified platform,
 * using updateInfo.matchedAsset if present, or picking from updateInfo.assets,
 * Assets must come from a published release. A version number alone does not
 * prove that a compatible installer was built or uploaded.
 */
export function resolveMatchedAsset(
  updateInfo: UpdateResult | null,
  platform?: PlatformInfo,
): ReleaseAsset | null {
  if (!updateInfo) return null;
  if (updateInfo.matchedAsset) return updateInfo.matchedAsset;
  const plat = platform || getPlatformInfoSync();
  if (updateInfo.assets && updateInfo.assets.length > 0) {
    const match = pickBestAsset(updateInfo.assets, plat);
    if (match) return match;
  }
  return null;
}

/** Select the best download asset for current OS and architecture */
export function pickBestAsset(assets: ReleaseAsset[], platform: PlatformInfo): ReleaseAsset | null {
  if (!assets || assets.length === 0) return null;
  const os = platform.os.toLowerCase();
  const arch = platform.arch.toLowerCase();

  const isArm = arch.includes('arm') || arch.includes('aarch64');

  if (os === 'windows') {
    // Priority: .msi matching architecture, then .exe matching architecture
    const msiArm = assets.find(a => a.name.toLowerCase().endsWith('.msi') && (a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('arm')));
    const msiX64 = assets.find(a => a.name.toLowerCase().endsWith('.msi') && (a.name.toLowerCase().includes('x64') || a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('amd64')));
    const exeArm = assets.find(a => a.name.toLowerCase().endsWith('.exe') && (a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('arm')));
    const exeX64 = assets.find(a => a.name.toLowerCase().endsWith('.exe') && !/arm|aarch64/i.test(a.name) && (a.name.toLowerCase().includes('x64') || a.name.toLowerCase().includes('setup') || a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('amd64')));

    if (isArm && (msiArm || exeArm)) return msiArm || exeArm || null;
    if (!isArm && msiX64) return msiX64;
    if (!isArm && exeX64) return exeX64;
    if (isArm && msiX64) return msiX64;
    if (isArm && exeX64) return exeX64;
    // Architecture safety: if not ARM, do NOT return an ARM binary
    const anyMsi = assets.find(a => a.name.toLowerCase().endsWith('.msi') && (isArm || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (anyMsi) return anyMsi;
    const anyExe = assets.find(a => a.name.toLowerCase().endsWith('.exe') && (isArm || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (anyExe) return anyExe;
  } else if (os === 'macos') {
    const dmgArm = assets.find(a => a.name.toLowerCase().endsWith('.dmg') && (a.name.toLowerCase().includes('aarch64') || a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('arm')));
    const dmgX64 = assets.find(a => a.name.toLowerCase().endsWith('.dmg') && (a.name.toLowerCase().includes('x64') || a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('intel')));
    const dmgUniversal = assets.find(a => a.name.toLowerCase().endsWith('.dmg') && a.name.toLowerCase().includes('universal'));
    if (isArm && dmgArm) return dmgArm;
    if (!isArm && dmgX64) return dmgX64;
    if (dmgUniversal) return dmgUniversal;
    // Apple Silicon can run Intel x64 DMGs via Rosetta 2
    if (isArm && dmgX64) return dmgX64;
    // Architecture safety: if not ARM, do NOT return an ARM binary
    const anyDmg = assets.find(a => a.name.toLowerCase().endsWith('.dmg') && (isArm || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (anyDmg) return anyDmg;
  } else if (os === 'linux') {
    const appImageArm = assets.find(a => a.name.toLowerCase().endsWith('.appimage') && (a.name.toLowerCase().includes('arm') || a.name.toLowerCase().includes('aarch64')));
    const appImageX64 = assets.find(a => a.name.toLowerCase().endsWith('.appimage') && (a.name.toLowerCase().includes('amd64') || a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('x64') || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (isArm && appImageArm) return appImageArm;
    if (!isArm && appImageX64) return appImageX64;
    const anyAppImage = assets.find(a => a.name.toLowerCase().endsWith('.appimage') && (isArm || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (anyAppImage) return anyAppImage;
    const debArm = assets.find(a => a.name.toLowerCase().endsWith('.deb') && (a.name.toLowerCase().includes('arm') || a.name.toLowerCase().includes('aarch64')));
    const debX64 = assets.find(a => a.name.toLowerCase().endsWith('.deb') && (a.name.toLowerCase().includes('amd64') || a.name.toLowerCase().includes('x86_64') || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (isArm && debArm) return debArm;
    if (!isArm && debX64) return debX64;
    const anyDeb = assets.find(a => a.name.toLowerCase().endsWith('.deb') && (isArm || (!a.name.toLowerCase().includes('arm') && !a.name.toLowerCase().includes('aarch64'))));
    if (anyDeb) return anyDeb;
  } else if (os === 'android') {
    // Android APK assets:
    // Priority: arch-specific (arm64-v8a / aarch64, armeabi-v7a / armv7, x86_64) -> universal -> any .apk
    const isArm64 = arch.includes('arm64') || arch.includes('aarch64') || arch.includes('v8a');
    const isArmV7 = arch.includes('armv7') || arch.includes('v7a') || (arch.includes('arm') && !isArm64);
    const isX86_64 = arch.includes('x86_64') || arch.includes('x64');

    if (isArm64) {
      const apkArm64 = assets.find(a => a.name.toLowerCase().endsWith('.apk') && (a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('v8a') || a.name.toLowerCase().includes('aarch64')));
      if (apkArm64) return apkArm64;
    } else if (isArmV7) {
      const apkArmV7 = assets.find(a => a.name.toLowerCase().endsWith('.apk') && (a.name.toLowerCase().includes('v7a') || a.name.toLowerCase().includes('armv7') || a.name.toLowerCase().includes('armeabi')));
      if (apkArmV7) return apkArmV7;
    } else if (isX86_64) {
      const apkX86 = assets.find(a => a.name.toLowerCase().endsWith('.apk') && (a.name.toLowerCase().includes('x86_64') || a.name.toLowerCase().includes('x64')));
      if (apkX86) return apkX86;
    }

    // Universal APK fallback
    const apkUniversal = assets.find(a => a.name.toLowerCase().endsWith('.apk') && a.name.toLowerCase().includes('universal'));
    if (apkUniversal) return apkUniversal;

    // Any APK fallback
    const anyApk = assets.find(a => a.name.toLowerCase().endsWith('.apk'));
    if (anyApk) return anyApk;
  }

  // No suitable asset for this OS/platform architecture
  return null;
}

interface GitHubReleaseJson {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
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
    const current = await getVersion().catch(() => '1.0.13');
    const res = await fetch(GITHUB_API_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3500),
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CatstepMD-App',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GitHubReleaseJson;
    const tag = (data.tag_name || '').replace(/^v/, '').trim();
    if (!tag || data.draft || data.prerelease) return null;

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
    const current = await getVersion().catch(() => '1.0.13');
    const res = await fetch(LATEST_RELEASE_PAGE, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const tagMatch = res.url.match(/\/releases\/tag\/v?([^/?#]+)/);
    if (tagMatch && tagMatch[1]) {
      const tag = tagMatch[1].replace(/^v/, '').trim();
      const hasUpdate = compareSemver(tag, current) > 0;
      // A real release redirect proves the version exists, but not which
      // architectures finished building. Without API asset metadata, offer
      // the release page rather than guessing an executable URL.
      const assets: ReleaseAsset[] = [];
      return {
        current,
        latest: tag,
        hasUpdate,
        url: res.url,
        error: false,
        releaseTitle: `v${tag}`,
        releaseNotes: '',
        assets,
        matchedAsset: null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = await getVersion().catch(() => '1.0.13');
  if (MAS_BUILD) {
    return { current, latest: null, hasUpdate: false, url: '', error: false };
  }

  // The repository's main branch is not a published release channel.
  let info = await fetchFromGitHubApi();
  if (!info) info = await fetchFromGitHubWebRedirect();

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

export interface UpdateInstallContext { automatic: boolean }
type PrepareInstall = (context: UpdateInstallContext) => boolean | Promise<boolean>;
interface AutoInstallPolicy {
  enabled: () => boolean;
  onError?: (error: unknown) => void;
  onStarting?: () => void;
}
let prepareInstall: PrepareInstall | null = null;
let autoPolicy: AutoInstallPolicy | null = null;
let stopAutoPolicy: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoGeneration = 0;
let downloadSequence = 0;
let cancelledAutoTarget: string | null = null;

function targetKey(): string {
  return `${downloadSequence}:${sharedUpdaterState.targetVersion}:${sharedUpdaterState.matchedAsset?.browser_download_url}`;
}

function clearAutoTimer() {
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = null;
  sharedUpdaterState.autoInstallCountdown = null;
  sharedUpdaterState.autoInstallDeferred = false;
  autoGeneration += 1;
}

/** Shared by every modal and the background updater; cancellation survives
 * closing/reopening a modal until a new download or an explicit setting change. */
export function cancelAutoInstall(): void {
  cancelledAutoTarget = targetKey();
  clearAutoTimer();
}

function canAutoInstall(key: string, preparing = false): boolean {
  return key === targetKey() && cancelledAutoTarget !== key && !!autoPolicy?.enabled()
    && !!sharedUpdaterState.filePath && !downloadPromise
    && (sharedUpdaterState.status === 'completed' || (preparing && sharedUpdaterState.status === 'preparing'));
}

function scheduleAutoInstall() {
  const key = targetKey();
  if (autoTimer !== null || installPromise || !canAutoInstall(key)) return;
  const generation = autoGeneration;
  const attempt = async () => {
    if (generation !== autoGeneration || !canAutoInstall(key)) return;
    sharedUpdaterState.autoInstallCountdown = null;
    try {
      const installed = await installUpdateAndRestart(undefined, true, { automatic: true });
      if (!installed && generation === autoGeneration && canAutoInstall(key)) {
        // A dirty buffer or active composition postpones automatic updates.
        // Poll the guard; never save or discard the note to make it pass.
        sharedUpdaterState.autoInstallDeferred = true;
        autoTimer = setTimeout(() => { autoTimer = null; void attempt(); }, 5000);
      }
    } catch (error) {
      if (generation === autoGeneration) autoPolicy?.onError?.(error);
    }
  };
  const tick = (seconds: number) => {
    if (generation !== autoGeneration || !canAutoInstall(key)) return;
    sharedUpdaterState.autoInstallCountdown = seconds;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (seconds > 1) tick(seconds - 1);
      else void attempt();
    }, 1000);
  };
  tick(3);
}

/** App owns the editor/session guard. No install IPC is allowed without it. */
export function registerUpdateInstallPreparation(prepare: PrepareInstall): () => void {
  prepareInstall = prepare;
  return () => { if (prepareInstall === prepare) prepareInstall = null; };
}

/** One scheduler per webview. Only the main editor enables background updates. */
export function configureAutoInstall(policy: AutoInstallPolicy): () => void {
  stopAutoPolicy?.();
  clearAutoTimer();
  autoPolicy = policy;
  stopAutoPolicy = watch(policy.enabled, (enabled) => {
    clearAutoTimer();
    if (enabled) {
      cancelledAutoTarget = null;
      scheduleAutoInstall();
    }
  }, { immediate: true, flush: 'sync' });
  return () => {
    if (autoPolicy !== policy) return;
    stopAutoPolicy?.();
    stopAutoPolicy = null;
    autoPolicy = null;
    clearAutoTimer();
  };
}

/** Start one download, coalescing all modal/background requests until it settles. */
export function startUpdateDownload(asset: ReleaseAsset, version: string, updateInfo?: UpdateResult): Promise<string> {
  if (downloadPromise) return downloadPromise;
  if (sharedUpdaterState.isInstalling) return Promise.reject(new Error('Update installation is already in progress'));
  clearAutoTimer();
  cancelledAutoTarget = null;
  downloadSequence += 1;
  downloadCancelled = false;
  sharedUpdaterState.targetVersion = version;
  sharedUpdaterState.matchedAsset = asset;
  sharedUpdaterState.updateInfo = updateInfo || {
    current: '', latest: version, hasUpdate: true, error: false,
    url: LATEST_RELEASE_PAGE, matchedAsset: asset, assets: [asset],
  };
  sharedUpdaterState.isDownloading = true;
  sharedUpdaterState.status = 'started';
  sharedUpdaterState.error = null;
  sharedUpdaterState.installError = null;
  sharedUpdaterState.filePath = null;
  sharedUpdaterState.downloaded = 0;
  sharedUpdaterState.total = asset.size || null;
  sharedUpdaterState.percent = 0;
  sharedUpdaterState.speedBps = 0;

  downloadPromise = (async () => {
    try {
      await initUpdaterEventListener();
      if (downloadCancelled) throw new Error('Download cancelled by user');
      const downloadedPath = await invoke<string>('updater_start_download', {
        url: asset.browser_download_url,
        filename: asset.name,
      });
      if (downloadCancelled) throw new Error('Download cancelled by user');
      sharedUpdaterState.filePath = downloadedPath;
      sharedUpdaterState.status = 'completed';
      sharedUpdaterState.percent = 100;
      return downloadedPath;
    } catch (e) {
      sharedUpdaterState.filePath = null;
      if (downloadCancelled || /download cancelled by user/i.test(String(e))) {
        sharedUpdaterState.status = 'cancelled';
        sharedUpdaterState.error = null;
      } else {
        sharedUpdaterState.status = 'error';
        sharedUpdaterState.error = String(e);
      }
      throw e;
    } finally {
      sharedUpdaterState.isDownloading = false;
      sharedUpdaterState.speedBps = 0;
      downloadPromise = null;
      if (sharedUpdaterState.status === 'completed') scheduleAutoInstall();
    }
  })();
  return downloadPromise;
}

/** Cancel ongoing download */
export async function cancelUpdateDownload(): Promise<void> {
  if (!downloadPromise) return;
  cancelAutoInstall();
  downloadCancelled = true;
  try {
    await invoke('updater_cancel_download');
    sharedUpdaterState.isDownloading = false;
    sharedUpdaterState.status = 'cancelled';
    sharedUpdaterState.filePath = null;
    sharedUpdaterState.error = null;
  } catch (e) {
    downloadCancelled = false;
    throw e;
  }
}

/** Persist/flush first, then launch at most one installer. Successful launch
 * stays installing until native shutdown; repeat clicks cannot spawn again. */
export function installUpdateAndRestart(
  filePath?: string,
  silent: boolean = false,
  context: UpdateInstallContext = { automatic: false },
): Promise<boolean> {
  if (installPromise) return installPromise;
  if (sharedUpdaterState.status === 'installing') return Promise.resolve(true);
  const path = filePath || sharedUpdaterState.filePath;
  if (!path || path !== sharedUpdaterState.filePath || sharedUpdaterState.status !== 'completed' || downloadPromise) {
    return Promise.reject(new Error('No completed, verified update is ready to install'));
  }
  const key = targetKey();
  if (!context.automatic) cancelAutoInstall();
  const generation = autoGeneration;
  sharedUpdaterState.isInstalling = true;
  sharedUpdaterState.status = 'preparing';
  sharedUpdaterState.installError = null;
  installPromise = (async () => {
    try {
      // Publish the single-flight promise before invoking user/editor code.
      await Promise.resolve();
      if (!prepareInstall) throw new Error('The editor is not ready to prepare an update');
      const ready = await prepareInstall(context);
      if (!ready || (context.automatic && (generation !== autoGeneration || !canAutoInstall(key, true)))) {
        sharedUpdaterState.status = 'completed';
        sharedUpdaterState.isInstalling = false;
        return false;
      }
      if (key !== targetKey() || path !== sharedUpdaterState.filePath) throw new Error('The update target changed before installation');
      sharedUpdaterState.status = 'installing';
      sharedUpdaterState.autoInstallDeferred = false;
      if (context.automatic) autoPolicy?.onStarting?.();
      await invoke('updater_install_and_restart', { filePath: path, silent });
      return true;
    } catch (error) {
      sharedUpdaterState.isInstalling = false;
      sharedUpdaterState.status = 'completed';
      sharedUpdaterState.installError = String(error);
      throw error;
    } finally {
      installPromise = null;
    }
  })();
  return installPromise;
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

/** Store the last-checked timestamp */
const LS_KEY = 'catstep.update.last-check';
// 10s debounce to prevent double-invocation during rapid re-mounts / hot reloads
const CHECK_MIN_INTERVAL = 10 * 1000;

export async function checkForUpdateOnStartup(force: boolean = true): Promise<UpdateResult | null> {
  if (MAS_BUILD) return null;
  if (!force) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const ts = Number(raw);
        if (Date.now() - ts < CHECK_MIN_INTERVAL) return null;
      }
    } catch {}
  }
  const result = await checkForUpdate();
  if (!result.error) {
    try {
      localStorage.setItem(LS_KEY, String(Date.now()));
    } catch {}
  }
  return result;
}
