# `catstep-mcp` in Cursor

[Cursor](https://cursor.com)'s built-in MCP support reads
`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in the workspace.

## Install the server

```bash
# macOS — bundled in Catstep MD.app, or:
cargo install catstep-mcp

# Linux x64
curl -L https://github.com/maobukeai/catstep-md/releases/latest/download/catstep-mcp-linux-x64.tar.gz \
  | tar -xz -C /usr/local/bin

# Linux arm64
curl -L https://github.com/maobukeai/catstep-md/releases/latest/download/catstep-mcp-linux-arm64.tar.gz \
  | tar -xz -C /usr/local/bin

# Windows x64 / arm64 — unzip and put on PATH.
```

## Config — `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "solomd": {
      "command": "catstep-mcp",
      "args": ["--workspace", "/Users/you/notes"]
    }
  }
}
```

Restart Cursor. **Settings → MCP** should list `solomd` with 13 tools.

## Try it

In Cursor's chat (`Cmd+K` / `Ctrl+K`):

> Use the Catstep MD MCP to find every note that links to `[[architecture]]`
> and give me a 3-bullet summary of each.

## Allow writes

Add `--allow-write` to the args. Then Cursor can call `write_note` /
`append_to_note` to create/update notes from chat.

```json
"args": [
  "--workspace", "/Users/you/notes",
  "--allow-write"
]
```

## About Catstep MD

[**Catstep MD**](https://github.com/maobukeai/catstep-md) is the Markdown editor that ships this MCP
server pre-wired. Get the desktop app for the Agent panel UI, the pending
write accept/reject screen, and AutoGit history navigation:

[📥 Download Catstep MD for macOS / Windows / Linux](https://github.com/maobukeai/catstep-md/releases/latest)
