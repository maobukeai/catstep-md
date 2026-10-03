/**
 * v2.6 — auto-push + auto-pull glue.
 *
 * Runs alongside `useAutoCommit`:
 *   - On `solomd:saved` (after AutoGit has committed), if the workspace is
 *     linked AND `auto_push` is on, push to GitHub.
 *   - On a fixed interval (`auto_pull_minutes`), pull.
 *
 * Both push and pull surface toasts. `quiet` is intentionally not an
 * option here — silent failures were the v2.2 footgun and we don't repeat
 * the mistake in v2.6.
 */
import { watch } from 'vue';
import { useGithubSyncStore, isGithubAuthError, classifyPushError } from '../stores/githubSync';
import { useWorkspaceStore } from '../stores/workspace';
import { useToastsStore } from '../stores/toasts';
import { useI18n } from '../i18n';
import { hasGitBackend } from '../lib/platform';

export function useGithubSync() {
  const sync = useGithubSyncStore();
  const workspace = useWorkspaceStore();
  const toasts = useToastsStore();
  const { t } = useI18n();

  /**
   * Turn a sync failure into a toast. Classifies error type for actionable
   * messages instead of raw API text.
   */
  function reportSyncError(e: unknown, fallbackKey: string): void {
    if (isGithubAuthError(e)) {
      const wasInvalid = sync.tokenInvalid;
      sync.tokenInvalid = true;
      const expKey = sync.status?.provider === 'gitea' ? 'githubSync.giteaTokenExpired' : 'githubSync.tokenExpired';
      if (!wasInvalid) toasts.error(t(expKey), 6000);
      return;
    }
    const pushType = classifyPushError(e);
    if (pushType === 'protected-branch') {
      toasts.warning(t('githubSync.pushBlockedByBranchProtection'), 6000);
      return;
    }
    if (pushType === 'non-fast-forward') {
      toasts.warning(t('githubSync.pushRejectedPullFirst'), 6000);
      return;
    }
    toasts.error(`${t(fallbackKey)}: ${e}`);
  }

  let listening = false;
  let pulltimer: ReturnType<typeof setInterval> | null = null;
  // Debounce auto-push so a flurry of saves coalesces into one push.
  let pushTimer: ReturnType<typeof setTimeout> | null = null;

  async function refreshIfLinked(folder: string | null): Promise<void> {
    if (!folder) return;
    await sync.refreshStatus(folder);
  }

  /** Return the provider-specific i18n key for a toast message. */
  function syncToast(key: string): string {
    const gitea: Record<string, string> = {
      pushedToast: 'giteaPushedToast',
      pulledToast: 'giteaPulledToast',
    };
    const actual = sync.status?.provider === 'gitea' ? (gitea[key] ?? key) : key;
    return `githubSync.${actual}`;
  }

  async function pushIfWanted(): Promise<void> {
    const folder = workspace.currentFolder;
    if (!folder) return;
    if (!sync.status?.linked) return;
    if (!sync.status?.auto_push) return;
    try {
      await sync.push(folder);
      toasts.success(t(syncToast('pushedToast')));
    } catch (e) {
      reportSyncError(e, 'githubSync.pushFailed');
    }
  }

  function onSaved(): void {
    if (pushTimer) clearTimeout(pushTimer);
    // 5s debounce: AutoGit has just committed; give the user a moment in
    // case they ⌘S three more times before going to lunch.
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushIfWanted();
    }, 5000);
  }

  /**
   * Core pull, shared by the auto timer, the boot pull and the manual
   * entries (status pill, command palette). No cached-dirty guard: the
   * backend commits uncommitted tracked work ("workspace state at pull",
   * github_sync.rs `needs_safety_commit`) before the fast-forward
   * checkout, so pulling onto a dirty tree is safe — the old guard only
   * made auto-pulls silently vanish behind a stale `status.dirty`.
   * Unresolved merge conflicts are the one remaining skip: the backend
   * skips its safety commit on a conflicted index, so a merge there
   * would just fail.
   *
   * `manual` gives user-initiated pulls feedback on every skip path (no
   * folder, not linked, conflicts, up to date) instead of a silent
   * return — the silent-failure footgun this module's header warns
   * about. The in-flight mutex lives on the Pinia store (`sync.pulling`)
   * so the pill's composable instance, the command palette's and this
   * one all share it.
   */
  /** Deep-link into Settings → Sync, where the existing E2EE passphrase
   *  form lives. Same event the other toolbar/empty-state callers use. */
  function openSyncSettings(): void {
    window.dispatchEvent(new CustomEvent('solomd:open-settings', { detail: { section: 'sync' } }));
  }

  /**
   * E2EE fresh-device bootstrap: the pull succeeded, but this device has
   * no passphrase yet so the shadow ciphertext was never mirrored back to
   * plaintext — the workspace still shows no notes. The backend used to
   * leave this state invisible (`finalize_decrypt` soft-skips "key
   * missing") and the frontend toasted a normal "pulled". Say what
   * actually happened and offer the Settings decrypt flow. By the time
   * this fires the salt has been pulled, so setting the passphrase in
   * Settings derives the right key immediately.
   */
  function announcePendingDecryption(): void {
    toasts.push(
      t('githubSync.pullPendingDecryption'),
      'warning',
      8000,
      () => openSyncSettings(),
      { actionLabel: t('githubSync.openSyncSettings') },
    );
  }

  async function runPull(manual: boolean): Promise<void> {
    const folder = workspace.currentFolder;
    if (!folder) {
      if (manual) toasts.warning(t('githubSync.noWorkspace'));
      return;
    }
    if (!sync.status?.linked) {
      if (manual) {
        const key = sync.status?.provider === 'gitea' ? 'githubSync.giteaNotLinked' : 'githubSync.notLinked';
        toasts.warning(t(key));
      }
      return;
    }
    if (sync.status.has_conflicts) {
      if (manual) toasts.warning(t('githubSync.pullBlockedByConflicts'));
      return;
    }
    if (sync.pulling) return;
    try {
      const r = await sync.pull(folder);
      if (r.kind === 'fast_forward' || r.kind === 'merged') {
        toasts.success(t(syncToast('pulledToast')));
        // Notify the rest of the app that files changed under us so the
        // workspace index, file tree, and active editor reload from disk.
        window.dispatchEvent(new CustomEvent('solomd:remote-pulled'));
        if (r.pending_decryption) announcePendingDecryption();
      } else if (r.kind === 'conflicts') {
        toasts.warning(t('githubSync.pullConflicts', { n: String(r.conflicts.length) }));
        // The conflict panel surfaces in the History panel when
        // `sync.status.has_conflicts` is true.
      } else if (r.pending_decryption) {
        // Up to date, but this device never decrypted — repeating the
        // "up to date" toast would hide the real problem.
        announcePendingDecryption();
      } else if (manual) {
        toasts.info(t('githubSync.upToDate'));
      }
    } catch (e) {
      reportSyncError(e, 'githubSync.pullFailed');
    }
  }

  /** Auto-pull entry (timer tick, boot pull): silent on skips. */
  function pullIfWanted(): Promise<void> {
    return runPull(false);
  }

  function rescheduleTimer(): void {
    if (pulltimer) {
      clearInterval(pulltimer);
      pulltimer = null;
    }
    const minutes = sync.status?.auto_pull_minutes ?? 0;
    if (!sync.status?.linked || minutes <= 0) return;
    pulltimer = setInterval(() => {
      void pullIfWanted();
    }, minutes * 60_000);
  }

  function start(): void {
    if (listening) return;
    // #230 — no libgit2 in the Android binary, so there is nothing to push or
    // pull. Bail before wiring the save listener / pull timer, otherwise every
    // save and every tick fires a command that doesn't exist.
    if (!hasGitBackend()) return;
    listening = true;
    window.addEventListener('solomd:saved', onSaved as EventListener);

    // Whenever workspace changes, refresh the linked status. Whenever
    // the auto-pull interval changes, reschedule the timer.
    watch(
      () => workspace.currentFolder,
      (f) => {
        void refreshIfLinked(f);
      },
      { immediate: true },
    );
    watch(
      () => [sync.status?.linked, sync.status?.auto_pull_minutes],
      () => rescheduleTimer(),
      { immediate: true },
    );

    // Best-effort: on boot, do one immediate pull if linked AND auto-pull
    // is enabled. "Off (manual)" is respected — a manual-mode user may
    // have pulled deliberately before closing and must not get a surprise
    // pull 2s after every launch (the old boot pull ignored the setting).
    // If the status hasn't landed yet, refresh it once so the decision
    // uses the real auto_pull_minutes, not "not loaded yet".
    setTimeout(() => {
      void (async () => {
        const folder = workspace.currentFolder;
        if (!folder) return;
        if (!sync.status) await sync.refreshStatus(folder);
        if ((sync.status?.auto_pull_minutes ?? 0) <= 0) return;
        await pullIfWanted();
      })();
    }, 2000);
  }

  function stop(): void {
    if (!listening) return;
    listening = false;
    window.removeEventListener('solomd:saved', onSaved as EventListener);
    if (pulltimer) {
      clearInterval(pulltimer);
      pulltimer = null;
    }
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
  }

  /** Manual entry (command palette, status pill): every outcome talks. */
  function pullNow(): Promise<void> {
    return runPull(true);
  }

  /** Command-palette entry: push right now, even if auto_push is off. */
  async function pushNow(commitMessage?: string): Promise<void> {
    const folder = workspace.currentFolder;
    if (!folder) {
      toasts.warning(t('history.noFolder'));
      return;
    }
    if (!sync.status?.linked) {
      const key = sync.status?.provider === 'gitea' ? 'githubSync.giteaNotLinked' : 'githubSync.notLinked';
      toasts.warning(t(key));
      return;
    }
    try {
      await sync.push(folder, commitMessage);
      toasts.success(t(syncToast('pushedToast')));
    } catch (e) {
      reportSyncError(e, 'githubSync.pushFailed');
    }
  }

  return { start, stop, pullNow, pushNow };
}
