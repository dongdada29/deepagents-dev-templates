#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Installing deepagents-app-py..."
uv sync
echo "Installation complete."
