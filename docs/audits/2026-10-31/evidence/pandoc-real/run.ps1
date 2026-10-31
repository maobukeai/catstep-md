param([string]$AuditRoot = '')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if (-not $AuditRoot) { $AuditRoot = Join-Path $tempRoot 'catstep-pandoc-real-audit-20261031' }
$AuditRoot = [IO.Path]::GetFullPath($AuditRoot).TrimEnd('\')
if (-not $AuditRoot.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'This audit writes fixtures only below the current user TEMP directory.'
}
New-Item -ItemType Directory -Path $AuditRoot -Force | Out-Null
$zip = Join-Path $AuditRoot 'pandoc-3.13-windows-x86_64.zip'
if (-not (Test-Path -LiteralPath $zip)) {
  Invoke-WebRequest -Uri 'https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-windows-x86_64.zip' -OutFile $zip
}
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne '23e1f2e978a3df80db8bf65c9c59534f41a23140480cfb4f783a882ab7dc6a4e') { throw 'Official Pandoc ZIP SHA256 mismatch.' }
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $AuditRoot 'portable') -Force
$pandoc = Join-Path $AuditRoot 'portable\pandoc-3.13\pandoc.exe'
python -X utf8 (Join-Path $PSScriptRoot 'prepare.py') --repo $repoRoot --root $AuditRoot --pandoc $pandoc --evidence $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Fixture preparation failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'driver-main.rs') -Destination (Join-Path $AuditRoot 'rust-driver\src\main.rs') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'probe-Cargo.lock') -Destination (Join-Path $AuditRoot 'rust-driver\Cargo.lock') -Force
$driverLog = & cargo run --locked --offline --color never --manifest-path (Join-Path $AuditRoot 'rust-driver\Cargo.toml') --target-dir (Join-Path $AuditRoot 'rust-target') -- (Join-Path $AuditRoot 'config.json') (Join-Path $PSScriptRoot 'driver-results.json') 2>&1
$driverExit = $LASTEXITCODE
$driverLog | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'real-driver-run.txt') -Encoding utf8
$driverLog | Write-Output
if ($driverExit -ne 0) { throw "Real product Pandoc driver assertions failed: $driverExit" }
python -X utf8 (Join-Path $PSScriptRoot 'inspect-packages.py') --evidence $PSScriptRoot --root $AuditRoot
if ($LASTEXITCODE -ne 0) { throw 'Real EPUB/ODT package inspection failed.' }
