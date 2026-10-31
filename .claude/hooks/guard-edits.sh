#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): block edits an agent must never make here.
# Exit 2 blocks the tool call and shows stderr to Claude.
set -euo pipefail

file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -z "$file" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"
rel=$(realpath -m --relative-to=. "$file")

case "$rel" in
  .env.example) ;;
  .env | .env.* | */.env | */.env.*)
    echo "Blocked: $rel holds local secrets. Edit .env.example instead, or ask the user to change it." >&2
    exit 2 ;;
  package-lock.json)
    echo "Blocked: never hand-edit package-lock.json. Use 'npm install <pkg>' / 'npm uninstall <pkg>'." >&2
    exit 2 ;;
  ../antcolos/*)
    echo "Blocked: the NestJS backend (../antcolos) is read-only from the frontend session. Write the change up as a backend ask (plan '## Backend asks') or open a session in ../antcolos." >&2
    exit 2 ;;
esac
exit 0
