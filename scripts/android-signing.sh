#!/usr/bin/env bash
# Projeye dokunmadan Android imzası + sürüm numarası + ultra-hızlı Gradle optimizasyonları enjekte eder.
# Keystore önceliği: ANDROID_KEYSTORE_<SLUG>_* (uygulamaya özel) → ANDROID_KEYSTORE_<GOOGLE_PROFILE>_* (hesaba özel) → ANDROID_KEYSTORE_* (ortak)
# env: SECRETS_JSON SLUG GOOGLE_PROFILE(ops.) BUILD_NUMBER VERSION
set -euo pipefail

s() { jq -r --arg k "$1" '.[$k] // empty' <<<"$SECRETS_JSON"; }
pick() {
  local v
  v="$(s "ANDROID_${1}_${SLUG}")"
  if [ -z "$v" ] && [ -n "${GOOGLE_PROFILE:-}" ]; then
    v="$(s "ANDROID_${1}_${GOOGLE_PROFILE}")"
  fi
  [ -z "$v" ] && v="$(s "ANDROID_${1}")"
  printf '%s' "$v"
}

KS_B64="$(pick KEYSTORE_BASE64)"
if [ -z "$KS_B64" ]; then echo "::error::ANDROID_KEYSTORE_BASE64 secret'ı yok. Masaüstü uygulamasından veya 'ship setup' ile ekleyin."; exit 1; fi
if [ -n "$(s "ANDROID_KEYSTORE_BASE64_${SLUG}")" ]; then
  echo "✔ Uygulamaya özel keystore ($SLUG)"
elif [ -n "${GOOGLE_PROFILE:-}" ] && [ -n "$(s "ANDROID_KEYSTORE_BASE64_${GOOGLE_PROFILE}")" ]; then
  echo "✔ Google profiline özel keystore ($GOOGLE_PROFILE)"
else
  echo "✔ Ortak keystore"
fi

KS="$RUNNER_TEMP/upload.jks"
echo "$KS_B64" | base64 --decode > "$KS"
STORE_PASS="$(pick KEYSTORE_PASSWORD)"; KEY_ALIAS="$(pick KEY_ALIAS)"; KEY_PASS="$(pick KEY_PASSWORD)"
[ -z "$KEY_PASS" ] && KEY_PASS="$STORE_PASS"

GH="${GRADLE_USER_HOME:-$HOME/.gradle}"
mkdir -p "$GH/init.d"
# Android Studio'nun "Generate Signed Bundle" mekanizması + Ultra-Hızlı CI Gradle Ayarları
cat >> "$GH/gradle.properties" <<EOF
android.injected.signing.store.file=$KS
android.injected.signing.store.password=$STORE_PASS
android.injected.signing.key.alias=$KEY_ALIAS
android.injected.signing.key.password=$KEY_PASS
org.gradle.jvmargs=-Xmx5g -XX:+UseParallelGC -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.workers.max=4
kotlin.incremental=true
kotlin.caching.enabled=true
android.enableJetifier=false
EOF

# versionCode her build'de artar + Lint/Test/Vital gibi yavaşlatıcı adımlar devre dışı bırakılır
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
  tasks.configureEach { task ->
    def n = task.name.toLowerCase()
    if (n.contains("lint") || n.contains("unittest") || n.contains("androidtest")) {
      task.enabled = false
    }
  }
}
EOF
echo "✔ İmza + Turbo Gradle + versionCode=$BUILD_NUMBER ${VERSION:+versionName=$VERSION} enjekte edildi"
