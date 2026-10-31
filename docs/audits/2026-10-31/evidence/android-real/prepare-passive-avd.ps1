param(
    [string]$QaRoot = (Join-Path $env:LOCALAPPDATA 'Temp\catstep-android-d11-qa-20261031')
)

$ErrorActionPreference = 'Stop'
$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$qaAbsolute = [IO.Path]::GetFullPath($QaRoot)
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Temp\catstep-android-d11-qa-20261031'))
if ($qaAbsolute -ne $expectedRoot) { throw 'This audit script only writes its explicitly scoped temporary QA root.' }
$avdName = 'catstep_qa_d11_20261031_isolated'
$avdHome = Join-Path $qaAbsolute 'android-user\avd'
$avdPath = Join-Path $avdHome ($avdName + '.avd')
$imagePackage = 'system-images;android-34;default;x86_64'
$originalMetadata = @(
    (Join-Path $env:USERPROFILE '.android\avd\maobu_test.ini'),
    (Join-Path $env:USERPROFILE '.android\avd\maobu_test.avd\config.ini')
)
$beforeHashes = @($originalMetadata | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })

# These variables affect only this process and its command-line child. No system/user env is changed.
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_USER_HOME = Join-Path $qaAbsolute 'android-user'
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = $avdHome
# Do not also set deprecated ANDROID_SDK_HOME: cmdline-tools 12 treats its
# derived .android path and ANDROID_USER_HOME as conflicting preferences.
$env:ANDROID_SDK_HOME = $null
New-Item -ItemType Directory -Path $avdHome -Force | Out-Null
if (Test-Path -LiteralPath $avdPath) { throw 'QA AVD already exists; refuse to overwrite or wipe it.' }

# No --force, no emulator invocation, no original AVD path, no copied user data.
'no' | & (Join-Path $sdkRoot 'cmdline-tools\latest\bin\avdmanager.bat') create avd `
    --name $avdName --package $imagePackage --device 'pixel_6' --path $avdPath
if ($LASTEXITCODE -ne 0) { throw "avdmanager create failed: $LASTEXITCODE" }

# Only the newly created QA definition is tuned. No device has been booted.
$configPath = Join-Path $avdPath 'config.ini'
$configText = Get-Content -LiteralPath $configPath -Raw
$configText = $configText -replace '(?m)^disk.dataPartition.size=.*$', 'disk.dataPartition.size=2G'
$configText = $configText -replace '(?m)^hw.ramSize=.*$', 'hw.ramSize=2048M'
$configText = $configText -replace '(?m)^hw.keyboard=.*$', 'hw.keyboard=yes'
$configText = $configText -replace '(?m)^fastboot.forceColdBoot=.*$', 'fastboot.forceColdBoot=yes'
$configText = $configText -replace '(?m)^fastboot.forceFastBoot=.*$', 'fastboot.forceFastBoot=no'
[IO.File]::WriteAllText($configPath, $configText, [Text.UTF8Encoding]::new($false))

$afterHashes = @($originalMetadata | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
if (Compare-Object $beforeHashes $afterHashes) { throw 'Existing AVD metadata unexpectedly changed.' }

$listing = & (Join-Path $sdkRoot 'emulator\emulator.exe') -list-avds
if ($LASTEXITCODE -ne 0 -or @($listing).Count -ne 1 -or $listing.Trim() -ne $avdName) {
    throw 'The isolated AVD home did not resolve exclusively to the new QA AVD.'
}

[ordered]@{
    createdAt = (Get-Date).ToString('o')
    qaRoot = $qaAbsolute
    avdName = $avdName
    avdPath = $avdPath
    androidUserHome = $env:ANDROID_USER_HOME
    androidAvdHome = $env:ANDROID_AVD_HOME
    imagePackage = $imagePackage
    apiLevel = 34
    osVersion = 'Android 14'
    abi = 'x86_64'
    launched = $false
    installedApk = $false
    originalAvdMetadataUnchanged = $true
    originalMetadataSHA256 = $beforeHashes
    sourceOfUserdata = 'New AVD initialized by avdmanager from SDK pristine image; no existing AVD user data read or copied.'
    isolatedListAvds = @($listing)
    qaFiles = @(Get-ChildItem -LiteralPath $avdPath -File | Select-Object Name,Length)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'passive-avd-result.json') -Encoding utf8

Get-Content -LiteralPath (Join-Path $avdPath 'config.ini') |
    Where-Object { $_ -match '^(AvdId|avd.ini.displayname|image.sysdir.1|abi.type|hw.cpu.arch|target|tag.id|tag.display|PlayStore.enabled|hw.device.name|hw.ramSize|disk.dataPartition.size|hw.keyboard|fastboot.forceColdBoot|fastboot.forceFastBoot)\s*=' } |
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'qa-avd-config-summary.txt') -Encoding utf8
Write-Output "Created passive isolated QA AVD: $avdPath"
