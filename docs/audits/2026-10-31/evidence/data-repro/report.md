# 数据与核心逻辑专项审计结果

基线 `4a980caedd5fb1fa5e73069c772ab4b8e51aeeb8`，日期 2026-10-31。

本专项未运行完整桌面 GUI、真实双窗口或 Android 真机。前 9 项均有实际模块或原 Rust 函数复现；其余为完整源码控制流确认，独立注明验证边界。证据脚本只写临时文件，没有写入用户笔记。

优先级约定：P1 = 可能丢失/覆盖笔记或阻断受支持平台核心操作，应优先修；P2 = 明确功能错误，应在近期修复。没有足够证据的 P0。

## D01 / P1：保存中的新输入被误标记为已保存

位置：`app/src/composables/useFiles.ts:672-689`、`:734-749`；`app/src/stores/tabs.ts:285-310`。

复现：tab 初始正文 v1；触发保存，暂缓 writeNote Promise；继续输入得到 v2；让写入完成。实际磁盘 payload=v1，但 savedContent=v2，dirty=false。关闭标签将不再提示，恢复副本也会被 saved 事件清理。正常保存、另存为和 watcher overwrite 共用相同缺陷。

根因：写入使用 await 前捕获的字符串，完成后 markSaved 读取可变 tab 的当前正文，并未记录本次落盘版本。

修改：保存前形成 `{tabId,path,content,revision,encoding,bom,lineEnding}` 不可变快照；成功只把 savedContent 更新为该快照正文；期间的新输入继续保持 dirty。对同一文件保存串行化或处理版本先后，避免旧请求最后完成覆盖新请求。

证据：`reproduce.mjs` 第 1 例。未模拟真实磁盘延迟，受控 IPC Promise 确定性复现竞态。

验收：保存期间连续输入、连续 Ctrl+S、网络盘慢写入、另存为期间切换标签；以实际重读字节与 savedContent 对照，不只检查成功 toast。

## D02 / P1：属性面板修改 frontmatter 会丢掉尚未保存的正文

位置：`app/src/composables/useProperties.ts:41-43,78-81,98-99,118-119`；Rust `app/src-tauri/src/commands.rs:1636-1649,1671-1680`。

复现：磁盘正文 old body，编辑器正文 old body plus UNSAVED EDIT；不保存，直接改属性。Rust 从磁盘读取 old body 改 YAML，前端把返回的全文 applyExternalSave，UNSAVED EDIT 消失，dirty=false。

根因：属性编辑以磁盘旧版本为输入，既未保存/合并 live tab，又无 dirty 检查；回包按完整全文覆盖编辑缓冲。

修改：在当前 live 文档上执行 frontmatter 修改，保持正文与 undo 历史，再经过统一保存管道；若必须由后端解析，应传入当前内容及版本，返回 patch，并以版本检查应用。不能只增加一个“操作成功”标记。

证据：`reproduce.mjs` 第 4 例；后端 read-modify-write 源码确认。

验收：脏正文、350ms 尚未同步输入、属性更新失败、连续改多个属性，正文必须完整保留。

## D03 / P1：A 的属性异步返回会把 A 全文写进 B 标签

位置：`app/src/composables/useProperties.ts:78-81,85-100,112-120`。

复现：在 A 发起属性更新，挂起响应，切换到带未保存内容的 B，再让 A 响应返回。B.content 被替换成 A 全文且 B.savedContent 也变成 A，全无脏标记；A 内存未更新。下次保存 B 会把 A 内容写到 B 文件。

根因：请求开始时只捕获 path；applyRewritten 在完成时读取 tabs.activeId。身份跨 await 丢失。

修改：请求开始捕获 tabId+path+revision，按该 tabId 回写，并复核当前文件身份；原标签关闭或改路径时不能操作其他标签；与 D02 一并用 patch/版本保护。

证据：`reproduce.mjs` 第 5 例，确切复现 A 回包污染 B。

