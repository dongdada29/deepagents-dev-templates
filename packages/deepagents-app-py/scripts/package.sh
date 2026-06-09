#!/usr/bin/env bash
# Package script for deepagents-app-py.
# Builds wheel + sdist, stages configs/prompts/skills/manifests,
# generates metadata (version, platform, checksums), and produces
# Nuwax tar.gz + zip archives.
set -euo pipefail

cd "$(dirname "$0")/.."

AGENT_NAME="deepagents-app-py"
VERSION=$(grep '^version = "' pyproject.toml | head -1 | sed 's/^version = "\(.*\)"/\1/')
OUT_DIR="dist-packages"
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-py-package-XXXXXX")

cleanup() { rm -rf "$STAGING_DIR"; }
trap cleanup EXIT

if [ -z "$VERSION" ]; then
  echo "ERROR: Could not read version from pyproject.toml" >&2
  exit 1
fi

echo "Packaging ${AGENT_NAME} v${VERSION}"

# 1. Build wheel + sdist
echo ""
echo "Building wheel + sdist..."
rm -rf "$OUT_DIR"
uv build --out-dir "$OUT_DIR"

# 2. Stage non-code assets into staging dir
echo ""
echo "Staging assets..."
STAGE_ROOT="$STAGING_DIR/${AGENT_NAME}-${VERSION}"
mkdir -p "$STAGE_ROOT"
rsync -a \
  --exclude ".git/" \
  --exclude ".github/" \
  --exclude "__pycache__/" \
  --exclude ".venv/" \
  --exclude "dist/" \
  --exclude "dist-packages/" \
  --exclude "node_modules/" \
  --exclude "*.pyc" \
  --exclude ".gitignore" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".DS_Store" \
  --exclude "uv.lock" \
  ./ "$STAGE_ROOT"/

# Copy built wheel/sdist into staging dist-packages
mkdir -p "$STAGE_ROOT/dist-packages"
cp "$OUT_DIR"/* "$STAGE_ROOT/dist-packages"/

# 3. Generate metadata
echo ""
echo "Generating metadata..."
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$STAGE_ROOT/.version.json" <<EOF
{
  "schema": "nuwax.agent.version.v1",
  "packageName": "${AGENT_NAME}",
  "agentName": "${AGENT_NAME}",
  "version": "${VERSION}",
  "generatedAt": "${GENERATED_AT}",
  "bundleStrategy": "python-wheel"
}
EOF

cat > "$STAGE_ROOT/.platform.json" <<EOF
{
  "schema": "nuwax.agent.platform.v1",
  "packageName": "${AGENT_NAME}",
  "agentName": "${AGENT_NAME}",
  "version": "${VERSION}",
  "entrypoints": {
    "server": "deepagents-app-py",
    "graph": "deepagents-app-py graph"
  },
  "dependencies": {
    "strategy": "python-wheel",
    "installCommand": "uv sync --group dev || pip install ."
  },
  "platforms": [
    { "os": "darwin", "arch": "arm64" },
    { "os": "darwin", "arch": "x64" },
    { "os": "linux", "arch": "x64" },
    { "os": "linux", "arch": "arm64" }
  ]
}
EOF

# 4. Build Nuwax archives
echo ""
echo "Creating Nuwax tar.gz..."
mkdir -p "$OUT_DIR"
tar -C "$STAGING_DIR" -czf "$OUT_DIR/${AGENT_NAME}-${VERSION}-nuwax.tar.gz" "${AGENT_NAME}-${VERSION}"

echo "Creating Nuwax zip..."
(cd "$STAGING_DIR" && zip -qr "$OLDPWD/$OUT_DIR/${AGENT_NAME}-${VERSION}-nuwax.zip" "${AGENT_NAME}-${VERSION}")

# 5. Generate checksums
echo ""
echo "Generating checksums..."
python3 - "$OUT_DIR" "$AGENT_NAME" "$VERSION" <<'PY'
import hashlib, json, os, sys

out_dir, agent_name, version = sys.argv[1], sys.argv[2], sys.argv[3]

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

artifacts = []
skip_prefixes = (".",)
for fname in sorted(os.listdir(out_dir)):
    fpath = os.path.join(out_dir, fname)
    if not os.path.isfile(fpath) or any(fname.startswith(p) for p in skip_prefixes):
        continue
    if fname == "package-checksums.json":
        continue
    if fname.endswith(".tar.gz"):
        atype = "nuwax-tar" if "-nuwax." in fname else "python-sdist"
    elif fname.endswith(".zip"):
        atype = "nuwax-zip" if "-nuwax." in fname else "unknown"
    elif fname.endswith(".whl"):
        atype = "python-wheel"
    else:
        continue
    artifacts.append({
        "file": fname,
        "type": atype,
        "sha256": sha256(fpath),
    })

checksums = {
    "schema": "nuwax.agent.package-checksums.v1",
    "packageName": agent_name,
    "version": version,
    "artifacts": artifacts,
}
with open(os.path.join(out_dir, "package-checksums.json"), "w") as f:
    json.dump(checksums, f, indent=2)
    f.write("\n")

# Copy metadata files to out_dir for easy upload
import shutil
for meta in [".version.json", ".platform.json"]:
    src = os.path.join(out_dir, "..", "staging_placeholder", meta)  # won't exist
for meta_src, meta_name in []:
    pass
# Just write the metadata directly
print(f"Wrote {len(artifacts)} artifact checksums")
PY

# Copy metadata to out_dir
cp "$STAGE_ROOT/.version.json" "$OUT_DIR/${AGENT_NAME}-${VERSION}.version.json"
cp "$STAGE_ROOT/.platform.json" "$OUT_DIR/${AGENT_NAME}-${VERSION}.platform.json"

echo ""
echo "Package artifacts:"
for f in "$OUT_DIR"/*; do
  shasum -a 256 "$f"
done

echo ""
echo "Done: ${AGENT_NAME} v${VERSION}"
