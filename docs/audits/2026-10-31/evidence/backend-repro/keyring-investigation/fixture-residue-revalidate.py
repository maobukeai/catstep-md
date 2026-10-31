"""Revalidate ONLY the parent's approved 14 exact test-fixture identities.

No native credential APIs or deletions. Writes a verified exact allowlist.
"""
from pathlib import Path
import json
import runpy
import sys
import time

root = Path(sys.argv[1]).absolute()
base = root / "docs/audits/2026-10-31/evidence/backend-repro/keyring-investigation"
helpers = runpy.run_path(str(base / "fixture-residue-preflight.py"))
sha, processes, inspect_fixture, iso = (
    helpers[key] for key in ("sha", "processes", "inspect_fixture", "iso"))
manifest_path = base / "fixture-residue-preflight.json"
manifest_bytes = manifest_path.read_bytes()
manifest = json.loads(manifest_bytes)
source = root / "app/src-tauri/src/crypto.rs"
assert sha(source.read_bytes()) == manifest["source"]["sha256"], "source changed"
assert manifest["goal_start_unix_seconds"] == 1793412035
temp_root = Path(manifest["temp_root_as_returned_by_rust"])
approved = [item for item in manifest["confirmed_fixtures"]
            if item["test_can_attempt_credential_write"]]
assert len(approved) == 14
assert len({item["workspace"] for item in approved}) == 14
before = processes()
assert not before, f"active relevant processes: {before}"
started = time.time_ns()
verified = []
for item in approved:
    workspace = Path(item["workspace"])
    assert workspace.parent == temp_root
    match = helpers["NAME"].fullmatch(workspace.name)
    assert match and match[1] in ("ws", "ws-pp")
    nanos = int(match[2])
    assert nanos > helpers["GOAL_START_NS"]
    expected_identity = {
        "type": 1, "service": "solomd-encryption-key",
        "user": str(workspace), "target": str(workspace) + ".solomd-encryption-key",
    }
    assert item["exact_legacy_credential_identity"] == expected_identity
    current = inspect_fixture(workspace, match[1], nanos, started)
    for key in ("workspace", "label", "embedded_unix_nanoseconds", "creation_time_utc",
                "last_directory_write_utc", "files", "exact_legacy_credential_identity"):
        assert item[key] == current[key], f"approved fixture changed: {workspace}, {key}"
    verified.append({"workspace": str(workspace),
                     "exact_legacy_credential_identity": expected_identity,
                     "file_set_and_hashes_match_approved_manifest": True})
after = processes()
assert not after, f"active relevant processes: {after}"
assert manifest_path.read_bytes() == manifest_bytes, "approved manifest changed"
assert sha(source.read_bytes()) == manifest["source"]["sha256"], "source changed"
result = {
    "scope": "Only the 14 exact targets explicitly approved by root; no guard/pre-goal/unknown targets",
    "approved_manifest": str(manifest_path), "approved_manifest_sha256": sha(manifest_bytes),
    "source_sha256": manifest["source"]["sha256"],
    "validated_started_utc": iso(started), "validated_finished_utc": iso(time.time_ns()),
    "active_relevant_processes_before": before, "active_relevant_processes_after": after,
    "credential_api_calls": False, "deletion_performed": False,
    "target_count": len(verified), "verified_exact_targets": verified,
}
output = base / "fixture-residue-delete-allowlist.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"target_count": len(verified), "approved_manifest_sha256": sha(manifest_bytes),
                  "all_fixture_hashes_unchanged": True, "active_relevant_processes": after}, indent=2))