验收：发起后切换标签、关闭原标签、原文件重命名；B 的正文、路径、savedContent、undo 均不得变化。

## D04 / P1：自动外部刷新会覆盖读取期间产生的新输入

位置：`app/src/composables/useFileWatcher.ts:49-65,78-87`。

复现：外部文件事件到达时 tab clean；readNote 仍 pending 时用户继续输入；readNote 返回后 setContent+savedContent 无条件覆盖。新输入丢失，未显示冲突对话框。

根因：isDirty 仅在读取前检查；await 返回后没有重查 revision、path、tab 存活或编辑变化。autoReload 分支也没有 pendingPaths 防重入，多个响应还能乱序覆盖。

修改：为每个 tab/path 记录请求 generation 与开始版本；返回时只在仍 clean 且版本未改变时应用，否则弹冲突或保留最新 live 内容；合并重复事件。

证据：`reproduce.mjs` 第 6 例。

验收：慢磁盘读期间输入、连续外部变化、读取期间重命名/关闭，禁止静默覆盖。

## D05 / P1：UTF-16 保存会转码；属性操作会写出 BOM 与正文编码不匹配的乱码文件

位置：`app/src-tauri/src/commands.rs:548-575,855-864`；`app/src/lib/commands.ts:49-71,102-107`；`useFiles.ts:687`。

实际探针结果（encoding_rs 0.8.35）：

- `write_file_inner(...,"UTF-16LE")` 的 enc.encode 实际返回 UTF-8 字节，代码忽略元组返回的真实 output encoding。普通 Ctrl+S 会把 UTF-16 转为无 BOM UTF-8，tab.encoding 仍显示 UTF-16。
- `atomic_write_encoded(...,"UTF-16LE",true)` 又按请求编码补 FF FE，所以得到 **UTF-16 BOM + UTF-8 正文**。UTF-16 读取“中文 Hello”后实际成为“룤…螖䠠汥潬”，且解码错误标志仍为 false。这影响属性修改/删除及其他使用该辅助函数的流程。
- 普通 UTF-8 BOM 保存时 BOM 也丢失：hadBom 在 tab 中保存，但写入接口没有传递它。

修改：UTF-16LE/BE 明确使用 Rust encode_utf16 逐 u16 按端序序列化；统一带 BOM 元数据的编码写入函数；不能把 encoding_rs::Encoding::encode 当成 UTF-16 编码器；完成后核对真实字节编码。保留 legacy 不可表达字符时的拒绝写入。

证据：`encoding-probe/src/main.rs` 提取项目两段原函数，用 Rust 真实字节断言；`encoding-results.txt`。只有原子替换实现换成临时目录 fs::write，不影响编码结论。

验收：UTF-8 有/无 BOM、UTF-16LE/BE 有 BOM、中文+emoji+ASCII，普通保存/另存为/改属性/删属性/Agent patch 后重读逐字符相等，BOM 与实际字节一致。

## D06 / P1：会话恢复和工作区切回直接信任旧正文，可覆盖应用关闭期间的外部修改

位置：`app/src/stores/tabs.ts:135-159,213-226,438-471`；`app/src/App.vue:1370-1444` 初始化路径；`useFileWatcher.ts:18-44,122-126`。

复现：保存 clean 标签 old body 并 persist；应用关闭后磁盘被其他编辑器改成 newer body；再次创建 tabs store。实际 activeTab 仍 old body、savedContent 仍 old body、dirty=false。watcher 是启动之后才注册，历史修改没有新事件；openPath 即使读到更新内容，openFromDisk 遇已打开路径也直接 return existing。

修改：恢复仅以缓存保留 dirty 草稿；clean 笔记按磁盘重读；dirty 笔记比较缓存 savedContent 与当前磁盘版本，发生双端修改必须保留两份并提示合并。工作区切回亦执行同样 reconciliation。磁盘不见时标明失联，不能当作正常已保存文件。

