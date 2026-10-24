#!/usr/bin/env bash
# Projeye dokunmadan Android imzası + sürüm numarası enjekte eder (~/.gradle üzerinden, her proje tipi için çalışır).
# Keystore önceliği: ANDROID_KEYSTORE_<SLUG>_* (uygulamaya özel) → ANDROID_KEYSTORE_* (ortak)
# env: SECRETS_JSON SLUG BUILD_NUMBER VERSION
set -euo pipefail

s() { jq -r --arg k "$1" '.[$k] // empty' <<<"$SECRETS_JSON"; }
pick() { local v; v="$(s "ANDROID_${1}_${SLUG}")"; [ -z "$v" ] && v="$(s "ANDROID_${1}")"; printf '%s' "$v"; }

KS_B64="$(pick KEYSTORE_BASE64)"
if [ -z "$KS_B64" ]; then echo "::error::ANDROID_KEYSTORE_BASE64 (veya ANDROID_KEYSTORE_BASE64_$SLUG) secret'ı yok. 'ship setup' çalıştır."; exit 1; fi
[ -n "$(s "ANDROID_KEYSTORE_BASE64_${SLUG}")" ] && echo "✔ Uygulamaya özel keystore ($SLUG)" || echo "✔ Ortak keystore"

KS="$RUNNER_TEMP/upload.jks"
echo "$KS_B64" | base64 --decode > "$KS"
STORE_PASS="$(pick KEYSTORE_PASSWORD)"; KEY_ALIAS="$(pick KEY_ALIAS)"; KEY_PASS="$(pick KEY_PASSWORD)"
[ -z "$KEY_PASS" ] && KEY_PASS="$STORE_PASS"

GH="${GRADLE_USER_HOME:-$HOME/.gradle}"
mkdir -p "$GH/init.d"
# Android Studio'nun "Generate Signed Bundle" mekanizması: build.gradle'daki signingConfig'i ezer
cat >> "$GH/gradle.properties" <<EOF
android.injected.signing.store.file=$KS
android.injected.signing.store.password=$STORE_PASS
android.injected.signing.key.alias=$KEY_ALIAS
android.injected.signing.key.password=$KEY_PASS
org.gradle.jvmargs=-Xmx4g -XX:+UseParallelGC
org.gradle.parallel=true
org.gradle.caching=true
EOF

# versionCode her build'de artar; versionName sadece --version verilirse değişir
cat > "$GH/init.d/shipper-version.gradle" <<'EOF'
def code = System.getenv('BUILD_NUMBER')
def name = System.getenv('VERSION')
allprojects {
  plugins.withId('com.android.application') {
    def ac = extensions.getByName('androidComponents')
    ac.onVariants(ac.selector().all(), { variant ->
      variant.outputs.each { out ->
        if (code) out.versionCode.set(code.toInteger())
        if (name) out.versionName.set(name)
      }
    })
  }
}
EOF
echo "✔ İmza + versionCode=$BUILD_NUMBER ${VERSION:+versionName=$VERSION} enjekte edildi"
