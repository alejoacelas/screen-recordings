#!/bin/zsh
# Builds "Screen Recordings.app" into build/. `./build.sh install` also copies it to /Applications.
set -euo pipefail
cd "$(dirname "$0")"

IDENTITY="Switcher Local Code Signing"
APP="build/Screen Recordings.app"

if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "Signing identity '$IDENTITY' not found. Screen Recording and Camera grants need a stable signature." >&2
  exit 1
fi

swift build -c release
mkdir -p "$APP/Contents/MacOS"
cp .build/release/ScreenRecordings "$APP/Contents/MacOS/ScreenRecordings"
cp Resources/Info.plist "$APP/Contents/Info.plist"
codesign --force --sign "$IDENTITY" --identifier com.alejoacelas.screenrecordings "$APP"
echo "Built $APP"

if [[ "${1:-}" == "install" ]]; then
  ditto "$APP" "/Applications/Screen Recordings.app"
  echo "Installed to /Applications/Screen Recordings.app"
fi
