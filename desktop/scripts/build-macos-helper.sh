#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_FILE="${DESKTOP_DIR}/macos-helper/screencapture_audio.swift"
BIN_DIR="${DESKTOP_DIR}/src-tauri/binaries"

mkdir -p "${BIN_DIR}"

ARCH="$(uname -m)"
if [ "${ARCH}" = "arm64" ] || [ "${ARCH}" = "aarch64" ]; then
  TARGET_TRIPLE="aarch64-apple-darwin"
  SWIFT_TARGET="arm64-apple-macos13.0"
else
  TARGET_TRIPLE="x86_64-apple-darwin"
  SWIFT_TARGET="x86_64-apple-macos13.0"
fi

OUT_BIN="${BIN_DIR}/auralis-macos-audio-${TARGET_TRIPLE}"

echo "Compiling macOS ScreenCaptureKit helper for ${TARGET_TRIPLE}..."
/usr/bin/swiftc \
  -O \
  -parse-as-library \
  -target "${SWIFT_TARGET}" \
  -framework ScreenCaptureKit \
  -framework CoreMedia \
  -framework AVFoundation \
  -framework Foundation \
  "${SRC_FILE}" \
  -o "${OUT_BIN}"

chmod +x "${OUT_BIN}"

# Also keep a generic copy for direct lookup if needed
cp -f "${OUT_BIN}" "${BIN_DIR}/auralis-macos-audio"
chmod +x "${BIN_DIR}/auralis-macos-audio"

echo "Built helper binary at: ${OUT_BIN}"
