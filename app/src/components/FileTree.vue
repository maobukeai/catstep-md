<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useWorkspaceStore } from '../stores/workspace';
import { useFiles } from '../composables/useFiles';
import { useInbox } from '../composables/useInbox';
import { useInboxView } from '../composables/useInboxView';
import { useSettingsStore } from '../stores/settings';
import { useToastsStore } from '../stores/toasts';
import { useGithubSyncStore } from '../stores/githubSync';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useTabsStore } from '../stores/tabs';
import { useTilesStore } from '../stores/tiles';
import { useGlobalSearch, type SearchHit } from '../composables/useGlobalSearch';
import { useI18n } from '../i18n';
import { isMobile, isMacOS } from '../lib/platform';
import { usePendingDeletes, isDeletePending, UNDO_WINDOW_MS } from '../composables/usePendingDeletes';
import { isSafPath, fromSafPath, safList, safCreate } from '../lib/saf-fs';

interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}
interface Node extends Entry {
  expanded?: boolean;
  children?: Node[];
  loading?: boolean;
  /** True when the directory had more children than we serialized — surface
   *  a "+N more" hint instead of silently hiding files. */
  truncated?: boolean;
}

const workspace = useWorkspaceStore();
const files = useFiles();
const inbox = useInbox();
const inboxView = useInboxView();
const settings = useSettingsStore();
const toasts = useToastsStore();
const ghSync = useGithubSyncStore();

/** v4.6.1 — Tolaria-parity "Copy Git URL": repository-backed blob URL for a
 *  file node, built from the linked remote + relative path (branch=main). */
async function copyGitUrl(node: Node) {
  const folder = workspace.currentFolder;
  const remote = ghSync.status?.remote_url ?? '';
  const m = remote.match(/(?:@|:\/\/)([^/:]+)[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!folder || !m) {
    toasts.warning(t('explorer.copyGitUrlNoRepo'));
    return;
  }
  const [, host, owner, repo] = m;
  const sep = node.path.includes('\\') ? '\\' : '/';
  const folderNorm = folder.endsWith(sep) ? folder : folder + sep;
  const rel = node.path.slice(folderNorm.length).split('\\').join('/').split('/').map(encodeURIComponent).join('/');
  const blobSeg = /gitlab/i.test(host) ? '/-/blob/' : '/blob/';
  await writeText(`https://${host}/${owner}/${repo}${blobSeg}main/${rel}`);
  toasts.success(t('explorer.copyGitUrlDone'));
  closeCtx();
}

/** #120 — copy the node's absolute filesystem path (file OR folder). */
async function copyNodePath(node: Node) {
  await writeText(node.path);
  toasts.success(t('explorer.copyPathDone'));
  closeCtx();
}

/** #120 — copy the node's path relative to the workspace root, slash-normalised. */
async function copyNodeRelativePath(node: Node) {
  const folder = workspace.currentFolder;
  const sep = node.path.includes('\\') ? '\\' : '/';
  let rel = node.path;
  if (folder) {
    const folderNorm = folder.endsWith(sep) ? folder : folder + sep;
    if (node.path.startsWith(folderNorm)) rel = node.path.slice(folderNorm.length);
  }
  await writeText(rel.split('\\').join('/'));
  toasts.success(t('explorer.copyRelPathDone'));
  closeCtx();
}
const tabs = useTabsStore();
const { t } = useI18n();
const pendingDeletes = usePendingDeletes();

const root = ref<Node | null>(null);
const search = useGlobalSearch();
const tiles = useTilesStore();

const searchQuery = ref('');
const searchMode = ref<'name' | 'content'>('name');
const filterInputRef = ref<HTMLInputElement | null>(null);
const hits = ref<SearchHit[]>([]);
const searchLoading = ref(false);
const selectedHitIdx = ref(0);
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const preSearchExpanded = ref<Set<string> | null>(null);

function saveCurrentExpanded() {
  const set = new Set<string>();
  function walk(n: Node | null | undefined) {
    if (!n) return;
    if (n.is_dir && n.expanded) set.add(n.path);
    n.children?.forEach(walk);
  }
  walk(root.value);
  preSearchExpanded.value = set;
}

function restoreSavedExpanded() {
  if (!preSearchExpanded.value) return;
  const saved = preSearchExpanded.value;
  function walk(n: Node | null | undefined) {
    if (!n) return;
    if (n.is_dir) {
      n.expanded = saved.has(n.path);
    }
    n.children?.forEach(walk);
  }
  walk(root.value);
  preSearchExpanded.value = null;
}

const matchingInfo = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q || searchMode.value !== 'name') {
    return { matchingPaths: null as Set<string> | null, matchCount: 0 };
  }
  const matchingSet = new Set<string>();
  let count = 0;

  function checkNode(n: Node): boolean {
    const isSelfMatch = n.name.toLowerCase().includes(q);
    let hasChildMatch = false;

    if (n.is_dir && n.children) {
      for (const child of n.children) {
        if (checkNode(child)) {
          hasChildMatch = true;
        }
      }
    }

    if (isSelfMatch || hasChildMatch) {
      matchingSet.add(n.path);
      if (!n.is_dir && isSelfMatch) {
        count++;
      }
      return true;
    }
    return false;
  }

  if (root.value && root.value.children) {
    for (const c of root.value.children) {
      checkNode(c);
    }
  }

  return { matchingPaths: matchingSet, matchCount: count };
});

const matchingPaths = computed(() => matchingInfo.value.matchingPaths);
const matchCount = computed(() => matchingInfo.value.matchCount);

watch(
  [searchQuery, searchMode],
  ([q, mode], [oldQ]) => {
    if (mode === 'name') {
      const query = q.trim();
      if (query) {
        if (!preSearchExpanded.value) {
          saveCurrentExpanded();
        }
        const set = matchingPaths.value;
        if (set && root.value) {
          function expandMatches(n: Node) {
            if (n.is_dir && set?.has(n.path)) {
              n.expanded = true;
            }
            n.children?.forEach(expandMatches);
          }
          expandMatches(root.value);
        }
      } else if (oldQ && oldQ.trim()) {
        restoreSavedExpanded();
      }
    } else if (mode === 'content') {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        void doContentSearch();
      }, 200);
    }
  },
  { deep: true },
);

async function doContentSearch() {
  const q = searchQuery.value.trim();
  if (!q) {
    hits.value = [];
    return;
  }
  searchLoading.value = true;
  try {
    hits.value = await search.search(q);
    selectedHitIdx.value = 0;
  } finally {
    searchLoading.value = false;
  }
}

const groupedContentHits = computed(() => {
  const map = new Map<string, SearchHit[]>();
  for (const h of hits.value) {
    if (!map.has(h.file)) map.set(h.file, []);
    map.get(h.file)!.push(h);
  }
  return Array.from(map.entries());
});

async function openSearchHit(hit: SearchHit) {
  try {
    await files.openPath(hit.file);
    nextTick(() => {
      window.dispatchEvent(
        new CustomEvent('solomd:outline-goto', {
          detail: { line: hit.line, paneId: tiles.focusedPaneId },
        }),
      );
    });
  } catch (e) {
    console.error('FileTree: openSearchHit failed', e);
  }
}

function shortFilePath(p: string) {
  const folder = workspace.currentFolder;
  if (folder && p.startsWith(folder)) {
    return p.slice(folder.length).replace(/^[\\/]/, '');
  }
  return p.split(/[\\/]/).slice(-2).join('/');
}

