# 后端、Agent 与格式转换专项审计

> 本文件保留最初审计阶段的缺陷证据和当时行号。后续源码修复与验收见同目录 `remediation.md`，修改后复现输出见 `observed-output-after-fixes.txt`。

本节只列能定位到具体代码的问题。前六项有可执行复现；第七项为静态执行路径确认，尚未做完整模型到桌面端的动态验证；第八项是待验证候选，不应计入已复现问题数量。未修改产品源码。

## B01 — P2：DOCX 表格把单元格中的多段落误拆成多列（已复现）

- 位置：`app/src-tauri/src/convert.rs:164-167`；行输出位置 `180-188`。
- 触发：Word 表格有两列，第一格含两个段落 A1/A2，第二格为 B；下一行是 C/D。
- 实际：导入输出 `| A1 | A2 | B |` 及三列分隔线，下一行仍两列。原两列表格变三列，后续数据错位。`table_cells.push(line)` 发生在 `</w:p>`，应发生在 `</w:tc>`。
- 预期：第一格保持一个单元格，内部保留段落内容，例如 `A1<br>A2`。
- 修改：维护独立 cell buffer，遇到段落结束累计到 cell buffer，单元格结束才 push；处理空格、换行、表内竖线和列跨度。跨行跨列支持不足时应明确降级。
- 验收：2×2 表格含多段落、空单元格、粗体、换行、竖线；导入后每行列数与原始表一致。

## B02 — P2：DOCX 粗体/斜体样式跨 run 泄漏（已复现）

- 位置：`convert.rs:106` 合并 Start 与 Empty，`133-134` 设置布尔状态，`162-163` 仅对应结束标签清理。
- 触发：Word 标准 `<w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>` 后跟无样式普通 run `Plain`。
- 实际：`**Bold****Plain**`；普通文本也被当作粗体。`<w:b/>` 是空元素，不会触发 `</w:b>`，且 run 结束没有重置。`w:b w:val="0"` 也会错误启用粗体。
- 预期：只让 Bold 具有粗体样式。
- 修改：在 `<w:r>` 开始/结束重置 run properties，解析 `w:val`，完整 run 收集结束后再包装 Markdown 标记；避免对 XML 文本事件逐块包裹形成连续标记。
- 验收：粗体→普通→斜体、`w:val="0"`、多段落、拆分 text nodes。

## B03 — P2：CSV/XLSX 导入没有转义表格单元格（CSV 已复现，XLSX 同类代码确认）

- 位置：CSV `convert.rs:296,309`；XLSX `convert.rs:338-351`；DOCX 同样在 `183` 直接 join。
- 触发 CSV：`name,value`；值为 `"a|b"` 或引号包裹的多行字符串。
- 实际：生成 `| alpha | a|b |`，竖线被 Markdown 识别为额外列（可能导致后半值被截断）；多行值直接把一条记录拆成多行 Markdown。用户看到的“表格别扭”有时在导入时已经发生结构损坏，改 CSS 无法修复。
- 预期：原值仍属于同一单元格。
- 修改：建立格式转换共用的 cell serializer，对反斜线、竖线、CR/LF 做一致转换；换行按 `<br>` 或受控多段落降级。表头也必须同样处理。
- 验收：CSV 与 XLSX 各包含 `a|b`、反斜线、CRLF、内嵌 LF、空值、中文长文本；解析生成 Markdown 后校验列数和文本内容。

## B04 — P2：MCP 工具命名清洗后发生碰撞，调用错误工具（已复现）

- 位置：`app/src-tauri/src/mcp_client.rs:112-118`；路由覆盖 `135-139`，工具注册 `803-806`。
- 触发：同服务同时公布 `read.note` 与 `read_note`；也可用截断后相同的超长工具名。
- 实际：两者都叫 `mcp_audit_read_note`。路由表后写覆盖前写，调用第一个工具实际执行 `read_note`。可能在模型服务端因重复 function name 报错，也可能执行错误操作。
- 修改：命名中保留稳定短 hash，hash 输入包括 server id 与完整原名；提供模型 schema 前检查唯一性；路由应按请求上下文保存，避免全局旧路由污染。
- 验收：标点/CJK/截断碰撞、不同 server id 组合、并发请求与工具重新加载。

## B05 — P2：修改 MCP 服务配置后仍复用旧进程与旧凭据（已复现）

- 位置：`mcp_client.rs:716-733`，注册表只按 `config.id` 查找；进程存活即直接返回已有连接。
- 触发：同 id 先连接固定回复 A 的服务，再修改 command/args 或 HTTP URL/headers 为回复 B 的服务，重新测试连接或发起 Agent。
- 实际：仍执行 A。复现输出 `AFTER_CONFIG_UPDATE="A:read_note"`。修改环境变量、URL 或授权 header 也没有失效机制。
- 修改：缓存项保存连接配置的 fingerprint；对 command/args/env/url/headers 等相关字段变化执行有序关闭并重连；避免把秘密原文打印进日志。
- 验收：同 id 切换命令、参数、endpoint 和 token；新请求使用新配置；现有请求终止/排空策略明确。

