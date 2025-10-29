#!/usr/bin/env bash
set -euo pipefail

avail_kb=$(df -k . | awk 'NR==2 {print $4}')
echo "Available disk space: ${avail_kb} KB"

if [ "${avail_kb}" -lt 10240 ]; then
  echo "Insufficient disk space to create a snapshot commit. Aborting."
  exit 1
fi

git config user.name "snapshot-bot"
git config user.email "snapshot-bot@users.noreply.github.com"

git add archive docs

if git diff --cached --quiet; then
  echo "No changes detected in archive/ or docs/. Nothing to commit."
  exit 0
fi

timestamp=${SNAPSHOT_TIMESTAMP:-$(date -u +"%Y-%m-%dT%H-%M-%SZ")}
url=${SNAPSHOT_URL:-unknown-url}

commit_message="snapshot: ${timestamp} ${url}"

git commit -m "${commit_message}"
git push origin HEAD:"${GITHUB_REF_NAME:-main}"
