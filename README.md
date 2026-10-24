# app-shipper 🚀

Tek komutla (`ship`) herhangi bir mobil projeyi **TestFlight** ve **Google Play (internal)**'a derleyip yükler. Derleme GitHub Actions'ta yapılır: bilgisayarın kapalı olabilir, Expo/EAS kuyruğu yok.

Desteklenen proje tipleri: **Capacitor**, **Expo / React Native**, **Flutter**, **native Android & iOS**. Tip otomatik bulunur.

```
ship  →  GitHub Actions (app-shipper)  →  ┬─ Android: AAB derle → imzala → Google Play (internal)
                                          └─ iOS: archive → imzala → TestFlight
```

---

## 1. Kurulum (tek seferlik)

### Gereksinimler
- Node.js 20+, [GitHub CLI](https://cli.github.com) (`gh auth login` yapılmış olmalı)
- Apple Developer hesabı (App Store Connect API anahtarı) ve Google Play Console hesabı

### Adımlar

```bash
cd app-shipper
npm link            # `ship` komutunu terminale ekler
ship setup          # sihirbaz: repo + tüm secret'lar
ship doctor         # her şey yüklü mü? (eksikleri listeler)
```

`ship setup` sırasıyla şunları sorar ve **yalnızca** özel `app-shipper` reposunun GitHub Secrets alanına yükler:

| Ne | Nereden alınır |
|---|---|
| Apple **Key ID / Issuer ID / .p8** | appstoreconnect.apple.com → Users and Access → Integrations → Team Keys → `+` (rol: **Admin**) |
| Apple **Team ID** | developer.apple.com/account → Membership |
| **Google Play service account JSON** | aşağıya bak |
| GitHub **fine-grained token** | github.com/settings/personal-access-tokens/new → *All repositories*, Contents=Read, Actions=Read and write |

Dağıtım sertifikası (iOS) ve ortak Android upload keystore'u sihirbaz kendisi üretir.

### Google Play service account (en sık takılan yer)

1. [Google Cloud Console](https://console.cloud.google.com) → bir proje seç/oluştur → **Google Play Android Developer API**'yi etkinleştir.
2. IAM → **Service Accounts** → hesap oluştur → *Keys* → **Add key → JSON** (dosya iner).
3. [Play Console](https://play.google.com/console) → **Kullanıcılar ve izinler** → *Yeni kullanıcı davet et* → service account e-postasını ekle → uygulama için **Sürümleri yönet** (en azından Internal testing) yetkisi ver.
4. Anahtarı yükle:
   ```bash
   ship play ~/Downloads/anahtar.json
   ```
5. **Uygulama Play Console'da bir kez elle oluşturulmuş ve ilk AAB'si (internal testing) elle yüklenmiş olmalı.** API, hiç sürümü olmayan bir uygulamaya yükleme yapamaz.

> Android upload keystore'unu daha önce başka bir anahtarla Play'e yüklediysen (ör. eski CI), o anahtarı kullan: `ship keystore tahmin-et --jks anahtar.jks --alias upload --store-pass ŞİFRE`.

---

## 2. Kullanım

```bash
ship                                # bulunduğun klasördeki repo → iOS + Android
ship tahmin-et                      # OsmanSivrikaya/tahmin-et
ship tahmin-et ios                  # yalnız TestFlight
ship tahmin-et android              # yalnız Google Play
ship tahmin-et --version 1.2.0      # görünen sürüm (boşsa projedeki kalır)
ship tahmin-et --ref develop        # branch / tag / sha
ship tahmin-et android --track beta # internal (varsayılan) | alpha | beta | production
ship tahmin-et android --draft      # Play'de taslak bırak (elle yayınlarsın)
ship tahmin-et --no-watch           # tetikle ve çık
ship status                         # son 15 gönderim
ship doctor                         # eksik secret kontrolü
```

### Git tag ile otomatik gönderim

```bash
ship init tahmin-et                 # bir kez: repoya ship-on-tag.yml ekler
git tag v1.0.5 && git push --tags   # TestFlight + Google Play otomatik
```

### Projeye özel ayarlar

| Komut | Ne yapar |
|---|---|
| `ship keystore <repo> --jks … --alias … --store-pass …` | O uygulamaya özel upload keystore |
| `ship env <repo> .env.production` | Build sırasında `.env` olarak yazılacak değişkenler |
| `ship play <anahtar.json>` | Google Play service account anahtarını yükler/yeniler |

Otomatik tespit yanılırsa projenin köküne `ship.json` koy (hepsi opsiyonel):

```json
{ "appPath": "frontend", "prepare": "npm run build",
  "android": { "dir": "android", "task": "bundleRelease" },
  "ios": { "dir": "ios/App", "scheme": "App" } }
```

---

## 3. Build numarası ve sürüm

- **Build numarası elle artırılmaz.** Her gönderimde otomatik üretilir ve **hep artar**: `YYDDDHHMM` (UTC) biçiminde.
  Örnek: `262971512` = 2026 yılı, yılın 297. günü, 15:12. Hem Play `versionCode` (üst sınır ~2,1 milyar) hem iOS build numarası olarak kullanılır.
  Aynı dakikada iki kez gönderirsen ikincisi mağazada reddedilir, bir dakika bekle.
- **Sürüm adı** (`1.0`, `1.2.0`…) `--version` verilmezse projede yazan kalır. App Store'da aynı sürüm numarası yayınlandıysa yeni sürüm için `--version` ver.
- Daha önce başka bir yöntemle (ör. `github.run_number + 100`) çok daha küçük numaralar yüklendiyse sorun olmaz: yeni numara hep daha büyüktür.
- Mağazaya **eski formülle** (dakika sayısı, ör. `3583455`) bir build yüklendiyse o da yeni numaradan küçüktür, çakışma olmaz.

---

## 4. Hız

Tipik süre: Android ~3–4 dk, iOS ~5 dk (paralel çalışır, toplam ≈ yavaş olan).

- İki platform **aynı anda** derlenir.
- npm bağımlılıkları (`package-lock.json` varsa), Gradle ve SwiftPM paketleri **önbelleğe** alınır. İlk çalıştırma yavaştır, sonrakiler hızlıdır.
- Eksik secret **build'den önce** kontrol edilir: hata 4 dakika sonra değil saniyeler içinde görünür.
- Yalnız ihtiyacın olanı gönder: `ship tahmin-et ios` / `ship tahmin-et android`.

---

## 5. Sorun giderme

| Hata | Sebep ve çözüm |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON secret'ı yok` / `Could not parse service account json` | Play anahtarı yüklenmemiş: `ship play anahtar.json`, sonra `ship doctor` |
| Play: `The caller does not have permission` | Service account'a Play Console → Kullanıcılar ve izinler'den uygulama yetkisi ver |
| Play: `Package not found` / ilk yükleme hatası | Uygulamayı Play Console'da oluştur ve ilk AAB'yi bir kez elle yükle |
| Play: `Upload key mismatch` | Eskiden başka keystore ile yükledin: `ship keystore <repo> --jks …` |
| `versionCode already used` | Aynı dakikada ikinci gönderim; bir dakika sonra tekrar dene |
| iOS: `App Store Connect'te '…' uygulama kaydı yok` | appstoreconnect.apple.com → Apps → `+` ile uygulamayı bir kez oluştur |
| Kaynak repoya erişilemedi | `SOURCE_TOKEN` süresi dolmuş: yeni token ile `ship setup` |
| Log'da `***` görünüyor | GitHub gizli değerleri maskeler (ör. keystore alias'ı `upload` kelimesi); hata değildir |

Bir gönderimin hata logu: `gh run view <id> --repo OsmanSivrikaya/app-shipper --log-failed`.

---

## 6. Repo yapısı

```
bin/ship.mjs                 CLI (ship, setup, play, doctor, init, keystore, env, status)
.github/workflows/ship.yml   detect → android ‖ ios
scripts/detect.sh            proje tipi, klasörler, build numarası
scripts/prepare.sh           bağımlılık kurulumu + web build + cap sync
scripts/android-*.sh         imza + versionCode enjeksiyonu, AAB üretimi
scripts/ios-detect.sh        Xcode scheme / target tespiti
fastlane/Fastfile            Play yükleme, iOS imzalama + TestFlight
```
