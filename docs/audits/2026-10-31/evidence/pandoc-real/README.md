# 真实 Pandoc 导出与资源封装验收

日期：2026-10-31，Asia/Shanghai。

**结果：真实 Pandoc 3.13 的 5 个产品导出驱动用例全部符合预期；EPUB、ODT 的资源封装、相对图片、Bib/CSL 和中文空格路径通过。** 本轮另实证并修复了 Windows Pandoc 失败诊断的中文路径乱码。

## 运行方式与边界

本机 PATH 原先没有 Pandoc。依据 [官方安装说明](https://pandoc.org/installing.html) 提供的便携 ZIP 方式，从 [官方 3.13 发布页](https://github.com/jgm/pandoc/releases/tag/3.13) 下载 Windows x64 ZIP，并核对 GitHub API 提供的 SHA256：

`23e1f2e978a3df80db8bf65c9c59534f41a23140480cfb4f783a882ab7dc6a4e`

只解压到 `%TEMP%/catstep-pandoc-real-audit-20261031/portable/`；未运行安装器、未修改系统或进程 PATH、未写用户笔记。所有输入均为本次生成的审计 fixture。

驱动直接执行当前产品的 `pandoc_export_inner → locate_pandoc → run_export → 官方 pandoc.exe`。它把本进程 cwd 指向便携程序目录，使 Windows `where pandoc` 在不改 PATH 的情况下找到真实程序；产品随后按 source_dir 为 Pandoc 子进程设置源文档 cwd 和 resource-path。

审计小 crate 从 `app/src-tauri/src/pandoc.rs` 取实际源码，只移除 Tauri 命令宏和 async IPC 授权/spawn 包装，原来的路径解析、探测、参数构建、真实子进程、错误处理和 RAII 输入清理均保留。源码摘要见 `product-extraction.json`。这不是假进程测试，也不是原生 UI/文件选择授权流程的完整验收。系统 PATH 仍未配置 Pandoc。

## 已通过的实际用例

| 用例 | 观察结果 |
| --- | --- |
| EPUB：中文空格源目录 → 另一中文空格输出目录 | 成功，真实包包含两张源图片，引用和书目已转换 |
| ODT：同一源目录 → 另一个输出目录 | 成功，Pictures 资源和 XML 引用一致 |
| 真实 Pandoc 无效命令选项 | 产品返回失败；临时 Markdown 清理；原输出 sentinel 不被覆盖 |
| 真实 Pandoc 缺失 Bib 文件 | 产品返回失败；临时 Markdown 清理；未生成目标 ODT；修复后错误内的中文完整可读 |
| 真实 Pandoc 输出到新建嵌套目录 | 成功，Pandoc 自动创建输出父目录；临时 Markdown 清理 |

所有用例在成功或失败返回后，本进程生成的 `catstep-pandoc-<pid>-*.md` 均无残留。最早的驱动曾错误预期“缺少输出父目录必然失败”；实际 Pandoc 会创建目录，已修正的是审计预期，并保留 `driver-results-initial-assumption.json`，没有据此修改产品。

## EPUB/ODT 封装检查

`inspect-packages.py` 对真实导出文件逐项断言：

- ZIP CRC 校验通过，mimetype 正确。
- 两张 PNG 分别来自 source_dir 和额外 resource-path，包内字节的 SHA256 与原 fixture 完全相同。
- EPUB XHTML 的每个 img src 都指向包内存在的资源，OPF 声明两张 PNG。
- ODT 的 draw:image/xlink:href 指向包内 Pictures，manifest 与实际图片一致。
- 本地 CSL 的 `AUDIT-CSL:` 标记与 Bib 的 `BIB-AUDIT:`、作者、标题出现，原始 `@audit2026` 未遗留。
- 中文图片说明保留。

成品保存在：

- [真实 EPUB 样本](artifacts/relative-resources.epub)
- [真实 ODT 样本](artifacts/relative-resources.odt)

已完成结构、内容和封装检查，尚未用 EPUB 阅读器或 LibreOffice 做逐页视觉排版验收。

## 额外发现与最小修复

原始 Pandoc stderr 不是 UTF-8，而是当前 Windows ACP 936 的字节。产品使用 `String::from_utf8_lossy` 后，错误路径变成乱码；原始字节见 `missing-bibliography-stderr.bin`，修前结果见 `driver-results-before-diagnostic-fix.json` 和 `stderr-encoding-observation-before-diagnostic-fix.json`。

仅修改 `pandoc.rs` 的诊断转换：合法 UTF-8 优先原样；非 UTF-8 在 Windows 读取 [GetACP](https://learn.microsoft.com/en-us/windows/win32/api/winnls/nf-winnls-getacp)，使用 [MultiByteToWideChar](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar) 两阶段转换。未对所有输出强行套 GBK，也未改变其他外部命令。

正式 Rust 回归验证 UTF-8、CP936、GB18030 和 CP1252；当前 ACP 936 失败路径可读，失败输入仍清理。产品 lib 和 desktop bin 的 Pandoc 相关测试各 6/6 通过（共 12 个执行结果，其中有重复覆盖）；all-targets Clippy `-D warnings` 通过。日志为 `rust-pandoc-tests.txt`、`rust-clippy.txt`。

随后重新执行真实 Pandoc 的全部 5 例及 EPUB/ODT 包检查，结果仍通过，中文诊断路径恢复正常。当前结果见 `driver-results.json`、`package-verification.json`、`stderr-encoding-observation.json`。

## 复跑

在项目根目录执行：

```powershell
powershell -File docs/audits/2026-10-31/evidence/pandoc-real/run.ps1
```

需要本机 Python、Rust/Cargo 与 Cargo 依赖缓存。脚本只允许把运行目录放在用户 TEMP 下；从官方地址下载固定版本并验哈希，不安装系统、不改 PATH；Rust 小 crate 使用 `--locked --offline`。`prepare.py` 生成可审阅 fixture，`driver-main.rs` 调用产品原函数，`inspect-packages.py` 检查真实成品，`probe-Cargo.lock` 固定小 crate 依赖。

本目录的 sources.json 记录官方来源、版本、发布日期与哈希；fixture-manifest.json 记录所有自建资源的摘要。
