# 表格重做与专注计时快捷键冲突

根代理在本轮 production 638 界面验收中实证：表格内 Ctrl+Shift+Z 成功重做，同时工具栏“猫步专注”变为倒计时（24:43）。这不是表格重做本身失败，而是同一事件执行了两个动作。

## 根因

- `keybindings.ts` 的默认 `pomodoro.startLast` 是 `Mod+Shift+Z`，与编辑器重做组合冲突。标准 editor history 不在全局 KEY_ACTIONS 内，现有设置冲突检查不会报告这个上下文冲突。
- `useShortcuts.ts` 以 window capture 注册，先匹配并启动专注计时；目标阶段的表格 `keydown` 才调用 redo 和 stopPropagation，无法撤销已经启动的计时器。plain fallback 同样有后置 Shift+Z handler。
- CodeMirror 会拒绝已 defaultPrevented 的事件，所以它可能只启动计时而不重做；此外当前 upstream historyKeymap 在 Windows 仅有 Ctrl+Y，Shift+Z 仅列为 macOS/Linux 重做，需要明确补上 Windows 同样的 alias。
- 原表格回归直接触发 cell handler，没有装载 window capture 分发器，因而未覆盖这个副作用。

## 最小修复

- 保留默认 `pomodoro.startLast`、设置文案与所有翻译。仅在该默认绑定没有有效显式用户字符串 override、组合为 Mod+Shift+Z、目标实际可编辑文字时，让事件进入编辑器/原生历史处理，不 preventDefault、不 stopPropagation。即使没有可重做历史，也不回退为启动计时。
- 识别继承 contenteditable 的 CM 行、表格子节点、可写 textarea 和文字 input；不把整个 pane 当作文字编辑。按钮、工具栏、非文字控件、非编辑区域仍保留默认启动行为；readonly/disabled 字段不当作可编辑目标。
- 显式自定义 override 即使恰好设为同一 Mod+Shift+Z，也尊重用户意图。已消费的 pomodoro 动作在 capture 阶段 stopPropagation，避免目标端 table/plain 继续重做；不同自定义组合、解绑和恢复默认仍由原 resolver 决定。
- isComposing 或 keyCode229 不触发该全局动作，既有 F11 特例没有修改。
- CM 装配仅增加 `Mod-Shift-z → redo` alias，使用已有 history 和原有输入分组，不新建历史栈。plain fallback 已支持 Shift+Z，无需修改。

产品改动仅 `app/src/composables/useShortcuts.ts` 与 `app/src/lib/cm-extensions.ts`；未改 Rust、默认快捷键、翻译或用户设置。

## 回归

新增 `shortcut-dispatch.test.ts` 装载实际 useShortcuts 源码、捕获它实际注册的 window capture handler，替代的仅是 Vue 生命周期及 native/file service。验证 capture 后的实际 CM redo、各文字目标、空 redo、不相关计时副作用、工具栏与非编辑区默认行为、显式同键/异键 override、解绑、IME与229。

`cm-extensions.test.ts` 使用实际 buildCmExtensions 的 keymap facet 验证 alias 指向现有 redo，并通过实际 EditorState/undo/redo 确认连续输入仍只有一组历史，undo/redo 往返不变。

第一轮定向执行 **25 passed / 0 failed / 0 skipped**，见 `shortcut-conflict-targeted.txt`；当时类型检查见 `shortcut-conflict-typecheck.txt`。相对前端638新增7个测试。下述真实原生验收随后发现了该轮实现的范围回归，因此不能只用这组通过结果关闭 IME 保存验收。

## 真实原生645复核发现的保存回归及修正

根代理使用真实微软拼音输入 ni'hao，候选打开时按 Ctrl+S；磁盘没有写入 IME 前缀，符合等待预期。但 Space 提交“你好”后，磁盘仍旧、标签仍为蓝点，原保存请求没有继续。这里不是 saveActive 的等待协议失败，而是本次快捷键修改错误地在全局入口遇到 isComposing/keyCode229 时直接 return，使保存动作根本没有排队。该全局 guard 已移除。

当前 IME/229 保护仅限已解析的 `pomodoro.startLast`，保留其他动作原有行为。另原 eventToCombo 本来就对 isComposing 返回 null，因此仅移动 guard 不能覆盖 composing=true 的 Ctrl+S。当前保持该通用 normalizer 原样，仅对 Ctrl/Meta 修饰的 composition/Process/229 事件，在候选组合实际绑定到 **file.save** 时恢复同一个现有 Save action；Process/Unidentified/Dead 可由稳定 KeyS 等 code 恢复候选。不猜普通拼音字母，不添加监听器或全动作白名单，不改其他动作的 IME 策略；保存仍由真实 saveActive/waitForNoteEditors 等待提交。

追加的实际 handler 测试覆盖 isComposing、229、Process+KeyS、自定义 Save 绑定和旧键解绑。另 note-lifecycle.test.ts 把实际 useShortcuts handler 接到实际 useFiles.saveActive、tabs/store 与 editor-flush 协议；四种事件场景均验证：一次 Ctrl+S 排队后写入为0，composition-finished 提交完整中文后正好一次写入、savedContent一致、dirty=false，期间不发第二次保存快捷键。

修正后定向 **48 passed / 0 failed / 0 skipped**（包含原默认/自定义 Zen、CM keymap 分组与数据生命周期回归），日志 `shortcut-ime-save-targeted.txt`；类型检查 `shortcut-ime-save-typecheck.txt` 通过。相对前端645新增3项，完整门禁预计648，由根代理随后统一重跑；真实微软拼音 Ctrl+S→Space 无第二次保存的最终原生结果仍待根代理记录。Rust 源码与测试没有重复修改或运行。
