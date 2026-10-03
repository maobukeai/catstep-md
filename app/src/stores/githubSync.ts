/**
 * v2.6 — GitHub-backed sync (Pinia store).
 *
 * Wraps the Rust `github_*` Tauri commands. Owns:
 *   - PAT presence flag (stored in OS keychain on the Rust side; we cache
 *     `hasToken` here so the UI can reactively show "linked vs sign-in")
 *   - Cached `SyncStatus` for the current workspace folder, refreshed on
 *     a) link/unlink, b) explicit refresh, c) after push/pull
 *
 * Design notes:
 *   - Single-user product. No multi-account or org-scoped picks; we just
 *     show the PAT-owner's own repos.
 *   - Settings.autoGitEnabled is a *prerequisite* — GitHub sync only
 *     pushes/pulls commits, so the AutoGit layer must be writing them.
 *   - All errors surface as toasts via the caller; the store stashes
 *     `lastError` for diagnostics but doesn't toast itself (keeps it
 *     usable from non-Vue contexts).
 */
import { defineStore } from 'pinia';
import {
  SYNC_UNSUPPORTED,
  cryptoClearPassphrase,
  cryptoDecryptAfterPull,
  cryptoSetPassphrase,
  cryptoStatus,
  giteaClearToken,
  giteaCreateVaultRepo,
  giteaGetUrl,
  giteaHasToken,
  giteaListRepos,
  giteaSetToken,
  giteaSetUrl,
  giteaUser,
  giteaValidateUrl,
  githubClearToken,
  githubCreateVaultRepo,
  githubEnableEncryption,
  githubHasToken,
  githubLinkWorkspace,
  githubListRepos,
  githubPull,
  githubPush,
  githubResolveConflict,
  githubSetConfig,
  githubSetToken,
  githubSyncStatus,
  githubUnlinkWorkspace,
  githubUser,
  proxyGet,
  proxySet,
} from '../lib/commands';
import { hasGitBackend, isTauri } from '../lib/platform';

// Re-exported so existing importers of the marker keep working — the constant
// itself (and the hasGitBackend guard that throws it) lives in lib/commands.
export { SYNC_UNSUPPORTED };

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
}

export interface SyncConfig {
  remote_url: string;
  auto_push: boolean;
  auto_pull_minutes: number;
  last_push_at: number | null;
  last_pull_at: number | null;
}

export interface SyncStatus {
  linked: boolean;
  remote_url: string;
  auto_push: boolean;
  auto_pull_minutes: number;
  encrypted: boolean;
  provider: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  has_conflicts: boolean;
  conflicts: string[];
  last_push_at: number | null;
  last_pull_at: number | null;
}

export interface CryptoStatus {
  enabled: boolean;
  has_key: boolean;
}

export interface PullResult {
  kind: 'fast_forward' | 'up_to_date' | 'conflicts' | 'merged';
  conflicts: string[];
  /** E2EE bootstrap: the pull succeeded but this device has no passphrase
   *  set, so the shadow ciphertext was NOT mirrored back to plaintext.
   *  Callers must tell the user instead of toasting a plain "pulled". */
  pending_decryption?: boolean;
}

interface State {
  hasToken: boolean;
  user: GitHubUser | null;
  repos: GitHubRepo[];
  folder: string | null;
  status: SyncStatus | null;
  loading: boolean;
  pushing: boolean;
  pulling: boolean;
  lastError: string | null;
  /** Set when GitHub rejects the stored token (401 / Bad credentials), i.e.
   *  the PAT expired or was revoked. Drives a "reconnect" banner + toast so the
   *  user isn't left staring at a raw `GitHub API 401` on their next sync. */
  tokenInvalid: boolean;
  /** Classified push error type after last failed push attempt. Reset on next push. */
  pushErrorType: PushErrorType;
  /** Classified pull error type after last failed pull attempt. Reset on next pull. */
  pullErrorType: PullErrorType;

  // Gitea-specific state
  giteaUrl: string;
  hasGiteaToken: boolean;
  giteaUser: GitHubUser | null;
  giteaRepos: GitHubRepo[];
  giteaLoading: boolean;
  giteaUrlValid: boolean | null;
  giteaTokenInvalid: boolean;
}

/** Does this error indicate the GitHub token is no longer valid (expired /
 *  revoked)? The Rust side surfaces `GitHub API 401 Unauthorized: {...Bad
 *  credentials...}`; match on either signal. Exported so the auto-sync glue
 *  reuses the exact same classification. */
export function isGithubAuthError(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e ?? '');
  return /\b401\b|bad credentials/i.test(s);
}

/** Classify push errors from the Rust backend. Returns a machine-readable tag. */
export type PushErrorType = 'none' | 'auth' | 'protected-branch' | 'non-fast-forward' | 'other';
export type PullErrorType = 'none' | 'auth' | 'conflict' | 'other';