证据：`reproduce.mjs` 第 8 例动态验证 store hydration 的缓存结果；App 初始化与 watcher 源码确认没有启动补读。未声明已经运行关闭/重开 GUI 测试。

验收：关闭期间外部改文/删文、非活动工作区外部改文、clean/dirty 两种缓存状态，恢复后不得把旧稿静默当新稿保存。

## D07 / P2：文件夹重命名/移动不更新内部已打开笔记路径

位置：`app/src/components/FileTree.vue:725-728,858-875,943-946`。

复现：打开 C:/notes/old/note.md，重命名 old→new。repointOpenTabs 只 find filePath === originalFolder，因此内部文件一个也不迁移。标签继续指向旧路径；Ctrl+S 因父目录不存在失败，最近文件与 watcher 仍关联旧位置；如果旧目录被重建，后续保存可能产生两份分叉。

修改：针对目录操作按规范化路径前缀迁移全部子 tab、MRU、MFU、recovery 与 watcher；dirty 内容保留；clean 内容重读时也使用 D04 的版本保护及 CRLF/编码一致处理。

证据：`reproduce.mjs` 第 7 例提取 FileTree 的原 repointOpenTabs 函数，验证子 tab 不变；真实 filesystem rename 未执行。

验收：多层目录内多个 clean/dirty 标签、移动目录、路径大小写/分隔符变化，所有子路径与保存目标一致。

## D08 / P2：goal_set_at 在落盘后才插入，内存与磁盘伪一致

位置：`app/src/stores/tabs.ts:301-310`；`useFiles.ts:672-689`。

复现：含 goal: 100 且无 goal_set_at 的笔记第一次保存。磁盘没有 goal_set_at，内存和 savedContent 有，dirty=false。关闭后重读丢失日期锚点；连续重开可能每天重新生成，写作 streak 不可信。

修改：保存前做确定性的内容变换，写入和 savedContent 必须引用同一快照；markSaved 只能记账，不能再改正文。和 D01 共同修复。

证据：`reproduce.mjs` 第 2 例。

验收：第一次保存后立即用另一个 reader 读磁盘，内容必须与编辑器完全一致；再次保存幂等。

## D09 / P2：失焦自动保存先检查滞后 dirty，短时间输入后切走会漏保存

位置：`app/src/composables/useFiles.ts:779-784`；`app/src/components/Editor.vue:305` 附近的 350ms debounce；`App.vue:1348-1350`。

复现：原 clean 标签，在 CodeMirror 里输入后 350ms 内切到其他应用。autoSaveDirtyTabs 在调用 saveTab 之前先判断 tabs.isDirty，看到滞后的 clean，整个保存被跳过；saveTab 内的 flush 根本没有机会执行。随后 debounce 虽会同步内存，但失焦事件已经结束，磁盘仍旧。

修改：autoSaveDirtyTabs 入口先广播同步 flush，再枚举 dirty；若 IME composition 尚未结束，排队在结束后重试，不能无条件宣告完成。

证据：`reproduce.mjs` 第 3 例用 flush listener 模拟待同步编辑，验证入口未 dispatch flush，也未落盘；未做真实键盘/IME GUI 测试。

验收：clean 文档输入后立即 Alt+Tab，测试 0/100/349/351ms，磁盘必须保存最后已提交文本。

## D10 / P1：Git 拉取屏蔽 watcher，但成功后没有重读打开标签

位置：`app/src-tauri/src/github_sync.rs:1247-1250`；`watcher.rs:198-199`；`useGithubSync.ts:157-161`；`App.vue:866-877`。

源码控制流确认：pull 开始时屏蔽整个工作区 30 秒 watcher 事件；完成后发 remote-pulled，整个前端唯一处理者是 App（rescan index）和 FileTree（刷新树），没有任何标签重读。打开的 clean 标签因此继续显示 pull 前正文，下一次 Ctrl+S 可以覆盖已经拉取的远端正文。dirty 标签也没有比较新的磁盘 baseline。开始时间在网络 fetch 之前，失败/慢拉取仍会形成无条件屏蔽窗口。

