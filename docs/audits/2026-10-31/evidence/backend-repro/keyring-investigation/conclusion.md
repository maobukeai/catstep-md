# Windows keyring error 8 定位与受限恢复

本轮证明是当前凭据集剩余可用容量影响写入，并非原生 Credential API 整体不可用，也不能简单归因于路径字符或目标长度。未枚举凭据，未读取任何用户密码，未改生产安全存储或目标命名格式。

清理前，两个新建、字段完全同形的随机 Generic 目标（目标 42 字符、用户名 7 字符、comment 14 字符、blob 128 字节、persist 3）：A 写入成功，持有 A 时 B 写入返回 error 8；只删除自己的 A 后，**同一个 B、同样字段**立刻写入成功。另一个同目标实验在目标 100/110 字符时，128 字节 blob 失败、0 字节成功、再更新为 128 字节失败，排除了单纯目标长度校验。原探针为 `native-capacity-probe.cs`，观察记录为 `native-capacity-before-observations.json`；后者是从工具 stdout 整理的结构化记录，并非声称原始文件捕获。其他探针源码也保留在本目录。

公开 API 对 Generic 目标、用户名和 blob 的长度上限与结构见 [CREDENTIALW 官方文档](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)；本次失败字段低于这些公开上限。写入调用定义见 [CredWriteW 官方文档](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)。没有枚举内部总占用或总条目数，因此不声称已测出 Windows 内部具体限额。

根代理审核本次 goal（Unix 秒 1793412035）后，授权只清理经过只读预检的 14 个精确随机 crypto fixture 目标。清理前重新核对源文件 SHA、目录创建时间、固定字节、完整允许文件集与 SHA，确认无相关运行测试；清理仅调用 `CredDeleteW(exact target, type=1, flags=0)`：**11 个删除成功、3 个原已不存在、0 个失败**。6 个空 guard fixture、goal 前目录、GitHub 历史 fixture及未知项均不在授权清理清单内；未删除任何目录。逐项目标结果为 `fixture-credential-cleanup.jsonl`，汇总为 `fixture-credential-cleanup-summary.json`，原授权清单 SHA 为 `7553cedc6f87b57c7403da2baf0674e2945a29c233a3aefb8abc83d3233576e9`。

清理后，同形态新随机短目标 A/B 均可同时写入，原有 error 8 不再出现；探针仅处理自己的两个随机目标，最终均确认 NoEntry 1168。见 `native-capacity-after-approved-cleanup.cs` 与 `.txt`。这个前后对照，以及旧测试泄漏的 fixture key 被回收后实际失败测试恢复，支持容量压力这一原因；无需改成短哈希目标来掩盖问题，也没有凭据格式迁移或既有密钥读取兼容风险。

随后只重跑此前失败的两个测试：

| 测试 | 结果 | 日志 |
| --- | --- | --- |
| bin `runner::crypto::tests::workspace_round_trip` | 1 passed / 0 failed，283 filtered | `crypto-roundtrip-after-fixture-cleanup.txt` |
| `github_sync_e2ee_test::e2ee_full_round_trip_two_devices` | 1 passed / 0 failed | `github-e2ee-after-fixture-cleanup.txt` |

本次两个 isolated 测试创建的 3 个随机 workspace 再按其运行时间窗、CreationTime 和源码固定样本确认。对这三个精确目标调用 CredDeleteW 均返回 NoEntry 1168，证明现有 RAII 已回收密钥；未调用 CredRead 或枚举，未删目录。见 `isolated-raii-targets.json`、`isolated-raii-verification.json`。生产存储格式与产品源码在本次调查/恢复中均未改。

随后按根代理要求，在没有 TAURI_CONFIG 的正常配置子进程重跑最终完整门禁：`cargo test --locked --offline -j2 --no-fail-fast -- --test-threads=2` 为 **699 passed / 0 failed / 4 项既有 ignored**（lib272、bin284、24个集成目标143、doc0）；all-targets Clippy `-D warnings` 通过。未修改父进程或系统环境。完整日志与精确统计见上级目录 `app-rust-tests-final-normal-config.txt`、`app-rust-tests-final-normal-config-counts.json`；Clippy 为 `app-clippy-final-normal-config.txt`。

最终完整运行产生的 6 个可能写 key 的自身新随机 fixture（crypto ws2、ws-pp2、E2EE A/B各1）再次按该次运行时间窗、CreationTime、源样本确认，CredDeleteW 精确核验均为 NoEntry1168，证明 RAII 已回收，另2个空guard fixture排除。没有 CredRead、枚举或目录删除，见 `full-suite-raii-targets.json`、`full-suite-raii-verification.json`。

较早的完整单测和完整集成日志仍如实保留 error 8 失败，不能改写成当时全绿。测试 fixture 的 RAII 修复已在前一阶段落实，本轮完整运行也确认不会继续泄漏；没有授权清理 goal 前或真实用户凭据，也不需要用户删除任意真实密钥。
