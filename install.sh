#!/bin/bash
set -euo pipefail

REPO="Monet-AI-Editor/Monet"
APP_NAME="Monet.app"
INSTALL_DIR="/Applications"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  ASSET="Monet-macOS-arm64.zip"
else
  ASSET="Monet-macOS-x64.zip"
fi

echo "Fetching latest Monet release..."
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
ZIP_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
assets = data.get('assets', [])
match = next((a['browser_download_url'] for a in assets if a['name'] == '$ASSET'), None)
if not match:
    raise SystemExit('No asset named $ASSET found in the latest release.')
print(match)
")

VERSION=$(echo "$RELEASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
echo "Downloading Monet $VERSION ($ASSET)..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL --progress-bar -o "$TMP_DIR/Monet.zip" "$ZIP_URL"

echo "Installing to $INSTALL_DIR..."
rm -rf "$INSTALL_DIR/$APP_NAME"
ditto -x -k "$TMP_DIR/Monet.zip" "$TMP_DIR/extracted"
cp -R "$TMP_DIR/extracted/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

# Strip quarantine just in case (curl doesn't set it, but belt-and-suspenders)
xattr -cr "$INSTALL_DIR/$APP_NAME" 2>/dev/null || true

echo ""
echo "Monet $VERSION installed successfully."
echo "Launching Monet..."
open "$INSTALL_DIR/$APP_NAME"
