# Windows 更新启动链修复与后端验证

核查基线：`c277d85`，应用版本 `1.0.13`。首轮后端源码于 17:53:50 冻结，交叉复核后追加本文末尾两项修复，最终冻结于 **2026-10-31 18:26:30 +08:00**。此文档记录 Rust 更新器；前端调度、保存保护、最终安装包和 GitHub 发布由根代理分别验收。

## 根因及实证

旧 `updater.rs` 的 Windows 两个分支把含 `start "" /wait "安装包路径"` 的整段命令作为 Rust `Command::arg` 交给 `cmd.exe /C`。Rust 对 Windows 一般程序使用的参数转义，与 cmd 对引号、反斜线和命令串的解释不相同。系统可能尝试启动错误的文件名；cmd 启动成功也不代表安装程序启动成功。

本机使用独立 Rust 小程序创建自有无害 EXE，置于中文、空格、`&`、`%` 路径。保留原来的 `.arg("/C").arg(script)` 和 START 引用方式，增加 `/D` 禁止用户 AutoRun、`/B` 避免打开窗口：旧链返回 1，stderr 为 `Access is denied.`，无执行标记；同一路径直接 `Command` 启动返回 0，并写出标记。见 [复现源码](old_cmd_repro.rs)、[实际输出](old-cmd-repro.txt)。本机错误文案与用户截图的“找不到 \\ 文件”不同，不能称为复现了完全相同的对话框；已实证同一错误参数传递方式能阻断存在且可执行的程序。

旧实现还有两个独立问题：使用固定 ping 延时猜测主程序已退出；使用 `&` 无条件继续重启，不检查安装进程退出码。下载流仅每 100ms 采样一次，随后获取 SHA256SUMS 时不发新阶段事件，最后一次采样可能仍为 93%，因此下载完后的校验等待看起来像仍在下载。

## 实现

- Windows 不再生成 cmd、START、ping 或批处理。`main.rs` 在迁移、Tauri、插件和单实例初始化之前识别内部 helper 参数；helper 使用正在运行程序的缓存副本，避免占用被安装程序覆盖的原 EXE。
- `windows_update_helper.rs::launch_handoff` 生成独立随机目录和 job，父进程将 job SHA-256 通过独立进程参数传入。子进程一次读入、校验摘要、解析为内存快照。随机 ready token、父 PID 和真实子 PID 均需匹配；子进程先取得父进程 HANDLE，父进程收到就绪信号后才安排退出。helper 等待 HANDLE 真正结束，120s 不退出则拒绝启动安装。
- 父进程以 Windows `FILE_SHARE_READ` 持有原 EXE 及缓存 helper 的只读句柄，核对两者 SHA，直到子进程 ready。helper 对独立 staging 安装包持同样 deny-write/delete 的句柄，在同一句柄上校验摘要，等待父进程后再校验，并持续持锁到安装进程结束。原始缓存被覆盖不会改变 staging 内容。
- 安装使用 `ShellExecuteExW` 的 `open`，取得真实进程 HANDLE 并等待退出码；遇到 740 再走 `runas` 请求正常 Windows 授权，取消授权仍为失败。初始化 COM STA，不禁用 UAC、证书或 SHA 门禁。MSI 保留 `/passive /norestart /L*V 日志路径`，没有改为 `/quiet`；NSIS silent 使用单独的 `/S` 参数。
- `lpParameters` 仅按 Windows CRT argv 规则编码数据，不经过命令解释器。MSI 只接受 0、3010、1641 为成功；普通 EXE 只接受 0。失败写 `result.json`、`helper.log`、`installer.log`/`msi.log`，正式 helper 在原程序已退出后显示品牌错误提示，不重启冒充成功；1641 已发起系统重启时不再启动应用。
- Rust 安装入口进程内单飞；若还有另一个 `main` / `solomd-window-*` 编辑窗口则拒绝安装，提示先保存并关闭。隐藏 quick capture、PiP 不误判为编辑窗口。此前路径授权和发布清单 SHA 校验保留，未设置任何 unverified 环境旁路。
- 下载使用 `try_lock` 立即拒绝并发，纯 RAII guard 覆盖错误/`?` 返回；重试同文件名先移除旧验证记录。进度仅发往发起下载的 WebviewWindow，避免其他窗口把广播当成自己的任务。新增 `verifying` 事件显示完整字节数和 100%；manifest 每请求 12s、总校验 45s，流式最多 1MiB。HTTP headers 等待、下个数据块等待、校验等待均可取消，取消删除包且不会进入正常完成分支。