## B06 — P2：MCP 初始化与 tools/list 没有超时，连接测试和 Agent 启动可挂起（已复现）

- 位置：`mcp_client.rs:222-238` 中 `rx.await`；初始化 `241-266`；`list_server_tools:784-790` 没有 timeout。`timeout_secs` 仅在 list 成功后 `798-801` 写入，普通 tool call 才使用。
- 触发：启动了进程但不回复 `initialize` 或 `tools/list` 的 MCP 服务。
- 实际：配置 `timeout_secs=1`，等待超过 1.6 秒仍未返回，被测试外层 deadline 截断。源码显示只要进程继续存活且不回复就没有完成条件；连接测试与聊天工具列表合并可一直等待。进程空闲回收也要先拿连接锁，不能可靠解救正在等待的初始化。
- 修改：对 spawn/initialize/tools-list/response body 统一施加可取消 deadline；超时后移除 pending 请求并关闭失效连接；聊天取消信号应能中断工具发现。
- 验收：永不回包、初始化后 list 不回包、半条 JSON、HTTP body 不结束；均在 deadline 内返回，取消能恢复 UI。

## B07 — P1：Agent 只在工具 schema 过滤写权限，执行层未复核请求授权（静态执行路径确认，未做完整端到端动态验证）

- 位置：`app/src-tauri/src/ai_proxy.rs:2723-2782` 只通过 `allow_write` 过滤提供给模型的 schema；实际执行位于 Ollama `2436-2446`、Anthropic `3092-3101`、OpenAI `3701-3710`。这些分支直接调度模型返回的工具名。`agent_tools.rs:2889-2928` 只检查 recipe quota 和工具名是否存在，没有当前请求的 allow_write/allowed-tools 上下文。
- 触发条件：请求 `allow_write=false` 且没有 active_selection；自定义/异常模型端返回未提供的 `write_note`、`delete_note` 等 tool call。也可返回不在显式 `req.tools` 中的已知工具。
- 静态实际：调度路径没有检查该工具是否在本次请求的最终允许名单中，能到达工具执行函数；新建 `write_note` 可使用不存在的目标，无需 overwrite。
- 影响：只读开关依赖模型遵守提供的 schema；不能作为执行权限保证。第三方 MCP 路由同样需要本次请求的绑定列表校验。
- 修改：构建请求专属工具 allowlist，并在每一次 dispatch 前验证 exact tool name、写权限与剩余额度；拒绝未提供的工具。保留“选区允许编辑”的产品规则也应限制其明确作用范围。
- 验证限制：未在本机启动完整 Tauri/mock-runtime 到假模型端的动态写入测试；Windows 现有完整 Ollama e2e 已通过 cfg 禁用。因此报告可列为静态确认的高优先级权限缺口，不能表述为已在 UI 动态利用成功。
- 验收：假模型无视 schema 强制返回写工具；文件必须保持不变并产生明确拒绝结果；对三个 provider loop 和自定义 tool list 分别覆盖。

## B08 — P2 候选：Pandoc 导出缺少源文档资源目录（待实际 Pandoc 验证）

- 位置：`app/src/composables/usePandocExport.ts:247-258` 未传源文件目录；`app/src-tauri/src/pandoc.rs:177-198` 在 OS temp 下写临时 Markdown；`211-218` 注释声称按 output 目录解析，但没有 `current_dir` 或 `--resource-path`。
- 风险：`![图](assets/a.png)` 这样的相对图片在导出 EPUB 等格式时无法找到；相对 bibliography/模板路径也需明确解析上下文。
- 修改：显式传 source_dir，受授权检查后设置 `--resource-path`，解析相对资源与引用文件，勿使用应用 cwd 作为文档上下文。
- 边界：本机 PATH 未找到 Pandoc，未运行真实 Pandoc 导出；应留待验证清单，不和已复现问题混计。

## 已执行验证

- `mcp-server`：`cargo test --locked --offline`，41/41 通过（33 单元 + 3 导出 + 5 多工作区），日志 `mcp-tests.txt`。
- 命令注册守卫独立 rustc：1/1 通过。
- 源函数复现：B01/B02/B03；完整 MCP 模块复现：B04/B05/B06；输出 `observed-output.txt`。
- `app/src-tauri`：`cargo test --locked --offline --no-run` 完成（5 分 11 秒），随后完整 `cargo test --locked --offline` exit 0；24 个 suite 汇总 **671 passed / 0 failed / 4 ignored**，日志 `app-rust-tests.txt`。267 个 lib 单测与 273 个 bin 单测有大量重复覆盖，不能把 671 解释为独立功能点数量。Gitea/Gitee/Ollama 实际服务测试被忽略；Windows `ollama_tools_e2e_test.rs` 被 cfg 排除为 0 tests。
