import { searchInDir, searchReplace } from '../lib/commands';
import { useWorkspaceStore } from '../stores/workspace';
import { useToastsStore } from '../stores/toasts';

export interface SearchHit {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Advanced match toggles — 1:1 with the GlobalSearch.vue Aa / whole-word /
 * regex switches. All off keeps the original lowercase-substring behavior.
 */
export interface MatchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Search hits plus walk telemetry (footer "scanned N files · X ms"). */
export interface SearchOutcome {
  hits: SearchHit[];
  filesScanned: number;
  elapsedMs: number;
}

/** Cross-file replace summary from the `search_replace` command. */
export interface ReplaceSummary {
  filesChanged: number;
  replacements: number;
  errors: string[];
  elapsedMs: number;
}

const EMPTY_OUTCOME: SearchOutcome = { hits: [], filesScanned: 0, elapsedMs: 0 };

export function useGlobalSearch() {
  const workspace = useWorkspaceStore();
  const toasts = useToastsStore();

  async function search(
    query: string,
    root?: string,
    maxResults = 200,
    options?: MatchOptions,
    pathFilter?: string,
  ): Promise<SearchOutcome> {
    const folder = root ?? workspace.currentFolder;
    if (!folder) {
      toasts.warning('Open a folder first to enable global search');
      return EMPTY_OUTCOME;
    }
    if (!query.trim()) return EMPTY_OUTCOME;
    try {
      return await searchInDir<SearchOutcome>({
        root: folder,
        query,
        maxResults,
        options: options ?? { caseSensitive: false, wholeWord: false, regex: false },
        pathFilter: pathFilter?.trim() ? pathFilter.trim() : null,
      });
    } catch (e) {
      if (import.meta.env.DEV && typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        const q = query.toLowerCase();
        return {
          hits: [
            { file: `${folder}/Blender 进阶与实战技巧.md`, line: 12, snippet: 'Blender 常用快捷键与高级实战技巧梳理总结' },
            { file: `${folder}/3D建模/Blender 进阶与实战技巧.md`, line: 45, snippet: '深入理解 Blender 几何节点与物理模拟' },
            { file: `${folder}/3D建模/LowPoly 场景建模.md`, line: 28, snippet: '使用 Blender 构建多边形场景拓扑' },
            { file: `${folder}/Vue3 与 Vite 性能调优指南.md`, line: 8, snippet: 'Vue3 响应式系统与虚拟 DOM Diff 深度解析' },
          ].filter(h => h.snippet.toLowerCase().includes(q) || h.file.toLowerCase().includes(q)),
          filesScanned: 4,
          elapsedMs: 0,
        };
      }
      toasts.error(`Search failed: ${e}`);
      return EMPTY_OUTCOME;
    }
  }

  /**
   * Cross-file replace. The Rust side walks the same candidate set as
   * `search`, rewrites matching files through the atomic-write pipeline and
   * returns a per-batch summary; one unreadable file only lands in
   * `errors`, it never aborts the rest.
   */
  async function replace(
    query: string,
    replacement: string,
    options: MatchOptions,
    pathFilter?: string,
  ): Promise<ReplaceSummary | null> {
    const folder = workspace.currentFolder;
    if (!folder) {
      toasts.warning('Open a folder first to enable global search');
      return null;
    }
    if (!query.trim()) return null;
    try {
      return await searchReplace<ReplaceSummary>({
        root: folder,
        query,
        replacement,
        options,
        pathFilter: pathFilter?.trim() ? pathFilter.trim() : null,
      });
    } catch (e) {
      toasts.error(`Replace failed: ${e}`);
      return null;
    }
  }

  return { search, replace };
}
