#!/usr/bin/env bash
# Kaynak repoda mobil uygulamayı bulur ve tipini belirler.
# usage: detect.sh <checkout_dir> [app_path]   → $GITHUB_OUTPUT'a yazar
#
# Otomatik tespit yetmezse proje reposunun köküne ship.json koy (hepsi opsiyonel):
# { "appPath": "frontend", "prepare": "npm run build:mobile",
#   "android": { "dir": "android", "task": "bundleRelease" },
#   "ios": { "dir": "ios/App", "scheme": "App" } }
set -euo pipefail
cd "$1"
ROOT="$(pwd)"

cfg() { if [ -f "$ROOT/ship.json" ]; then jq -r "$1 // empty" "$ROOT/ship.json"; fi; }
REQ_PATH="${2:-}"; [ -z "$REQ_PATH" ] && REQ_PATH="$(cfg .appPath)"
CFG_ANDROID_DIR="$(cfg .android.dir)"; CFG_IOS_DIR="$(cfg .ios.dir)"

has_dep() { [ -f "$1/package.json" ] && jq -e --arg d "$2" '((.dependencies // {}) + (.devDependencies // {})) | has($d)' "$1/package.json" >/dev/null; }

type_of() {
  local d="$1"
  if [ -f "$d/pubspec.yaml" ] && grep -q 'sdk: *flutter' "$d/pubspec.yaml"; then echo flutter; return; fi
  if compgen -G "$d/capacitor.config.*" >/dev/null; then echo capacitor; return; fi
  if has_dep "$d" expo; then echo expo; return; fi
  if has_dep "$d" react-native; then echo react-native; return; fi
  if [ -f "$d/gradlew" ] || [ -f "$d/android/gradlew" ] || compgen -G "$d/*.xcodeproj" >/dev/null || compgen -G "$d/ios/*.xcodeproj" >/dev/null; then
    echo native; return
  fi
  echo ""
}

APP_DIR=""; TYPE=""
if [ -n "$REQ_PATH" ]; then
  APP_DIR="$REQ_PATH"; TYPE="$(type_of "$APP_DIR")"
else
  DIRS=". $(find . -mindepth 1 -maxdepth 3 -type d \
    -not -path '*/node_modules*' -not -path '*/.*' -not -path '*/Pods*' -not -path '*/build*' \
    -not -path '*/android*' -not -path '*/ios*' | sort)"
  # 1. tur framework projeleri (Flutter/Capacitor/Expo/RN), 2. tur saf native
  for d in $DIRS; do t="$(type_of "$d")"; if [ -n "$t" ] && [ "$t" != native ]; then APP_DIR="$d"; TYPE="$t"; break; fi; done
  if [ -z "$TYPE" ]; then
    for d in $DIRS; do t="$(type_of "$d")"; if [ "$t" = native ]; then APP_DIR="$d"; TYPE="$t"; break; fi; done
  fi
fi
if [ -z "$TYPE" ]; then
  echo "::error::Mobil uygulama bulunamadı. Proje köküne ship.json koyup appPath belirt."
  exit 1
fi
APP_DIR="${APP_DIR#./}"; [ -z "$APP_DIR" ] && APP_DIR=.
cd "$APP_DIR"

# ── platform klasörleri ──
ANDROID_DIR=android; IOS_DIR=ios
case "$TYPE" in
  capacitor) [ -d ios/App ] && IOS_DIR=ios/App ;;
  native)
    [ -f gradlew ] && ANDROID_DIR=.
    proj="$(find . -maxdepth 2 -name '*.xcodeproj' -not -path '*/Pods/*' | head -1)"
    [ -n "$proj" ] && IOS_DIR="$(dirname "$proj")" ;;
esac
[ -n "$CFG_ANDROID_DIR" ] && ANDROID_DIR="$CFG_ANDROID_DIR"
[ -n "$CFG_IOS_DIR" ] && IOS_DIR="$CFG_IOS_DIR"
IOS_DIR="${IOS_DIR#./}"; [ -z "$IOS_DIR" ] && IOS_DIR=.

HAS_ANDROID=false; HAS_IOS=false
case "$TYPE" in
  expo) HAS_ANDROID=true; HAS_IOS=true ;;                       # yoksa prebuild üretir
  flutter|capacitor) [ -d android ] && HAS_ANDROID=true; [ -d ios ] && HAS_IOS=true ;;
  *)
    [ -f "$ANDROID_DIR/gradlew" ] && HAS_ANDROID=true
    compgen -G "$IOS_DIR/*.xcodeproj" >/dev/null && HAS_IOS=true ;;
esac

# ── paket yöneticisi / node / java ──
PM=npm; NODE=""
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then PM=pnpm; elif [ -f yarn.lock ]; then PM=yarn; elif [ -f bun.lockb ] || [ -f bun.lock ]; then PM=bun; fi
  NODE=22
  [ -f .nvmrc ] && NODE="$(tr -d 'v \r\n' < .nvmrc)"
  [ -f .node-version ] && NODE="$(tr -d 'v \r\n' < .node-version)"
fi

# Gradle 8.5+ / AGP 8.x → JDK 21, daha eskisi 17
JAVA=17
WRAPPER="$ANDROID_DIR/gradle/wrapper/gradle-wrapper.properties"
if [ -f "$WRAPPER" ]; then
  GV="$(grep distributionUrl "$WRAPPER" | sed -E 's/.*gradle-([0-9]+)\.([0-9]+).*/\1 \2/')"
  GMAJ="${GV% *}"; GMIN="${GV#* }"
  if [ "${GMAJ:-0}" -gt 8 ] 2>/dev/null || { [ "${GMAJ:-0}" -eq 8 ] && [ "${GMIN:-0}" -ge 5 ]; } 2>/dev/null; then JAVA=21; fi
fi

# Her çalıştırmada artan build numarası (2020'den beri geçen dakika) → hiçbir projede elle artırmak gerekmez
BUILD_NUMBER=$(( ($(date -u +%s) - 1577836800) / 60 ))
SLUG="$(echo "${REPO:-app}" | sed 's#.*/##' | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9]/_/g')"

{
  echo "app_dir=$APP_DIR"
  echo "type=$TYPE"
  echo "pm=$PM"
  echo "node_version=$NODE"
  echo "java_version=$JAVA"
  echo "android_dir=$ANDROID_DIR"
  echo "ios_dir=$IOS_DIR"
  echo "has_android=$HAS_ANDROID"
  echo "has_ios=$HAS_IOS"
  echo "ios_scheme=$(cfg .ios.scheme)"
  echo "android_task=$(cfg .android.task)"
  echo "prepare_cmd=$(cfg .prepare)"
  echo "build_number=$BUILD_NUMBER"
  echo "slug=$SLUG"
} | tee -a "${GITHUB_OUTPUT:-/dev/null}"
