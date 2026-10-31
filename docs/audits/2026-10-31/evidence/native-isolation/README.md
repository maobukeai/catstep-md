# 原生桌面验收的隔离边界（静态核验）

日期：2026-10-31。本文核验路径、准备审计入口并完成其编译检查，未启动 GUI、未读取真实配置内容或凭据、未运行安装器。不会把旧 debug 可执行文件当作本轮源码产物。

## 结论

受限的原生编辑、保存、文件监控、多窗口和 IME 验收，可以在当前 Windows 用户下使用**重新编译的独立审计入口**完成：新的 Tauri identifier、在 runner 初始化前安装 keyring mock、进程级环境目录重定向、全新的 QA 工作区缺一不可。不能仅给旧 exe 设置环境变量，也不能仅凭凭据 service 名固定就断言所有原生验收必须使用 VM。

本次审阅没有发现上述组合仍必然在普通启动过程中写入真实用户固定配置路径的产品代码。这个结论不覆盖 Windows 自身的事件记录、图形缓存等系统行为，也不代表程序已被 OS 沙箱约束。客户端集成配置探测/注入、CLI 安装/用户 PATH、默认关联、安装器及真实系统凭据持久化，应在独立 Windows 用户或 VM 内验证；这些动作有已确认的环境变量无法完整隔离的目标。

## identifier 实际隔离什么

锁定依赖为 Tauri 2.10.3、dirs 6.0.0 / dirs-sys 0.5.0、single-instance 2.4.2、window-state 2.4.1、keyring 3.6.3。

| 状态 | 实际位置/身份 | 新 identifier 的效果 |
| --- | --- | --- |
| app_config_dir、app_data_dir | Windows Roaming KnownFolder / identifier | 使用全新子目录；不会读取正式应用目录 |
| app_local_data_dir、app_cache_dir | Windows Local KnownFolder / identifier | 使用全新子目录 |
| WebView2 默认数据目录 | Local KnownFolder / identifier | 包括 localStorage、IndexedDB、WebView 会话，所有未显式指定目录的辅助窗口也使用审计 profile |
| 窗口状态 | app_config_dir / .window-state.json | 使用审计配置目录 |
| 单实例锁/消息窗口 | identifier 加 -sim / -sic / -siw 后缀 | 不转发参数到正式应用实例 |
| debug bridge | app_config_dir / dev-bridge.port、dev-bridge.token | debug 启动会写审计目录；不是固定 solomd 目录 |
| 路径授权记录、主题、词典、MCP profiles、其他 app_config 状态 | app_config_dir 下的各子目录 | 隔离到审计目录；工作区索引在审计 app_data_dir |

依据：本机锁定源码 `tauri-2.10.3/src/path/desktop.rs:238-269`、`src/manager/webview.rs:505-522`，`dirs-6.0.0/src/win.rs:5-11`，`dirs-sys-0.5.0/src/lib.rs:153`，`tauri-plugin-single-instance-2.4.2/src/platform_impl/windows.rs:58-99`，`tauri-plugin-window-state-2.4.1/src/lib.rs:36,122,515`。Windows KnownFolder 使用 SHGetKnownFolderPath，因此单独覆盖 APPDATA/LOCALAPPDATA 不能改变这些基础目录，但**新的 identifier 可以隔离其子目录**。

`TAURI_CONFIG` 被 tauri-codegen 在编译期间读取（2.5.5 `src/lib.rs:53-90`）；给已经编译好的正式 exe 注入这个变量不能替换内嵌 identifier。不要只替换主窗口的 dataDirectory，否则多窗口会分离为不同 profile，失去真实共享 localStorage 语义。

## identifier 以外的路径与启动触发

