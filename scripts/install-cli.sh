#!/bin/bash
#
# Installs the `catstep` and `solomd` CLI to /usr/local/bin (or $HOME/.local/bin if
# /usr/local/bin isn't writable).
#
# Run via:
#   curl -fsSL https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/install-cli.sh | bash

set -e

URL="https://raw.githubusercontent.com/maobukeai/catstep-md/main/scripts/solomd"
DIRS=("/usr/local/bin" "$HOME/.local/bin")

for dir in "${DIRS[@]}"; do
    if [[ -w "$dir" ]] || mkdir -p "$dir" 2>/dev/null && [[ -w "$dir" ]]; then
        target="$dir/catstep"
        echo "Installing catstep CLI to $target"
        if command -v curl >/dev/null 2>&1; then
            curl -fsSL "$URL" -o "$target"
        elif command -v wget >/dev/null 2>&1; then
            wget -q "$URL" -O "$target"
        else
            echo "Error: need curl or wget" >&2
            exit 1
        fi
        chmod +x "$target"

        # Create solomd alias / symlink
        ln -sf "$target" "$dir/solomd" 2>/dev/null || cp -f "$target" "$dir/solomd"

        echo "Installed successfully. Try: catstep help"
        exit 0
    fi
done

echo "No writable target dir. Tried: ${DIRS[*]}" >&2
echo "Run with sudo, or create ~/.local/bin and add it to PATH." >&2
exit 1
