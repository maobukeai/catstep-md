# 后端专项复现证据

修复落实和验证说明见 `remediation.md`；最初审计证据见 `findings.md`。`run.ps1` 已更新为可读取修改后的当前源码，原始失败输出与修改后输出分别保留。

运行：在任意工作目录执行 `powershell -ExecutionPolicy Bypass -File <本目录>/run.ps1`；可用 `-RepoRoot <仓库绝对路径>` 指定源码。

依赖：Rust/Cargo、Node.js、本机 Cargo 缓存。脚本使用 `--offline`，不访问实际 AI 或同步服务，不修改产品源码或用户笔记；临时 Cargo crate 和样本写入系统临时目录。

复现边界：

- DOCX 抽取 `convert.rs` 的原始 `docx_xml_to_markdown` 函数，使用同版 `quick-xml 0.37.5`。输入是最小合法 WordprocessingML 片段；未启动完整桌面导入 UI。
- CSV 抽取原始 `convert_csv`，UTF-8 样本的编码读取用标准 UTF-8 读取替代；不涉及编码推断行为。
- MCP 完整读取 `mcp_client.rs`，仅移除 Tauri 导出宏。假 Node 服务通过本地 stdio 提供固定响应；没有外部服务调用。
- MCP 初始化超时观察使用 1.6 秒外层超时，配置值为 1 秒；源码同时表明 initialize/list 路径只有无期限 `rx.await`，没有内部 deadline。
- 注册守卫直接独立编译仓库现有测试，没有替换测试内容。

`observed-output.txt` 保存本次运行的核心观察结果。现有 MCP 测试运行记录位于 `mcp-tests.txt`，完整桌面 Rust 测试日志位于 `app-rust-tests.txt`。桌面 Rust 汇总 671 passed / 0 failed / 4 ignored；lib/bin 有重复单测，且平台 cfg 排除的测试不计入 ignored。
