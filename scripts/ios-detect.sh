#!/usr/bin/env bash
# Xcode workspace/project, scheme ve imzalanacak target'ları (app + extension'lar) bulur → $GITHUB_ENV
# env: IOS_DIR IOS_SCHEME(ops.) VERSION(ops.)
set -euo pipefail
cd "$IOS_DIR"

WS="$(find . -maxdepth 1 -name '*.xcworkspace' -not -name 'project.xcworkspace' | head -1)"
PROJ="$(find . -maxdepth 1 -name '*.xcodeproj' | head -1)"
if [ -z "$PROJ" ]; then echo "::error::$IOS_DIR içinde .xcodeproj yok"; exit 1; fi
PROJ="$(pwd)/${PROJ#./}"
[ -n "$WS" ] && WS="$(pwd)/${WS#./}"
if [ -n "$WS" ]; then CONTAINER=(-workspace "$WS"); else CONTAINER=(-project "$PROJ"); fi
# SwiftPM paketleri her koşuda baştan indirilmesin: önbellekli ortak klasör (workflow'daki cache adımı)
SPM=()
if [ -n "${IOS_SPM_DIR:-}" ]; then mkdir -p "$IOS_SPM_DIR"; SPM=(-clonedSourcePackagesDirPath "$IOS_SPM_DIR"); fi

SCHEME="${IOS_SCHEME:-}"
if [ -z "$SCHEME" ]; then
  LIST="$(xcodebuild -list -json "${CONTAINER[@]}" "${SPM[@]}" 2>/dev/null)"
  BASE="$(basename "$PROJ" .xcodeproj)"
  # Önce .xcodeproj adıyla aynı scheme, yoksa Pods olmayan ilk scheme
  SCHEME="$(jq -r --arg b "$BASE" '(.workspace.schemes // .project.schemes) | (map(select(. == $b)) + map(select(test("^Pods") | not))) | .[0] // empty' <<<"$LIST")"
fi
[ -z "$SCHEME" ] && { echo "::error::Scheme bulunamadı (ship.json → ios.scheme)"; exit 1; }

SETTINGS="$(xcodebuild -showBuildSettings -json "${CONTAINER[@]}" "${SPM[@]}" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' 2>/dev/null)"
# Scheme yalnız ana target'ı listeleyebilir (Expo); gömülü extension'lar (widget, share…) projenin tüm target'larından
ALL="$(xcodebuild -showBuildSettings -json -project "$PROJ" "${SPM[@]}" -alltargets -configuration Release 2>/dev/null || echo '[]')"
SETTINGS="$(jq -s 'add' <<<"$SETTINGS$ALL")"
# İmzalanacak target'lar: .app + .appex (widget, notification extension…)
TARGETS="$(jq -c '[.[] | .buildSettings | select(.WRAPPER_EXTENSION == "app" or .WRAPPER_EXTENSION == "appex")
  | select(.PRODUCT_BUNDLE_IDENTIFIER != null) | {target: .TARGET_NAME, bundle: .PRODUCT_BUNDLE_IDENTIFIER, plist: (.INFOPLIST_FILE // ""), main: (.WRAPPER_EXTENSION == "app")}]
  | unique_by(.target)' <<<"$SETTINGS")"
BUNDLE_ID="$(jq -r 'map(select(.main))[0].bundle' <<<"$TARGETS")"
[ "$BUNDLE_ID" = null ] && { echo "::error::.app target bulunamadı"; exit 1; }

# Info.plist'te sabit yazılmış sürümleri build setting'e bağla (xcargs ile ezilebilsin)
PB=/usr/libexec/PlistBuddy
for PLIST in $(jq -r '.[].plist | select(. != "")' <<<"$TARGETS"); do
  [ -f "$PLIST" ] || continue
  CUR="$($PB -c 'Print :CFBundleVersion' "$PLIST" 2>/dev/null || true)"
  if [[ "$CUR" != *'$('* ]]; then $PB -c 'Set :CFBundleVersion $(CURRENT_PROJECT_VERSION)' "$PLIST" || true; fi
  if [ -n "${VERSION:-}" ]; then
    CUR="$($PB -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || true)"
    if [[ "$CUR" != *'$('* ]]; then $PB -c 'Set :CFBundleShortVersionString $(MARKETING_VERSION)' "$PLIST" || true; fi
  fi
done

echo "✔ scheme=$SCHEME bundle=$BUNDLE_ID ${WS:+workspace=$WS}"
echo "  targets: $TARGETS"
{
  echo "IOS_WORKSPACE=$WS"
  echo "IOS_PROJECT=$PROJ"
  echo "IOS_SCHEME=$SCHEME"
  echo "IOS_BUNDLE_ID=$BUNDLE_ID"
  echo "IOS_TARGETS_JSON=$TARGETS"
} >> "$GITHUB_ENV"