function highlightSnippet(snippet: string): string {
  const q = searchQuery.value.trim();
  if (!q) return escapeHtml(snippet);
  const re = new RegExp(`(${escapeRe(q)})`, 'gi');
  return escapeHtml(snippet).replace(re, '<mark class="ftree__mark">$1</mark>');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearSearch() {
  searchQuery.value = '';
  restoreSavedExpanded();
  if (searchMode.value === 'content') {
    hits.value = [];
  }
}

function setSearchMode(mode: 'name' | 'content') {
  if (searchMode.value === mode) return;
  searchMode.value = mode;
  if (mode === 'content' && searchQuery.value.trim()) {
    void doContentSearch();
  } else if (mode === 'name') {
    hits.value = [];
  }
}

function onSearchInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    clearSearch();
    filterInputRef.value?.blur();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (searchMode.value === 'name') {
      if (matchCount.value === 0 && searchQuery.value.trim()) {
        setSearchMode('content');
      } else if (matchingPaths.value && root.value) {
        let firstFile: Node | null = null;
        function findFirst(n: Node) {
          if (firstFile) return;
          if (!n.is_dir && matchingPaths.value?.has(n.path)) {
            firstFile = n;
            return;
          }
          n.children?.forEach(findFirst);
        }
        findFirst(root.value);
        if (firstFile) {
          void files.openPath((firstFile as Node).path);
        }
      }
    } else if (searchMode.value === 'content') {
      if (hits.value.length > 0) {
        const hit = hits.value[selectedHitIdx.value] || hits.value[0];
        if (hit) void openSearchHit(hit);
      }
    }
  } else if (searchMode.value === 'content') {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedHitIdx.value = Math.min(selectedHitIdx.value + 1, hits.value.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedHitIdx.value = Math.max(selectedHitIdx.value - 1, 0);
    }
  }
}

function onFocusFileSearch() {
  nextTick(() => {
    filterInputRef.value?.focus();
    filterInputRef.value?.select();
  });
}

onMounted(() => {
  window.addEventListener('solomd:focus-file-search', onFocusFileSearch);
});

onBeforeUnmount(() => {
  window.removeEventListener('solomd:focus-file-search', onFocusFileSearch);
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
});

// v2.4 inbox filter — when on, the FileTreeNode subtree below prunes
// non-inbox files (and dirs whose subtree contains no inbox docs).
const showInboxOnly = computed(() => inbox.filterMode.value);

/** Sentinel emitted by the Rust backend when it truncated a huge dir
 * past the 10,000-entry hard cap. We surface it as a dedicated UI
 * row instead of rendering it as a fake file. */
const TRUNCATED_SENTINEL = '__solomd_truncated__';

/** True when the workspace folder itself is gone (moved, deleted, unmounted
 *  drive). Distinct from "empty": an empty tree under the folder's own name is
 *  indistinguishable from data loss, which is how it read before. */
const rootMissing = ref(false);

async function loadDir(path: string): Promise<{ children: Node[]; truncated: boolean }> {
  try {
    // #148 — SAF vault: list children via ContentResolver, not std::fs.
    if (isSafPath(path) && workspace.safTreeUri) {
      const safChildren = await safList(workspace.safTreeUri, fromSafPath(path));
      // A delete still inside its undo window is presented as done — the file
      // is on disk for a few more seconds but the user has been told it is gone.
      return {
        children: (safChildren as Node[]).filter((c) => !isDeletePending(c.path)),
        truncated: false,
      };
    }
    const entries = await invoke<Entry[]>('list_dir', { path });
    let truncated = false;
    const filtered: Node[] = [];
    for (const e of entries) {
      if (e.name === TRUNCATED_SENTINEL && !e.is_dir && e.path === '') {
        truncated = true;
        continue;
      }
      if (isDeletePending(e.path)) continue;
      filtered.push({ ...e });
    }
    // A successful listing clears the "folder is gone" state, so putting the
    // folder back (or reconnecting the drive) recovers on the next refresh
    // rather than needing the workspace re-picked.
    if (path === workspace.currentFolder) rootMissing.value = false;
    return { children: filtered, truncated };
  } catch (e) {
    console.error('list_dir failed', e);
    if (import.meta.env.DEV && typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const demoChildren: Node[] = [
        {
          name: '3D建模',
          path: `${path}/3D建模`,
          is_dir: true,
          expanded: true,
          children: [
            { name: 'Blender 进阶与实战技巧.md', path: `${path}/3D建模/Blender 进阶与实战技巧.md`, is_dir: false },
            { name: 'LowPoly 场景建模.md', path: `${path}/3D建模/LowPoly 场景建模.md`, is_dir: false },
          ],
        },
        { name: '_assets', path: `${path}/_assets`, is_dir: true, expanded: false },
        { name: 'inbox', path: `${path}/inbox`, is_dir: true, expanded: false },
        { name: '待整理速记.md', path: `${path}/待整理速记.md`, is_dir: false },
        { name: 'Blender 进阶与实战技巧.md', path: `${path}/Blender 进阶与实战技巧.md`, is_dir: false },
        { name: 'Vue3 与 Vite 性能调优指南.md', path: `${path}/Vue3 与 Vite 性能调优指南.md`, is_dir: false },
      ];
      return { children: demoChildren, truncated: false };
    }
    // Only the root's disappearance is worth a special state; a subfolder that
    // vanished mid-expand just lists as empty.
    if (path === workspace.currentFolder) {
      try {
        rootMissing.value = !(await invoke<boolean>('fs_dir_exists', { path }));
      } catch {
        rootMissing.value = false;
      }
    }
    return { children: [], truncated: false };
  }
}

async function refreshRoot() {
  if (!workspace.currentFolder) {
    root.value = null;
    return;
  }
  const path = workspace.currentFolder;
  rootMissing.value = false;
  root.value = {
    name: isSafPath(path) ? workspace.safName ?? 'Vault' : path.split(/[\\/]/).pop() ?? path,
    path,
    is_dir: true,
    expanded: true,
    loading: true,
  };
  const { children, truncated } = await loadDir(path);
  // If a newer setFolder fired during the await, root.value now points at a
  // different node — discarding our stale result is correct. Same v2.3.1
  // pattern that fixed FileTree-stuck-on-Loading.
  if (root.value && root.value.path === path) {
    root.value.children = children;
    root.value.truncated = truncated;
    root.value.loading = false;
  }
}

async function toggle(node: Node) {
  if (!node.is_dir) {
    await files.openPath(node.path);
    return;
  }
  if (node.expanded) {
    node.expanded = false;
    return;
  }
  if (!node.children) {
    node.loading = true;
    const { children, truncated } = await loadDir(node.path);
    node.children = children;
    node.truncated = truncated;
    node.loading = false;
  }
  node.expanded = true;
}

watch(
  () => workspace.currentFolder,
  () => {
    // Leaving the folder ends the undo offer — the toast is about to be out of
    // sight, and a timer that fires against another workspace is a trap.
    void pendingDeletes.flushAll();
    void refreshRoot();
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// v3.0: auto-refresh on save / pull / external-change
// ---------------------------------------------------------------------------

let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() {
  if (refreshDebounce) clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null;
    void refreshTreePreservingExpansion();
  }, 250);
}

async function refreshTreePreservingExpansion() {
  if (!workspace.currentFolder) return;
  const expanded = new Set<string>();
  function walk(n: Node | null | undefined) {
    if (!n) return;
    if (n.is_dir && n.expanded) expanded.add(n.path);
    n.children?.forEach(walk);
  }
  walk(root.value);
  const path = workspace.currentFolder;
  const { children, truncated } = await loadDir(path);
  async function rehydrate(nodes: Node[]) {
    for (const n of nodes) {
      if (n.is_dir && expanded.has(n.path)) {
        const sub = await loadDir(n.path);
        n.children = sub.children;
        n.truncated = sub.truncated;
        n.expanded = true;
        await rehydrate(sub.children);
      }
    }
  }
  await rehydrate(children);
  if (root.value) {
    root.value.children = children;
    root.value.truncated = truncated;
    root.value.loading = false;
  }
}

