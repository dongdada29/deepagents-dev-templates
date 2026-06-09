#!/usr/bin/env bash
# Upgrade an installed Nuwax agent artifact with rollback support.
set -euo pipefail

ARTIFACT=""
INSTALL_ROOT=""
ROLLBACK=0
FROM_BUCKET=0
CHANNEL="stable"
TARGET_VERSION=""
NO_VERIFY_SSL=0
AWS_ENDPOINT_OVERRIDE=""
AWS_BUCKET_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/upgrade.sh --artifact PATH --install-root DIR
  bash scripts/upgrade.sh --rollback --install-root DIR
  bash scripts/upgrade.sh --from-bucket --install-root DIR [--channel stable|beta | --target-version X.Y.Z]

Options:
  --artifact PATH           New npm tgz, Nuwax tar.gz, or Nuwax zip artifact
  --install-root DIR        Existing install directory
  --rollback                Restore the last backup recorded by upgrade
  --from-bucket             Pull the new artifact from the MinIO/S3 bucket declared in
                            .nuwax-agent/distribution.json (implies --channel stable)
  --channel <stable|beta>   Channel to resolve when --from-bucket is set (default: stable)
  --target-version <v>      Explicit target version (overrides --channel resolution)
  --no-verify-ssl           Pass through to `aws s3 cp` for self-signed MinIO endpoints
  --aws-endpoint <url>      Override NUWAX_S3_ENDPOINT for this invocation
  --aws-bucket <name>       Override NUWAX_S3_BUCKET for this invocation
  -h, --help                Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT="${2:-}"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="${2:-}"
      shift 2
      ;;
    --rollback)
      ROLLBACK=1
      shift
      ;;
    --from-bucket)
      FROM_BUCKET=1
      shift
      ;;
    --channel)
      CHANNEL="${2:-stable}"
      shift 2
      ;;
    --target-version)
      TARGET_VERSION="${2:-}"
      _EXPLICIT_TARGET_VERSION=1
      shift 2
      ;;
    --no-verify-ssl)
      NO_VERIFY_SSL=1
      shift
      ;;
    --aws-endpoint)
      AWS_ENDPOINT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --aws-bucket)
      AWS_BUCKET_OVERRIDE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$FROM_BUCKET" -eq 1 && -n "$ARTIFACT" ]]; then
  echo "--from-bucket and --artifact are mutually exclusive" >&2
  exit 1
fi

if [[ -n "$AWS_ENDPOINT_OVERRIDE" ]]; then
  export NUWAX_S3_ENDPOINT="$AWS_ENDPOINT_OVERRIDE"
fi
if [[ -n "$AWS_BUCKET_OVERRIDE" ]]; then
  export NUWAX_S3_BUCKET="$AWS_BUCKET_OVERRIDE"
fi
if [[ "$NO_VERIFY_SSL" -eq 1 ]]; then
  export NUWAX_S3_NO_VERIFY_SSL=1
fi

if [[ -z "$INSTALL_ROOT" ]]; then
  echo "--install-root is required" >&2
  exit 1
fi

STATE_FILE="$INSTALL_ROOT/.nuwax-agent/upgrade-state.json"

rollback() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No upgrade state found: $STATE_FILE" >&2
    exit 1
  fi

  local backup
  backup=$(node -p "require('$STATE_FILE').backupPath")
  if [[ ! -d "$backup" ]]; then
    echo "Backup path does not exist: $backup" >&2
    exit 1
  fi

  local failed="${INSTALL_ROOT}.failed-$(date +%Y%m%d%H%M%S)"
  mv "$INSTALL_ROOT" "$failed"
  cp -R "$backup" "$INSTALL_ROOT"
  echo "Rollback complete: $INSTALL_ROOT"
  echo "Previous failed install moved to: $failed"
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  rollback
  exit 0
fi

