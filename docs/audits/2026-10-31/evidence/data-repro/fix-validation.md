# 数据生命周期修复验证

本文件记录审计之后的修复；同目录 `report.md` 与 `reproduction-results.json` 仍为修复前基线证据，不应再以旧缺陷断言脚本代替正确性测试。

## 已实施

- D01/D08：统一保存快照与写前 goal 日期变换；按规范路径串行；成功只更新实际落盘正文对应的 savedContent；写完成立即 flush 最后输入。Save As 使用同一流程并固定请求标签身份。
- D02/D03：属性变换以 live tab 正文为输入；拒绝无效 YAML；await 前固定标签；通过统一保存与磁盘冲突路径落盘，不再应用磁盘旧全文回包。
- D04：外部读取、授权重新读取、对话框返回均复核文档身份、正文与 baseline；读取结束先 flush，防 350ms 同步窗口内输入被覆盖。
- D06/D10：启动恢复、工作区恢复、跨窗文件事件、Git remote-pulled 及本窗保存统一协调；clean 读盘更新，dirty 双端变更交由串行冲突对话框处理；保存本身也验证磁盘 baseline，避免恢复尚未完成就回写旧稿。
- D07：文件/目录移动迁移所有子标签、MRU/MFU；FS 与 SAF 操作使用相关路径锁；clean 重读带版本校验，dirty 保留正文与脏状态；恢复副本迁移通过清旧副本、保留 tab 与随后快照完成。
- D09：blur 入口先 flush 再筛 dirty；工作区切换亦先 flush 再保存旧桶与携带脏标签。保存关闭途中出现新输入则保留标签/窗口。新增可回传 blocked 的同步协议；IME 组合未完成时保存、关闭和外部刷新等待 composition-finished，工作区与 SAF 上下文延后一起变更，最后一次选择获胜。
- D11：Android launch/resume/cancel 共用 SAF 状态 helper，并兼容清理旧键。
- 与主代理 D05/D12 协同：传递 hadBom、expectedContent、expectMissing，后端编码、应用级路径锁及 compare-and-swap 拒绝并发旧 baseline 写入。CAS 错误保留编辑缓冲，不自动覆盖重试。
- 冲突窗口 Escape 会 resolve cancel，不会隐藏窗口后永久卡住保存队列。
- 追加恢复记账修复：仅确认实际写入的快照内容，固定其 notePath/root；同一快照路径上的 beat 与 purge 串行、重复 beat 合并；purge 同步失效旧写入 token，删除等待在途 native 写完成，禁止晚到快照复活。保存后继续输入、重叠 beat、保存清理、重命名与工作区变化均有实际源码 IPC 回归。

## 验证

2026-10-31 最新针对性执行：**57/57 通过**（40 个新生命周期/辅助逻辑/Editor AST/恢复编排用例 + 17 个现有 tabs 与 recovery 合约）；`pnpm run test:type` 通过。

```powershell
cd app
node --import ./scripts/register-loader.mjs --test src/lib/note-document.test.ts src/lib/note-lifecycle.test.ts src/lib/editor-composition.test.ts src/lib/recovery-orchestration.test.ts src/lib/recovery.test.ts src/stores/tabs.test.ts
pnpm run test:type
```

新测试直接运行产品 composable/store 源码，以受控 IPC Promise、真实 Vue/Pinia 响应式状态和最小 EventTarget 模拟磁盘延迟、工作区更换、切标签、最后尚未同步输入、外部写入与用户冲突决定。目录迁移探针提取 FileTree 原函数；Editor 组合输入探针由 TypeScript AST 提取实际 SFC 函数，覆盖目标 tab、blocked、边界草稿与旧 id、plain block 分隔和取消/结束的提交时序；纯 helper 测试覆盖规范路径、队列失败释放、前端冲突串行化、frontmatter 保真及 SAF 键契约。

这证明的是产品代码在受控时序下的数据一致性。Rust 真字节/CAS并发检查由主代理运行；原生 WebView2、Android 真机及第三方 SAF provider 的并发语义不能由这些模块测试替代。系统文件上的 CAS 由 Rust 实现；SAF/content:// 不具备该 filesystem CAS 接口。