export function classifyPushError(e: unknown): PushErrorType {
  if (isGithubAuthError(e)) return 'auth';
  const s = String(e);
  if (/protected branch/i.test(s) || /create a pull request/i.test(s)) return 'protected-branch';
  if (/non-fast-forward/i.test(s) || /pull first/i.test(s)) return 'non-fast-forward';
  return 'other';
}

export function classifyPullError(e: unknown): PullErrorType {
  if (isGithubAuthError(e)) return 'auth';
  const s = String(e);
  if (/conflict/i.test(s)) return 'conflict';
  return 'other';
}

export const useGithubSyncStore = defineStore('githubSync', {
  state: (): State => ({
    hasToken: false,
    user: null,
    repos: [],
    folder: null,
    status: null,
    loading: false,
    pushing: false,
    pulling: false,
    lastError: null,
    tokenInvalid: false,
    pushErrorType: 'none',
    pullErrorType: 'none',

    // Gitea state
    giteaUrl: '',
    hasGiteaToken: false,
    giteaUser: null,
    giteaRepos: [],
    giteaLoading: false,
    giteaUrlValid: null,
    giteaTokenInvalid: false,
  }),

  getters: {
    isLinked(state): boolean {
      return Boolean(state.status?.linked);
    },
    hasConflicts(state): boolean {
      return Boolean(state.status?.has_conflicts);
    },
  },

  actions: {
    async refreshHasToken(): Promise<void> {
      if (!isTauri() || !hasGitBackend()) {
        this.hasToken = false;
        return;
      }
      try {
        this.hasToken = await githubHasToken();
      } catch (e) {
        const s = String(e);
        if (!s.includes(SYNC_UNSUPPORTED) && !s.includes('invoke')) {
          this.lastError = s;
        }
        this.hasToken = false;
      }
    },

    async setToken(token: string, provider = 'github'): Promise<void> {
      await githubSetToken(token);
      this.hasToken = true;
      // #229 — `github_user` is an api.github.com call. For a Gitea / Forgejo /
      // GitLab token it returns 401, which `refreshUser` classifies as
      // "your token expired" and raises the reconnect banner — on a token that
      // was just saved and is perfectly valid for its own server. Only ask
      // GitHub about GitHub tokens.
      if (provider !== 'github') return;
      // Also refresh the user immediately so UI can show the avatar.
      await this.refreshUser();
    },

    async clearToken(): Promise<void> {
      await githubClearToken();
      this.hasToken = false;
      this.user = null;
      this.repos = [];
      this.tokenInvalid = false;
    },

    async refreshUser(): Promise<void> {
      if (!isTauri() || !hasGitBackend()) {
        this.user = null;
        return;
      }
      try {
        this.user = await githubUser<GitHubUser>();
        // A successful /user call proves the token is good again — clear any
        // stale "expired" flag (e.g. after the user reconnects).
        this.tokenInvalid = false;
      } catch (e) {
        const s = String(e);
        if (!s.includes(SYNC_UNSUPPORTED) && !s.includes('invoke')) {
          this.lastError = s;
        }
        this.user = null;
        if (isGithubAuthError(e)) this.tokenInvalid = true;
      }
    },

    async listRepos(): Promise<GitHubRepo[]> {
      this.loading = true;
      try {
        this.repos = await githubListRepos<GitHubRepo[]>();
        this.tokenInvalid = false;
        return this.repos;
      } catch (e) {
        this.lastError = String(e);
        this.repos = [];
        if (isGithubAuthError(e)) this.tokenInvalid = true;
        throw e;
      } finally {
        this.loading = false;
      }
    },

    async createRepo(name: string, isPrivate: boolean): Promise<GitHubRepo> {
      const repo = await githubCreateVaultRepo<GitHubRepo>({
        name,
        private: isPrivate,
      });
      // Insert at the head of the cached list so the picker reflects it.
      this.repos.unshift(repo);
      return repo;
    },

    async link(
      folder: string,
      remoteUrl: string,
      opts: { encrypted?: boolean; provider?: string } = {},
    ): Promise<void> {
      await githubLinkWorkspace({
        folder,
        remoteUrl,
        encrypted: opts.encrypted ?? false,
        provider: opts.provider ?? 'github',
      });
      await this.refreshStatus(folder);
    },

    async cryptoStatus(folder: string): Promise<CryptoStatus> {
      return await cryptoStatus<CryptoStatus>(folder);
    },

    async setPassphrase(folder: string, passphrase: string): Promise<void> {
      await cryptoSetPassphrase(folder, passphrase);
    },

    async clearPassphrase(folder: string): Promise<void> {
      await cryptoClearPassphrase(folder);
    },

    async decryptNow(folder: string): Promise<void> {
      await cryptoDecryptAfterPull(folder);
    },

    async getProxy(): Promise<string> {
      return await proxyGet();
    },

    async setProxy(url: string): Promise<void> {
      await proxySet(url);
    },

    async enableEncryption(folder: string, passphrase: string): Promise<void> {
      await githubEnableEncryption(folder, passphrase);
      await this.refreshStatus(folder);
    },

    async setConfig(
      folder: string,
      autoPush: boolean,
      autoPullMinutes: number,
    ): Promise<void> {
      await githubSetConfig({
        folder,
        autoPush,
        autoPullMinutes,
      });
      await this.refreshStatus(folder);
    },

    async unlink(folder: string): Promise<void> {
      await githubUnlinkWorkspace(folder);
      await this.refreshStatus(folder);
    },

    async refreshStatus(folder: string | null): Promise<void> {
      if (!isTauri() || !hasGitBackend()) {
        this.folder = folder;
        this.status = null;
        return;
      }
      if (!folder) {
        this.folder = null;
        this.status = null;
        return;
      }
      this.folder = folder;
      try {
        this.status = await githubSyncStatus<SyncStatus>(folder);
      } catch (e) {
        const s = String(e);
        if (!s.includes(SYNC_UNSUPPORTED) && !s.includes('invoke')) {
          this.lastError = s;
        }
        // Don't null the status on error — keep the last known good so the
        // UI doesn't flicker between "linked" and "not linked" on a flaky
        // network probe.
      }
    },

    async push(folder: string, commitMessage?: string): Promise<void> {
      this.pushing = true;
      this.pushErrorType = 'none';
      try {
        await githubPush(folder, commitMessage ?? null);
        await this.refreshStatus(folder);
      } catch (e) {
        this.lastError = String(e);
        this.pushErrorType = classifyPushError(e);
        throw e;
      } finally {
        this.pushing = false;
      }
    },

    async pull(folder: string): Promise<PullResult> {
      this.pulling = true;
      this.pullErrorType = 'none';
      try {
        const r = await githubPull<PullResult>(folder);
        await this.refreshStatus(folder);
        return r;
      } catch (e) {
        this.lastError = String(e);
        this.pullErrorType = classifyPullError(e);
        throw e;
      } finally {
        this.pulling = false;
      }
    },

    async resolveConflict(
      folder: string,
      file: string,
      choice: 'local' | 'remote' | 'both',
    ): Promise<void> {
      await githubResolveConflict({ folder, file, choice });
      await this.refreshStatus(folder);
    },

    // ─── Gitea actions ─────────────────────────────────────────

    async getGiteaUrl(): Promise<string> {
      if (!isTauri() || !hasGitBackend()) return '';
      try {
        this.giteaUrl = await giteaGetUrl();
        return this.giteaUrl;
      } catch {
        return '';
      }
    },

    async setGiteaUrl(url: string): Promise<void> {
      await giteaSetUrl(url);
      this.giteaUrl = url;
    },

    async validateGiteaUrl(url: string): Promise<boolean> {
      const valid = await giteaValidateUrl(url);
      this.giteaUrlValid = valid;
      return valid;
    },

    async refreshHasGiteaToken(): Promise<void> {
      if (!isTauri() || !hasGitBackend()) {
        this.hasGiteaToken = false;
        return;
      }
      try {
        this.hasGiteaToken = await giteaHasToken();
      } catch {
        this.hasGiteaToken = false;
      }
    },

    async setGiteaToken(token: string): Promise<void> {
      await giteaSetToken(token);
      this.hasGiteaToken = true;
      if (this.giteaUrl) {
        await this.refreshGiteaUser(this.giteaUrl);
      }
    },

    async clearGiteaToken(): Promise<void> {
      await giteaClearToken();
      this.hasGiteaToken = false;
      this.giteaUser = null;
      this.giteaRepos = [];
      this.giteaTokenInvalid = false;
    },

    async refreshGiteaUser(baseUrl: string): Promise<void> {
      if (!isTauri() || !hasGitBackend()) {
        this.giteaUser = null;
        return;
      }
      try {
        this.giteaUser = await giteaUser<GitHubUser>(baseUrl);
        this.giteaTokenInvalid = false;
      } catch (e) {
        const s = String(e);
        if (!s.includes(SYNC_UNSUPPORTED) && !s.includes('invoke')) {
          this.lastError = s;
        }
        this.giteaUser = null;
        this.giteaTokenInvalid = true;
      }
    },

    async listGiteaRepos(baseUrl: string): Promise<GitHubRepo[]> {
      if (!isTauri() || !hasGitBackend()) {
        this.giteaRepos = [];
        return [];
      }
      this.giteaLoading = true;
      try {
        this.giteaRepos = await giteaListRepos<GitHubRepo[]>(baseUrl);
        this.giteaTokenInvalid = false;
        return this.giteaRepos;
      } catch (e) {
        const s = String(e);
        if (!s.includes(SYNC_UNSUPPORTED) && !s.includes('invoke')) {
          this.lastError = s;
        }
        this.giteaRepos = [];
        this.giteaTokenInvalid = true;
        throw e;
      } finally {
        this.giteaLoading = false;
      }
    },

    async createGiteaRepo(baseUrl: string, name: string, isPrivate: boolean): Promise<GitHubRepo> {
      const repo = await giteaCreateVaultRepo<GitHubRepo>({
        baseUrl,
        name,
        private: isPrivate,
      });
      this.giteaRepos.unshift(repo);
      return repo;
    },
  },
});
