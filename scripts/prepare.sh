#!/usr/bin/env bash
# Bağımlılıkları kurar ve native projeyi build'e hazır hale getirir.
# usage: prepare.sh <android|ios>
# env: TYPE PM APP_DIR PREPARE_CMD BUILD_NUMBER VERSION SECRETS_JSON(ops.) SLUG(ops.)
set -euo pipefail
PLATFORM="$1"
cd "$APP_DIR"

# Proje .env'i: ENV_<SLUG> secret'ı varsa .env olarak yazılır (ör. ENV_TAHMIN_ET)
if [ -n "${SECRETS_JSON:-}" ] && [ -n "${SLUG:-}" ]; then
  ENV_CONTENT="$(jq -r --arg k "ENV_$SLUG" '.[$k] // empty' <<<"$SECRETS_JSON")"
  if [ -n "$ENV_CONTENT" ]; then printf '%s\n' "$ENV_CONTENT" > .env; echo "✔ .env yazıldı (ENV_$SLUG)"; fi
fi

install_js() {
  [ -f package.json ] || return 0
  case "$PM" in
    pnpm) corepack enable; pnpm install --frozen-lockfile ;;
    yarn) corepack enable; if [ -f .yarnrc.yml ]; then yarn install --immutable; else yarn install --frozen-lockfile; fi ;;
    bun)  npm i -g bun; bun install --frozen-lockfile ;;
    *)    if [ -f package-lock.json ]; then npm ci; else npm install; fi ;;
  esac
}
run() { if [ "$PM" = npm ]; then npm run "$@"; else "$PM" run "$@"; fi; }
x()   { if [ "$PM" = npm ]; then npx --yes "$@"; else "$PM" exec "$@"; fi; }

pods() {
  local dir="$1"
  [ -f "$dir/Podfile" ] || return 0
  ( cd "$dir"
    if [ -f Gemfile ]; then bundle install && bundle exec pod install; else pod install; fi )
}

case "$TYPE" in
  capacitor)
    install_js
    if [ -n "$PREPARE_CMD" ]; then bash -c "$PREPARE_CMD"; else run build; fi
    x cap sync "$PLATFORM"
    [ "$PLATFORM" = ios ] && pods ios/App
    ;;
  expo)
    install_js
    [ -n "$PREPARE_CMD" ] && bash -c "$PREPARE_CMD"
    if [ ! -d "$PLATFORM" ]; then x expo prebuild --platform "$PLATFORM" --no-install; fi
    [ "$PLATFORM" = ios ] && pods ios
    ;;
  react-native)
    install_js
    [ -n "$PREPARE_CMD" ] && bash -c "$PREPARE_CMD"
    [ "$PLATFORM" = ios ] && pods ios
    ;;
  flutter)
    flutter pub get
    [ -n "$PREPARE_CMD" ] && bash -c "$PREPARE_CMD"
    if [ "$PLATFORM" = ios ]; then
      flutter build ios --release --no-codesign --config-only --build-number "$BUILD_NUMBER" ${VERSION:+--build-name "$VERSION"}
      pods ios
    fi
    ;;
  native)
    install_js
    [ -n "$PREPARE_CMD" ] && bash -c "$PREPARE_CMD"
    [ "$PLATFORM" = ios ] && pods "${IOS_DIR:-ios}"
    ;;
esac
echo "✔ prepare ($TYPE / $PLATFORM) tamam"
