# ==============================================================================
# Catstep MD (猫步 MD) - Windows CLI Installer
#
# Run via PowerShell:
#   irm https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"

$binDir = Join-Path $env:LOCALAPPDATA "catstep\bin"
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

# 1. Detect CatstepMD.exe
$detectedExe = $null

# Check running process first
$proc = Get-Process "CatstepMD" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc -and $proc.Path -and (Test-Path $proc.Path)) {
    $detectedExe = $proc.Path
}

# Check common install locations
if (-not $detectedExe) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\CatstepMD\CatstepMD.exe"),
        "C:\Program Files\CatstepMD\CatstepMD.exe",
        "C:\Program Files (x86)\CatstepMD\CatstepMD.exe",
        (Join-Path $PSScriptRoot "..\app\src-tauri\target\debug\CatstepMD.exe"),
        (Join-Path $PSScriptRoot "..\app\src-tauri\target\release\CatstepMD.exe")
    )
    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            $detectedExe = (Resolve-Path $cand).Path
            break
        }
    }
}

if (-not $detectedExe) {
    # Fallback to standard Program Files path
    $detectedExe = (Join-Path $env:LOCALAPPDATA "Programs\CatstepMD\CatstepMD.exe")
}

# 2. Write catstep.cmd and solomd.cmd
$cmdContent = @"
@echo off
if "%~1"=="" (
    start "" "$detectedExe"
    exit /b 0
)
if /i "%~1"=="open" (
    if "%~2"=="" (
        echo Usage: catstep open ^<file^>
        exit /b 1
    )
    start "" "$detectedExe" "%~f2"
    exit /b 0
)
if /i "%~1"=="new" (
    if "%~2"=="" (
        echo Usage: catstep new ^<title^>
        exit /b 1
    )
    start "" "$detectedExe" "%~f2"
    exit /b 0
)
if /i "%~1"=="help" (
    echo catstep - CLI for Catstep MD
    echo Usage:
    echo   catstep ^<file^>           Open file in Catstep MD
    echo   catstep open ^<file^>      Open file in Catstep MD
    echo   catstep new ^<title^>      Create and open note
    echo   catstep --version        Show version
    echo   catstep help             Show this help
    exit /b 0
)
if /i "%~1"=="--version" (
    echo catstep 1.0.0
    exit /b 0
)
if /i "%~1"=="-v" (
    echo catstep 1.0.0
    exit /b 0
)
start "" "$detectedExe" "%~f1"
"@

Set-Content -Path (Join-Path $binDir "catstep.cmd") -Value $cmdContent -Encoding ASCII
Set-Content -Path (Join-Path $binDir "solomd.cmd") -Value $cmdContent -Encoding ASCII

# 3. Add to User PATH if not present
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = ($currentPath -split ';') | Where-Object { $_.Trim() -ne '' }
if ($parts -notcontains $binDir) {
    $newPath = ($parts + $binDir) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "[OK] Added $binDir to user PATH." -ForegroundColor Green
} else {
    Write-Host "[OK] $binDir is already in user PATH." -ForegroundColor Gray
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Catstep MD (猫步 MD) CLI installed successfully!" -ForegroundColor Green
Write-Host "  Location: $binDir" -ForegroundColor Gray
Write-Host "  Commands: catstep, solomd" -ForegroundColor Yellow
Write-Host "  Try: catstep help" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
