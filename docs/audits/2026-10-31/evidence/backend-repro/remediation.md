# 后端专项修复与复验

本文件对应原始 `findings.md` 的 B01–B08。原始报告和 `observed-output.txt` 保留审计当时的缺陷证据；`observed-output-after-fixes.txt` 是修改后再次执行同一复现入口的输出。

| 编号 | 已落实修改 | 回归证据 |
| --- | --- | --- |
| B01 | Word 在单元格结束时归并段落；空单元格、换行、列跨度按矩形表格保留，不把段落当列 | `convert::fidelity_tests`：多段落两列表、空格、换行、跨列 |
| B02 | Word run 独立重置粗斜体，识别显式关闭值，合并相邻同样式 run，忽略 XML 排版空白 | 同组：粗体→普通→斜体、false/0、相邻粗体 |
| B03 | Word/CSV/XLSX 共用单元格序列化，转义竖线和字面 Markdown，把内部换行转换为 `<br>` | CSV 实际文件；真实 XLSX ZIP 经 calamine 导入 |
| B04 | 模型工具名包含完整原名与连接配置的稳定摘要，保留 64 字符上限；拒绝重复声明 | 真实 Node MCP 服务同时声明 `read.note`/`read_note`，分别返回各自工具名 |
| B05 | 完整连接配置摘要作为缓存键，命令/参数/环境/URL/请求头变化产生新连接；模型名称绑定该连接，旧请求不被改派 | 同 id 的 A/B 服务：新请求执行 B，先前 A 请求仍执行 A |
| B06 | 工具发现、连接等待、初始化、调用和响应读取有 deadline；Agent 取消贯穿发现/调用；pending slot 在超时取消时释放；SSE 收到匹配响应即完成 | initialize/list/call 静默超时、取消、保持连接不关闭的 HTTP SSE；额外修复 SSE 结果重复解包问题 |
| B07 | 三个 provider 共用请求级 exact allowlist 与写权限/额度执行校验，拒绝结果回传模型；提供 schema 不再等同于允许执行任意返回名 | 实际本地假模型 HTTP + 文件系统，OpenAI/Anthropic/Ollama 各测试默认只读、显式读工具、明确授权写入，共 9 个场景；拒绝时原文件与备份目录均不变 |
| B08 | 前端传原始笔记 source_dir/resource_paths；Rust 设置 cwd/资源目录，解析并授权相对 bibliography/csl/template；输入临时文件用 RAII 清理 | 真实 Node 假 Pandoc 进程记录 argv/cwd 并读取资源：中文/空格源路径、不同输出目录、图片/bib/csl/template；成功与失败清理、无来源的相对引用拒绝 |

核心源码：`app/src-tauri/src/convert.rs`、`mcp_client.rs`、`ai_proxy.rs`、`agent_tools.rs`、`pandoc.rs` 与 `app/src/composables/usePandocExport.ts`。

新增/扩展的集成回归：`agent_tool_authorization_test.rs`、`mcp_client_e2e_test.rs`。provider 的 Tauri 事件出口抽象为轻量 sink，测试仍运行相同的模型协议解析、工具循环与文件写入逻辑，避免 Windows mock WebView DLL 的平台限制。

## 验证记录

**最终正常配置完整 Rust 门禁：699 passed / 0 failed / 4 项既有 ignored；Clippy 全目标禁止 warning 通过。** 其中 lib 272、desktop bin 284、24 个集成目标 143 项通过，doc-tests 0 项。lib/bin 有重复模块覆盖，699 是执行结果数，不代表独立功能数。最终完整运行覆盖 Unicode CAS、Pandoc 诊断修复以及受限测试凭据容量恢复后的当前产品源码。

此前 keyring error 8 已定位并受限恢复：只清理根代理审核授权的本 goal 14 个精确随机 fixture 目标（11 删除、3 已不存在），原失败 crypto roundtrip 与 GitHub E2EE 各 isolated 1/1 通过，之后上述最终完整运行再次通过。最终全量新建的 6 个写 key fixture 精确目标均返回 NoEntry 1168，确认 RAII 已回收；2 个空 guard fixture 排除。历史失败日志与计数原样保留。因果证据、逐项清理及回收验证见 `keyring-investigation/conclusion.md`。

- 最终完整日志：`app-rust-tests-final-normal-config.txt`，逐目标精确统计：`app-rust-tests-final-normal-config-counts.json`。
- 最终完整命令：`cargo test --locked --offline -j2 --no-fail-fast -- --test-threads=2`；正常配置子进程没有 `TAURI_CONFIG`，未修改父进程或系统环境，见 `app-rust-tests-final-normal-config-result.json`。
- 最终全目标 Clippy：`app-clippy-final-normal-config.txt` 与 `app-clippy-final-normal-config-result.json`，命令为 `cargo clippy --locked --offline -j2 --all-targets -- -D warnings`。
- 最终完整运行的 6 个自身 fixture key 回收证据：`keyring-investigation/full-suite-raii-targets.json`、`keyring-investigation/full-suite-raii-verification.json`。只调用这些精确新目标的 CredDeleteW，无凭据读取或枚举，均已不存在。

以下保留各阶段历史验证，不能用较早计数替代上述最终门禁。

