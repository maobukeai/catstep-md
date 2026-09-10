# 猫步 MD (Catstep MD) PowerShell 一键启动器
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$host.UI.RawUI.WindowTitle = '猫步 MD 启动器'

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "       猫步 MD (Catstep MD - Typora 极简风格版) 一键启动器" -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检测 Node.js 环境
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
    Write-Host "[错误] 未检测到 Node.js 环境！" -ForegroundColor Red
    Write-Host "请前往 https://nodejs.org/ 下载并安装 Node.js (推荐 LTS 版本)。" -ForegroundColor Yellow
    Read-Host "按回车键退出..."
    exit 1
}

# 2. 确定包管理器 (优先使用 pnpm，若无则使用 npm)
$pm = "npm"
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pm = "pnpm"
}

# 3. 检查前端依赖
$appDir = Join-Path $PSScriptRoot "app"
Set-Location $appDir

if (-not (Test-Path "node_modules")) {
    Write-Host "[提示] 检测到尚未安装前端依赖，正在执行 $pm install，请稍候..." -ForegroundColor Green
    & $pm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 依赖安装失败，请检查网络或 npm 源设置。" -ForegroundColor Red
        Read-Host "按回车键退出..."
        exit 1
    }
}

# 4. 检测 Rust / Cargo 环境
$hasCargo = [bool](Get-Command cargo -ErrorAction SilentlyContinue)

# 5. 检测并准备 solomd-mcp 侧边二进制
$mcpBinDir = Join-Path $appDir "src-tauri\binaries"
$mcpTarget = Join-Path $mcpBinDir "solomd-mcp-x86_64-pc-windows-msvc.exe"

function Ensure-McpBinary {
    if (-not (Test-Path $mcpTarget)) {
        $mcpBuilt = Join-Path $PSScriptRoot "mcp-server\target\release\solomd-mcp.exe"
        if (-not (Test-Path $mcpBuilt)) {
            if ($hasCargo) {
                Write-Host "[提示] 正在构建 solomd-mcp 侧边服务二进制..." -ForegroundColor Yellow
                Push-Location (Join-Path $PSScriptRoot "mcp-server")
                cargo build --release
                Pop-Location
            } else {
                Write-Host "[警告] 未找到 solomd-mcp 二进制且未检测到 cargo，桌面端启动可能会受影响。" -ForegroundColor Yellow
            }
        }
        if (Test-Path $mcpBuilt) {
            if (-not (Test-Path $mcpBinDir)) {
                New-Item -ItemType Directory -Path $mcpBinDir -Force | Out-Null
            }
            Copy-Item $mcpBuilt $mcpTarget -Force
            Write-Host "[就绪] solomd-mcp 侧边二进制已部署就绪。" -ForegroundColor Green
        }
    }
}

Write-Host "请选择启动模式："
Write-Host "  [1] 启动桌面客户端 (Tauri 完整桌面版 - 推荐，需 Rust 环境)" -ForegroundColor Green
Write-Host "  [2] 启动网页极速预览 (Vite Web 模式 - 免 Rust 编译，浏览器即开即看)" -ForegroundColor Cyan
Write-Host "  [3] 打包桌面正式版安装包 (Tauri Build)" -ForegroundColor Magenta
Write-Host "  [4] 重新构建 MCP 侧边服务 (solomd-mcp)" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "请输入选项 [1/2/3/4] (直接回车默认启动 [1] 桌面版)"
if ([string]::IsNullOrWhiteSpace($choice)) {
    $choice = "1"
}

switch ($choice.Trim()) {
    "2" {
        Write-Host "`n正在启动 Web 开发模式 (http://localhost:1420)..." -ForegroundColor Green
        & $pm run dev -- --open
    }
    "3" {
        Ensure-McpBinary
        Write-Host "`n正在打包桌面正式版安装包..." -ForegroundColor Green
        & $pm run tauri build
    }
    "4" {
        Write-Host "`n正在重新构建 solomd-mcp 服务..." -ForegroundColor Green
        Push-Location (Join-Path $PSScriptRoot "mcp-server")
        cargo build --release
        Pop-Location
        $mcpBuilt = Join-Path $PSScriptRoot "mcp-server\target\release\solomd-mcp.exe"
        if (Test-Path $mcpBuilt) {
            if (-not (Test-Path $mcpBinDir)) {
                New-Item -ItemType Directory -Path $mcpBinDir -Force | Out-Null
            }
            Copy-Item $mcpBuilt $mcpTarget -Force
            Write-Host "[成功] solomd-mcp 侧边二进制已构建并部署至 app/src-tauri/binaries/ !" -ForegroundColor Green
        }
    }
    default {
        if (-not $hasCargo) {
            Write-Host "[提示] 未检测到 Rust/Cargo 环境，无法编译 Tauri 桌面客户端。" -ForegroundColor Yellow
            Write-Host "[提示] 正在自动为您切换为网页极速预览模式 (Web Dev)..." -ForegroundColor Cyan
            & $pm run dev -- --open
        } else {
            Ensure-McpBinary
            Write-Host "`n正在启动 SoloMD 桌面客户端 (Tauri Dev)..." -ForegroundColor Green
            & $pm run tauri dev
        }
    }
}

if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    Write-Host "`n[提示] 运行退出，退出码: $LASTEXITCODE" -ForegroundColor Yellow
    Read-Host "按回车键退出..."
}

