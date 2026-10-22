#!/usr/bin/env bash
# Build the LNF Run Log macOS app and a drag-to-install disk image.
# Runs on macOS only and needs the Xcode Command Line Tools (swiftc).
#
#   bash desktop/macos/build-macos.sh           # release build
#   bash desktop/macos/build-macos.sh --debug   # debug build: Web Inspector always on
#
# Writes build/macos/LNF Run Log.app and dist/LNF-Run-Log-<version>-macOS.dmg.
# Works with the bash 3.2 that ships with macOS. See docs/DESKTOP-MACOS.md.
set -euo pipefail

APP_NAME="LNF Run Log"
EXECUTABLE="LNFRunLog" # must match CFBundleExecutable in desktop/macos/Info.plist
MIN_MACOS="12"         # must match LSMinimumSystemVersion in desktop/macos/Info.plist

fail() {
  echo "error: $*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "build-macos.sh runs on macOS only."

case "${1:-}" in
  "") OPT_FLAGS=(-O) ;;
  --debug) OPT_FLAGS=(-Onone -g -D DEBUG) ;;
  *) fail "unknown option '$1' (use --debug, or nothing for a release build)" ;;
esac

if ! command -v swiftc >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "error: swiftc (the Swift compiler) was not found." >&2
  echo "Install the Xcode Command Line Tools, then run this script again:" >&2
  echo "    xcode-select --install" >&2
  exit 1
fi

# Work from the repository root, wherever the script was started from.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
ROOT="$(pwd)"
SRC="desktop/macos"
for f in app/index.html app/version.js LICENSE "$SRC/Info.plist" "$SRC/AppIcon-1024.png"; do
  [ -f "$f" ] || fail "$f is missing; run this script inside the LNF Run Log repository."
done

VERSION="$(sed -n "s/^export const APP_VERSION = '\([0-9][0-9.]*\)'.*/\1/p" app/version.js | head -n 1)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "could not read APP_VERSION (x.y.z) from app/version.js"
DMG_NAME="LNF-Run-Log-$VERSION-macOS.dmg"

# Build in a temporary folder outside the repository: sync clients such as
# Synology Drive or iCloud can add Finder attributes that make codesign fail.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lnf-runlog-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/$APP_NAME.app"
CONTENTS="$APP/Contents"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

echo "Building $APP_NAME $VERSION"
xcrun --sdk macosx swiftc --version

# 1. Compile for Apple silicon and for Intel, then join the two into one
#    universal binary.
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SOURCES=("$SRC"/*.swift)
for ARCH in arm64 x86_64; do
  echo "  compiling for $ARCH"
  xcrun --sdk macosx swiftc "${OPT_FLAGS[@]}" \
    -swift-version 5 \
    -parse-as-library \
    -module-name "$EXECUTABLE" \
    -target "$ARCH-apple-macos$MIN_MACOS" \
    -sdk "$SDK" \
    -framework AppKit -framework WebKit \
    -o "$WORK/$EXECUTABLE-$ARCH" \
    "${SOURCES[@]}"
done
lipo -create -output "$CONTENTS/MacOS/$EXECUTABLE" "$WORK/$EXECUTABLE-arm64" "$WORK/$EXECUTABLE-x86_64"

# 2. Bundle contents: Info.plist with the version, the web app, the licence.
echo "  assembling the app"
sed "s/__VERSION__/$VERSION/g" "$SRC/Info.plist" > "$CONTENTS/Info.plist"
plutil -lint "$CONTENTS/Info.plist" >/dev/null \
  || fail "the generated Info.plist is not valid; check it with: plutil -lint $SRC/Info.plist"
printf 'APPL????' > "$CONTENTS/PkgInfo"
ditto --norsrc --noextattr --noqtn app "$CONTENTS/Resources/app"
cp LICENSE "$CONTENTS/Resources/LICENSE.txt"

# 3. App icon: every size macOS asks for, made from the 1024 px master.
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  DOUBLE=$((SIZE * 2))
  sips -z "$SIZE" "$SIZE" "$SRC/AppIcon-1024.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
  sips -z "$DOUBLE" "$DOUBLE" "$SRC/AppIcon-1024.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/AppIcon.icns"

# 4. Sign ad hoc ("-"). Apple silicon runs only signed code; no certificate
#    is needed. Gatekeeper still warns about copies downloaded from the
#    internet (see docs/DESKTOP-MACOS.md).
echo "  signing (ad hoc)"
xattr -cr "$APP" 2>/dev/null || true # leftover Finder attributes make codesign fail
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

# 5. Disk image: the app, the licence and an /Applications link for
#    drag-to-install. hdiutil now and then reports "Resource busy", so it
#    gets three tries.
echo "  making the disk image"
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$APP_NAME.app"
cp LICENSE "$STAGE/LICENSE.txt"
ln -s /Applications "$STAGE/Applications"
for TRY in 1 2 3; do
  if hdiutil create -quiet -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$WORK/$DMG_NAME"; then
    break
  fi
  [ "$TRY" -lt 3 ] || fail "hdiutil could not create the disk image"
  echo "  hdiutil failed; trying again" >&2
  sleep 2
done

# 6. Copy the results into the repository.
BUILD="build/macos"
rm -rf "$BUILD"
mkdir -p "$BUILD" dist
ditto "$APP" "$BUILD/$APP_NAME.app"
cp "$WORK/$DMG_NAME" "dist/$DMG_NAME"

echo
echo "Done: $APP_NAME $VERSION"
lipo -info "$BUILD/$APP_NAME.app/Contents/MacOS/$EXECUTABLE"
echo "  App: $ROOT/$BUILD/$APP_NAME.app"
echo "  DMG: $ROOT/dist/$DMG_NAME"
echo "Open the DMG and drag LNF Run Log to Applications. See docs/DESKTOP-MACOS.md."
