"""Identify only the current normal-config full run's random crypto fixtures.

No credential APIs; no old fixture metadata or contents are read.
"""
from datetime import datetime
import json
import os
from pathlib import Path
import re
import runpy
import sys
import time

root = Path(sys.argv[1]).absolute()
base = root / "docs/audits/2026-10-31/evidence/backend-repro"
evidence = base / "keyring-investigation"
h = runpy.run_path(str(evidence / "fixture-residue-preflight.py"))
sha, processes, inspect_fixture = (h[k] for k in ("sha", "processes", "inspect_fixture"))
assert not processes(), "relevant tests still active"
run = json.loads((base / "app-rust-tests-final-normal-config-result.json").read_text(encoding="utf-8-sig"))
assert run["exit_code"] == 0 and run["tauri_config_absent_in_test_child"]
lower, upper = (int(datetime.fromisoformat(run[k]).timestamp() * 1e9)
                for k in ("started_utc", "finished_utc"))
temp = Path((evidence / "rust-temp-root.txt").read_text(encoding="utf-8-sig").strip())
found, guards = [], []
with os.scandir(temp) as entries:
    for entry in entries:
        match = re.fullmatch(r"solomd-(crypto-(?:ws|ws-pp|ws-guard)|e2ee-devA|e2ee-devB)-(\d{19})", entry.name)
        if not match:
            continue
        label, digits = match.groups()
        nanos = int(digits)
        if not lower <= nanos <= upper:
            continue
        workspace = Path(entry.path)
        info = h["safe_stat"](workspace)
        assert abs(info.st_birthtime_ns - nanos) < 10_000_000_000
        if label.startswith("crypto-"):
            current = inspect_fixture(workspace, label.removeprefix("crypto-"), nanos, time.time_ns())
            files = current["files"]
            if label == "crypto-ws-guard":
                guards.append(str(workspace))
                continue
        else:
            files = []
            for relative, expected in {
                "note.md": b"# Hello\n\nedited on device B\n",
                "assets/img.png": b"\x89PNG fake bytes",
            }.items():
                target = workspace / relative
                h["safe_stat"](target.parent)
                h["safe_stat"](target)
                actual = target.read_bytes()
                assert actual == expected, "E2EE source sample differs"
                files.append({"relative_path": relative, "size": len(actual), "sha256": sha(actual)})
            assert not (workspace / ".solomd/encryption.key-set").exists(), "public RAII marker cleanup not run"
        found.append({"workspace": str(workspace), "label": label,
                      "embedded_unix_nanoseconds": nanos,
                      "creation_time_utc": h["iso"](info.st_birthtime_ns),
                      "exact_target": str(workspace) + ".solomd-encryption-key", "type": 1,
                      "current_source_fixed_samples_verified": files})
assert len(found) == 6 and len(guards) == 2, (len(found), len(guards))
expected_counts = {"crypto-ws": 2, "crypto-ws-pp": 2, "e2ee-devA": 1, "e2ee-devB": 1}
assert {label: sum(item["label"] == label for item in found) for label in expected_counts} == expected_counts
assert not processes(), "relevant tests started during verification"
report = {
    "scope": "Only random workspaces generated within the final normal-config full Cargo test runtime",
    "credential_api_calls": False,
    "crypto_source_sha256": sha((root / "app/src-tauri/src/crypto.rs").read_bytes()),
    "e2ee_test_source_sha256": sha((root / "app/src-tauri/tests/github_sync_e2ee_test.rs").read_bytes()),
    "guard_fixtures_verified_empty_and_excluded_from_credential_actions": guards,
    "targets": sorted(found, key=lambda item: item["embedded_unix_nanoseconds"]),
}
(evidence / "full-suite-raii-targets.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"own_final_full_run_key_targets": len(found), "empty_guard_fixtures_excluded": len(guards)}, indent=2))