| 函数/位置（项目源码） | 真实行为 | 启动触发与隔离办法 |
| --- | --- | --- |
| App.vue:741-751 → runner.rs::save_language_preference:227-229；dirs_path:207-217、dirs_home:220-223 | 写 HOME 或 USERPROFILE 下的 .catstep-language；若旧 .solomd-language 存在则写旧文件 | watchEffect 在普通启动时执行。HOME/USERPROFILE 均指向新目录即可；不能遗漏此项 |
| cloud_folder.rs::home:119-123、device_id_get_or_create:163-175 | 读写 HOME/USERPROFILE 下 .solomd-device-id | cloudSync.refresh 工作区后调用；环境重定向可隔离 |
| github_sync.rs::token_marker_path:80-84、gitea_token_marker_path:175-179、proxy_path:843-847、gitea_url_path:921-925 | HOME/USERPROFILE 下 .solomd 的 marker/proxy/url | 环境重定向可隔离。正常新 profile 不具有已有工作区同步绑定 |
| ai_keystore.rs::current_config_dir:114-146；cost_meter.rs::current_config_dir:121-159 | 无 AppHandle 预热时使用 APPDATA/solomd fallback | APPDATA 必须一并重定向；命令预热后使用新 identifier 的目录 |
| dev_bridge.rs::write_port_token:123-145；runner.rs:1140 | debug setup 生成端口和随机 token 文件 | 写 app_config_dir，随 identifier 隔离；不要把 token 内容写入报告 |
| commands.rs::path_guard::prime_app_roots:360-382 | 读取审计 app_config/security 内允许列表，将 app/temp 目录登记为授权根 | 路径随 identifier 或 TEMP/TMP 变化；不扫描旧正式配置 |
| cloud_folder.rs session_save、useRecovery.ts | 工作区内 .solomd 会话/恢复文件 | 只选新的 QA 工作区；严禁打开真实笔记目录或沿用旧 profile |

以下位置是**剩余边界**，不能拿来证明普通启动一定写入真实配置：

* `integrations.rs::ai_client_config_path:528-581` 直接用 `app.path().home_dir()` 定位 `.claude.json`、`.cursor/mcp.json`、`.continue/config.json`、`.gemini/config/mcp_config.json`；`ai_client_probe_dir:590-598` 也用真实 KnownFolder home。`detect_ai_clients:648-678` 探测并读取这些配置。入口为集成设置页，不是普通编辑器 startup 写操作。`inject_mcp:845-888`、`remove_mcp:894+` 调用 `write_json_with_backup:721-736`，会修改真实目标；覆盖环境变量不能隔离这些 KnownFolder home 目标。
* `integrations.rs::cli_install_inner:183-264` 的脚本文件位置可随 LOCALAPPDATA 变化，但同时修改当前 Windows 用户的 PATH；默认关联 `set_default.rs:120-147+` 直接写 HKCU 固定键（包括 `Software\\Classes\\Applications\\CatstepMD.exe`）。受限验收不执行这些动作。
* `main.rs:8-25` 还将任务栏 AppUserModelID 固定为 app.catstepmd；它是进程身份设置，不是已证实的配置文件写入。审计入口应使用审计 ID，避免和正式应用任务栏分组。
* `windows_install_migration.rs:6-12` 当前两个函数均为显式 no-op；main.rs 的历史注释不能作为“启动会卸载旧应用”的证据。

## 凭据隔离

AI service `solomd`（ai_keystore.rs:45）、GitHub `catstep-github`（github_sync.rs:50-51）、Gitea `solomd-gitea`（github_sync.rs:167）、E2EE `solomd-encryption-key`（crypto.rs:52）不随 identifier 改变。仅变更 identifier 会保留对真实凭据后端的访问能力。

专用审计入口可在创建 Tokio/Tauri/runner、任何 Entry 和静态凭据缓存之前调用锁定 keyring 3.6.3 提供的进程级接口：

```rust
keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
// 然后保持正常 runtime 与 runner::run_with(...) 的桌面启动链路。
```

依据：keyring 3.6.3 `src/lib.rs:190,332-334`、`src/mock.rs:234+`。该 mock 的 persistence 为 EntryOnly，不共享系统持久化语义；不能以此验收系统凭据持久化、重启恢复或真实 keyring 故障。入口必须由同一 Cargo 依赖图构建，不能通过另一个进程设置 builder，也不能给旧 exe 在运行后补设。

