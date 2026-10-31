$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$appRoot = Join-Path $repoRoot 'app'
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$qaRoot = Join-Path $env:LOCALAPPDATA 'Temp\catstep-android-d11-qa-20261031'
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:NDK_HOME = Join-Path $sdkRoot 'ndk\26.3.11579264'
$env:ANDROID_NDK_HOME = $env:NDK_HOME
$env:ANDROID_USER_HOME = Join-Path $qaRoot 'android-user'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = Join-Path $env:ANDROID_USER_HOME 'avd'
$env:ANDROID_SDK_HOME = $null
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.jdks\jdk-21'
$env:CARGO_BUILD_JOBS = '2'
$env:CI = 'true'
if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $qaRoot 'rust-target-ascii'
}
# Installed AGP 8.11 exposes this project property. It only suppresses the
# Windows location warning; target files are actually generated at ASCII paths.
Set-Item -Path 'Env:ORG_GRADLE_PROJECT_android.overridePathCheck' -Value 'true'

$distIndex = Join-Path $appRoot 'dist\index.html'
$distHash = (Get-FileHash -LiteralPath $distIndex -Algorithm SHA256).Hash
$generatedRoot = Join-Path $appRoot 'src-tauri\gen\android'
$beforeFiles = @(Get-ChildItem -LiteralPath $generatedRoot -File -Recurse |
    Where-Object { $_.FullName -notmatch '\\(build|\.gradle)\\' } |
    ForEach-Object { [ordered]@{ path = $_.FullName.Substring($generatedRoot.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
$beforeFiles | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'generated-files-before.json') -Encoding utf8

Push-Location -LiteralPath $appRoot
try {
    # build only: never android dev/run, --open, adb install or emulator start.
    # The root agent's current dist is reused without invoking pnpm build.
    & pnpm exec tauri android build --debug --apk --target x86_64 --ci --config (Join-Path $PSScriptRoot 'build-override.json') *>&1 |
        Tee-Object -FilePath (Join-Path $PSScriptRoot 'build-debug-apk.log')
    $buildExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

$afterFiles = @(Get-ChildItem -LiteralPath $generatedRoot -File -Recurse |
    Where-Object { $_.FullName -notmatch '\\(build|\.gradle)\\' } |
    ForEach-Object { [ordered]@{ path = $_.FullName.Substring($generatedRoot.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
$afterFiles | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'generated-files-after.json') -Encoding utf8
[ordered]@{
    completedAt = (Get-Date).ToString('o')
    command = 'pnpm exec tauri android build --debug --apk --target x86_64 --ci --config <evidence/android-real/build-override.json>'
    buildExitCode = $buildExitCode
    distIndexSHA256Before = $distHash
    distIndexSHA256After = (Get-FileHash -LiteralPath $distIndex -Algorithm SHA256).Hash
    frontendBuildHooksDisabled = $true
    devicesStarted = $false
    apkInstalled = $false
    sdkRoot = $sdkRoot
    ndkRoot = $env:NDK_HOME
    javaHome = $env:JAVA_HOME
    androidUserHome = $env:ANDROID_USER_HOME
    cargoTargetDir = $env:CARGO_TARGET_DIR
    gradlePathCheckOverride = [Environment]::GetEnvironmentVariable('ORG_GRADLE_PROJECT_android.overridePathCheck')
    artifacts = @(Get-ChildItem -LiteralPath (Join-Path $generatedRoot 'app\build\outputs\apk') -Filter '*.apk' -Recurse -ErrorAction SilentlyContinue | Select-Object FullName,Length,LastWriteTime)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'build-result.json') -Encoding utf8
exit $buildExitCode