function onSaved() { scheduleRefresh(); }
function onRemotePulled() { scheduleRefresh(); }

let unlistenIndex: UnlistenFn | null = null;
let unlistenCapture: UnlistenFn | null = null;
/** Closing the window while a delete is pending: run it. The user asked for
 *  the delete and saw it happen; having the file reappear on next launch would
 *  be the surprise, not the safety. Best-effort — the IPC may not land. */
function onBeforeUnload() {
  void pendingDeletes.flushAll();
}

onMounted(async () => {
  window.addEventListener('solomd:saved', onSaved as EventListener);
  window.addEventListener('solomd:remote-pulled', onRemotePulled as EventListener);
  window.addEventListener('beforeunload', onBeforeUnload);
  try {
    unlistenIndex = await listen('solomd://index-updated', () => scheduleRefresh());
  } catch {}
  try {
    // A quick capture writes straight to disk from Rust; without this the new
    // Inbox note is invisible until something else happens to refresh.
    unlistenCapture = await listen('solomd://capture-written', () => scheduleRefresh());
  } catch {}
});
onBeforeUnmount(() => {
  window.removeEventListener('solomd:saved', onSaved as EventListener);
  window.removeEventListener('solomd:remote-pulled', onRemotePulled as EventListener);
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (unlistenIndex) unlistenIndex();
  if (unlistenCapture) unlistenCapture();
  if (refreshDebounce) clearTimeout(refreshDebounce);
});

// ---------------------------------------------------------------------------
// v3.0: right-click context menu + inline new / rename
// ---------------------------------------------------------------------------

interface CtxMenu {
  x: number;
  y: number;
  /** null = clicked the workspace root (no node) */
  node: Node | null;
}
const ctx = ref<CtxMenu | null>(null);
const ctxMenuRef = ref<HTMLDivElement | null>(null);
const ctxFocusedIndex = ref(-1);
const isMac = isMacOS();

interface InlineEdit {
  /** 'new-file' / 'new-dir' / 'rename' */
  kind: 'new-file' | 'new-dir' | 'rename';
  /** For "new", this is the parent dir; for rename, the target's parent. */
  parent: string;
  /** For rename only — the original full path. */
  original?: string;
  /** Editable name (defaults to a sensible placeholder). */
  name: string;
}
const editing = ref<InlineEdit | null>(null);
const editInput = ref<HTMLInputElement | null>(null);

function openCtx(e: MouseEvent, node: Node | null) {
  e.preventDefault();
  e.stopPropagation();
  ctxFocusedIndex.value = -1;
  const menuWidth = 205;
  const menuHeight = 260;
  const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
  const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
  ctx.value = { x: Math.max(10, x), y: Math.max(10, y), node };
  void nextTick(() => {
    ctxMenuRef.value?.focus();
  });
}
function closeCtx() {
  ctx.value = null;
  ctxFocusedIndex.value = -1;
}

async function startNewFile(parent: string) {
  closeCtx();
  editing.value = { kind: 'new-file', parent, name: 'untitled.md' };
  await nextTick();
  // Select just the basename (not the .md) so a single keystroke replaces
  // the placeholder, Finder-style.
  const el = editInput.value;
  if (el) {
    el.focus();
    const dot = el.value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  }
}

async function startNewFolder(parent: string) {
  closeCtx();
  editing.value = { kind: 'new-dir', parent, name: 'New Folder' };
  await nextTick();
  const el = editInput.value;
  if (el) {
    el.focus();
    el.select();
  }
}

async function startRename(node: Node) {
  closeCtx();
  const parent = node.path.replace(/[\\/][^\\/]+$/, '');
  editing.value = {
    kind: 'rename',
    parent,
    original: node.path,
    name: node.name,
  };
  await nextTick();
  const el = editInput.value;
  if (el) {
    el.focus();
    const dot = el.value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  }
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

async function commitEdit() {
  const e = editing.value;
  if (!e) return;
  const name = e.name.trim();
  if (!name) {
    editing.value = null;
    return;
  }
  try {
    if (e.kind === 'new-file') {
      // Default to .md when the user didn't type an extension — we only
      // edit md/txt anyway, so this is the right bias.
      const finalName = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
      // #148 — SAF vault: create the file via ContentResolver and open its
      // content-URI, not a std::fs path.
      if (isSafPath(e.parent) && workspace.safTreeUri) {
        const { toSafPath } = await import('../lib/saf-fs');
        const newDocId = await safCreate(workspace.safTreeUri, fromSafPath(e.parent), finalName);
        editing.value = null;
        scheduleRefresh();
        await files.openPath(toSafPath(newDocId), { bypassNewWindow: true });
        return;
      }
      const target = joinPath(e.parent, finalName);
      // A pending delete on this exact path would fire later and take the new
      // file with it. Commit it now so the two never race.
      await pendingDeletes.flushUnder(target);
      await invoke('fs_create_file', { path: target, content: '' });
      scheduleRefresh();
      await files.openPath(target, { bypassNewWindow: true });
    } else if (e.kind === 'new-dir') {
      await pendingDeletes.flushUnder(joinPath(e.parent, name));
      await invoke('fs_create_dir', { path: joinPath(e.parent, name) });
      scheduleRefresh();
    } else if (e.kind === 'rename' && e.original) {
      const target = joinPath(e.parent, name);
      if (target === e.original) {
        return;
      }
      await pendingDeletes.flushUnder(target);
      await invoke('fs_rename', { from: e.original, to: target });
      scheduleRefresh();
      // v4.3.5 — if the renamed file is open in a tab, point the tab at the
      // new path and (when content might have changed on disk via the
      // per-file `.assets/` link rewrite) reload from disk for clean tabs.
      // Dirty tabs keep their in-memory content; user resolves on save.
      //
      // #91 fix: the dirty check has to run BEFORE we call markSaved —
      // markSaved sets savedContent = content as part of its bookkeeping,
      // so the comparison was always true and dirty tabs lost their
      // in-memory edits to whatever was on disk. Snapshot first, reload
      // only if it was already clean.
      try {
        const tab = tabs.tabs.find((t: { filePath?: string }) => t.filePath === e.original);
        if (tab) {
          const wasClean = tab.savedContent === tab.content;
          if (wasClean) {
            // Clean tab: safe to repoint + reload from disk (picks up any
            // per-file `.assets/` link rewrite the rename triggered).
            tabs.markSaved(tab.id, target);
            const fr = await invoke<{ content: string }>('read_file', { path: target });
            tabs.setContent(tab.id, fr.content);
            tabs.markSaved(tab.id, target);
          } else {
            // Dirty tab: repoint to the new path but KEEP the unsaved edits
            // AND the dirty flag. markSaved() here would clear savedContent
            // and silently lose the edits when the tab is later closed (#91).
            tabs.renamePath(tab.id, target);
          }
        }
      } catch (err) {
        console.warn('[FileTree.rename] tab refresh failed', err);
      }
    }
  } catch (err) {
    toasts.error(String(err));
  } finally {
    editing.value = null;
  }
}

function cancelEdit() {
  editing.value = null;
}

// CJK / IME guard for the rename / new-file inline input. Mirrors the pattern
// used by AgentPanel.vue::onKeydown — while the user is mid-composition (e.g.
// typing pinyin and pressing Enter to commit an IME candidate), `isComposing`
// is true (or `keyCode === 229` on older engines) and the Enter belongs to
// the IME, not to us. Treating it as "commit" would rename/create the file
// before the candidate is inserted.
function onRenameKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    void commitEdit();
  }
}