已经准备 `app/src-tauri/examples/native_audit.rs`，本目录 `native_audit.rs` 为同份归档。入口先校验编译时 TAURI_CONFIG 的专用 ID、窗口标题、URL 和 bundle=false；缺失或不符则在创建 GUI 前拒绝。随后安装 mock，在当前 temp 目录下创建 `catstep-native-audit-r20261031n1`，用精确 marker 验证归属，拒绝 symlink/reparse 目录或文件，进程内重定向六个环境目录。启动对象固定为该根内的 `workspace/native-audit.md`，不接受任意文件参数，不走正式 main 的迁移代码，同时设置专用任务栏身份，再使用正常 Tokio 和桌面 runner。

## 可执行的准备/验收顺序

1. 使用一个全新审计 ID；附带 `tauri.audit.override.json` 是本机可直接合并的配置。若需新一轮 ID，同时更新审计入口的常量、marker、根名和 JSON 并重新编译；禁止清空真实目录。其 frontendDist 为本机绝对路径，换机器时需显式调整。devUrl 固定为 `http://127.0.0.1:1420`，供根代理手动确认的本机 frontend 服务使用。
2. 固定本轮源码、Cargo.lock；通过构建子进程的 env 传入该 JSON 的完整文本为 TAURI_CONFIG，不更改系统/用户环境。已在这种方式下从 app/src-tauri 运行以下**不启动**的检查并通过：

   ```text
   cargo check --example native_audit --locked --offline
   ```

   编译检查 exit 0，用时 16.97s。随后经根代理审阅并授权，以同样子进程配置运行 `cargo build --locked --offline -j2 --example native_audit`，exit 0，用时 27.75s；未 run。产物为 `app/src-tauri/target/debug/examples/native_audit.exe`，与正式 `target/debug/CatstepMD.exe` 分开。实际构建配置、二进制哈希和起止源码清单均已归档。不得用 `cargo run` 代替仅构建检查。
3. 六个进程目录由入口自身在任何 worker 创建前设置，`process-env.example.json` 仅解释所需字段，实际值为 temp/专用根内路径；没有改系统或用户的全局环境。不得把正式 profile/会话复制到新 WebView 目录。根代理确认本机 frontend 地址后，手动运行专用 example exe；从它输出的 AUDIT_ID、QA_ROOT、QA_NOTE 及原生配置/profile 观测验证实际隔离，再只在新工作区操作。编译检查不等于已经完成这些运行期观测。
4. 受限验收覆盖编辑、表格/代码、切页、保存/另存、监控、恢复、IME、多窗。不要打开客户端集成设置或执行安装 CLI、默认关联、更新安装、外部 MCP/Agent 和真实云端账号操作；那些需要独立 Windows 用户/VM 的完整验收链。
5. 如采用独立 guest，`native-acceptance.wsb` 为**被动配置**：仅 input 只读映射、output 可写映射，无 LogonCommand；网络、剪贴板、音视频和打印机重定向关闭。input 只存本轮构建物、离线所需 runtime 和虚构夹具；复制虚构笔记到 guest 自己的目录后再编辑，不映射整个仓库或真实工作区。当前审计 exe 的 devUrl 指向运行它的系统自身 127.0.0.1:1420，不能直接连接宿主服务；guest 路线还需要在 guest 内准备前端服务，或另编译嵌入 frontendDist 的构建，不能把当前 exe 和 WSB 组合宣称为开箱即用。[Microsoft 配置文档](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)说明这些开关及映射语义。

本机只读探测：Windows Professional build 26300；未发现 `WindowsSandbox.exe`、`wsb` 命令或 WindowsSandbox Appx 包，不能宣称本机已能启动此 WSB。未启用系统可选组件、未新建用户、未执行 GUI。可使用已准备好的 VM/独立测试用户；缺少这些环境不妨碍先实现受限同用户审计入口。

## 当前二进制证据与未完成项