核心定位：`updater.rs:190` 下载入口、`:470` verifying、`:878` 安装入口；`windows_update_helper.rs:85` 文件锁、`:126` handoff、`:260` argv 编码、`:288` ShellExecuteEx、`:364` worker、`:460` 启动分派。后续行号变化请以函数名为准。

## 首轮验证（最终补充见下文）

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| updater 单测（原 12 + 新 4） | 16/16，无忽略 | [日志](updater-unit-tests.txt) |
| MSI 参数经真实 ShellExecuteEx 无害进程 | 1/1 | [日志](msi-argument-process-test.txt) |
| 实际 CatstepMD.exe 的 helper 入口进程回归 | 5/5 | [日志](process-regressions.txt) |
| 所有 targets Clippy，`-D warnings` | exit 0，26.94s | [日志](rust-clippy.txt) |

HTTP 回归使用随机 localhost 监听端口，实际传输正常清单、超大 Content-Length、超大 chunked body，并分别令服务停在 headers/body 阶段，验证取消不依赖服务器继续传数据。下载 reservation 验证重叠请求立即拒绝，错误返回后可再次获取。

MSI 参数回归使用新建的无害引擎 EXE，实际收到包含中文、空格、`&`、已定义的 `%PATH%`、引号、末尾反斜线和空字符串的完整参数，未经过 shell 展开；实际系统 msiexec 仅核对系统目录定位和存在性，没有运行。

五个进程回归由 Cargo 提供的实际 `CatstepMD.exe` 进入 helper 模式，安装器/原进程/重启目标均为新建无害 fixture：

1. 中文、空格、`& %PATH% !^()` 路径；就绪后改写 job 文件不会改变内存快照；父进程退出前不执行安装，安装结束后才重启。
2. 安装器返回 23，保留明确失败退出码和错误，没有重启。
3. 等待期间写入、删除、重命名 staging 安装包均被 Windows 以错误 32 拒绝，handoff 目录及 cache 祖先重命名亦被拒绝；随后原可信 fixture 正常运行。
4. 实际产品入口拒绝不匹配的 job 摘要，不创建 ready、不执行安装。
5. 未匹配 SHA 或 `.cmd` 等非 EXE/MSI 格式在 preflight 被拒绝，不启动 helper。

正式测试源码为 `app/src-tauri/tests/windows_updater_process_test.rs`、`tests/fixtures/windows_updater_fixture.rs`，以及 helper/updater 模块内单测。测试只操作随机临时目录，关闭并等待自有进程后由 TempDir 回收；没有运行用户应用的退出流程、真实安装包或 GUI，没有改用户配置、已有安装或凭据。

## 验收边界

这是更新启动链和离线进程回归，不等同真实 MSI/NSIS 安装验收。管理员/普通用户的实际 UAC 同意/拒绝、Windows Installer 服务、安装器自身故障、重启后包版本及所有发行架构，仍取决于最终构建产物和真实安装环境。未执行安装或重启用户应用；未通过这些 fixture 声称官方包已完成下载安装全流程。最终 GitHub 上传与包 SHA 属根代理发布验收。

