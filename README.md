# app-shipper 🚀

Merkezi mobil dağıtım merkezi. Expo Go / EAS kuyruklarına girmeden, herhangi bir projenizi **tek komutla** veya **git tag** ile doğrudan **Google Play** ve **TestFlight**'a derleyip yükler.

Desteklenen proje tipleri:
- **Capacitor**
- **Expo / React Native** (otomatik prebuild ile native derleme)
- **Flutter**
- **Native Android & iOS** (Gradle / Xcode)

---

## 1. Tek Seferlik Kurulum

Terminalden kurulum sihirbazını çalıştırın:
```powershell
ship setup
```
Bu komut sırasıyla:
1. `app-shipper` adında özel (private) bir GitHub reposu oluşturur.
2. Apple Developer / App Store Connect bilgilerinizi alıp dağıtım sertifikasını ve profilini otomatik üretir.
3. Android ortak imza anahtarını (keystore) otomatik oluşturur.
4. Google Play Service Account anahtarınızı alır.
5. Tüm bu gizli anahtarları yalnızca merkezi reponuzun GitHub Secrets alanına güvenle yükler.

---

## 2. Kullanım Şekilleri

### A) Terminalden Tek Komutla Gönderme
Herhangi bir projenin klasöründeyken veya repo adını belirterek:

```powershell
# İçinde bulunduğun repoyu hem iOS hem Android için mağazalara gönder
ship

# Belirli bir repoyu gönder
ship tahmin-et

# Sadece iOS (TestFlight) veya sadece Android (Google Play)
ship tahmin-et ios
ship tahmin-et android

# Özel sürüm veya branch belirterek
ship tahmin-et --version 1.2.0 --ref develop
```

### B) Git Tag ile Otomatik Gönderme (Butonsuz / Komutsuz)
Projelerinizde sadece `git tag` atarak otomatik gönderilmesini isterseniz:

```powershell
# İlgili projeye tek seferlik otomatik tetikleyiciyi ekler
ship init tahmin-et
```
Artık o projede:
```bash
git tag v1.0.5
git push --tags
```
yaptığınız an arka planda merkezi `app-shipper` devreye girer, derler ve TestFlight + Google Play'e yükler.

---

## 3. Ek Ayarlar (Opsiyonel)

- **Uygulamaya Özel Android Keystore:** Eğer bir uygulamanız önceden başka bir keystore ile Play Store'a yüklendiyse:
  ```powershell
  ship keystore tahmin-et --jks yol/dosya.jks --alias upload --store-pass sifre
  ```
- **Gizli `.env` Dosyası:** Uygulamanızın canlı ortam değişkenleri varsa:
  ```powershell
  ship env tahmin-et .env.production
  ```
- **Son Gönderim Durumları:**
  ```powershell
  ship status
  ```
