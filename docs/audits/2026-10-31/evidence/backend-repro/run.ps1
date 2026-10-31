param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../../../')).Path
)

# Read current production sources. Product files are never changed.
# Cargo output and fixtures live in a fresh OS temporary directory.
$ErrorActionPreference = 'Stop'
$taskDir = Join-Path ([System.IO.Path]::GetTempPath()) ('catstep-audit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskDir | Out-Null
Write-Output "Temporary harness directory: $taskDir"

function Extract-FunctionSection([string]$Source, [string]$Marker) {
    $start = $Source.IndexOf($Marker)
    if ($start -lt 0) { throw "Missing source marker: $Marker" }
    $end = $Source.IndexOf('// ====================================================================', $start)
    if ($end -lt 0) { throw "Missing end marker after: $Marker" }
    return $Source.Substring($start, $end - $start)
}

$convertSource = Get-Content -LiteralPath (Join-Path $RepoRoot 'app/src-tauri/src/convert.rs') -Raw
$importDir = Join-Path $taskDir 'import'
New-Item -ItemType Directory -Path (Join-Path $importDir 'src') | Out-Null
$importSource = (Extract-FunctionSection $convertSource 'fn markdown_literal(') +
    (Extract-FunctionSection $convertSource 'fn convert_csv(') +
    (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'import-harness.rs') -Raw)
Set-Content -LiteralPath (Join-Path $importDir 'src/main.rs') -Value $importSource -Encoding utf8
$importManifest = @'
[package]
name = "catstep-import-audit"
version = "0.1.0"
edition = "2021"
[dependencies]
quick-xml = "=0.37.5"
csv = "1.3"
'@
Set-Content -LiteralPath (Join-Path $importDir 'Cargo.toml') -Value $importManifest -Encoding utf8
Write-Output '=== Import conversion source-function repro ==='
& cargo run --offline --quiet --manifest-path (Join-Path $importDir 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'Import repro failed to execute' }

$mcpDir = Join-Path $taskDir 'mcp'
New-Item -ItemType Directory -Path (Join-Path $mcpDir 'src') | Out-Null
$mcpSource = Get-Content -LiteralPath (Join-Path $RepoRoot 'app/src-tauri/src/mcp_client.rs') -Raw
# Only the Tauri IPC export attribute is removed; all client logic is retained.
$mcpSource = $mcpSource.Replace('#[tauri::command]', '') +
    (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mcp-harness.rs') -Raw)
Set-Content -LiteralPath (Join-Path $mcpDir 'src/main.rs') -Value $mcpSource -Encoding utf8
$mcpManifest = @'
[package]
name = "catstep-mcp-client-audit"
version = "0.1.0"
edition = "2021"
[dependencies]
once_cell = "1"
sha2 = "0.10"
hex = "0.4"
serde = { version="1", features=["derive"] }
serde_json = "1"
tokio = { version="1", features=["rt-multi-thread", "macros", "io-util", "sync", "process", "time"] }
reqwest = { version="0.12", default-features=false, features=["json", "rustls-tls"] }
'@
Set-Content -LiteralPath (Join-Path $mcpDir 'Cargo.toml') -Value $mcpManifest -Encoding utf8
Write-Output '=== MCP client production-module repro against fake local Node servers ==='
& cargo run --offline --quiet --manifest-path (Join-Path $mcpDir 'Cargo.toml')
if ($LASTEXITCODE -ne 0) { throw 'MCP repro failed to execute' }

Write-Output '=== Command registration guard ==='
$oldManifest = $env:CARGO_MANIFEST_DIR
try {
    $env:CARGO_MANIFEST_DIR = (Resolve-Path (Join-Path $RepoRoot 'app/src-tauri')).Path
    $guardExe = Join-Path $taskDir 'command-registration.exe'
    & rustc --test (Join-Path $RepoRoot 'app/src-tauri/tests/command_registration_test.rs') -o $guardExe
    if ($LASTEXITCODE -ne 0) { throw 'Registration guard failed to compile' }
    & $guardExe
    if ($LASTEXITCODE -ne 0) { throw 'Registration guard failed' }
} finally {
    $env:CARGO_MANIFEST_DIR = $oldManifest
}