async function deleteNode(node: Node) {
  closeCtx();
  // #112 — desktop deletes now go to the OS trash (recoverable); mobile has
  // no user-visible trash, so keep the permanent-delete wording there.
  const suffix = isMobile()
    ? 'This cannot be undone.'
    : 'It will be moved to the system Trash / Recycle Bin.';
  const ok = window.confirm(
    node.is_dir
      ? `Delete folder "${node.name}" and everything inside?\n\n${suffix}`
      : `Delete "${node.name}"?\n\n${suffix}`,
  );
  if (!ok) return;

  // The delete is held for a few seconds so the toast can offer Undo. The
  // file is untouched until then; the tree hides it in the meantime.
  const path = node.path;
  const name = node.name;
  await pendingDeletes.schedule({
    path,
    name,
    isDir: !!node.is_dir,
    delayMs: UNDO_WINDOW_MS,
    commit: async () => {
      try {
        await invoke('fs_delete', { path });
      } catch (e) {
        toasts.error(`Delete failed: ${e}`);
      }
      scheduleRefresh();
    },
  });
  scheduleRefresh();
  toasts.push(t('explorer.deleted', { name }), 'success', UNDO_WINDOW_MS, () => {
    if (!pendingDeletes.undo(path)) return;
    scheduleRefresh();
    toasts.info(t('explorer.deleteUndone', { name }));
  }, { actionLabel: t('explorer.undo') });
}

async function revealNode(node: Node) {
  closeCtx();
  try {
    await revealItemInDir(node.path);
  } catch (e) {
    console.warn('reveal failed', e);
  }
}

// v4.3.5 — workspace switcher dropdown state.
const switcherOpen = ref(false);

/** Recent folders rendered into the dropdown. Splits each path into the
 *  basename (display) and the parent dir (subtitle), so two folders named
 *  `notes/` from different drives are distinguishable. The current folder
 *  always appears at the top, even if it isn't yet in `recentFolders` —
 *  defends against the (rare) case where session restore set
 *  `currentFolder` without going through `setFolder`. */
const switcherList = computed(() => {
  const seen = new Set<string>();
  const out: Array<{ path: string; name: string; parent: string }> = [];
  const push = (p: string) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    const parts = p.split(/[\\/]/).filter(Boolean);
    const name = parts.length > 0 ? parts[parts.length - 1] : p;
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    out.push({ path: p, name, parent });
  };
  if (workspace.currentFolder) push(workspace.currentFolder);
  for (const p of workspace.recentFolders) push(p);
  return out;
});

function toggleSwitcher() {
  switcherOpen.value = !switcherOpen.value;
}
function closeSwitcher() {
  switcherOpen.value = false;
}
async function pickRecentFolder(path: string) {
  closeSwitcher();
  if (path === workspace.currentFolder) return;
  workspace.setFolder(path);
}
async function openFolderAndClose() {
  closeSwitcher();
  await files.openFolder();
}
/** #118 — close the current workspace folder (return to the no-folder state).
 *  `setFolder(null)` is already a supported "closed workspace" state; this just
 *  exposes it, since previously a folder once opened could never be closed. */
function closeFolder() {
  closeSwitcher();
  workspace.setFolder(null);
}

function getCtxActionButtons(): HTMLButtonElement[] {
  if (!ctxMenuRef.value) return [];
  return Array.from(ctxMenuRef.value.querySelectorAll<HTMLButtonElement>('.ftree__ctx-item:not([disabled])'));
}

// Close the context menu on any outside click / escape.
function onWindowPointerDown(e: PointerEvent) {
  if (switcherOpen.value) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.ftree__switcher-menu') && !target?.closest('.ftree__switcher-btn')) {
      closeSwitcher();
    }
  }
  if (ctx.value) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.ftree__ctx')) {
      closeCtx();
    }
  }
}

function onWindowKey(e: KeyboardEvent) {
  if (ctx.value) {
    const items = getCtxActionButtons();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCtx();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        ctxFocusedIndex.value = (ctxFocusedIndex.value + 1) % items.length;
        items[ctxFocusedIndex.value]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        ctxFocusedIndex.value = (ctxFocusedIndex.value - 1 + items.length) % items.length;
        items[ctxFocusedIndex.value]?.focus();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (ctxFocusedIndex.value >= 0 && items[ctxFocusedIndex.value]) {
        e.preventDefault();
        items[ctxFocusedIndex.value].click();
        return;
      }
    }
  }

  if (e.key === 'Escape') {
    closeCtx();
    closeSwitcher();
    if (editing.value) editing.value = null;
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown);
  window.addEventListener('keydown', onWindowKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown);
  window.removeEventListener('keydown', onWindowKey);
});
</script>

