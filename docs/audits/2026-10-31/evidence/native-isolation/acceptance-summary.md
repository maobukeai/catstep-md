# Windows 原生验收证据汇总

日期：2026-10-31。此摘要只汇总已有文件和根代理实际 CUA 操作记录；复核者未启动 GUI、仿真器或新增测试，未改产品源码及主报告。根代理补充确认了多窗方向和 Escape 取消冲突的具体动作。

本轮已获得 Windows Tauri/WebView2 的真实操作证据：普通保存、外部刷新、保存后快速外改、多窗订阅生命周期、dirty 冲突取消/覆盖、微软拼音一次 Ctrl+S 等待提交、提交后立即新建标签，以及 650 前端的光标状态恢复、桌面 Markdown 实时/阅读样本、表格历史和代码点击还原。结论限于下列实际执行场景，不表示所有原生、平台或输入法组合均已验收。

## 环境与产物身份

* 原生入口：`app/src-tauri/target/debug/examples/native_audit.exe`，专用 identifier `app.catstepmd.audit.r20261031n1`，使用正常桌面 runner，凭据后端为进程级 keyring mock。
* 审计入口初次构建 hash 为 `989b67518650666a28cc9faa0cc2676ddc8eac06f701cce073acaa3c6a6c4839`；补齐 Tauri 标准 Common-Controls v6 manifest 后为 `2aa8ae2be14093a519097493197f48b10dd055a0e6b4e7d16c04a5fb255acdd6`。详见 [构建记录](build-provenance.json)、[manifest 修复记录](manifest-repair-provenance.json)。
* 仅操作虚构 QA 文档：`C:\Users\20269\AppData\Local\Temp\catstep-native-audit-r20261031n1\workspace\native-audit.md`。入口还重定向自身 HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP；这不是 OS 沙箱或正式安装包验收。
* 前端通过 `http://127.0.0.1:1420` 提供。原生二进制没有因为后续前端修复全部重新编译；必须保留“原生 runner + 当时加载的前端构建”的分层身份。IME 等待/切页结果明确标为 648；最终光标结果明确标为 650；其余较早截图未记录独立前端版本号，不推定全部在 650 上重复执行。

## 已核验的原生覆盖