修改：pull 返回具体 changed/deleted paths 与版本；完成后对所有打开标签执行 clean 重读、dirty 冲突提示；内部写事件按本次实际变更精准去重；将 suppression 限定为实际写入时段并显式关闭，不能只依赖 30s 定时。

验证边界：跨 Rust→事件→所有前端 listener 的全库静态路径确认；未启动本地 Git 双设备 + GUI 的端到端复现。不能把 Rust git 测试通过当作编辑器内容已同步。

验收：A/B 两设备改同一打开笔记，pull 后 clean 编辑器立即等于磁盘；dirty 编辑器保留新输入并提示冲突；失败拉取后普通外部编辑仍能被感知。

## D11 / P1（Android）：SAF 文件夹选择的持久化键不一致，系统选完后不进入工作区

位置：`useFiles.ts:590,593` 写/删除 `catstep:saf-picking`；`App.vue:1394,1407` 读/删除 `solomd:saf-picking`。

源码控制流确认：Android openFolder 设置的是 catstep 前缀，resolveSafPick 函数只认可 solomd 前缀，函数第一行直接 return。系统选择器返回后，解析结果、setSafVault 和打开文件树均无法到达，用户看到“选了文件夹没反应”。

修改：将键集中为常量并由入口/恢复/取消共同使用；兼容清理两个旧键；为“launch→visibility resume→resolve→setSafVault”完整链路补测试。

验证边界：确定的字符串断链，未使用 Android 真机。Windows 不受此项影响。

## D12 / P1（多窗口）：保存事件全局抑制与无订阅引用，其他窗口会失去文件更新

位置：`app/src-tauri/src/runner.rs:850`；`watcher.rs:29,189-199,230-242,288-299`。

源码控制流确认两条故障路径：

1. WatcherState 与 SELF_WRITES 属应用进程级。窗口 A 保存同一笔记后，事件在 Rust 发送给所有 webview 之前被全局 suppressed，窗口 B 无法收到“另一个窗口已保存”的更新。B 的 clean 旧副本可能随后覆盖 A。
2. 同 canonical 文件第二次 watch_file 直接返回，没有按窗口/订阅计数。窗口 A 或 B 任一关闭标签触发 unwatch_file 都直接 remove canonical，另一窗口本地 watchedPaths 仍以为有监控，之后外部修改无法再感知。

修改：按 window label/token 记录订阅集合；unwatch 只解除调用方订阅，最后订阅消失才移除系统 watch。应用内部保存另发携带 sourceWindow、path、revision 的更新事件，其他窗口照常执行 clean 刷新/dirty 冲突处理。仅对写入来源窗口抑制重复通知。

验证边界：应用级 state、watch 注册/注销、self-write emit 前抑制的源码路径确认，未实际启动双窗口。新增多窗口测试不应继续把重复订阅当作单一订阅的“幂等调用”。

## 测试与修复顺序建议

- 已完成：8 个 TypeScript 受控模块复现；3 个 Rust 字节断言。结果表明缺陷存在，不表示质量门禁通过。
- 先修 D01-D06：身份与版本一致、不会丢稿、磁盘编码一致。
- 再修 D10/D12：拉取/跨窗更新后的同步与冲突处理，避免旧副本回写。
- 同步补 D07-D09 和 Android D11 的完整动作链回归。
- 前端纯工具测试、Rust 磁盘测试、桌面行为测试均需覆盖同一条“编辑→保存→外部修改→切换→关闭→重开”生命周期；只测试局部纯函数会遗漏上面的边界错误。

已看到的正向实现：普通保存采用临时文件+fsync+rename；legacy 编码不可表达字符会返回错误；关闭标签会 flush debounce 并在 save 失败时保留标签；切换工作区携带 dirty tab；recovery 恢复由用户确认。这些措施有价值，但并未覆盖异步返回时文档身份/版本变化、编码器真实输出和多窗口订阅。
