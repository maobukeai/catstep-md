@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title SoloMD Launcher

where powershell >nul 2>&1
if %ERRORLEVEL% equ 0 (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
    if errorlevel 1 (
        echo.
        echo [ERROR] Process exited with error. Press any key to close...
        pause >nul
    )
    exit /b %ERRORLEVEL%
)

echo [WARN] PowerShell not found. Starting Web dev mode directly...
cd /d "%~dp0app"
call npm run dev
pause

