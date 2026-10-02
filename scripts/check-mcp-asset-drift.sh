#!/usr/bin/env bash
#
# check-mcp-asset-drift.sh — fail the release when the MCP asset names
# .github/workflows/release.yml uploads drift from the names
# scripts/install-mcp.sh resolves for the same platforms.
#
# Why: the Windows zip was renamed on the workflow side only
# (solomd-mcp-win-*.zip vs the catstep-mcp-win-*.zip install-mcp.sh asks
# for), so `curl install-mcp.sh | bash` 404'd on Windows while workflow
# comments still claimed the two agreed. This check derives the expected
# names from install-mcp.sh's own detection logic — a fake `uname` feeds it
# Linux/MINGW values and the detection block is sourced up to its first
# progress echo — instead of re-stating the mapping here (a second copy is
# exactly the drift being guarded). Each expected name must then exist on
# the release.
#
# Scope note: macOS is deliberately NOT checked. install-mcp.sh maps every
# Darwin machine to `catstep-mcp-mac-universal.tar.gz`, while CI uploads
# `catstep-mcp-mac-arm64.tar.gz` (an arm64-only binary — labelling it
# universal would be a lie). Reconciling that needs a maintainer decision
# (lipo a universal binary vs per-arch mac naming in install-mcp.sh) and is
# out of scope here.
#
# CI runs this from .github/workflows/release.yml (checksums job). Locally:
#   ./scripts/check-mcp-asset-drift.sh v4.11.20
#
# Requires: gh, authenticated (works against draft releases); sed, mktemp.

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <tag>    e.g. $0 v4.11.20" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_MCP="$SCRIPT_DIR/install-mcp.sh"

# ---------------------------------------------------------------------------
# Resolve the asset name install-mcp.sh would use for a (uname -s, uname -m)
# pair, by running the script's own detection block under a fake `uname`.
# The block is cut at its first `echo` line — everything before it is pure
# detection/assignment. `echo` is overridden to a no-op for the sourced
# range, so only the resolved `$asset` reaches stdout.
# ---------------------------------------------------------------------------
resolve_expected_asset() {
  local uname_s="$1" uname_m="$2" fakebin out
  fakebin="$(mktemp -d)"
  printf '#!/bin/sh\ncase "$1" in\n  -s) echo "%s" ;;\n  -m) echo "%s" ;;\n  *) exit 1 ;;\nesac\n' \
    "$uname_s" "$uname_m" >"$fakebin/uname"
  chmod +x "$fakebin/uname"
  out="$(
    PATH="$fakebin:$PATH" bash -c "
      echo() { :; }
      set -e
      source <(sed -n '1,/^echo \"Platform:/p' '$INSTALL_MCP')
      printf '%s' \"\$asset\"
    "
  )"
  rm -rf "$fakebin"
  printf '%s' "$out"
}

FAILED=0

check_pair() {
  local label="$1" uname_s="$2" uname_m="$3" expected
  expected="$(resolve_expected_asset "$uname_s" "$uname_m")"
  if [[ -z "$expected" ]]; then
    echo "FAIL  $label: install-mcp.sh resolved an empty asset name" >&2
    FAILED=1
    return
  fi
  if gh release view "$TAG" --json assets -q '.assets[].name' | grep -Fqx -- "$expected"; then
    echo "ok    $label -> $expected"
  else
    echo "FAIL  $label -> $expected not found on release $TAG" >&2
    echo "      .github/workflows/release.yml and scripts/install-mcp.sh have drifted" >&2
    echo "      apart; a fresh install via install-mcp.sh would 404." >&2
    FAILED=1
  fi
}

check_pair "linux/x64"   "Linux"            "x86_64"
check_pair "linux/arm64" "Linux"            "aarch64"
check_pair "win/x64"     "MINGW64_NT-10.0"  "x86_64"
check_pair "win/arm64"   "MINGW64_NT-10.0"  "aarch64"

if [[ "$FAILED" -ne 0 ]]; then
  echo "install-mcp.sh <-> release asset drift detected" >&2
  exit 1
fi
echo "install-mcp.sh <-> release assets: no drift"
