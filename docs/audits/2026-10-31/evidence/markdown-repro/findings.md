# Markdown 编辑与渲染审计证据（2026-10-31）

本目录仅含报告证据，未修改产品代码。`repro-output.json` 是实际执行结果；12 个探针覆盖 6 类已确认问题。两个 TableWidget 事件链探针使用真实 CodeMirror StateField、真实 TableWidget 与真实 useEditorTable，DOM 为最小事件桩，不能替代原生 WebView 全流程测试；普通代码围栏误渲染已由主代理在浏览器中独立复现。

## 复现命令

在项目 `app/` 下运行：

```powershell
node --import ./scripts/register-loader.mjs --import ../docs/audits/2026-10-31/evidence/markdown-repro/register-transpile.mjs ../docs/audits/2026-10-31/evidence/markdown-repro/repro.mjs
```

`transpile-loader.mjs` 使用项目现有 TypeScript 编译器处理纯类型导入和参数属性，避免直接用 Node 类型擦除导入前端模块时产生非业务错误；不安装依赖、不改源码。

已运行现有针对性测试（58 / 58 通过）：

```powershell
node --import ./scripts/register-loader.mjs --test src/lib/markdown-table.test.ts src/lib/markdown-tables.test.ts src/lib/code-block-fidelity.test.ts src/lib/html-live-render.test.ts
```

## M1 / P1：表格在文档中的位置变化后，继续编辑可能覆盖表格外正文

适用：默认 CodeMirror 的 `liveEdit`，或 `edit + livePreview`。`Editor.vue:2281-2329` 装载这些扩展；`platform.ts:97-111` 表明 Windows 现也默认使用 CM，只有 `?forcePlain` 强制旧实现。

证据位置：`cm-live-blocks.ts:287-290` 把表格范围、模型放入闭包；`:385-402` 用闭包范围写回；`:539-599` 的 `updateDOM` 重用旧 DOM 时只更新单元格和 `__tableWidget`，没有同步闭包范围和模型。

触发：挂载 `Prefix\n\n| A | B |\n| --- | --- |\n| x | y |\n\nTail`；在表格之前插入 `INSERTED\n`；再把正文第一格改成 `EDITED`。

实际：`INSERTED| A ...`，`Prefix` 丢失，表格旧尾拼接成重复残行。数据写入 CodeMirror 文档，后续保存会持久化；不是纯样式问题。外部模型变更、撤销重做后模型也可能过时。

建议：将表格控制器保存在 DOM 或共享对象上，`updateDOM` 原子更新最新范围、模型和 source；事件发生时读取控制器，不捕获不可更新的局部副本。或先在范围/模型改变时重建 widget，并正确恢复焦点与 IME 状态。回归覆盖表格前增删字、两张表互相挤动、撤销重做后编辑。

## M2 / P1：输入后立刻操作表格工具栏，用过期快照覆盖新内容

位置：`cm-live-blocks.ts:415-444` 仅 focus 时发送 `source/blockTo`；`:385-402` 输入后没有更新工具栏快照。`useEditorTable.ts:197-200` 读取旧 source，`:254-258` 按旧 blockTo 整块替换。`:356-365` 打开完整表格编辑器也复用快照。

触发：聚焦上面表格的 `x`，改成 `EDITEDLONG`，随即点击居中。

实际：新表格内变回 `x`，旧范围之外残留 `EDITEDLONG` 与重复分隔/数据行。见 JSON 中 before/actual。风险不限于对齐按钮，增删行列、删表、打开完整编辑器均读取同一快照。

建议：工具栏只保存可校验的表格身份与行列；操作前从当前文档重新定位和解析，或每次 input/updateDOM 都刷新活动表格范围与 source。写入前验证当前 slice 与预期 source 一致。回归覆盖连续输入后立刻执行每种工具栏操作。

## M3 / P1：普通代码块中的 Markdown 示例被再次当作正文渲染

位置：`cm-live-blocks.ts:1034-1067` 全文逐行扫描；后续直接识别 HTML、图片、公式和表格（表格 `:1285-1320`），不跳过普通 fenced/indented code。`cm-live-render.ts` 另一条链路虽然读语法树并识别 FencedCode，不能保护该独立 StateField。