if [[ "$FROM_BUCKET" -eq 1 ]]; then
  if [[ ! -d "$INSTALL_ROOT" ]]; then
    echo "Install root not found: $INSTALL_ROOT" >&2
    echo "Use scripts/install.sh --from-bucket for a fresh install instead." >&2
    exit 1
  fi

  # shellcheck source=scripts/s3-fetch.sh
  source "$(dirname "$0")/s3-fetch.sh"
  s3_load_env

  if [[ -z "$TARGET_VERSION" ]]; then
    TARGET_VERSION=$(s3_resolve_version "$CHANNEL")
  fi
  echo "Target version (channel=$CHANNEL): $TARGET_VERSION"

  INSTALL_STATE="$INSTALL_ROOT/.nuwax-agent/install-state.json"
  if [[ -f "$INSTALL_STATE" ]]; then
    CURRENT_VERSION=$(node -p "require('$INSTALL_STATE').version // 'unknown'")
    if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
      echo "Already at version $CURRENT_VERSION; nothing to do." >&2
      echo "Use --target-version to force a reinstall, or pass --channel beta to switch channels." >&2
      exit 0
    fi
    echo "Current version: $CURRENT_VERSION → $TARGET_VERSION"
  else
    echo "No install-state.json at $INSTALL_STATE; cannot compare versions." >&2
    echo "Use scripts/install.sh --from-bucket for a fresh install instead." >&2
    exit 1
  fi

  TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-upgrade-XXXXXX")
  trap 'rm -rf "$TMP_DIR"' EXIT

  # When the user passed --target-version explicitly, download that version
  # directly (skip channel resolution). Otherwise resolve via the channel.
  if [[ -n "${_EXPLICIT_TARGET_VERSION:-}" ]]; then
    ARTIFACT=$(s3_fetch_artifact_at_version "$TARGET_VERSION" "nuwax-zip" "$TMP_DIR")
  else
    ARTIFACT=$(s3_fetch_artifact "$CHANNEL" "nuwax-zip" "$TMP_DIR")
  fi
  echo "Downloaded: $ARTIFACT"
fi

if [[ -z "$ARTIFACT" ]]; then
  echo "--artifact is required unless --rollback or --from-bucket is used" >&2
  exit 1
fi

if [[ ! -d "$INSTALL_ROOT" ]]; then
  echo "Install root not found: $INSTALL_ROOT" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Artifact not found: $ARTIFACT" >&2
  exit 1
fi

BACKUP_ROOT="$(dirname "$INSTALL_ROOT")/.nuwax-agent-backups"
BACKUP_PATH="$BACKUP_ROOT/$(basename "$INSTALL_ROOT")-$(date +%Y%m%d%H%M%S)"
TMP_INSTALL="${INSTALL_ROOT}.next-$(date +%Y%m%d%H%M%S)"

mkdir -p "$BACKUP_ROOT"
cp -R "$INSTALL_ROOT" "$BACKUP_PATH"

bash "$(dirname "$0")/install.sh" --artifact "$ARTIFACT" --install-root "$TMP_INSTALL" --force

preserve_path() {
  local rel="$1"
  if [[ -e "$BACKUP_PATH/$rel" ]]; then
    rm -rf "$TMP_INSTALL/$rel"
    mkdir -p "$(dirname "$TMP_INSTALL/$rel")"
    cp -R "$BACKUP_PATH/$rel" "$TMP_INSTALL/$rel"
  fi
}

preserve_path ".env"
preserve_path "logs"
preserve_path "skills/platform"

if compgen -G "$BACKUP_PATH/config/*.local.json" > /dev/null; then
  mkdir -p "$TMP_INSTALL/config"
  cp "$BACKUP_PATH"/config/*.local.json "$TMP_INSTALL/config"/
fi

mkdir -p "$TMP_INSTALL/.nuwax-agent"
BACKUP_PATH="$BACKUP_PATH" ARTIFACT="$ARTIFACT" TMP_INSTALL="$TMP_INSTALL" node <<'NODE'
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(process.env.TMP_INSTALL, "package.json"), "utf8"));
const state = {
  schema: "nuwax.agent.upgrade-state.v1",
  packageName: pkg.name,
  version: pkg.version,
  artifact: path.basename(process.env.ARTIFACT),
  backupPath: process.env.BACKUP_PATH,
  upgradedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(process.env.TMP_INSTALL, ".nuwax-agent", "upgrade-state.json"), JSON.stringify(state, null, 2) + "\n");
NODE

OLD_PATH="${INSTALL_ROOT}.previous-$(date +%Y%m%d%H%M%S)"
mv "$INSTALL_ROOT" "$OLD_PATH"
mv "$TMP_INSTALL" "$INSTALL_ROOT"

echo "Upgrade complete: $INSTALL_ROOT"
echo "Backup: $BACKUP_PATH"
echo "Previous install moved to: $OLD_PATH"

