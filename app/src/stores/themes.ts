import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';

/**
 * v2.5 — Community theme marketplace store.
 *
 * Two slabs of state:
 *
 *   1. The curator manifest (read-only) — fetched from local
 *      /themes/index.json and cached in memory for
 *      MANIFEST_TTL_MS. Refresh button bypasses the cache.
 *
 *   2. The installed-theme list (mirror of <config_dir>/themes/) — pulled
 *      via `theme_list_installed` after the manifest loads, kept in sync
 *      after every `install` / `uninstall` action.
 *
 * The actual CSS injection still goes through the existing
 * `lib/custom-theme.ts::loadCustomTheme` watcher on
 * `settings.customCssPath` — installing a theme just sets that path. No
 * second watcher, no double-application.
 */

export interface ThemeManifestEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  url: string;
  preview?: string;
  tags?: string[];
  license?: string;
}

export interface ThemeManifest {
  version: number;
  themes: ThemeManifestEntry[];
}

export interface TyporaThemeEntry {
  id: string;
  name: string;
  author: string;
  stars?: string;
  description: string;
  repo: string;
  url: string;
  cdnUrl?: string;
  preview?: string;
  tags?: string[];
  license?: string;
  typoraCompatible?: boolean;
  tone?: 'light' | 'dark';
}

export interface TyporaThemeManifest {
  version: number;
  source?: string;
  updatedAt?: string;
  themes: TyporaThemeEntry[];
}

export interface InstalledTheme {
  id: string;
  name?: string;
  path: string;
  author?: string;
  tone?: 'light' | 'dark';
}

export function resolveThemeTone(theme: { id: string; name?: string; tone?: 'light' | 'dark'; path?: string }): 'light' | 'dark' {
  if (theme.tone) return theme.tone;
  const id = theme.id.toLowerCase();
  const name = (theme.name || '').toLowerCase();
  const path = (theme.path || '').toLowerCase();
  if (
    id.includes('dark') || id.includes('night') || id.includes('black') || id.includes('dracula') ||
    name.includes('dark') || name.includes('night') || name.includes('暗') || name.includes('黑') ||
    path.includes('dark') || path.includes('night') || path.includes('black')
  ) {
    return 'dark';
  }
  return 'light';
}

export interface GitHubRepoSummary {
  id: number;
  name: string;
  full_name: string;
  owner_login: string;
  owner_avatar: string;
  html_url: string;
  description: string;
  stars: number;
  forks: number;
  updated_at: string;
  topics: string[];
  default_branch: string;
}

export interface GitHubSearchResponse {
  total_count: number;
  items: GitHubRepoSummary[];
  rate_limited: boolean;
  message?: string;
}

export interface DiscoveredCssFile {
  id: string;
  name: string;
  file_name: string;
  path: string;
  download_urls: string[];
  size: number;
  is_dark: boolean;
}

const MANIFEST_URL = '/themes/index.json';
const TYPORA_MANIFEST_URL = '/themes/typora-manifest.json';
const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 min

interface State {
  manifest: ThemeManifest | null;
  manifestFetchedAt: number;
  loading: boolean;
  error: string;
  typoraManifest: TyporaThemeManifest | null;
  typoraFetchedAt: number;
  typoraLoading: boolean;
  typoraError: string;
  installed: InstalledTheme[];
  installingId: string;
  // Filter chip state — empty array means "all".
  activeTags: string[];
  // GitHub Live Search state
  githubRepos: GitHubRepoSummary[];
  githubTotal: number;
  githubLoading: boolean;
  githubError: string;
  githubRateLimited: boolean;
  githubSearchQuery: string;
  githubSort: 'stars' | 'updated';
}

