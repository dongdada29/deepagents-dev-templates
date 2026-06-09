#!/usr/bin/env bash
# Render a chat-deliverable ACP agent_servers JSON payload.
# Usage: bash scripts/render-acp-config.sh --install-root /opt/nuwax/deepagents-template [--provider openai|anthropic]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/../.nuwax-agent/rcoder.chat.agent_servers.example.json"

INSTALL_ROOT=""
PROVIDER="openai"

usage() {
  cat <<'USAGE'
Usage: bash scripts/render-acp-config.sh --install-root DIR [--provider openai|anthropic]

Options:
  --install-root DIR   Absolute path where the agent was installed
  --provider TYPE      LLM provider: openai (default) or anthropic
  -h, --help           Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-root) INSTALL_ROOT="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$INSTALL_ROOT" ]]; then
  echo "--install-root is required" >&2
  exit 1
fi

# Resolve INSTALL_ROOT to absolute
INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd)"

if [[ ! -f "$INSTALL_ROOT/dist/index.js" ]]; then
  echo "Warning: $INSTALL_ROOT/dist/index.js not found" >&2
fi

node - "$TEMPLATE_FILE" "$INSTALL_ROOT" "$PROVIDER" <<'NODE'
const fs = require("fs");
const path = require("path");

const [templatePath, installRoot, provider] = process.argv.slice(2);
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const cfg = template.agent_servers["deepagents-template"];

cfg.args = [
  path.join(installRoot, "dist/index.js"),
  "--config",
  path.join(installRoot, "config/app-agent.config.json"),
];

cfg.env.LOG_DIR = path.join(installRoot, "logs");

// Keep placeholders for secrets/runtime config — caller fills these in
console.log(JSON.stringify(template, null, 2));
NODE