<template>
  <aside
    class="ftree"
    :class="{ 'ftree--fullnames': settings.explorerFullNames }"
    :style="{ '--file-tree-width': settings.fileTreeWidth + 'px' }"
    @contextmenu.prevent="openCtx($event, null)"
  >
    <div class="ftree__header">
      <span class="ftree__title">{{ t('explorer.heading') }}</span>
      <div class="ftree__header-btns">
        <button
          class="ftree__hbtn"
          :title="t('explorer.newFile')"
          @click="root && startNewFile(root.path)"
          :disabled="!root"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
        <button
          class="ftree__hbtn"
          :title="t('explorer.refresh')"
          @click="scheduleRefresh"
          :disabled="!root"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9L14 6" />
            <path d="M14 2.5v3.5h-3.5" />
          </svg>
        </button>
        <button
          class="ftree__hbtn"
          :title="t('explorer.openFolder')"
          @click="files.openFolder"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1.5 13.5v-9a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
          </svg>
        </button>
        <button
          v-if="workspace.currentFolder"
          class="ftree__hbtn"
          :title="t('explorer.closeFolder')"
          @click="closeFolder"
        >
          <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
            <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Instant Filter & Search Bar -->
    <div v-if="root" class="ftree__filter-box">
      <div class="ftree__filter-input-wrap">
        <svg class="ftree__filter-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          ref="filterInputRef"
          v-model="searchQuery"
          class="ftree__filter-input"
          :placeholder="searchMode === 'content' ? (t('explorer.searchContentPlaceholder') || '全文搜索…') : (t('explorer.filterPlaceholder') || '过滤文件… (Esc 清空)')"
          @keydown="onSearchInputKeydown"
        />
        <span v-if="searchQuery && (searchMode === 'name' ? matchCount >= 0 : hits.length >= 0)" class="ftree__filter-badge">
          {{ searchMode === 'name' ? matchCount : hits.length }}
        </span>
        <button
          v-if="searchQuery"
          class="ftree__filter-clear"
          type="button"
          :title="'Esc'"
          @click="clearSearch"
        >
          <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
            <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
          </svg>
        </button>
      </div>
      <div class="ftree__mode-toggle">
        <button
          type="button"
          class="ftree__mode-btn"
          :class="{ active: searchMode === 'name' }"
          :title="t('explorer.modeNameTooltip') || '文件名实时过滤'"
          @click="setSearchMode('name')"
        >
          {{ t('explorer.modeName') || '名称' }}
        </button>
        <button
          type="button"
          class="ftree__mode-btn"
          :class="{ active: searchMode === 'content' }"
          :title="t('explorer.modeContentTooltip') || '全文内容搜索'"
          @click="setSearchMode('content')"
        >
          {{ t('explorer.modeContent') || '全文' }}
        </button>
      </div>
    </div>

    <div v-if="!root" class="ftree__empty">
      <button class="ftree__open-btn" @click="files.openFolder">{{ t('explorer.openFolder') }}</button>
    </div>
    <div v-else class="ftree__body">
      <!-- Content Full-Text Search Hits List View -->
      <template v-if="searchMode === 'content' && searchQuery.trim()">
        <div v-if="searchLoading" class="ftree__loading">
          <span class="ftree__spinner" aria-hidden="true"></span>
          <span>{{ t('explorer.loading') }}</span>
        </div>
        <div v-else-if="hits.length === 0" class="ftree__empty-search">
          <p class="ftree__empty-msg">{{ t('explorer.noMatchingFiles') || '未找到匹配内容' }}</p>
          <button type="button" class="ftree__empty-action" @click="setSearchMode('name')">
            {{ t('explorer.backToFileTree') || '返回文件树' }}
          </button>
        </div>
        <div v-else class="ftree__search-results">
          <div
            v-for="[file, fileHits] in groupedContentHits"
            :key="file"
            class="ftree__search-group"
          >
            <div class="ftree__search-group-head" :title="file" @click="files.openPath(file)">
              <svg class="ftree__type-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
                <path d="M9.5 1.5V5H13" />
              </svg>
              <span class="ftree__search-file-name">{{ shortFilePath(file) }}</span>
              <span class="ftree__search-badge">{{ fileHits.length }}</span>
            </div>
            <ul class="ftree__search-hit-list">
              <li
                v-for="h in fileHits"
                :key="`${h.file}:${h.line}`"
                class="ftree__search-hit"
                @click="openSearchHit(h)"
              >
                <span class="ftree__search-line">行 {{ h.line }}</span>
                <span class="ftree__search-snippet" v-html="highlightSnippet(h.snippet)"></span>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <!-- Normal Tree or Name-Filtered Tree View -->
      <template v-else>
        <!-- v4.3.5: root display doubles as the workspace switcher. Click
             opens a dropdown listing recent folders + "Open folder…". -->
        <div class="ftree__root-wrap">
          <button
            class="ftree__root ftree__root--btn"
            :class="{ 'ftree__root--open': switcherOpen }"
            :title="t('explorer.switchWorkspace') + ' · ' + root.path"
            @click.stop="toggleSwitcher"
            @contextmenu.prevent="openCtx($event, root)"
          >
            <svg class="ftree__root-vicon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1.5 13.5v-9a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
            </svg>
            <span class="ftree__root-name">{{ root.name }}</span>
            <svg class="ftree__root-caret" viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
          <div v-if="switcherOpen" class="ftree__switcher" @click.stop>
            <div class="ftree__switcher-label">{{ t('explorer.recentFolders') }}</div>
            <button
              v-for="folder in switcherList"
              :key="folder.path"
              class="ftree__switcher-item"
              :class="{ 'ftree__switcher-item--active': folder.path === root.path }"
              :title="folder.path"
              @click="pickRecentFolder(folder.path)"
            >
              <span class="ftree__switcher-name">{{ folder.name }}</span>
              <span class="ftree__switcher-path">{{ folder.parent }}</span>
            </button>
            <div v-if="switcherList.length === 0" class="ftree__switcher-empty">
              {{ t('explorer.noRecentFolders') }}
            </div>
            <div class="ftree__switcher-sep"></div>
            <button class="ftree__switcher-item ftree__switcher-item--cta" @click="openFolderAndClose">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                <path d="M1.5 13.5v-9a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
              </svg>
              {{ t('explorer.openFolder') }}
            </button>
          </div>
        </div>

        <!-- The folder itself is gone (moved in Finder, deleted, drive
             unmounted). Saying so beats an empty tree under its own name,
             which reads as "my notes are gone". -->
        <div v-if="rootMissing" class="ftree__missing">
          <p class="ftree__missing-title">{{ t('explorer.folderMissing') }}</p>
          <p class="ftree__missing-path">{{ root.path }}</p>
          <div class="ftree__missing-actions">
            <button class="ftree__open-btn" @click="files.openFolder">
              {{ t('explorer.folderMissingLocate') }}
            </button>
            <button class="ftree__missing-secondary" @click="closeFolder">
              {{ t('explorer.closeFolder') }}
            </button>
          </div>
        </div>

        <!-- Inline new/rename input — appears at the top of the tree. -->
        <div v-if="editing" class="ftree__edit">
          <span class="ftree__chevron-wrap ftree__chevron-wrap--leaf"></span>
          <svg class="ftree__type-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path v-if="editing.kind === 'new-dir'" d="M1.5 13.5v-9a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
            <path v-else d="M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z M9.5 1.5V5H13" />
          </svg>
          <input
            ref="editInput"
            v-model="editing.name"
            class="ftree__edit-input"
            spellcheck="false"
            @keydown="onRenameKey"
            @keydown.escape.prevent="cancelEdit"
            @blur="commitEdit"
          />
        </div>

        <!-- v2.4 / v4.6 F6: Inbox row. The chevron toggles the inbox-only tree
             filter (so the tree below shows only `inbox: true` docs); clicking
             the name opens the dedicated InboxView workflow. Gated on the
             v4.6 inbox-workflow opt-out. -->
        <div
          v-if="settings.inboxWorkflowEnabled"
          class="ftree__inbox"
          :class="{ 'ftree__inbox--active': showInboxOnly }"
        >
          <button
            class="ftree__inbox-toggle"
            :title="showInboxOnly ? t('inbox.filterOff') : t('inbox.filterOn')"
            @click="inbox.toggleFilter()"
          >
            <span class="ftree__chevron-wrap">
              <svg
                class="ftree__chevron"
                viewBox="0 0 16 16"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                :style="{
                  transition: 'transform 0.15s ease',
                  transform: showInboxOnly ? 'rotate(90deg)' : 'none',
                }"
              >
                <path d="M5.5 3.5l4.5 4.5L5.5 12.5" />
              </svg>
            </span>
          </button>
          <button
            class="ftree__inbox-open"
            :title="t('inbox.openView')"
            @click="inboxView.openInbox()"
          >
            <svg class="ftree__type-icon ftree__type-icon--inbox" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="14.5 9 11 9 9.5 11 6.5 11 5 9 1.5 9" />
              <path d="M2.5 4.5h11l1 4.5v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-5l1-4.5z" />
            </svg>
            <span class="ftree__name">{{ t('inbox.heading') }}</span>
            <svg class="ftree__inbox-popout" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <span class="ftree__badge" v-if="inbox.inboxCount.value > 0">
            {{ inbox.inboxCount.value }}
          </span>
        </div>

        <div v-if="searchMode === 'name' && searchQuery.trim() && matchCount === 0" class="ftree__empty-search">
          <p class="ftree__empty-msg">{{ t('explorer.noMatchingFiles') || '未找到匹配文件' }}</p>
          <button type="button" class="ftree__empty-action" @click="setSearchMode('content')">
            👉 {{ (t('explorer.searchInContentAction') || '在全文内容中检索 “{query}” (Enter)').replace('{query}', searchQuery) }}
          </button>
        </div>

        <div v-else-if="root.loading" class="ftree__loading">
          <span class="ftree__spinner" aria-hidden="true"></span>
          <span>{{ t('explorer.loading') }}</span>
        </div>
        <ul v-else class="ftree__list">
          <FileTreeNode
            v-for="child in root.children"
            :key="child.path"
            :node="child"
            :depth="0"
            :inbox-only="showInboxOnly"
            :inbox-paths="inbox.inboxPaths.value"
            :ctx-path="ctx?.node?.path || ''"
            :search-query="searchQuery"
            :matching-paths="matchingPaths"
            @toggle="toggle"
            @contextmenu="openCtx"
          />
          <li v-if="root.truncated" class="ftree__truncated" :title="t('explorer.folderTruncatedHint')">
            {{ t('explorer.folderTruncated') }}
          </li>
        </ul>
      </template>
    </div>

    <!-- Context menu — Teleported to body for global overlay z-index and no clipping -->
    <Teleport to="body">
      <Transition name="ftree-ctx">
        <div
          v-if="ctx"
          ref="ctxMenuRef"
          class="ftree__ctx"
          :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
          tabindex="-1"
          @click.stop
        >
          <template v-if="!ctx.node || ctx.node.is_dir">
            <button class="ftree__ctx-item" @click="startNewFile((ctx.node ?? root!).path)">
              <span class="ftree__ctx-label">{{ t('explorer.newFile') }}</span>
            </button>
            <button class="ftree__ctx-item" @click="startNewFolder((ctx.node ?? root!).path)">
              <span class="ftree__ctx-label">{{ t('explorer.newFolder') }}</span>
            </button>
          </template>
          <div v-if="ctx.node" class="ftree__ctx-sep"></div>
          <button v-if="ctx.node" class="ftree__ctx-item" @click="startRename(ctx.node)">
            <span class="ftree__ctx-label">{{ t('explorer.rename') }}</span>
            <span class="ftree__ctx-kbd">{{ isMac ? 'Enter' : 'F2' }}</span>
          </button>
          <button v-if="ctx.node" class="ftree__ctx-item ftree__ctx-item--danger" @click="deleteNode(ctx.node)">
            <span class="ftree__ctx-label">{{ t('explorer.delete') }}</span>
            <span class="ftree__ctx-kbd">{{ isMac ? '⌘⌫' : 'Del' }}</span>
          </button>
          <button v-if="ctx.node" class="ftree__ctx-item" @click="copyNodePath(ctx.node)">
            <span class="ftree__ctx-label">{{ t('explorer.copyPath') }}</span>
            <span class="ftree__ctx-kbd">{{ isMac ? '⌥⇧⌘C' : 'Shift+Alt+C' }}</span>
          </button>
          <button v-if="ctx.node" class="ftree__ctx-item" @click="copyNodeRelativePath(ctx.node)">
            <span class="ftree__ctx-label">{{ t('explorer.copyRelPath') }}</span>
          </button>
          <button v-if="ctx.node && !ctx.node.is_dir" class="ftree__ctx-item" @click="copyGitUrl(ctx.node)">
            <span class="ftree__ctx-label">{{ t('explorer.copyGitUrl') }}</span>
          </button>
          <!-- #148 follow-up — hidden on mobile: revealItemInDir silently no-ops
               there (no user-reachable file manager can browse the app sandbox
               on Android, and iOS has no Finder), so the item just looked broken. -->
          <template v-if="!isMobile()">
            <div class="ftree__ctx-sep"></div>
            <button class="ftree__ctx-item" @click="revealNode(ctx.node ?? root!)">
              <span class="ftree__ctx-label">{{ t('explorer.reveal') }}</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>

