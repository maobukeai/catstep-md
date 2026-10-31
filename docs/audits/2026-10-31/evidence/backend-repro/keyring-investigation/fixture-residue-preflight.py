"""Read-only, goal-bounded crypto unit-fixture inventory; no Credential APIs.

Only the report file is written. This script never deletes a directory or key,
never enumerates credentials, and never derives/decrypts or reads a password.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time


GOAL_START_SECONDS = 1793412035
GOAL_START_NS = GOAL_START_SECONDS * 1_000_000_000
NAME = re.compile(r"solomd-crypto-(ws|ws-pp|ws-guard)-(\d{19})\Z")
KDF = {"mem_kib": 19456, "iterations": 2, "parallelism": 1}
FIXED_FILES = {
    "notes/a.md": b"# Hello",
    "assets/img.png": b"\x89PNG fake",
    ".solomd/sync.json": b"{}",
}
META = {".solomd/encryption.json", ".solomd-encrypted/.solomd-vault.json"}
OPTIONAL = {".solomd/encryption.key-set", ".solomd/encryption.probe.enc"}
SHADOW = {".solomd-encrypted/notes/a.md.enc", ".solomd-encrypted/assets/img.png"}
DIRS = {".solomd", ".solomd-encrypted", "notes", "assets",
        ".solomd-encrypted/notes", ".solomd-encrypted/assets"}


def iso(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, timezone.utc).isoformat()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def processes() -> list[dict]:
    # Names only; no command lines or unrelated processes are collected.
    command = ("$p = @(Get-CimInstance Win32_Process | Where-Object { "
               "$_.Name -match '^(cargo|rustc|rust-lld|link)\\.exe$' -or "
               "$_.Name -match '^(app_lib|CatstepMD|github_sync_e2ee_test)-.*\\.exe$' "
               "} | Select-Object Name,ProcessId); ConvertTo-Json -InputObject $p -Compress")
    result = subprocess.run(["powershell", "-NoProfile", "-Command", command],
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout.lstrip("\ufeff"))


def safe_stat(path: Path) -> os.stat_result:
    info = path.lstat()
    if info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
        raise ValueError("reparse point")
    if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
        raise ValueError("unexpected file type")
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        raise ValueError("hardlinked file")
    return info


def inspect_fixture(path: Path, label: str, nanos: int, started_ns: int) -> dict:
    info = safe_stat(path)
    created_ns = info.st_birthtime_ns
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("not directory")
    if created_ns < GOAL_START_NS:
        raise ValueError("creation before goal")
    if abs(created_ns - nanos) > 10_000_000_000:
        raise ValueError("name/creation mismatch over 10s")
    if info.st_mtime_ns > started_ns:
        raise ValueError("modified during preflight")

    allowed_files = set() if label == "ws-guard" else META | OPTIONAL
    allowed_dirs = set() if label == "ws-guard" else {".solomd", ".solomd-encrypted"}
    if label == "ws":
        # decrypt_after_pull's non-.enc branch also mirrors this non-secret
        # salt envelope from the shadow root back into the fixture root.
        allowed_files |= set(FIXED_FILES) | SHADOW | {".solomd-vault.json"}
        allowed_dirs = DIRS
    observed: dict[str, bytes] = {}
    signatures: list[tuple[Path, tuple[int, int, int, int]]] = []
    todo = [path]
    while todo:
        directory = todo.pop()
        for child in directory.iterdir():
            rel = child.relative_to(path).as_posix()
            child_info = safe_stat(child)
            if child_info.st_mtime_ns > started_ns:
                raise ValueError("modified during preflight")
            signature = (child_info.st_size, child_info.st_mtime_ns,
                         child_info.st_birthtime_ns, child_info.st_ino)
            signatures.append((child, signature))
            if stat.S_ISDIR(child_info.st_mode):
                if rel not in allowed_dirs:
                    raise ValueError("unexpected directory")
                todo.append(child)
            else:
                if rel not in allowed_files:
                    raise ValueError("unexpected file")
                if child_info.st_size > 2048:
                    raise ValueError("file exceeds source fixture bound")
                observed[rel] = child.read_bytes()

    if label != "ws-guard":
        if not META <= observed.keys():
            raise ValueError("missing source metadata")
        config = json.loads(observed[".solomd/encryption.json"])
        shadow = json.loads(observed[".solomd-encrypted/.solomd-vault.json"])
        if (set(config) != {"salt", "kdf", "encrypt_extensions"}
                or set(shadow) != {"salt", "kdf"}
                or not re.fullmatch("[0-9a-f]{32}", config.get("salt", ""))
                or config["kdf"] != KDF
                or config["encrypt_extensions"] != ["md", "txt", "markdown"]
                or shadow != {"salt": config["salt"], "kdf": KDF}):
            raise ValueError("metadata differs from current test/source")
        marker = observed.get(".solomd/encryption.key-set")
        if marker is not None and marker != b"1":
            raise ValueError("marker differs from source")
        probe = observed.get(".solomd/encryption.probe.enc")
        if probe is not None and (len(probe) != 45 + len(b"Catstep MD probe v1")
                                  or probe[:5] != b"CTMD\x01"):
            raise ValueError("probe envelope differs from source")
        if label == "ws":
            mirrored_metadata = observed.get(".solomd-vault.json")
            if (mirrored_metadata is not None
                    and mirrored_metadata != observed[".solomd-encrypted/.solomd-vault.json"]):
                raise ValueError("mirrored metadata differs from shadow")
            if any(observed.get(rel) != data for rel, data in FIXED_FILES.items()):
                raise ValueError("fixed plaintext differs from test")
            mirrored = observed.get(".solomd-encrypted/assets/img.png")
            if mirrored is not None and mirrored != FIXED_FILES["assets/img.png"]:
                raise ValueError("mirrored sample differs from test")
            encrypted = observed.get(".solomd-encrypted/notes/a.md.enc")
            if encrypted is not None and (len(encrypted) != 52 or encrypted[:5] != b"CTMD\x01"):
                raise ValueError("encrypted sample envelope differs from source")

    # Detect changes while examining the directory. No hashes/salts are used to
    # infer whether a credential exists; the OS credential store is not queried.
    for child, expected in signatures:
        current = safe_stat(child)
        actual = (current.st_size, current.st_mtime_ns, current.st_birthtime_ns, current.st_ino)
        if actual != expected:
            raise ValueError("changed during preflight")
    final = safe_stat(path)
    if (final.st_mtime_ns, final.st_birthtime_ns, final.st_ino) != (
            info.st_mtime_ns, info.st_birthtime_ns, info.st_ino):
        raise ValueError("root changed during preflight")
    workspace = str(path)
    return {
        "workspace": workspace,
        "label": label,
        "embedded_unix_nanoseconds": nanos,
        "embedded_time_utc": iso(nanos),
        "creation_time_utc": iso(created_ns),
        "creation_minus_embedded_ms": round((created_ns - nanos) / 1e6, 3),
        "last_directory_write_utc": iso(info.st_mtime_ns),
        "fixture_shape_matches_current_source": True,
        "fixed_plaintext_files_verified": sorted(set(FIXED_FILES) & observed.keys()),
        "metadata_matches_current_defaults_and_shared_salt": label != "ws-guard",
        "credential_presence": "not_checked",
        "test_can_attempt_credential_write": label != "ws-guard",
        "exact_legacy_credential_identity": None if label == "ws-guard" else {
            "type": 1,
            "service": "solomd-encryption-key",
            "user": workspace,
            "target": workspace + ".solomd-encryption-key",
        },
        "marker_present_does_not_prove_credential_exists": ".solomd/encryption.key-set" in observed,
        "files": [{"relative_path": rel, "size": len(data), "sha256": sha(data)}
                  for rel, data in sorted(observed.items())],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_root", type=Path)
    args = parser.parse_args()
    root = args.project_root.absolute()
    evidence = root / "docs/audits/2026-10-31/evidence/backend-repro/keyring-investigation"
    source = root / "app/src-tauri/src/crypto.rs"
    source_hash = sha(source.read_bytes())
    temp_root = Path((evidence / "rust-temp-root.txt").read_text(encoding="utf-8-sig").strip())
    before = processes()
    if before:
        raise SystemExit("Refusing to inventory while Cargo or a relevant test process is active")
    started_ns = time.time_ns()
    counts = Counter()
    excluded = Counter()
    confirmed = []
    # Only name/metadata of this exact prefix is inspected; pre-goal contents
    # are never opened, and their exact paths are not included in this report.
    with os.scandir(temp_root) as entries:
        for entry in entries:
            if not entry.name.startswith("solomd-crypto-"):
                continue
            counts["prefix_names_seen"] += 1
            match = NAME.fullmatch(entry.name)
            if not match:
                excluded["name_not_current_fresh_pattern"] += 1
                continue
            label, digits = match.groups()
            nanos = int(digits)
            if nanos <= GOAL_START_NS:
                excluded["embedded_time_not_after_goal_no_contents_read"] += 1
                continue
            counts["post_goal_name_candidates"] += 1
            if nanos > started_ns:
                excluded["embedded_time_after_preflight"] += 1
                continue
            try:
                confirmed.append(inspect_fixture(Path(entry.path), label, nanos, started_ns))
            except (ValueError, OSError, KeyError, TypeError) as error:
                excluded[str(error)] += 1
    after = processes()
    if after or sha(source.read_bytes()) != source_hash:
        raise SystemExit("Preflight invalid: process/source changed; no eligibility report written")
    confirmed.sort(key=lambda item: item["embedded_unix_nanoseconds"])
    report = {
        "purpose": "Read-only current-goal crypto unit fixture residue preflight; NOT deletion authorization",
        "goal_start_unix_seconds": GOAL_START_SECONDS,
        "goal_start_utc": iso(GOAL_START_NS),
        "preflight_started_utc": iso(started_ns),
        "preflight_finished_utc": iso(time.time_ns()),
        "source": {"path": str(source), "sha256": source_hash,
                   "fresh_lines": "635-643", "fixture_tests_lines": "713-771"},
        "temp_root_as_returned_by_rust": str(temp_root),
        "credential_api_calls": False,
        "credential_enumeration": False,
        "password_read_or_derivation": False,
        "deletion_performed": False,
        "unrelated_or_pre_goal_directory_contents_read": False,
        "active_relevant_processes_before": before,
        "active_relevant_processes_after": after,
        "counts": {**dict(counts),
                   "confirmed_current_goal_fixtures": len(confirmed),
                   "confirmed_fixtures_whose_tests_can_attempt_key_write":
                       sum(x["test_can_attempt_credential_write"] for x in confirmed),
                   "confirmed_empty_guard_fixtures_no_key_write_by_source":
                       sum(not x["test_can_attempt_credential_write"] for x in confirmed),
                   "existing_credential_count": "not_checked"},
        "excluded_counts_without_paths": dict(excluded),
        "eligibility_basis": [
            "Exact current fresh label and nanosecond name, strictly after goal start",
            "Native directory creation is after goal and within 10s of embedded time",
            "No reparse points or hardlinked files; allowlisted source fixture tree only",
            "Fixed plaintext bytes and/or exact current test metadata/probe shape verified",
            "No relevant active Cargo/test process at either boundary; files stable during inspection",
            "Random fresh function never reuses an existing finished workspace name",
        ],
        "limitations": [
            "No credential was queried; marker and fixture count do not establish that a stored key exists",
            "ws-pp has no plaintext note in source; its metadata/defaults, paired salt and optional synthetic probe shape were checked",
            "Guard fixtures have no credential target: guarded test returns before creating a key",
            "Only exact crypto unit fresh fixtures are in scope; GitHub E2EE and any other fixture families are excluded",
            "No deletion or production storage format change is authorized by this report",
        ],
        "confirmed_fixtures": confirmed,
    }
    output = evidence / "fixture-residue-preflight.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "counts": report["counts"],
                      "excluded_counts_without_paths": dict(excluded)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