export const useThemesStore = defineStore('themes', {
  state: (): State => ({
    manifest: null,
    manifestFetchedAt: 0,
    loading: false,
    error: '',
    typoraManifest: null,
    typoraFetchedAt: 0,
    typoraLoading: false,
    typoraError: '',
    installed: [],
    installingId: '',
    activeTags: [],
    githubRepos: [],
    githubTotal: 0,
    githubLoading: false,
    githubError: '',
    githubRateLimited: false,
    githubSearchQuery: '',
    githubSort: 'stars',
  }),
  getters: {
    /** Manifest entries, optionally narrowed by `activeTags`. */
    visibleThemes(state): ThemeManifestEntry[] {
      const all = state.manifest?.themes ?? [];
      if (state.activeTags.length === 0) return all;
      const want = new Set(state.activeTags.map((t) => t.toLowerCase()));
      return all.filter((th) =>
        (th.tags ?? []).some((t) => want.has(t.toLowerCase())),
      );
    },
    /** Set of every `tags[]` value across the manifest, lowercased + sorted. */
    allTags(state): string[] {
      const set = new Set<string>();
      for (const th of state.manifest?.themes ?? []) {
        for (const t of th.tags ?? []) set.add(t.toLowerCase());
      }
      return Array.from(set).sort();
    },
    installedById(state): Record<string, InstalledTheme> {
      const out: Record<string, InstalledTheme> = {};
      for (const t of state.installed) out[t.id] = t;
      return out;
    },
  },
  actions: {
    /**
     * Fetch the curator manifest. By default uses the in-memory cache when
     * fresh; pass `force = true` (refresh button) to bypass.
     */
    async loadManifest(force = false) {
      const fresh =
        this.manifest !== null &&
        Date.now() - this.manifestFetchedAt < MANIFEST_TTL_MS;
      if (fresh && !force) {
        // Still re-pull the installed list — the user may have installed
        // a theme via another window or the file may have been removed.
        await this.refreshInstalled();
        return;
      }
      this.loading = true;
      this.error = '';
      try {
        // Cache-bust on force so any HTTP cache doesn't trump us.
        const url = force ? `${MANIFEST_URL}?t=${Date.now()}` : MANIFEST_URL;
        const res = await fetch(url, { cache: force ? 'no-store' : 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ThemeManifest = await res.json();
        if (!json || !Array.isArray(json.themes)) {
          throw new Error('manifest: missing themes[]');
        }
        this.manifest = json;
        this.manifestFetchedAt = Date.now();
      } catch (e) {
        this.error = String((e as Error)?.message ?? e);
      } finally {
        this.loading = false;
      }
      await this.refreshInstalled();
    },

    async refreshInstalled() {
      try {
        const raw = await invoke<InstalledTheme[]>('theme_list_installed');
        if (this.manifest === null && !this.loading) {
          void this.loadManifest();
        }
        this.installed = raw.map((t) => {
          const matched = this.manifest?.themes?.find((m) => m.id === t.id);
          return {
            ...t,
            name: matched?.name || (t.name && t.name !== t.id ? t.name : t.id),
          };
        });
      } catch (e) {
        // Don't surface this as a user error — the dir may not exist yet.
        console.warn('theme_list_installed failed:', e);
        this.installed = [];
      }
    },

    /**
     * Download `theme.url`, write to `<config_dir>/themes/<id>.css`, and
     * return the absolute path. Caller is responsible for setting it as
     * `settings.customCssPath`.
     */
    async install(theme: ThemeManifestEntry): Promise<string> {
      this.installingId = theme.id;
      try {
        const res = await fetch(theme.url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`download HTTP ${res.status}`);
        const css = await res.text();
        if (!css.trim()) throw new Error('downloaded CSS is empty');
        const result = await invoke<{ path: string }>('theme_install', {
          id: theme.id,
          css,
        });
        await this.refreshInstalled();
        return result.path;
      } finally {
        this.installingId = '';
      }
    },

    async uninstall(id: string): Promise<void> {
      await invoke('theme_uninstall', { id });
      await this.refreshInstalled();
    },

    toggleTag(tag: string) {
      const lower = tag.toLowerCase();
      const i = this.activeTags.indexOf(lower);
      if (i === -1) this.activeTags.push(lower);
      else this.activeTags.splice(i, 1);
    },

    async openThemeFolder() {
      try {
        await invoke('theme_open_folder');
      } catch (e) {
        console.error('Failed to open theme folder:', e);
      }
    },

    async openUserCss() {
      try {
        await invoke('theme_open_user_css');
      } catch (e) {
        console.error('Failed to open user.css:', e);
      }
    },

    async readUserCss(): Promise<string> {
      try {
        return await invoke<string>('theme_read_user_css');
      } catch (e) {
        console.warn('Failed to read user.css:', e);
        return '';
      }
    },

    async saveWallpaper(sourcePath: string): Promise<string> {
      return await invoke<string>('theme_save_wallpaper', { sourcePath });
    },

    async openWallpapersFolder() {
      try {
        await invoke('theme_open_wallpapers_folder');
      } catch (e) {
        console.error('Failed to open wallpapers folder:', e);
      }
    },

    clearTags() {
      this.activeTags = [];
    },

    /**
     * Fetch the Typora community theme catalog.
     */
    async loadTyporaManifest(force = false) {
      const fresh =
        this.typoraManifest !== null &&
        Date.now() - this.typoraFetchedAt < MANIFEST_TTL_MS;
      if (fresh && !force) {
        return;
      }
      this.typoraLoading = true;
      this.typoraError = '';
      try {
        const url = force ? `${TYPORA_MANIFEST_URL}?t=${Date.now()}` : TYPORA_MANIFEST_URL;
        const res = await fetch(url, { cache: force ? 'no-store' : 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TyporaThemeManifest = await res.json();
        if (!json || !Array.isArray(json.themes)) {
          throw new Error('typora-manifest: missing themes[]');
        }
        this.typoraManifest = json;
        this.typoraFetchedAt = Date.now();
      } catch (e) {
        this.typoraError = String((e as Error)?.message ?? e);
      } finally {
        this.typoraLoading = false;
      }
    },

    /**
     * Download an online Typora theme using Rust native multi-mirror resilient fetching
     * with instant local bundled fallback.
     */
    async installTyporaTheme(theme: TyporaThemeEntry): Promise<string> {
      this.installingId = theme.id;
      try {
        // 1. Fetch bundled fallback CSS if available locally
        let fallbackCss = '';
        try {
          const fbUrl = `/themes/typora/${theme.id}.css`;
          const fbRes = await fetch(fbUrl);
          if (fbRes.ok) {
            fallbackCss = await fbRes.text();
          }
        } catch (_) {}

        // 2. Candidate remote URLs
        const candidateUrls: string[] = [];
        if (theme.url) candidateUrls.push(theme.url);
        if (theme.cdnUrl) candidateUrls.push(theme.cdnUrl);

        // 3. Invoke Rust native multi-mirror downloader
        const result = await invoke<{ path: string }>('theme_download_and_install', {
          id: theme.id,
          urls: candidateUrls,
          fallbackCss: fallbackCss || null,
          themeName: theme.name || null,
          author: theme.author || null,
        });

        await this.refreshInstalled();
        return result.path;
      } finally {
        this.installingId = '';
      }
    },

    /**
     * Search GitHub repositories dynamically for Typora themes.
     */
    async searchGitHubThemes(query = '', sort: 'stars' | 'updated' = 'stars', page = 1) {
      this.githubLoading = true;
      this.githubError = '';
      this.githubSearchQuery = query;
      this.githubSort = sort;
      try {
        const res = await invoke<GitHubSearchResponse>('theme_search_github_repos', {
          query,
          sort,
          page,
          perPage: 30,
        });
        this.githubRepos = res.items || [];
        this.githubTotal = res.total_count || 0;
        this.githubRateLimited = res.rate_limited || false;
        if (res.message) {
          this.githubError = res.message;
        }
      } catch (e) {
        this.githubError = String((e as Error)?.message ?? e);
      } finally {
        this.githubLoading = false;
      }
    },

    /**
     * Sniff CSS files from any GitHub repository URL or slug.
     */
    async sniffGitHubRepo(repoOrUrl: string): Promise<DiscoveredCssFile[]> {
      return await invoke<DiscoveredCssFile[]>('theme_sniff_github_repo', {
        repoOrUrl,
      });
    },

    /**
     * Install a discovered CSS file from GitHub.
     */
    async installDiscoveredTheme(discovered: DiscoveredCssFile): Promise<string> {
      this.installingId = discovered.id;
      try {
        const result = await invoke<{ path: string }>('theme_download_and_install', {
          id: discovered.id,
          urls: discovered.download_urls,
          fallbackCss: null,
          themeName: discovered.name || null,
          author: null,
        });
        await this.refreshInstalled();
        return result.path;
      } finally {
        this.installingId = '';
      }
    },

    /**
     * Install a custom theme directly from any user-provided URL (GitHub repo or raw CSS).
     * Uses smart repository sniffing to detect all available CSS variants.
     */
    async installFromCustomUrl(inputUrl: string): Promise<{ id: string; name: string; path: string }> {
      const trimmed = inputUrl.trim();
      if (!trimmed) throw new Error('URL 不能为空');

      // 1. Sniff CSS files from the given URL or repo
      const files = await this.sniffGitHubRepo(trimmed);
      if (!files || files.length === 0) {
        throw new Error('未能在该链接中探查到可用的 CSS 主题文件');
      }

      // 2. Pick the primary file
      const target = files[0];
      const path = await this.installDiscoveredTheme(target);
      return { id: target.id, name: target.name, path };
    },
  },
});