<script lang="ts">
import { defineComponent, h } from 'vue';

export const FileTreeNode = defineComponent({
  name: 'FileTreeNode',
  props: {
    node: { type: Object as () => any, required: true },
    depth: { type: Number, default: 0 },
    inboxOnly: { type: Boolean, default: false },
    inboxPaths: { type: Object as () => Set<string>, default: () => new Set() },
    ctxPath: { type: String, default: '' },
    searchQuery: { type: String, default: '' },
    matchingPaths: { type: Object as () => Set<string> | null, default: null },
  },
  emits: ['toggle', 'contextmenu'],
  setup(props, { emit }) {
    // #182 — the full-names toggle lives in settings; this inner component is
    // module-scoped so it can't close over <script setup>'s store instance.
    const nodeSettings = useSettingsStore();
    const nodeTabs = useTabsStore();
    const subtreeHasInbox = (node: any): boolean => {
      if (!node.is_dir) return props.inboxPaths.has(node.path);
      if (!node.children) return false;
      return node.children.some(subtreeHasInbox);
    };

    // Render clean SVG type icon based on extension or directory
    const renderTypeIcon = (n: any) => {
      if (n.is_dir) {
        return h(
          'svg',
          {
            class: ['ftree__type-icon', 'ftree__type-icon--dir', { 'ftree__type-icon--open': n.expanded }],
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.5',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            n.expanded
              ? h('path', {
                  d: 'M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v1.5M1.5 7.5h13l-1.5 6h-10l-1.5-6z',
                })
              : h('path', {
                  d: 'M1.5 13.5v-9a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z',
                }),
          ]
        );
      }

      const ext = n.name.split('.').pop()?.toLowerCase() || '';

      // Markdown & Notes
      if (['md', 'markdown', 'mdx', 'org'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--doc',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('path', { d: 'M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z' }),
            h('path', { d: 'M9.5 1.5V5H13' }),
            h('path', { d: 'M5.5 8.5h5' }),
            h('path', { d: 'M5.5 11h3.5' }),
          ]
        );
      }

      // Plain Text
      if (['txt', 'text', 'rtf', 'tex', 'log'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--txt',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('path', { d: 'M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z' }),
            h('path', { d: 'M9.5 1.5V5H13' }),
            h('path', { d: 'M5.5 8.5h5' }),
            h('path', { d: 'M5.5 11h5' }),
          ]
        );
      }

      // Images & Visual
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--img',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 1.5 }),
            h('circle', { cx: 5.5, cy: 5.5, r: 1 }),
            h('path', { d: 'm14 10.5-3.5-3.5L3 14' }),
          ]
        );
      }

      // Code & Structured Data
      if (['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'html', 'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'sh', 'bash', 'zsh', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'sql'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--code',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('path', { d: 'm5 5-3 3 3 3' }),
            h('path', { d: 'm11 5 3 3-3 3' }),
            h('path', { d: 'm9.5 3.5-3 9' }),
          ]
        );
      }

      // PDF & Documents
      if (['pdf', 'epub', 'doc', 'docx'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--pdf',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('path', { d: 'M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z' }),
            h('path', { d: 'M9.5 1.5V5H13' }),
            h('circle', { cx: 8, cy: 9.5, r: 1.5 }),
          ]
        );
      }

      // Audio & Video
      if (['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) {
        return h(
          'svg',
          {
            class: 'ftree__type-icon ftree__type-icon--media',
            viewBox: '0 0 16 16',
            width: 14,
            height: 14,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '1.4',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
          },
          [
            h('circle', { cx: 8, cy: 8, r: 6 }),
            h('path', { d: 'm7 5.5 3.5 2.5-3.5 2.5z', fill: 'currentColor', stroke: 'none' }),
          ]
        );
      }

      // Default Generic File
      return h(
        'svg',
        {
          class: 'ftree__type-icon ftree__type-icon--file',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        [
          h('path', { d: 'M3 1.5h6.5L13 5v9.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z' }),
          h('path', { d: 'M9.5 1.5V5H13' }),
        ]
      );
    };

    // Truncate filename in the middle: keep start and extension, ellipsis in middle
    const truncateFileName = (name: string, maxLength: number = 30): string => {
      if (name.length <= maxLength) return name;

      const lastDotIndex = name.lastIndexOf('.');
      if (lastDotIndex === -1) {
        // No extension: simple truncation
        const half = Math.floor((maxLength - 3) / 2);
        return name.slice(0, half) + '...' + name.slice(-half);
      }

      const ext = name.slice(lastDotIndex); // includes the dot
      const baseName = name.slice(0, lastDotIndex);
      const extLength = ext.length;

      // Reserve space for extension and ellipsis
      const availableForBase = maxLength - extLength - 3;
      if (availableForBase < 4) {
        // Extension is too long, truncate extension instead
        const half = Math.floor((maxLength - 3) / 2);
        return name.slice(0, half) + '...' + name.slice(-half);
      }

      const half = Math.floor(availableForBase / 2);
      return baseName.slice(0, half) + '...' + baseName.slice(-half) + ext;
    };

    return () => {
      const n = props.node as any;
      const inboxOnly = props.inboxOnly;
      if (inboxOnly) {
        if (!n.is_dir && !props.inboxPaths.has(n.path)) return [];
        if (n.is_dir && n.children && !subtreeHasInbox(n)) return [];
      }
      if (props.matchingPaths && !props.matchingPaths.has(n.path)) {
        return [];
      }
      const indent = 6 + props.depth * 14;

      // Use truncated name for display, full name in tooltip. #182 — the
      // full-names setting skips JS mid-ellipsis; CSS wraps instead.
      const displayName =
        !n.is_dir && !nodeSettings.explorerFullNames ? truncateFileName(n.name) : n.name;
      const isActive = !n.is_dir && nodeTabs.activeTab?.filePath === n.path;

      const renderDisplayName = () => {
        const q = props.searchQuery ? props.searchQuery.trim() : '';
        if (!q) return displayName;
        const lower = displayName.toLowerCase();
        const lowerQ = q.toLowerCase();
        const idx = lower.indexOf(lowerQ);
        if (idx === -1) return displayName;
        return [
          displayName.slice(0, idx),
          h('mark', { class: 'ftree__mark' }, displayName.slice(idx, idx + q.length)),
          displayName.slice(idx + q.length),
        ];
      };

      const items: any[] = [
        h(
          'li',
          {
            class: [
              'ftree__item',
              n.is_dir ? 'ftree__item--dir' : 'ftree__item--file',
              { 'ftree__item--active': isActive },
              { 'ftree__item--context-target': props.ctxPath && props.ctxPath === n.path },
            ],
            style: { paddingLeft: `${indent}px` },
            onClick: () => emit('toggle', n),
            onContextmenu: (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              emit('contextmenu', e, n);
            },
            title: n.path,
          },
          [
            h(
              'span',
              { class: ['ftree__chevron-wrap', { 'ftree__chevron-wrap--leaf': !n.is_dir }] },
              n.is_dir
                ? [
                    h(
                      'svg',
                      {
                        class: 'ftree__chevron',
                        viewBox: '0 0 16 16',
                        width: '10',
                        height: '10',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: '2',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        style: {
                          transition: 'transform 0.15s ease',
                          transform: n.expanded ? 'rotate(90deg)' : 'none',
                        },
                      },
                      [h('path', { d: 'M5.5 3.5l4.5 4.5L5.5 12.5' })]
                    ),
                  ]
                : []
            ),
            renderTypeIcon(n),
            h('span', { class: 'ftree__name' }, renderDisplayName()),
            !n.is_dir && props.inboxPaths.has(n.path)
              ? h('span', { class: 'ftree__inbox-dot', title: 'inbox' }, '●')
              : null,
          ]
        ),
      ];
      if (n.is_dir && n.expanded && n.children) {
        for (const c of n.children) {
          items.push(
            h(FileTreeNode, {
              node: c,
              depth: props.depth + 1,
              inboxOnly: props.inboxOnly,
              inboxPaths: props.inboxPaths,
              ctxPath: props.ctxPath,
              searchQuery: props.searchQuery,
              matchingPaths: props.matchingPaths,
              onToggle: (target: any) => emit('toggle', target),
              onContextmenu: (event: MouseEvent, target: any) => emit('contextmenu', event, target),
            })
          );
        }
      }
      return items;
    };
  },
});
</script>

