#!/usr/bin/env bash
# Publish deepagents-app-py artifacts to S3/MinIO.
# Reads version from pyproject.toml and uploads everything in dist-packages/.
set -euo pipefail

cd "$(dirname "$0")/.."

AGENT_NAME="deepagents-app-py"
VERSION=$(grep '^version = "' pyproject.toml | head -1 | sed 's/^version = "\(.*\)"/\1/')
PREFIX="agent-engines/${AGENT_NAME}"
OUT_DIR="dist-packages"

# S3 config (required env vars)
: "${NUWAX_S3_ENDPOINT:?NUWAX_S3_ENDPOINT is required}"
: "${NUWAX_S3_REGION:?NUWAX_S3_REGION is required}"
: "${NUWAX_S3_BUCKET:?NUWAX_S3_BUCKET is required}"

S3_ARGS="--endpoint-url ${NUWAX_S3_ENDPOINT} --region ${NUWAX_S3_REGION}"

if [ -z "$VERSION" ]; then
  echo "ERROR: Could not read version from pyproject.toml" >&2
  exit 1
fi

# Determine channel
if [[ "$VERSION" =~ - ]]; then
  CHANNEL="beta"
else
  CHANNEL="stable"
fi

echo "Publishing ${AGENT_NAME} v${VERSION} to S3 (channel=${CHANNEL})"
echo "  Endpoint: ${NUWAX_S3_ENDPOINT}"
echo "  Bucket:   ${NUWAX_S3_BUCKET}"
echo "  Prefix:   ${PREFIX}"

# 1. Upload versioned artifacts
echo ""
echo "Uploading artifacts..."
aws s3 sync "$OUT_DIR" \
  "s3://${NUWAX_S3_BUCKET}/${PREFIX}/versions/${VERSION}/artifacts/" \
  ${S3_ARGS} \
  --exclude "*.version.json" \
  --exclude "*.platform.json" \
  --exclude "package-checksums.json"

# 2. Upload metadata
echo "Uploading metadata..."
for meta_file in "$OUT_DIR/${AGENT_NAME}-${VERSION}.version.json" \
                 "$OUT_DIR/${AGENT_NAME}-${VERSION}.platform.json" \
                 "$OUT_DIR/package-checksums.json"; do
  if [ -f "$meta_file" ]; then
    aws s3 cp "$meta_file" \
      "s3://${NUWAX_S3_BUCKET}/${PREFIX}/versions/${VERSION}/metadata/$(basename "$meta_file")" \
      ${S3_ARGS}
  fi
done

# 3. Upload manifests
echo "Uploading manifests..."
for manifest in agent-package.json template.manifest.json; do
  if [ -f "$manifest" ]; then
    aws s3 cp "$manifest" \
      "s3://${NUWAX_S3_BUCKET}/${PREFIX}/versions/${VERSION}/manifests/${manifest}" \
      ${S3_ARGS}
  fi
done

# 4. Update channel pointer
echo "Updating channel pointer (${CHANNEL})..."
cat <<EOF | aws s3 cp - \
  "s3://${NUWAX_S3_BUCKET}/${PREFIX}/channels/${CHANNEL}.json" \
  ${S3_ARGS} \
  --content-type "application/json" \
  --cache-control "public, max-age=60, must-revalidate"
{
  "schema": "nuwax.agent.channel.v1",
  "channel": "${CHANNEL}",
  "version": "${VERSION}",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifactsPrefix": "${PREFIX}/versions/${VERSION}/artifacts/"
}
EOF

# 5. Update latest.json (stable only)
if [ "$CHANNEL" = "stable" ]; then
  echo "Updating latest.json..."
  cat <<EOF | aws s3 cp - \
    "s3://${NUWAX_S3_BUCKET}/${PREFIX}/latest.json" \
    ${S3_ARGS} \
    --content-type "application/json" \
    --cache-control "public, max-age=60, must-revalidate"
{
  "schema": "nuwax.agent.latest.v1",
  "version": "${VERSION}",
  "channel": "stable",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "artifactsPrefix": "${PREFIX}/versions/${VERSION}/artifacts/"
}
EOF
fi

echo ""
echo "Publish complete: ${AGENT_NAME} v${VERSION} (${CHANNEL})"