- Unicode CAS 独立日志：`cas-unicode-final.txt`，最终完整运行也覆盖 7/7。
- 凭据容量恢复之前的完整集成历史日志：`all-integrations-final.txt`，当时为 24 targets、142 通过、1 失败、4 忽略；失败唯一为 GitHub E2EE 的 error 8。命令为 `cargo test --locked --offline -j2 --test '*' --no-fail-fast -- --test-threads=2`，所有目标实际执行，原失败没有被跳过或忽略。
- Unicode 修复后的历史 Clippy 日志：`app-clippy-after-fixes.txt`，当时运行 16.53 秒完成。
- 原先 28 项定向回归和当时的完整单测早于最后的 Unicode CAS 补丁，保留为历史证据；其旧计数不能代表最终源码。下列记录中的测试数量有重叠，不应直接相加。

- 较早一轮完整应用 Rust 测试：**690 passed / 0 failed / 4 ignored**，包含编码、跨窗口 watcher 与最初 CAS 保存冲突回归。lib/bin 单测有重复覆盖，不能当作 690 个独立功能；这不是最后一次完整测试的全绿声明。
- Unicode 与凭据恢复前的完整测试：lib **269/269** 通过，bin **280 通过 / 1 失败**，当时未继续执行集成测试。失败为既有 `runner::crypto::tests::workspace_round_trip` 的 Windows secure storage error code 8。独立 `--exact --test-threads=1`、限制 `-j2` 且补 RAII 清理代码后再次执行仍失败；这些原始失败不能改写为通过。完整失败记录为 `app-rust-tests-keyring-failure.txt`，当时单例记录为 `keyring-isolated-after-cleanup.txt`。已修该测试与同模块另一个用例的随机 fixture key 清理：使用测试模块内的删除原语，避免未授权 IPC 清理命令静默失败；系统当时仍有约 7.1 GiB 可用物理内存。后续原生 A/B 实验与本 goal 精确残留清理证明剩余凭据容量是写入限制，原失败定向及最终完整运行均恢复通过，见调查记录。
- MCP 服务 crate 修改后重跑：**41 passed / 0 failed**，见 `mcp-tests-after-fixes.txt`，包含当前前端导出脚本的 HTML/DOCX 回归。
- 原始复现入口 `run.ps1` 修改后重跑通过，见 `observed-output-after-fixes.txt`。MCP 初始化约 1 秒由内部 deadline 返回，外层未触发超时。
- 此前低并发定向回归：**28 passed / 0 failed / 0 ignored**，包含授权、MCP、编码、6 项 CAS/重命名锁、6 项格式导入、3 项 Pandoc、权限额度、6 项 watcher；记录为 `final-targeted-tests.txt`。
- `cargo clippy --locked --offline -j2 --all-targets -- -D warnings` **通过**，记录为 `app-clippy-after-fixes.txt`；后续 Pandoc 诊断修复后再次通过，见 `../pandoc-real/rust-clippy.txt`。

## 收尾复核：Windows Unicode 文件别名的 CAS 互斥

只读交叉复核用实际编译的应用库确认：旧 ASCII 小写锁键允许两个线程同时对尚不存在的 `Ä.md`/`ä.md` 执行 `expect_missing=true` 并均返回成功，导致静默覆盖。复现源码保留为 `unicode-cas-readonly-review.rs`，修前首轮实际输出为 `success_count=2; errors=[]`。

已将活跃路径锁注册表改为带弱引用的 Vec；Windows 用原生 UTF-16 路径调用 `CompareStringOrdinal(..., 1)` 判等，比较失败时保守共享锁；其他平台仍按 Path 相等处理。签名和 `CSTR_EQUAL` 已核对本机 windows-sys 0.61.2；API 的操作系统 ordinal 比较规则与参数约束按 [Microsoft Learn 官方文档](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-comparestringordinal) 核对。

新增真实 Windows 文件系统并发回归，CAS 最终 7/7 通过。日志实测 `Ä/ä` 是同一文件别名，必须只有一方创建成功；`I/ı` 在本机卷不是别名，要求两份独立文件均成功且互不覆盖，没有虚构该组是 alias。生产路径授权逻辑没有修改。

加密测试清理另外覆盖 GitHub E2EE 集成测试本次创建的 A/B 随机 workspace：只给其自身 fixture 设置测试进程内授权，以便正常受保护的清理命令删除该 fixture 的密钥；失败时也执行 RAII 清理。此前已泄漏的 key 不会由新的 RAII 自动追溯删除，因此单改清理代码时 error 8 仍存在。根代理随后授权的清理严格限于经时间、固定内容与 SHA 审核的本 goal 14 个精确目标，没有枚举、清除 goal 前/未知 fixture 或真实用户凭据。原完整失败日志保留；清理后两项原失败分别通过，新 3 个密钥均核验 NoEntry 1168。

## 边界

- 已用官方便携 Pandoc 3.13 通过实际产品导出核心的 5 项用例，真实 EPUB/ODT 的相对图片、Bib/CSL、中文空格路径和包内资源一致性均通过；未安装系统软件或改 PATH。另实证修复 Windows ACP936 stderr 中文路径乱码，lib/bin Pandoc 各 6/6 与 Clippy 通过。详情见 `../pandoc-real/README.md`。尚未完成原生 UI/文件选择流程及 EPUB 阅读器、LibreOffice 逐页视觉验收。
- Word 是 Markdown 导入，不是完整 Word 排版格式往返。列跨度展开为矩形列，嵌套 Word 表格明确返回不支持错误，避免静默错列；复杂 Word 合并单元格、图片与页面样式没有宣称完整还原。
- 需要真实 Gitea/Gitee/Ollama 服务的 4 项测试保持忽略；Windows 原有 Ollama mock-App e2e 仍由 cfg 排除，新假模型回归已在 Windows 实际执行三个 provider 的协议和权限循环。
