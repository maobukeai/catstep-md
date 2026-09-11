import { invoke } from '@tauri-apps/api/core';
import { useWorkspaceStore } from '../stores/workspace';
import { useToastsStore } from '../stores/toasts';

export interface SearchHit {
  file: string;
  line: number;
  snippet: string;
}

export function useGlobalSearch() {
  const workspace = useWorkspaceStore();
  const toasts = useToastsStore();

  async function search(query: string, root?: string, maxResults = 200): Promise<SearchHit[]> {
    const folder = root ?? workspace.currentFolder;
    if (!folder) {
      toasts.warning('Open a folder first to enable global search');
      return [];
    }
    if (!query.trim()) return [];
    try {
      const hits = await invoke<SearchHit[]>('search_in_dir', {
        root: folder,
        query,
        maxResults,
      });
      return hits;
    } catch (e) {
      if (import.meta.env.DEV && typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        const q = query.toLowerCase();
        return [
          { file: `${folder}/Blender 进阶与实战技巧.md`, line: 12, snippet: 'Blender 常用快捷键与高级实战技巧梳理总结' },
          { file: `${folder}/3D建模/Blender 进阶与实战技巧.md`, line: 45, snippet: '深入理解 Blender 几何节点与物理模拟' },
          { file: `${folder}/3D建模/LowPoly 场景建模.md`, line: 28, snippet: '使用 Blender 构建多边形场景拓扑' },
          { file: `${folder}/Vue3 与 Vite 性能调优指南.md`, line: 8, snippet: 'Vue3 响应式系统与虚拟 DOM Diff 深度解析' },
        ].filter(h => h.snippet.toLowerCase().includes(q) || h.file.toLowerCase().includes(q));
      }
      toasts.error(`Search failed: ${e}`);
      return [];
    }
  }

  return { search };
}
