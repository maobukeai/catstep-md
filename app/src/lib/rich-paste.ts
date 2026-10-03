import { EditorState, type TransactionSpec } from '@codemirror/state';
import { clipboardHtmlIsStructured, htmlToMarkdown } from './htmlToMarkdown';

/**
 * 富文本粘贴 → Markdown 的分流判定层（第三轮从 Editor.vue 抽离，S14）。
 *
 * 原先这段判定链内联在 Editor.vue 的 tryRichTextPaste：设置开关 → 剪贴板
 * 是否携带 text/html → 是否为"真正的结构化标记"（wrapper-only HTML 不算，
 * 如 `<div>text</div>`）→ 转 Markdown → 转换结果非空。这里抽成纯函数：
 * 只读剪贴板数据、返回应插入的 Markdown 或 null（null = 不接管，交回
 * 原生/图片路径）。preventDefault 与插入动作仍留在组件编排层，时序与
 * 原实现一致（先转换后 preventDefault）。
 */
export interface ClipboardDataLike {
  /** DOM 的 DataTransfer.types 是 readonly string[]，结构兼容即可。 */
  types?: { includes(name: string): boolean };
  getData(type: string): string;
}

export function richPasteMarkdown(
  cd: ClipboardDataLike | null | undefined,
  enabled: boolean,
): string | null {
  if (!enabled) return null;
  if (!cd || !cd.types || !cd.types.includes('text/html')) return null;
  const html = cd.getData('text/html');
  if (!html || !clipboardHtmlIsStructured(html)) return null;
  const md = htmlToMarkdown(html);
  if (!md.trim()) return null;
  return md;
}

/**
 * CodeMirror 粘贴路径的插入事务：用 Markdown 替换当前主选区，光标落在
 * 插入文本末尾并滚动到可见。与原 Editor.vue 内联 dispatch 的 spec 一致。
 */
export function pasteReplaceSelectionTransaction(
  state: EditorState,
  md: string,
): TransactionSpec {
  const sel = state.selection.main;
  return {
    changes: { from: sel.from, to: sel.to, insert: md },
    selection: { anchor: sel.from + md.length },
    scrollIntoView: true,
  };
}

/**
 * 外部内容写回事务（#186 defense-in-depth 的事务半边）。外部更新（如保存
 * 后的回读）需要全文替换时，把光标钳制在新文档长度内——否则全 doc 替换会
 * 把 caret 映射到 0（"光标跳到顶部"）。IME 组合期间是否跳过 dispatch 的
 * 判定留在组件（依赖 view.composing 运行时状态）；文档相同则无事可做。
 */
export function externalContentWriteback(
  state: EditorState,
  next: string,
): TransactionSpec | null {
  if (state.doc.toString() === next) return null;
  const head = Math.min(state.selection.main.head, next.length);
  return {
    changes: { from: 0, to: state.doc.length, insert: next },
    selection: { anchor: head },
  };
}