| 编号 | 实际动作 | 有证据支持的结果 | 证据 |
| --- | --- | --- | --- |
| W01 保存 | 输入含中文、emoji、表格和保留空格/空行的代码；快速输入后立即保存 | QA 文件包含完整中文与 emoji；两空格缩进及代码空行保留。JSON 记录了正文和 SHA256 | [保存结果](../after-fixes/native-save-result.json)、[原生源码画面](../after-fixes/native-save-source.png) |
| W02 clean 外改 | 外部修改当前 QA 文件 | 原生窗口显示新增“外部监控事件：已刷新。” | [外改刷新截图](../after-fixes/native-external-change.png) |
| W03 保存后快速外改 | 观察到自身保存后 1ms 写入外部 marker | 原生编辑器随后出现 `AFTER_SAVE_EXTERNAL_MARKER`，该次事件未被旧时间窗口吞掉 | [时间记录](../after-fixes/native-fast-external-change-result.json)、[刷新截图](../after-fixes/native-fast-external-change.png) |
| W04 跨窗保存通知 | 第二个原生窗口打开同一 QA 文件；主窗保存 | 辅窗显示 `CROSS_WINDOW_MAIN_SAVE`；根代理确认了保存/刷新方向 | [辅窗打开](../after-fixes/native-second-window-open.png)、[辅窗刷新](../after-fixes/native-cross-window-save.png) |
| W05 关闭辅窗后监控 | 关闭辅窗，再外部修改 QA 文件 | 留下的主窗继续显示 `AFTER_SECOND_WINDOW_CLOSED`，未因另一窗退出而失去监控 | [主窗仍收到更新](../after-fixes/native-watcher-after-second-close.png) |
| W06 dirty 冲突取消 | 本地输入 `UNSAVED_LOCAL_MARKER`，外部修改触发冲突；按 Escape | 弹窗关闭，本地草稿和 dirty 蓝点仍在；磁盘仍为外部版本，本地草稿未被写盘 | [冲突弹窗](../after-fixes/native-dirty-file-conflict.png)、[取消后的草稿](../after-fixes/native-conflict-cancel-preserves-draft.png)、[磁盘断言](../after-fixes/native-conflict-cancel-result.json) |
| W07 显式覆盖 | 取消后 Ctrl+S，再次出现冲突；点击“覆盖外部修改” | 仅 QA 文档被写入本地草稿，外部 sentinel 因明确选择被移除，已提交中文保留 | [保存重新弹冲突](../after-fixes/native-conflict-reopened-on-save.png)、[覆盖结果](../after-fixes/native-conflict-overwrite-result.json) |
| W08 单次 Ctrl+S 等待 IME | 648：微软拼音 `ni'hao` 候选仍打开时只按一次 Ctrl+S；随后 Space 提交“你好”，不再发送第二次保存 | 提交前没有把前缀/半成品写盘；提交后完整中文自动写盘。结果明确记录 `secondSaveSent=false` | [提交前磁盘断言](../after-fixes/native-ime-wait-save-before-commit.json)、[真实候选框](../after-fixes/native-ime-wait-composing.png)、[修后磁盘断言](../after-fixes/native-ime-wait-save-after-fix.json)、[提交并保存](../after-fixes/native-ime-wait-saved.png) |
| W09 提交后立即新标签 | 648：中文提交后立即新建标签 | 新页正文为空；提交的“你好”仍保存到原 QA 文件，没有正文串页。该截图同时暴露了当时状态栏仍显示 33:15 的独立问题，不能用其 `passed=true` 声称状态栏正确 | [正文/磁盘断言](../after-fixes/native-ime-switch-result.json)、[当时新空页与旧行列](../after-fixes/native-ime-switch-new-tab.png) |
| W10 光标状态修后复核 | 650：原文 33:15 → 空白 Untitled → 返回原文 | 空页显示 1:1，计数为 0；返回原文恢复 33:15，没有一律重置到 1:1 | [最终结果](../after-fixes/native-cursor-final-650-result.json)、[原文](../after-fixes/native-cursor-original-final-650.png)、[空页](../after-fixes/native-cursor-blank-final-650.png)、[返回](../after-fixes/native-cursor-restored-final-650.png) |
| W11 原生 Markdown 桌面样本 | 650，1200×800：实时模式局部横滚至末列；普通 Markdown/HTML code literal；右插列→Ctrl+Z→Ctrl+Shift+Z→Ctrl+Z；点击第二段 JS 后 Enter→Ctrl+Z→保存，再看阅读模式 | 末列可达；围栏内容仍是代码；列数 3→4→3→4→3，未启动计时；代码点击状态 19:1；保存恢复完整 fixture。7 张原生截图含阅读模式 | [完整结果](../after-fixes/native-markdown-layout-final-650-result.json)、[实时](../after-fixes/native-markdown-live-650.png)、[末列](../after-fixes/native-table-local-scroll-650.png)、[插列](../after-fixes/native-table-column-add-650.png)、[撤销](../after-fixes/native-table-column-undo-650.png)、[重做](../after-fixes/native-table-column-redo-650.png)、[代码点击](../after-fixes/native-code-click-650.png)、[阅读](../after-fixes/native-markdown-reading-650.png) |

W03 的 1ms 是“宿主观察到保存”到外部写入的记录差值，不是原子写内部时刻或事件传递延迟；这是一次实际边界复现，不能外推为并发压力或任意调度保证。W04/W05 验证顺序通知与订阅存续，没有执行两窗从同一旧 baseline 同时写入的原生 UI 竞赛。

## 保留的修前失败与关闭依据

1. 初次原生启动在 main 前因缺少 Common-Controls manifest 报 TaskDialogIndirect loader 错误。补资源后的实际应用截图与后续 QA 文件断言证明已越过该 loader 失败；原始 [失败](loader-failure.json)、[资源提取](manifest-extract.json)、[非 GUI 激活上下文检查](activation-context-check.json) 保留。
2. 第一轮 IME Ctrl+S 验收并未通过：[`native-ime-after-commit.json`](../after-fixes/native-ime-after-commit.json) 明确记录提交后 `HasCommittedPhrase=false`，与 [提交前](../after-fixes/native-ime-before-commit.json) 相同磁盘 hash。它实证了当时快捷键请求没有继续，不能作为修后通过证据。修正及模块回归见 [快捷键跟进](../after-fixes/shortcut-conflict-followup.md)，最终原生关闭依据是 W08 的 648 记录。
3. W09 的旧状态栏问题由 W10 的 650 原生三截图关闭。源码中清除旧选区元数据另有实际 SFC/CM 状态回归；本组三截图只直接证明光标/空页计数，不声称独立验证了选中字符计数的全部分支。

