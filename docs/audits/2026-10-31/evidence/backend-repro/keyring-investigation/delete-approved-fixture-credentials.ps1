param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$base = Join-Path $ProjectRoot 'docs/audits/2026-10-31/evidence/backend-repro/keyring-investigation'
$manifestPath = Join-Path $base 'fixture-residue-preflight.json'
$approvedHash = '7553cedc6f87b57c7403da2baf0674e2945a29c233a3aefb8abc83d3233576e9'
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $approvedHash) {
    throw 'Parent-approved manifest changed; no credential action allowed'
}
$logPath = Join-Path $base 'fixture-credential-cleanup.jsonl'
$summaryPath = Join-Path $base 'fixture-credential-cleanup-summary.json'
if ((Test-Path -LiteralPath $logPath) -or (Test-Path -LiteralPath $summaryPath)) {
    throw 'Existing cleanup evidence; refusing to overwrite or silently repeat'
}
python (Join-Path $base 'fixture-residue-revalidate.py') $ProjectRoot
if ($LASTEXITCODE -ne 0) { throw 'Fixture tree/hash/process revalidation failed' }
$allowlist = Get-Content -LiteralPath (Join-Path $base 'fixture-residue-delete-allowlist.json') -Raw | ConvertFrom-Json
if ($allowlist.approved_manifest_sha256 -ne $approvedHash -or $allowlist.target_count -ne 14) {
    throw 'Unexpected exact target allowlist'
}
$original = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$approved = @($original.confirmed_fixtures | Where-Object test_can_attempt_credential_write)
if ($approved.Count -ne 14) { throw 'Expected exactly 14 approved fixture targets' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CatstepApprovedFixtureCredentialDelete {
 [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 private static extern bool CredDelete(string target, uint type, uint flags);
 public static int DeleteExactGeneric(string target) {
  return CredDelete(target, 1, 0) ? 0 : Marshal.GetLastWin32Error();
 }
}
'@
function Assert-NoRelevantTests {
    $active = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '^(cargo|rustc|rust-lld|link)\.exe$' -or
        $_.Name -match '^(app_lib|CatstepMD|github_sync_e2ee_test)-.*\.exe$'
    })
    if ($active.Count -gt 0) { throw 'Cargo or related test active; stopping before further credential actions' }
}
$started = [DateTime]::UtcNow.ToString('o')
$results = @()
foreach ($item in $allowlist.verified_exact_targets) {
    Assert-NoRelevantTests
    $identity = $item.exact_legacy_credential_identity
    $matching = @($approved | Where-Object { $_.workspace -ceq $item.workspace })
    if ($matching.Count -ne 1) { throw 'Target outside parent-approved workspace list' }
    $expected = $matching[0].exact_legacy_credential_identity
    if ($identity.type -ne 1 -or $identity.service -cne 'solomd-encryption-key' -or
        $identity.user -cne $expected.user -or $identity.target -cne $expected.target -or
        $identity.target -cne ($item.workspace + '.solomd-encryption-key')) {
        throw 'Exact credential identity mismatch'
    }
    # Only CredDeleteW(exact approved target, CRED_TYPE_GENERIC, flags=0).
    # There is deliberately no credential enumeration or read API here.
    $nativeError = [CatstepApprovedFixtureCredentialDelete]::DeleteExactGeneric($identity.target)
    $outcome = if ($nativeError -eq 0) { 'deleted' } elseif ($nativeError -eq 1168) { 'absent' } else { 'failed' }
    $result = [pscustomobject]@{
        time_utc = [DateTime]::UtcNow.ToString('o')
        workspace = $item.workspace
        target = $identity.target
        type = 1
        outcome = $outcome
        win32_error = $nativeError
        credential_content_read = $false
        directory_deleted = $false
    }
    $result | ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding UTF8
    $results += $result
    if ($outcome -eq 'failed') { throw "Exact fixture cleanup failed: error $nativeError; details logged" }
}
Assert-NoRelevantTests
$summary = [pscustomobject]@{
    approved_manifest_sha256 = $approvedHash
    started_utc = $started
    finished_utc = [DateTime]::UtcNow.ToString('o')
    requested_targets = 14
    attempted_targets = $results.Count
    deleted = @($results | Where-Object outcome -eq 'deleted').Count
    absent = @($results | Where-Object outcome -eq 'absent').Count
    failed = @($results | Where-Object outcome -eq 'failed').Count
    credential_enumeration = $false
    credential_reads = $false
    directory_deletion = $false
    production_storage_format_changed = $false
    results = $results
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
$summary | Select-Object requested_targets,attempted_targets,deleted,absent,failed | ConvertTo-Json