<style scoped>
.ftree {
  width: var(--file-tree-width, 240px);
  height: 100%;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  user-select: none;
  position: relative;
}
.ftree__header {
  height: 36px;
  min-height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.ftree__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  line-height: 1;
}
.ftree__header-btns {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ftree__hbtn {
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s ease;
}
.ftree__hbtn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover);
  border-color: var(--border);
}
.ftree__hbtn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Filter & Search Bar */
.ftree__filter-box {
  padding: 6px 8px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ftree__filter-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  height: 26px;
  padding: 0 6px;
  transition: all 0.15s ease;
  min-width: 0;
}

.ftree__filter-input-wrap:focus-within {
  border-color: var(--accent, #0366d6);
  box-shadow: 0 0 0 2px var(--accent-ring, rgba(3, 102, 214, 0.2));
}

.ftree__filter-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  margin-right: 5px;
}

.ftree__filter-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  outline: none;
  padding: 0;
  line-height: 1;
}

.ftree__filter-input::placeholder {
  color: var(--text-faint, #888);
}

.ftree__filter-badge {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #0366d6) 15%, transparent);
  color: var(--accent, #0366d6);
  font-weight: 600;
  margin-right: 3px;
  flex-shrink: 0;
}

.ftree__filter-clear {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.1s ease;
}

.ftree__filter-clear:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.ftree__mode-toggle {
  display: flex;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 1px;
  flex-shrink: 0;
}

.ftree__mode-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.2;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.ftree__mode-btn:hover {
  color: var(--text);
}

.ftree__mode-btn.active {
  background: var(--accent, #0366d6);
  color: #fff;
  font-weight: 600;
}

/* Highlight matching keyword in tree */
:deep(.ftree__mark) {
  background: color-mix(in srgb, var(--accent, #0366d6) 28%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
}

/* Empty search state */
.ftree__empty-search {
  padding: 20px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.ftree__empty-msg {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

.ftree__empty-action {
  font-size: 11.5px;
  color: var(--accent, #0366d6);
  background: color-mix(in srgb, var(--accent, #0366d6) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #0366d6) 25%, transparent);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ftree__empty-action:hover {
  background: color-mix(in srgb, var(--accent, #0366d6) 20%, transparent);
}

/* Full-text search hits */
.ftree__search-results {
  padding: 6px 0;
}

.ftree__search-group {
  margin-bottom: 8px;
}

.ftree__search-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}

.ftree__search-group-head:hover {
  background: var(--bg-hover);
}

.ftree__search-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ftree__search-hit-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.ftree__search-hit {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px 4px 24px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
}

.ftree__search-hit:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.ftree__search-line {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-faint);
  flex-shrink: 0;
}

.ftree__search-snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.ftree__missing {
  padding: 16px 14px;
  text-align: center;
}
.ftree__missing-title {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--danger, #d64545);
  font-weight: 600;
}
.ftree__missing-path {
  margin: 0 0 10px;
  font-size: 10px;
  color: var(--text-faint);
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}
.ftree__missing-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.ftree__missing-secondary {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
.ftree__empty {
  padding: 24px 14px;
  text-align: center;
}
.ftree__open-btn {
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  border-radius: 4px;
  cursor: pointer;
}
.ftree__body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 12px;
}
.ftree__root-wrap {
  position: relative;
}
.ftree__root {
  padding: 8px 14px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
/* v4.6 — workspace switcher reads as an obviously-clickable control
   (distinct pill + folder glyph + caret), not a static section label. */
.ftree__root--btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: calc(100% - 12px);
  margin: 6px 6px 4px;
  padding: 5px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  text-transform: none;
  letter-spacing: normal;
  font-size: 12.5px;
  font-weight: 600;
  transition: background var(--dur-fast, 120ms) var(--ease),
    border-color var(--dur-fast, 120ms) var(--ease);
}
.ftree__root--btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.ftree__root--btn:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
.ftree__root--open {
  background: var(--accent-soft, rgba(255, 159, 64, 0.1));
  border-color: var(--accent);
}
.ftree__root-vicon {
  flex: 0 0 auto;
  font-size: 13px;
  line-height: 1;
}
.ftree__root-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.ftree__root-caret {
  font-size: 11px;
  color: var(--text-muted);
  flex: 0 0 auto;
  transition: transform var(--dur-fast, 120ms) var(--ease),
    color var(--dur-fast, 120ms) var(--ease);
}
.ftree__root--btn:hover .ftree__root-caret,
.ftree__root--open .ftree__root-caret {
  color: var(--accent);
}
.ftree__root--open .ftree__root-caret {
  transform: rotate(180deg);
}
.ftree__switcher {
  position: absolute;
  top: 100%;
  left: 6px;
  right: 6px;
  z-index: 30;
  margin-top: 2px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  padding: 4px;
  max-height: 60vh;
  overflow-y: auto;
}
.ftree__switcher-label {
  padding: 6px 8px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.ftree__switcher-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  border-radius: 4px;
}
.ftree__switcher-item:hover {
  background: var(--bg-hover);
}
.ftree__switcher-item--active {
  background: var(--bg-hover);
  font-weight: 600;
}
.ftree__switcher-item--cta {
  color: var(--accent, #ff9f40);
  font-weight: 600;
}
.ftree__switcher-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ftree__switcher-path {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  direction: rtl;
  text-align: left;
}
.ftree__switcher-empty {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-faint);
}
.ftree__switcher-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.ftree__list {
  list-style: none;
  margin: 0;
  padding: 2px 6px;
}
:deep(.ftree__item) {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-right: 8px;
  margin: 1px 0;
  font-size: 13px;
  cursor: pointer;
  color: var(--text);
  border-radius: 6px;
  transition: background 0.12s ease, color 0.12s ease;
  box-sizing: border-box;
}
:deep(.ftree__item:hover) {
  background: var(--bg-hover, rgba(0, 0, 0, 0.045));
}
:root[data-theme="dark"] :deep(.ftree__item:hover),
body.dark :deep(.ftree__item:hover) {
  background: rgba(255, 255, 255, 0.05);
}
:deep(.ftree__item--active) {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-hover, rgba(0, 0, 0, 0.05)));
  color: var(--text);
}
:root[data-theme="dark"] :deep(.ftree__item--active),
body.dark :deep(.ftree__item--active) {
  background: color-mix(in srgb, var(--accent) 18%, rgba(255, 255, 255, 0.08));
  color: var(--text);
}
:deep(.ftree__item--active .ftree__name) {
  font-weight: 550;
  color: var(--text);
}
:deep(.ftree__item--active .ftree__type-icon) {
  color: var(--accent);
}
:deep(.ftree__chevron-wrap) {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-faint);
}
:deep(.ftree__chevron-wrap--leaf) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
:deep(.ftree__chevron) {
  display: block;
}
:deep(.ftree__type-icon) {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
:deep(.ftree__type-icon--dir) {
  color: var(--accent-subtle, var(--text-muted));
}
:deep(.ftree__name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
  line-height: 1.3;
}
:deep(.ftree__item--dir .ftree__name) {
  font-weight: 500;
  color: var(--text);
}
:deep(.ftree__item--file .ftree__name) {
  font-weight: 400;
  color: var(--text);
}
/* #182 — full-filename mode: wrap long names across lines instead of the
 * JS mid-ellipsis, so large doc sets with long shared prefixes stay
 * scannable. */
.ftree--fullnames :deep(.ftree__name) {
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  -webkit-line-clamp: unset;
  line-height: 1.3;
}
:deep(.ftree__inbox-dot) {
  color: var(--accent);
  font-size: 7px;
  margin-left: auto;
}
.ftree__inbox {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  margin: 2px 6px;
  padding: 0 8px 0 6px;
  font-size: 13px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  text-align: left;
  border-radius: 6px;
  transition: background 0.12s ease, color 0.12s ease;
  box-sizing: border-box;
}
.ftree__inbox:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.045));
  color: var(--text);
}
:root[data-theme="dark"] .ftree__inbox:hover,
body.dark .ftree__inbox:hover {
  background: rgba(255, 255, 255, 0.05);
}
.ftree__inbox--active {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-hover, rgba(0, 0, 0, 0.05)));
  color: var(--text);
}
.ftree__inbox--active .ftree__name {
  font-weight: 550;
}
.ftree__inbox--active .ftree__type-icon {
  color: var(--accent);
}
.ftree__inbox-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
.ftree__inbox-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
.ftree__badge {
  margin-left: auto;
  background: var(--accent);
  color: #000;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
}
.ftree__loading {
  padding: 16px 14px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ftree__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ftree-spin 0.7s linear infinite;
}
@keyframes ftree-spin { to { transform: rotate(360deg); } }
.ftree__truncated {
  padding: 6px 14px 6px 22px;
  font-size: 11px;
  color: var(--text-faint);
  font-style: italic;
}
.ftree__edit {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  margin: 1px 6px;
  padding: 0 6px;
  box-sizing: border-box;
}
.ftree__edit-input {
  flex: 1;
  font-size: 13px;
  font-family: inherit;
  padding: 2px 6px;
  height: 22px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  outline: none;
  min-width: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}
.ftree__ctx {
  position: fixed;
  z-index: 10000;
  min-width: 195px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 9px;
  box-shadow:
    0 16px 36px rgba(0, 0, 0, 0.12),
    0 3px 8px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.7);
  user-select: none;
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
}

:root[data-theme="dark"] .ftree__ctx,
body.dark .ftree__ctx {
  background: rgba(30, 29, 27, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow:
    0 20px 44px rgba(0, 0, 0, 0.52),
    0 4px 12px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.ftree__ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 28px;
  padding: 5px 9px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text, #1e293b);
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 450;
  line-height: 1.4;
  text-align: left;
  transition: background-color 0.06s ease, color 0.06s ease;
  user-select: none;
  outline: none;
}

.ftree__ctx-item:hover,
.ftree__ctx-item:focus-visible {
  background: var(--bg-hover, rgba(0, 0, 0, 0.055));
  color: var(--text, #0f172a);
}

:root[data-theme="dark"] .ftree__ctx-item,
body.dark .ftree__ctx-item {
  color: var(--text, #e2e8f0);
}

:root[data-theme="dark"] .ftree__ctx-item:hover,
:root[data-theme="dark"] .ftree__ctx-item:focus-visible,
body.dark .ftree__ctx-item:hover,
body.dark .ftree__ctx-item:focus-visible {
  background: rgba(255, 255, 255, 0.085);
  color: #ffffff;
}

.ftree__ctx-label {
  flex: 1;
  white-space: nowrap;
}

.ftree__ctx-kbd {
  font-family: "JetBrains Mono", Consolas, -apple-system, monospace;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint, #94a3b8);
  letter-spacing: 0.3px;
  margin-left: auto;
  opacity: 0.75;
}

.ftree__ctx-item:hover .ftree__ctx-kbd,
.ftree__ctx-item:focus-visible .ftree__ctx-kbd {
  color: var(--text-muted, #64748b);
  opacity: 1;
}

:root[data-theme="dark"] .ftree__ctx-kbd {
  color: rgba(255, 255, 255, 0.4);
}

:root[data-theme="dark"] .ftree__ctx-item:hover .ftree__ctx-kbd,
:root[data-theme="dark"] .ftree__ctx-item:focus-visible .ftree__ctx-kbd {
  color: rgba(255, 255, 255, 0.75);
}

.ftree__ctx-item--danger {
  color: #ef4444;
}

.ftree__ctx-item--danger:hover,
.ftree__ctx-item--danger:focus-visible {
  background: rgba(239, 68, 68, 0.12) !important;
  color: #dc2626 !important;
}

:root[data-theme="dark"] .ftree__ctx-item--danger:hover,
:root[data-theme="dark"] .ftree__ctx-item--danger:focus-visible {
  background: rgba(239, 68, 68, 0.2) !important;
  color: #f87171 !important;
}

.ftree__ctx-sep {
  height: 1px;
  background: rgba(0, 0, 0, 0.07);
  margin: 4px 6px;
}

:root[data-theme="dark"] .ftree__ctx-sep,
body.dark .ftree__ctx-sep {
  background: rgba(255, 255, 255, 0.08);
}

/* Context menu animation */
.ftree-ctx-enter-active,
.ftree-ctx-leave-active {
  transition: opacity 0.1s ease, transform 0.1s cubic-bezier(0.16, 1, 0.3, 1);
}

.ftree-ctx-enter-from,
.ftree-ctx-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-2px);
}

/* Row context target highlight */
.ftree__item--context-target {
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-hover, transparent)) !important;
}

/* Better filename display with middle ellipsis for very long names */
:deep(.ftree__name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
</style>