官方依据：[Rust Command 的 Windows 非标准解码说明](https://doc.rust-lang.org/std/process/struct.Command.html)、[Microsoft cmd 引号规则](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)、[ShellExecuteExW 与 COM/进程 HANDLE](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)、[Windows Installer UAC](https://learn.microsoft.com/en-us/windows/win32/msi/using-windows-installer-with-uac)、[MSI 标准命令行选项](https://learn.microsoft.com/en-us/windows/win32/msi/standard-installer-command-line-options)。

## 最终追加：MSI 真实重启目标与快捷捕获草稿保护

便携 EXE 运行时，前端仍优先选择 MSI。仅在安装成功后重启原 `current_exe` 会重开未被 MSI 覆盖的旧便携版。最终 helper 在 staging 安装包的 `share_mode(FILE_SHARE_READ)` 锁内完成 SHA 校验后、发 ready 前，只读 MSI 的 `Property`、`File`、`Component` 表：获取唯一 ProductCode，识别 `短名|长名` 中的唯一 `CatstepMD.exe`，要求关联组件的 KeyPath 就是该文件，快照 ComponentGuid。安装成功后调用 `MsiGetComponentPathW(ProductCode, ComponentGuid)`，仅接受 LOCAL 且存在的绝对 `CatstepMD.exe` 文件。查询或校验失败会明确失败，**不会退回旧便携路径**；EXE 安装分支保留原重启路径。

Windows Installer 的少量 API 通过 `LoadLibraryExW` 从绝对 System32 路径加载，依赖搜索限定系统目录；`GetProcAddress` 绑定强类型函数指针。数据库、view、record 的 RAII 句柄各持有同线程 `Rc<MsiApi>`；最后一个句柄关闭后才允许模块 `FreeLibrary`。不硬编码 Program Files，不枚举产品，不写注册表。

快捷捕获的未提交内容只存在独立窗口的 ref 中，不能依赖主编辑器 session。最终安装预检先获取 RAII 安装预约，再检查其他编辑器和**可见** `solomd-quick-capture`；拒绝、IPC 被取消或 handoff 失败均自动释放预约。隐藏常驻 capture 不阻断更新。capture 的显示/创建/toggle 与安装预约、可见性检查均排到 UI 主线程，异步 oneshot 等待，不持有互斥锁等待 UI；全局快捷键也走同一入口。

另外对 capture 的 show/build 操作持无阻塞 RAII opening 标志，并双向复查安装状态。即便窗口创建中嵌套消息泵，安装也会在“尚未可见但正在创建”的阶段拒绝；不会等待同一 UI 线程形成死锁。真实 `open_capture_now` 通过共享 `with_capture_permission` 包住实际 show/build 边界，安装已预约时不会调用窗口操作 closure。

| 最终定向验证 | 结果 | 证据 |
| --- | --- | --- |
| updater（含 visible/hidden、预约拒绝释放、成功提交保留 gate） | 18/18 | [日志](updater-unit-tail-final-tests.txt) |
| MSI metadata/restart + 实际 ShellExecuteEx argv | 4/4 | [日志](msi-metadata-dynamic-final-tests.txt) |
| 实际 capture shared guard：副作用隔离、创建时重入拒绝/释放 | 2/2 | [日志](capture-tail-final-tests.txt) |
| 实际产品 helper 五项无害进程回归 | 5/5 | [日志](process-tail-final-tests.txt) |
| all-targets Clippy，`-D warnings` | exit 0，28.76s | [日志](rust-tail-final-clippy.txt) |

定向共 **29 项通过，0 失败、0 忽略**。MSI 回归使用原生数据库 API 在随机临时目录创建最小三表 fixture；正向解析在与产品相同的只读 share lock 下完成，并确认查询前后数据库 SHA 不变、写入被 Windows 32 拒绝。解析覆盖短长文件名、错误 KeyPath 和重复 EXE。真实 `MsiGetComponentPathW` 仅查询本次新生成、未注册的随机 GUID，确认失败；正向安装路径映射在该原生服务边界注入新 fixture 文件，证明选择新路径且失败不 fallback，**未注册或实际安装任何 MSI**。

最后的 process5 覆盖最终 MSI/helper 实现；其后新增 opening 标志及单测 iterator 清理，由 capture2/updater18 覆盖。根代理将在这份冻结源码上执行完整 Rust、最终 Tauri 构建与两架构 CI，不能把先前完整 714 项当成本次尾部后已经重跑的结果。

### 测试加载器问题记录

最初测试版本两次在进入测试 main 前退出 `0xC0000139 / STATUS_ENTRYPOINT_NOT_FOUND`，没有执行任何断言，未计为通过。[首次失败日志](msi-metadata-final-tests.txt) 保留。只读检查系统 MSI DLL及 8 个 API export 均存在；PE 对比发现旧通过的 lib test 没有 comctl32 import，新增 MockRuntime 窗口正向 `.build()` 实例化后引入了 `TaskDialogIndirect` 等导入，而 lib test 没有正式产品的 Common Controls manifest。将 MSI 改为延迟加载后，MSI 静态 import 消失，但该测试 UI import 仍导致同样启动失败，说明不能把问题简单归因于 MSI API 不存在。

最终移除测试里的 MockWindowBuilder 实例化，改为对真实生产路径使用的 shared guard 注入窗口操作边界，避免无 GUI 单测引入原生 GUI 加载依赖。该版本恢复正常启动，四项真实 MSI API/合成数据库测试及 capture 两项均通过。正式产品入口的五项进程回归另行通过；没有修改产品 manifest 或放宽安全门禁来隐藏错误。

以上追加仍受前述真实安装/UAC/双架构执行边界约束；capture 测试覆盖真实 shared guard 及预约逻辑，没有启动 GUI 或假称进行过实际全局热键界面验收。未重试先前被安全策略拒绝的 JSON 生成命令，本次验证证据为这些 Markdown 与实际 Cargo 日志。