## 浏览器与门禁证据的层级

650 的 [redo 结果](../after-fixes/shortcut-redo-final-650-result.json) 与 [截图](../after-fixes/table-redo-final-650.jpg) **是 Chrome production 浏览器验收**，根代理已确认：插列 3 → Ctrl+Z 2 → Ctrl+Shift+Z 3，源码 undo/redo 正确，`timerVisible=false`。此文件本身不升级为原生证据；后来追加的 W11 是独立的原生 3→4→3→4→3 记录，支持其限定桌面场景。

宽窄表格、代码换行/行号四组合的 production JSON/图片属于浏览器层。W11 新增了原生实时/阅读桌面样本、局部横滚、表格历史与代码往返；窗口固定 1200×800，不能扩展成原生窄屏/四设置完整矩阵。根代理记录保存回 fixture 逐字节一致；复核时 `layout-native.md` 为 447 个字符、551 个 UTF-8 字节，SHA256 为 `8f8c5991cdb22bae90c11e2f274c797753fe2854338d6cf5b7d7e977b411fcb1`，没有将“447 字符”误写为“447 字节”。

当前最新 [完整前端日志](../after-fixes/test-final.txt) 为 **654 passed / 0 failed / 0 skipped**；[类型](../after-fixes/test-type-final.txt)、[i18n](../after-fixes/i18n-check-final.txt)、[toast](../after-fixes/i18n-toast-final.txt) 和 [production build](../after-fixes/build-final.txt) 通过（[命令 exit code](../after-fixes/gate-results-final.json)）。W10/W11 仍是 650 的实际原生验收，不能因最新门禁变为 654 就改写其版本；654 的 Android SAF 实际验收另见 [专项说明](../android-real/SAF实际验收.md)。

## 尚未覆盖的具体边界

* 两个原生窗口同 baseline 同时保存、不同大小写/Unicode 路径 alias 的原生往返、不同进程同时写入；共享锁/CAS 的 Rust 测试不能替代这些 UI 压力场景。
* dirty 冲突中的“从磁盘重新加载”分支、弹窗期间再次外改导致 CAS 拒绝、两窗同时 dirty、读盘/写盘人为延迟期间持续键入的原生竞态。
* 其他输入法（含搜狗）、日文/韩文、语音输入、compositioncancel，以及候选仍打开时关闭窗口/切工作区。W09 是“提交后立即切页”，不能描述为“未提交候选时切页”已全面通过；自定义保存键/Meta 保存也仅有模块层覆盖。
* 原生 UTF-16 LE/BE、BOM、CRLF 文件保存往返；W01 只证明其 UTF-8 显示/Unicode 正文样本，不构成编码矩阵。
* 强制崩溃/重启的恢复快照、恢复失败重试、工作区切换、目录迁移/重命名/删除、属性编辑并发、磁盘满/权限/被占用等故障的原生完整流程。
* 正式安装包、离线内嵌前端、系统 keyring 持久化/重启、真实云端同步、外部客户端配置/默认关联。当前 mock 凭据、独立 identifier 与 QA 目录只支持受限功能验收。
* Windows 原生窄窗口、代码换行/行号四设置和更多 Markdown 样式组合尚未覆盖；W11 已通过的 1200×800 场景不再列为未测。
* Android 已有独立 [654 SAF 实际验收](../android-real/SAF实际验收.md)，不由本 Windows 摘要外推；iOS/macOS/Linux 和真实导出 reader/PDF 页面的 UI 签收仍未覆盖。

较早 `ui-validation-status.json` 的中断历史已逐字节备份为 [ui-validation-before-native.json](../after-fixes/ui-validation-before-native.json)，当前 [UI 状态](../after-fixes/ui-validation-status.json) 已更新限定浏览器、Windows 原生及 Android SAF 场景的实际结果；全平台仍不签收。未改写 `validation-summary.json` 的旧计数、本目录静态准备 README 或主报告。完整输入清单、SHA256 和机器可读结论见 [acceptance-summary.json](acceptance-summary.json)。
