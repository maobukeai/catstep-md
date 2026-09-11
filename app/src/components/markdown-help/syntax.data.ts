export interface SyntaxItem {
  category: string;
  syntax: string;
  example: string;
  zh: string;
  en: string;
}

const C = {
  headings: '标题 / Headings',
  emphasis: '强调 / Emphasis',
  lists: '列表 / Lists',
  links: '链接与图片 / Links & Images',
  code: '代码 / Code',
  quotes: '引用 / Quotes',
  tables: '表格 / Tables',
  math: '数学公式 / Math (KaTeX)',
  diagrams: '图表 / Diagrams',
  extras: '扩展语法 / Extras',
  other: '其他 / Other',
};

const syntaxItems: SyntaxItem[] = [
  {
    category: C.headings,
    syntax: '# Heading',
    example: '# H1\n## H2\n### H3',
    zh: '一到六级标题，# 的数量决定级别',
    en: 'Headings 1–6, the number of # is the level',
  },
  {
    category: C.emphasis,
    syntax: '**bold**',
    example: '**bold text**',
    zh: '加粗文字',
    en: 'Bold text',
  },
  {
    category: C.emphasis,
    syntax: '*italic*',
    example: '*italic text*',
    zh: '斜体文字',
    en: 'Italic text',
  },
  {
    category: C.emphasis,
    syntax: '~~strike~~',
    example: '~~deleted~~',
    zh: '删除线',
    en: 'Strikethrough',
  },
  {
    category: C.emphasis,
    syntax: '`code`',
    example: '`inline code`',
    zh: '行内代码',
    en: 'Inline code',
  },
  {
    category: C.emphasis,
    syntax: '==mark==',
    example: '==highlighted==',
    zh: '高亮（GFM 扩展）',
    en: 'Highlight (GFM extension)',
  },
  {
    category: C.lists,
    syntax: '- item',
    example: '- Apple\n- Banana\n- Cherry',
    zh: '无序列表（- 或 * 均可）',
    en: 'Unordered list (- or * works)',
  },
  {
    category: C.lists,
    syntax: '1. item',
    example: '1. First\n2. Second\n3. Third',
    zh: '有序列表',
    en: 'Ordered list',
  },
  {
    category: C.lists,
    syntax: '- [ ] task',
    example: '- [ ] Todo\n- [x] Done',
    zh: '任务待办列表，可直接点击勾选',
    en: 'Task list, click checkbox to toggle',
  },
  {
    category: C.lists,
    syntax: '  - nested',
    example: '- Outer\n  - Inner\n    - Deeper',
    zh: '缩进 2 个空格 = 嵌套一层',
    en: 'Indent 2 spaces to nest deeper',
  },
  {
    category: C.links,
    syntax: '[text](url)',
    example: '[Google](https://google.com)',
    zh: '超链接：[显示文字](网址)',
    en: 'Link: [text](url)',
  },
  {
    category: C.links,
    syntax: '![alt](url)',
    example: '![Logo](./logo.png)',
    zh: '图片：在链接前加上叹号 !',
    en: 'Image: same as link, prefixed with !',
  },
  {
    category: C.links,
    syntax: '[[note]]',
    example: '[[Welcome]]\n[[Welcome|主页]]\n[[Welcome#快速上手]]',
    zh: '双链：快速跳转工作区同名笔记，输入 [[ 唤起自动补全',
    en: 'Wikilink to note in workspace, type [[ for autocomplete',
  },
  {
    category: C.code,
    syntax: '```lang',
    example: '```js\nconsole.log("hello catstep")\n```',
    zh: '代码块，指定语言名称启用语法高亮 (js/python/rust/ts/...)',
    en: 'Fenced code block, set language for syntax highlighting',
  },
  {
    category: C.quotes,
    syntax: '> quote',
    example: '> 知识就是力量。\n> — 培根',
    zh: '引用区块，可多行嵌套',
    en: 'Blockquote, can span multiple lines',
  },
  {
    category: C.tables,
    syntax: '| h1 | h2 |',
    example: '| 姓名 | 职务 |\n|------|------|\n| 猫步 | 架构师 |\n| Solo | 助手 |',
    zh: '表格：支持就地浮动工具条增删行与列',
    en: 'Table: supports in-place floating editing',
  },
  {
    category: C.math,
    syntax: '$inline$',
    example: '$E = mc^2$',
    zh: '行内数学公式 (KaTeX 渲染)',
    en: 'Inline math formula via KaTeX',
  },
  {
    category: C.math,
    syntax: '$$block$$',
    example: '$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$',
    zh: '块级数学公式',
    en: 'Block math formula',
  },
  {
    category: C.diagrams,
    syntax: '```mermaid',
    example: '```mermaid\nflowchart LR\nA[灵感] --> B[猫步 MD] --> C[优雅产出]\n```',
    zh: '流程图（Mermaid 支持流程图、时序图、甘特图等）',
    en: 'Diagram via Mermaid flowchart / sequence etc.',
  },
  {
    category: C.extras,
    syntax: '[^1]',
    example: '点击查看脚注说明[^1]。\n\n[^1]: 脚注详细内容。',
    zh: '脚注：正文标记 + 文档底部说明',
    en: 'Footnote: marker in text + definition at bottom',
  },
  {
    category: C.extras,
    syntax: '---\nkey: val\n---',
    example: '---\ntitle: 猫步文档\ntags: [笔记, 效率]\n---\n\n# 正文内容',
    zh: 'YAML Front-matter 文档元数据（置于第一行）',
    en: 'YAML Front-matter metadata (must be line 1)',
  },
];

export { syntaxItems };