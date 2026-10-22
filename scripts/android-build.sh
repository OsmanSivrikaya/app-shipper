#!/usr/bin/env bash
# AAB üretir; AAB yolunu ve paket adını $GITHUB_ENV'e yazar.
# env: TYPE APP_DIR ANDROID_DIR GRADLE_TASK BUILD_NUMBER VERSION
set -euo pipefail

if [ "$TYPE" = flutter ]; then
  cd "$APP_DIR"
  flutter build appbundle --release --build-number "$BUILD_NUMBER" ${VERSION:+--build-name "$VERSION"}
  SEARCH="$APP_DIR/build/app/outputs/bundle"
else
  cd "$ANDROID_DIR"
  chmod +x gradlew
  ./gradlew "${GRADLE_TASK:-bundleRelease}" --no-daemon --stacktrace
  SEARCH="$ANDROID_DIR"
fi

AAB="$(find "$SEARCH" -path '*outputs/bundle/*' -name '*.aab' -not -path '*intermediates*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
if [ -z "$AAB" ]; then echo "::error::AAB bulunamadı"; exit 1; fi

BT="$RUNNER_TEMP/bundletool.jar"
curl -fsSL -o "$BT" https://github.com/google/bundletool/releases/download/1.17.2/bundletool-all-1.17.2.jar
PACKAGE="$(java -jar "$BT" dump manifest --bundle "$AAB" --xpath /manifest/@package)"

echo "✔ $AAB ($PACKAGE)"
{ echo "AAB=$AAB"; echo "PACKAGE_NAME=$PACKAGE"; } >> "$GITHUB_ENV"
