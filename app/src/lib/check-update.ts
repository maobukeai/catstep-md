import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * CatStep MD GitHub Release Update Protocol.
 *
 * Checks official GitHub repository: maobukeai/catstep-md
 *
 * Sources in priority order:
 *   1. GitHub Official Releases API:
 *      https://api.github.com/repos/maobukeai/catstep-md/releases/latest
 *   2. GitHub Releases Web Page (Extracts redirect destination /tag/vX.Y.Z, no API rate limits):
 *      https://github.com/maobukeai/catstep-md/releases/latest
 *   3. jsDelivr / GitHub Raw mirror fallback (Mainland China friendly, 0 rate limit):
 *      https://fastly.jsdelivr.net/gh/maobukeai/catstep-md@main/app/package.json
 *
 * Clicking release notification opens the official GitHub release page.
 */

const REPO_OWNER = 'maobukeai';
const REPO_NAME = 'catstep-md';
const RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
const LATEST_RELEASE_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const JSDELIVR_MIRROR_URL = `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@main/app/package.json`;
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/app/package.json`;

export interface UpdateResult {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  url: string;
  /** True when no update source could be reached (offline). */
  error: boolean;
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

const MAS_BUILD = import.meta.env.VITE_MAS_BUILD === '1';

export const isMasBuild = (): boolean => MAS_BUILD;

/** Fetch latest release info from GitHub official Releases API */
async function fetchFromGitHubApi(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(GITHUB_API_URL, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'CatstepMD-App',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const tag = (data.tag_name || '').replace(/^v/, '').trim();
    if (!tag) return null;
    return { tag, url: data.html_url || LATEST_RELEASE_PAGE };
  } catch {
    return null;
  }
}

/** Fetch latest release by following GitHub's web release redirect (not rate-limited) */
async function fetchFromGitHubWebRedirect(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(LATEST_RELEASE_PAGE, {
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const tagMatch = res.url.match(/\/releases\/tag\/v?([^/?#]+)/);
    if (tagMatch && tagMatch[1]) {
      const tag = tagMatch[1].replace(/^v/, '').trim();
      return { tag, url: res.url };
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch repository latest package version from jsDelivr / GitHub Raw mirror */
async function fetchFromRepoMirror(): Promise<{ tag: string; url: string } | null> {
  for (const url of [JSDELIVR_MIRROR_URL, GITHUB_RAW_URL]) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const pkg = (await res.json()) as { version?: string };
        if (pkg.version) {
          const tag = pkg.version.replace(/^v/, '').trim();
          return { tag, url: LATEST_RELEASE_PAGE };
        }
      }
    } catch {
      // Continue to next mirror
    }
  }
  return null;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const current = await getVersion().catch(() => '1.0.0');
  if (MAS_BUILD) {
    return { current, latest: null, hasUpdate: false, url: '', error: false };
  }

  // Multi-tier check: GitHub API -> Web Redirect -> Fast Mirror
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

  const hasUpdate = compareSemver(info.tag, current) > 0;
  return {
    current,
    latest: info.tag,
    hasUpdate,
    url: info.url,
    error: false,
  };
}

/** Open GitHub Release page for download */
export async function openReleaseUrl(url?: string): Promise<void> {
  const target = url && url.startsWith('http') ? url : LATEST_RELEASE_PAGE;
  try {
    await openUrl(target);
  } catch (e) {
    console.error('Failed to open release url', e);
  }
}

/** Store the last-checked timestamp so we don't query excessively on launch. */
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
