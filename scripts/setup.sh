#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! command -v bun >/dev/null 2>&1; then
	echo "bun is required: https://bun.sh/" >&2
	exit 1
fi

git submodule update --init --recursive
bun install
bun run build

if [[ ! -f main.js || ! -f styles.css ]]; then
	echo "build finished but main.js or styles.css is missing" >&2
	exit 1
fi

echo "Built Commentator. Reload Obsidian (Cmd+R) to load the plugin."
