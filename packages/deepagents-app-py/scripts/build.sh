#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Building deepagents-app-py..."
uv build
echo "Build complete. See dist/ for output."