最小触发：普通三反引号 markdown 代码块里放完整 3 行表格。实际 StateField 生成 TableWidget；预期为纯代码字符。浏览器独立验证还确认 HTML 代码也被渲染。代码样例中生成的表格可交互，因而存在误改样例的风险。

建议：基于统一语法树/块 token 排除 FencedCode、CodeBlock、HTML 原始区和嵌套代码容器；专用 Mermaid/tldraw/PlantUML 规则仅在真正对应 fence token 上启用。回归涵盖代码内表格、HTML、图片、公式，三/四反引号、波浪线、列表/引用嵌套。

## M4 / P2：实时编辑与阅读使用不同表格语法和列数

位置：`cm-live-blocks.ts:121-137` 要求两侧外管道和至少一处 3 连横线；`:1285-1320` 还要求正文行。`markdown-table.ts:131-133` 用 header/delimiter 列数最大值；阅读预处理 `markdown.ts:579-633` 则按 header 列数纠错。

探针均确认 renderMarkdown 生成 table 而 live StateField 无 TableWidget：

- 无外侧管道：`A | B\n--- | ---\nx | y`。
- 只有表头与分隔行的空表。
- 单横杠分隔：`| A | B |\n| - | - |\n| x | y |`。
- 引用表格：每行加 `> `。

另对 2 列表头 + 3 列 delimiter，阅读为 2 列，实时为 3 列。后续编辑会把额外空列写回。

建议：表格范围和列模型来自同一解析结果，统一容错规范；保留容器前缀；不要另写一套不完整启发式 detector。回归要求阅读、编辑、保存重开结构一致。

## M5 / P2：引用表格增删移动列丢失引用语义

位置：`markdown-table.ts:239-250`、`:255-266`、`:269-282` 分别返回新模型时遗漏 `prefix`；行操作和 setAlign 使用 `...t`，故只有列操作会发生。

触发：`parseTable('> | A | B |\n> | --- | --- |\n> | x | y |')` 后 insertColumn/deleteColumn/moveColumn 并 serialize。实际所有行丢失 `> `；预期仍在引用块中。

建议：返回 `{ ...t, header, aligns, rows }` 保留模型附属信息，增加每种结构操作的 prefix 保真断言。此问题不依赖 widget DOM，也影响完整表格编辑器等共用模型入口。

## M6 / P2：合法缩进代码围栏在渲染前被改写

位置：`markdown.ts:475-499` 仅以零缩进且三字符围栏的正则切片来保护代码，随后对其余文本运行 HTML 去缩进/补空行。

触发源码：两空格缩进的三反引号 html 围栏，内部 `    <div>literal</div>`，两空格缩进关闭围栏。

实际 preprocessMarkdown 把内部变成多空行与零缩进 `<div>literal</div>`；阅读、导出使用的是被修改后的代码。原文件本身未因此改写，但展示及从渲染内容复制不再忠于原代码。

建议：所有预处理共享同一个符合语法规则的代码保护扫描，记录围栏字符、长度、容器与合法缩进，直接在非代码区域转换。补上缩进围栏、长围栏、未闭合围栏、混合围栏与嵌套容器的代码保真测试。

## 布局及其余问题交由主报告整合

主代理另已在浏览器测得窄编辑窗长 URL 表格撑宽全文，以及阅读页中文逐字竖排/右列被裁切；共同缺少可约束列宽与局部横滚的 table wrapper。这里不重复登记问题，避免数量重复。`codeBlockWrap` 默认 CM 接线问题也由主代理取证。

## 测试缺口

58 个相关现有测试通过不能说明交互链路正确：它们主要验证 parser/serializer/renderMarkdown 纯函数，未挂载 TableWidget、模拟输入后工具栏、校验 updateDOM 复用后的写回范围。建议新增最小 widget 集成测试，再用 WebView2 覆盖中文 IME、Tab/Enter、撤销重做、两个编辑窗及表格长内容的视觉回归。
