param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference='Stop'
$base=Join-Path $ProjectRoot 'docs/audits/2026-10-31/evidence/backend-repro/keyring-investigation'
python (Join-Path $base 'verify-full-suite-raii.py') $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw 'Own final test fixture verification failed' }
$targets=Get-Content -LiteralPath (Join-Path $base 'full-suite-raii-targets.json') -Raw | ConvertFrom-Json
if (@($targets.targets).Count -ne 6) { throw 'Expected exactly 6 own final-run targets' }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CatstepOwnFullSuiteTestAbsence {
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Delete(string target,uint type,uint flags);
 public static int DeleteExact(string target) {return Delete(target,1,0)?0:Marshal.GetLastWin32Error();}
}
'@
$rows=@()
foreach ($item in $targets.targets) {
    $active=@(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(cargo|rustc|rust-lld|link)\.exe$' -or
        $_.Name -match '^(app_lib|CatstepMD|github_sync_e2ee_test)-.*\.exe$'
    })
    if ($active.Count -ne 0) { throw 'Relevant test process active; no further action' }
    if ($item.type -ne 1 -or $item.exact_target -cne ($item.workspace+'.solomd-encryption-key') -or
        $item.label -notin @('crypto-ws','crypto-ws-pp','e2ee-devA','e2ee-devB')) {
        throw 'Unexpected own final-run test identity'
    }
    # No CredRead or enumeration. If RAII worked, exact CredDelete returns
    # ERROR_NOT_FOUND; any actual deletion is logged as a cleanup regression.
    $nativeError=[CatstepOwnFullSuiteTestAbsence]::DeleteExact($item.exact_target)
    $rows += [pscustomobject]@{
        workspace=$item.workspace; target=$item.exact_target; type=1
        win32_error=$nativeError; already_absent_after_raii=($nativeError -eq 1168)
        credential_content_read=$false; directory_deleted=$false
    }
}
$result=[pscustomobject]@{
    checked_utc=[DateTime]::UtcNow.ToString('o')
    only_own_final_normal_config_full_run_targets=$true
    method='CredDeleteW exact target/type1; ERROR_NOT_FOUND confirms RAII already removed the key; no CredRead/enumeration'
    target_count=$rows.Count
    already_absent=@($rows | Where-Object already_absent_after_raii).Count
    results=$rows
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $base 'full-suite-raii-verification.json') -Encoding UTF8
$result | Select-Object target_count,already_absent | ConvertTo-Json
if ($result.already_absent -ne 6) { exit 1 }