审阅时已有 `app/src-tauri/target/debug/CatstepMD.exe`：36,155,392 bytes，修改时间 2026-10-31 10:53:26，SHA256 `C396E7FE81251AF11B796AB90ED6853833440A236397C7D8186A25CA4336B465`。这些只是文件元数据，不能证明包含本轮未提交修复；现有 catstep-mcp.exe 的时间也早于本轮。没有复用它们启动。

审计入口已 build：36,075,008 bytes，SHA256 `989b67518650666a28cc9faa0cc2676ddc8eac06f701cce073acaa3c6a6c4839`。TAURI_CONFIG override SHA256 为 `9569af4208816b8275d5812af4aec42dd7f494cd1c81282d212afb1fbf9c4be7`。编译起止的 649 个项目源码/配置/资源文件 SHA256 一致；另用 git -z 核验清单没有因路径转义遗漏文件，详见 source-manifest-before-build.json、source-manifest-after-build.json 和 build-provenance.json。

根代理首次 CUA 启动发现 loader 无法定位 TaskDialogIndirect，按 Enter 关闭；入口 main 尚未执行，QA 根不存在。静态证据确认 Tauri 构建脚本为 resource.lib 输出 `cargo:rustc-link-arg-bins=...`，example 未继承常规 bin 的资源。SDK `10.0.26100.0/x64/mt.exe` 从原 audit exe 提取 RT_MANIFEST #1 失败（exit 31/c101008c），从正规 CatstepMD.exe 成功提取与 Tauri 默认内容相同的 Common-Controls v6 manifest。

按根代理明确授权，只给审计 exe 嵌入这份 manifest，未改产品源码、入口或系统设置，未重新编译、未启动 GUI。embed、重新 extract 均 exit 0，提取的 XML 与正规 bin manifest 一致，未添加 requestedExecutionLevel。修后审计 exe 为 36,075,520 bytes，SHA256 `2aa8ae2be14093a519097493197f48b10dd055a0e6b4e7d16c04a5fb255acdd6`；原始字节保存在 `target/debug/examples/native_audit.pre-manifest.exe`，仍匹配上述修前 hash。修复与重提取证明资源已补齐，尚不能替代 loader 的下一次真实启动验收。

证据：loader-failure.json、manifest-extract.json、audit-before-extract-recheck.json/原始 stdout bytes、standard-bin.manifest、audit-after.manifest、manifest-repair-provenance.json。build-provenance.json 保留构建时原始 hash；修后产物以 manifest-repair-provenance.json 为准。后续重新 cargo build 可能覆盖该资源补丁，必须重新核验 manifest。

额外验证：`mt -validate_manifest` 对修后与正规 bin 的提取内容均返回 31，原因均为 Tauri 默认 exe manifest 没有独立 assembly schema 要求的顶层 definition identity（sdk-manifest-validation.json），不能据此声称该独立 schema 校验通过。直接用 Windows CreateActCtxW 解析两个 exe 的 RT_MANIFEST #1 均成功、Win32 error 0，见 activation-context-check.json；此过程未调用 ActivateActCtx、LoadLibrary、CreateProcess，也未启动 GUI。

未完成：修后 loader/实际隔离路径观测、原生 IME 真机、多窗原生 IPC 和恢复 GUI 流程。浏览器/模块测试、cargo check/build 均不能替代这些验收；GUI 由根代理手动接手。

此前生成一整套自动启动/打包脚本的请求被自动审批拒绝，工具仅返回 `blocked by policy`，该请求没有执行。此目录只新增文档、Rust 审计入口归档、JSON、WSB 和虚构 Markdown，不包含自动启动/打包脚本，也未通过其他工具重试被拒绝的自动启动动作。

被动配置校验：将最新 override 深度合并进基础 Tauri 配置后，通过本机锁定 CLI 的 config.schema.json 验证；WSB 通过 XML 解析，两个映射宿主目录均存在，input=true/output=false 的 ReadOnly 值正确，且无 LogonCommand。结果、源码/配置 SHA256 及归档一致性见 validation.json，实际 cargo 输出见 cargo-check.txt。
