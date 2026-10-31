#!/usr/bin/env bash
# AAB üretir (Turbo CI optimizasyonlu); AAB yolunu ve paket adını $GITHUB_ENV'e yazar.
# env: TYPE APP_DIR ANDROID_DIR GRADLE_TASK BUILD_NUMBER VERSION
set -euo pipefail

if [ -n "${VERSION:-}" ] && [[ "$VERSION" == *"+"* ]]; then
  CUSTOM_BN="${VERSION#*+}"
  VERSION="${VERSION%%+*}"
  [ -n "$CUSTOM_BN" ] && BUILD_NUMBER="$CUSTOM_BN"
fi

if [ "$TYPE" = flutter ]; then
  cd "$APP_DIR"
  flutter build appbundle --release --build-number "$BUILD_NUMBER" ${VERSION:+--build-name "$VERSION"}
  SEARCH="$APP_DIR/build/app/outputs/bundle"
else
  cd "$ANDROID_DIR"
  chmod +x gradlew
  ./gradlew "${GRADLE_TASK:-bundleRelease}" \
    --build-cache \
    --parallel \
    --max-workers=4 \
    -x lint \
    -x lintVitalRelease \
    -x lintRelease \
    -x test \
    -Dorg.gradle.daemon=true \
    -Dkotlin.incremental=true
  SEARCH="$ANDROID_DIR"
fi

AAB="$(find "$SEARCH" -path '*outputs/bundle/*' -name '*.aab' -not -path '*intermediates*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
if [ -z "$AAB" ]; then echo "::error::AAB bulunamadı"; exit 1; fi

# Paket adını önce hızlıca build.gradle / AndroidManifest'ten oku, bulamazsa aapt2 / bundletool kullan
PACKAGE=""
if command -v aapt2 >/dev/null 2>&1; then
  PACKAGE="$(aapt2 dump packagename "$AAB" 2>/dev/null || true)"
fi
if [ -z "$PACKAGE" ] && [ -n "${ANDROID_HOME:-}" ]; then
  AAPT2_BIN="$(find "$ANDROID_HOME/build-tools" -name aapt2 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$AAPT2_BIN" ]; then
    # AAB bir zip olduğu için manifest veya gradle'dan da okuyabiliriz
    PACKAGE="$(grep -RhoE 'applicationId\s*[= ]\s*["'\'']([a-zA-Z0-9_.]+)["'\'']' "$ANDROID_DIR" 2>/dev/null | head -1 | sed -E 's/.*["'\'']([a-zA-Z0-9_.]+)["'\''].*/\1/' || true)"
  fi
fi
if [ -z "$PACKAGE" ]; then
  BT="$RUNNER_TEMP/bundletool.jar"
  [ -f "$BT" ] || curl -fsSL -o "$BT" https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar
  PACKAGE="$(java -jar "$BT" dump manifest --bundle "$AAB" --xpath /manifest/@package)"
fi

echo "✔ $AAB ($PACKAGE)"
{ echo "AAB=$AAB"; echo "PACKAGE_NAME=$PACKAGE"; } >> "$GITHUB_ENV"
