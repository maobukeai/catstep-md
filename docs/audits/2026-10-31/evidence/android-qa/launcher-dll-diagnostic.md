# QA 模拟器启动 DLL 诊断

SDK `source.properties` 记录 Android Emulator **37.1.11 / Build 15917651**。根代理直接通过 CUA 启动固定 v1 后出现 `libglib2_windows_msvc-x86_64.dll`、`libandroid-emu-metrics.dll`、`liblibprotobuf.dll`、`libandroid-emu-agents.dll` 缺失弹窗。这些文件实际均存在于官方 emulator 根与 lib64；不应据此删除、替换或重新安装 SDK。

使用已安装的官方 LLVM `llvm-readobj --coff-imports` 静态递归检查 emulator、x86_64 qemu、Qt qwindows plugin 及其 SDK 依赖，共 33 个模块。三处非系统搜索目录为 emulator 根、lib64、lib64/qt/lib；其余由 Windows System32/API sets 提供，包含实际存在的 `bthprops.cpl`。闭包没有未解析导入，见 `dll-static-dependencies.json`。另一代理独立检查这 33 个模块均可完整读取、为 AMD64 PE32+，对应文件/SDK 父目录没有 reparse 或路径别名。

按根代理授权，只新增 v2 源码/EXE，唯一功能变化是对子进程 PATH 按上述三目录加前缀，保留继承 PATH；固定 AVD/目录/参数与所有拒绝保护保持原样。v1 源/EXE/日志没有覆盖。v2 SHA256 `bb9f9031f93d1a27de9481829e5e660ff58852bf06f2494e7f749ac6fb32f08e`，288768 bytes，x64/GUI subsystem 2；见 `launcher-build-provenance-v2.json`。本代理只编译，没有执行启动器或操作 GUI。

根代理再从 CUA 直接启动 v2，仍出现同一 libglib 缺失弹窗（进程链 launcher37148 → emulator24956 → qemu28588）。尝试对这个精确 qemu 读取 PATH 时，根代理已关闭错误进程，`OpenProcess` 返回87；未读取到任何环境变量，见 `qemu-v2-path-observation.json`。

随后根代理用实际 Explorer 地址栏输入新的精确 v2 路径并启动**同一字节内容**的 EXE，未再出现 DLL 弹窗，推进到 WHPX/首次 boot（launcher44104 → emulator48732 → qemu28856）。对这三个精确进程只使用 QueryFullProcessImageName 和 GetPackageFullName，全部身份匹配，后者全返回15700，Windows 原生消息为“该进程没有程序包标识符。”没有读取 PEB/其他环境，见 `explorer-process-package-observation.json`。

`launch-origin-observation.json` 汇总两个启动来源下的结果。启动来源与 loader 结果存在相关性；由于失败链的包身份/PATH 没有捕获，**不能据此证明 packaged parent 的 DLL 搜索策略或 PATH 重写是根因**。静态导入闭包也不等于验证全部动态 LoadLibrary/Qt/GPU 路径。上述事实仅证明启动器/环境这一步已推进，Android 完成开机、产品安装及 SAF provider/picker/持久授权的最终结果由根代理另行验收。

整个诊断没有修改 SDK、系统环境或原 maobu_test AVD；其两份允许检查的元信息哈希继续与初始记录一致。没有执行 adb input、安装或任何子代理 GUI 操作。
