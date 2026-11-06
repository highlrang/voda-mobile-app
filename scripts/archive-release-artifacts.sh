#!/bin/sh
# Copies the R8 mapping and the JS source map of the last release build into
# release-artifacts/<versionName>-<versionCode>/, so stack traces from that
# version (Play vitals, /api/client-logs/app-error) can be de-obfuscated later.
# Run right after build:aab:prod (it does this itself). Usage:
#   sh scripts/archive-release-artifacts.sh [versionName versionCode]
set -e
cd "$(dirname "$0")/.."

GRADLE=android/app/build.gradle
NAME=${1:-$(sed -n 's/^ *versionName "\(.*\)"/\1/p' "$GRADLE")}
CODE=${2:-$(sed -n 's/^ *versionCode \([0-9]*\)/\1/p' "$GRADLE")}
DEST="release-artifacts/$NAME-$CODE"

mkdir -p "$DEST"
cp android/app/build/outputs/mapping/release/mapping.txt "$DEST/"
cp android/app/build/generated/sourcemaps/react/release/index.android.bundle.map "$DEST/"
echo "Archived to $DEST — back this folder up (it is gitignored)."
