# 数据与核心逻辑复现证据

审计日期：2026-10-31；基线 commit：4a980caedd5fb1fa5e73069c772ab4b8e51aeeb8。
只增加审计证据，没有修改产品源码。app/src/lib/pdf-export.ts 和被删除的一键启动.bat 为原有工作区变更。

`reproduce.mjs` 从 argv 指定的项目根读取实际 TS 源码，用项目 TypeScript 编译后运行。Pinia/Vue/IPC 使用最小依赖替身；被检查的函数、控制流和 store actions 使用实际源码。输出中的 disk 是受控 writeNote 替身捕获的写入内容，并非真实用户文件。时序由 deferred promise 控制，不声称已完成桌面 GUI 端到端测试。

从项目根运行：

```powershell
node docs/audits/2026-10-31/evidence/data-repro/reproduce.mjs (Get-Location).Path
```

8 个断言用例全部通过（这里的“通过”表示缺陷确实被复现）。`reproduction-results.json` 是运行输出。

Rust 编码探针复制被审计的 `atomic_write_encoded` 与 `write_file_inner` 原函数；仅 `atomic_write` 简化为临时目录 fs::write，watcher 标记为空函数，不影响编码结论。使用项目锁定的 encoding_rs 0.8.35，验证 UTF-16 输出和 BOM 的真实字节。`encoding-results.txt` 是探针输出。

```powershell
cargo run --offline --manifest-path docs/audits/2026-10-31/evidence/data-repro/encoding-probe/Cargo.toml --target-dir "$env:TEMP/catstep-encoding-probe-target"
```

编码探针只在操作系统临时目录写三个测试文件。运行 cargo 需要本机已有依赖缓存；原审计环境已成功离线编译。
