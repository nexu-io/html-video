#!/usr/bin/env bash
# Install the html-video agent skill for Claude Code and optionally Cursor.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skills/html-video/SKILL.md"

if [[ ! -f "$SRC" ]]; then
  echo "error: missing $SRC" >&2
  exit 1
fi

install_one() {
  local dest_dir="$1"
  mkdir -p "$dest_dir"
  cp "$SRC" "$dest_dir/SKILL.md"
  echo "installed → $dest_dir/SKILL.md"
}

install_one "${HOME}/.claude/skills/html-video"

if [[ "${1:-}" == "--with-cursor" ]] || [[ "${1:-}" == "--all" ]]; then
  install_one "${HOME}/.cursor/skills/html-video"
fi

echo ""
echo "Claude Code: skill name \"html-video\" (restart or rescan skills if needed)."
echo "This repo also ships a project Cursor skill at .cursor/skills/html-video/"
echo "Personal Cursor copy: re-run with --with-cursor"
