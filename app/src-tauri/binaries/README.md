# Tauri externalBin staging

This directory holds per-target builds of the `catstep-mcp` binary that
Tauri's bundler embeds as a sidecar (see `bundle.externalBin` in
`tauri.conf.json`).

Files here are produced by `scripts/build-mcp-sidecar.sh`, which is wired
to run automatically as `beforeBundleCommand` for `pnpm tauri build`.

You do **not** need to manually populate this folder. CI calls the same
script per target so production builds always include a matched MCP
sidecar.

Naming convention (Tauri 2):

    catstep-mcp-x86_64-apple-darwin
    catstep-mcp-aarch64-apple-darwin
    catstep-mcp-x86_64-unknown-linux-gnu
    catstep-mcp-aarch64-unknown-linux-gnu
    catstep-mcp-x86_64-pc-windows-msvc.exe

At install time Tauri renames the matching one back to `catstep-mcp` (or
`catstep-mcp.exe`) and drops it next to the main `CatstepMD` binary. The
runtime path on each platform is then:

    macOS:   /Applications/CatstepMD.app/Contents/MacOS/catstep-mcp
    Windows: <install dir>\catstep-mcp.exe
    Linux:   alongside the AppImage / installed binary
