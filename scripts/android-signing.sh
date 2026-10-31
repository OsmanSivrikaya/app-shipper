#!/usr/bin/env bash
# Projeye dokunmadan Android imzası + sürüm numarası + ultra-hızlı Gradle optimizasyonları enjekte eder.
# Keystore önceliği: Uygulamaya özel → Google profiline özel → Ortak
set -euo pipefail

KS_B64="${KS_B64_APP:-${KS_B64_PROF:-${KS_B64_DEF:-}}}"
STORE_PASS="${KS_PASS_APP:-${KS_PASS_PROF:-${KS_PASS_DEF:-}}}"
KEY_ALIAS="${KS_ALIAS_APP:-${KS_ALIAS_PROF:-${KS_ALIAS_DEF:-}}}"
KEY_PASS="${KEY_PASS_APP:-${KEY_PASS_PROF:-${KEY_PASS_DEF:-}}}"

if [ -z "$KS_B64" ]; then
  echo "::error::ANDROID_KEYSTORE_BASE64 secret'ı yok. Masaüstü uygulamasından veya 'ship setup' ile ekleyin."
  exit 1
fi

if [ -n "${KS_B64_APP:-}" ]; then
  echo "✔ Uygulamaya özel keystore ($SLUG)"
elif [ -n "${KS_B64_PROF:-}" ]; then
  echo "✔ Google profiline özel keystore ($GOOGLE_PROFILE)"
else
  echo "✔ Ortak keystore"
fi

KS="$RUNNER_TEMP/upload.jks"
echo "$KS_B64" | base64 --decode > "$KS"
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
