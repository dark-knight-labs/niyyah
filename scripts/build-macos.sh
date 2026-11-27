#!/usr/bin/env bash
# Build "Niyyah Capture" (apps/menubar) on an Apple Silicon Mac. UNSIGNED: the bundle is only
# ad-hoc signed (no Developer ID, no notarisation), so macOS asks you to approve it on first
# launch; see apps/menubar/README.md. This script does not run on Linux.
set -euo pipefail

TARGET="aarch64-apple-darwin"
MIN_RUSTC="1.90.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/menubar"

die() { printf 'build-macos: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "run this on the Mac (this is $(uname -s))"
[ "$(uname -m)" = "arm64" ]  || die "expected an Apple Silicon Mac (arm64), got $(uname -m)"
command -v rustup >/dev/null || die "rustup is missing: install it from https://rustup.rs, then re-run"
xcode-select -p >/dev/null 2>&1 || die "Xcode command line tools are missing: run 'xcode-select --install', then re-run"

echo "==> Rust toolchain and target"
rustup update stable
rustup target add "$TARGET"
have="$(rustc --version | awk '{print $2}')"
[ "$(printf '%s\n%s\n' "$MIN_RUSTC" "$have" | sort -V | head -n1)" = "$MIN_RUSTC" ] \
  || die "rustc $have is older than $MIN_RUSTC (Tauri 2 needs it): run 'rustup update stable'"

echo "==> Tauri CLI"
cargo tauri --version >/dev/null 2>&1 || cargo install tauri-cli --version '^2' --locked

echo "==> Core tests (must pass before a build)"
( cd "$APP_DIR/core" && cargo test --locked )

echo "==> Build ($TARGET, release)"
( cd "$APP_DIR/src-tauri" && cargo tauri build --target "$TARGET" --bundles app,dmg )

BUNDLE="$APP_DIR/src-tauri/target/$TARGET/release/bundle"
APP="$(find "$BUNDLE/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
DMG="$(find "$BUNDLE/dmg" -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
[ -n "$APP" ] && [ -n "$DMG" ] || die "build finished but the .app or .dmg was not found under $BUNDLE"

echo
echo "App: $APP"
echo "DMG: $DMG"
echo "First launch: right-click the app, choose Open (see apps/menubar/README.md)."
