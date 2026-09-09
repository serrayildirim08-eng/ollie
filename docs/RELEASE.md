# RELEASE — Ollie'yi başka cihazlara gönderme reçetesi

> Neden gerekli: Apple cihazları imzasız uygulamayı reddeder ("bozuk/açılamıyor" derler).
> Kendi Mac'inde çalışması yanıltıcıdır — o, kendi pişirdiğini yiyor.
> Geçmiş ders (2026-06-11): Masaüstündeki eski dmg'ler adhoc imzalıydı; arkadaşın o yüzden kuramadı.

## Gereksinimler (hepsi hazır, bir daha kurmana gerek yok)
- Sertifika: `Developer ID Application: Serra Yildirim (LA5J9BSPKL)` — Mac keychain'de
- Notarization profili: `ollie-notary` — keychain'de kayıtlı (2026-05-29'dan beri çalışıyor)

## macOS sürümü göndermek (3 komut)

```bash
# 1) İmzalı universal build (Intel + M-çipi; ~10-20 dk)
cd ~/ollie
APPLE_SIGNING_IDENTITY="Developer ID Application: Serra Yildirim (LA5J9BSPKL)" \
  pnpm --filter native tauri build --target universal-apple-darwin

# 2) Apple onayı (notarize, ~5-15 dk) — dmg yolu build çıktısında yazar
DMG=apps/native/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Ollie_0.1.0_universal.dmg
xcrun notarytool submit "$DMG" --keychain-profile ollie-notary --wait

# 3) Onay damgası + kontrol
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"   # "accepted" demeli
```

Sonra dmg'yi gönder (AirDrop/Drive). Karşı taraf: çift tık → Applications'a sürükle. O kadar.

**Kontrol listesi — göndermeden önce:**
- [ ] `spctl` çıktısı "accepted" dedi
- [ ] dmg adında doğru sürüm numarası var (tauri.conf.json `version` alanından gelir — yeni sürümde artır!)

## iOS sürümü göndermek (TestFlight) — kuruldu 2026-06-11

Tek seferlik kurulum TAMAM: ASC API anahtarı (`~/.appstoreconnect/private_keys/AuthKey_6KWAP28F37.p8`, Issuer `ee904d1d-b989-4e5f-9966-af073f0d65e5`), Apple Distribution sertifikası (keychain'de), "Ollie iOS App Store" profili (kurulu), iOS bundle id `app.ollie.ollie` (com.ollie.app başkasında — bu kimlik İOS'ta kalıcı).

```bash
# 1) Sürüm numarasını artır: tauri.conf.json "version" alanı
# 2) Build + IPA (~10-20 dk; imza Manual, project.yml'de gömülü)
cd ~/ollie/apps/native
pnpm exec tauri ios build --export-method app-store-connect --ci

# 3) Yükle
xcrun altool --upload-app -f src-tauri/gen/apple/build/arm64/Ollie.ipa -t ios \
  --apiKey 6KWAP28F37 --apiIssuer ee904d1d-b989-4e5f-9966-af073f0d65e5

# 4) İşlenince (5-15 dk): şifreleme beyanı + iç gruba bağla (script: /tmp/ascapi.mjs benzeri,
#    ya da App Store Connect web → TestFlight → build → "Ollie test" grubuna ekle)
```

İç grup "Ollie test" (074d719f-…): Serra + acikbetul@icloud.com. Gruba bağlanan her build ikisine anında bildirimle gider — review yok, bekleme yok.

**⚠️ ACL/REMOTE-IPC TUZAĞI (2026-06-11):** App, localhost:9527 üzerinden servis edildiği için (Clerk gereği) webview "remote" sayılır ve Tauri ACL, kendi tanımladığımız app komutlarını (`schedule_local_notification`, `calendar_*` vb.) `invoke()` ile çağrılınca BLOKLAR ("not allowed by ACL"). Bu yüzden app-kapalı hatırlatmalar aylardır sessizce çalışmıyordu (scheduleAt try/catch → setTimeout fallback'e düşüyordu). Çözüm: app komutu yerine OLAY kullan — JS `emit('ollie-schedule-notif', payload)`, Rust setup'ta `app.listen` ile yakalar. Olaylar `core:event:default` ile serbest, ACL'e takılmaz. Yeni app komutu eklerken bunu hatırla: webview'den çağrılacaksa ya capability'e ekle ya event'e çevir.

**⚠️ STALE-DIST TUZAĞI (2026-06-11, saatler yedi):** `tauri build`'in `beforeBuildCommand`'i `pnpm build` = `tsc && vite build`. **tsc HER HANGİ bir hata verirse** (örn. JSX'i `.ts` dosyasına yazmak) `pnpm build` çöker AMA `tauri build` yine de devam edip **eski `dist/`'i gömer** — sessizce. Belirti: kod değiştiriyorsun ama uygulamada hiçbir şey değişmiyor, `dist/index.html`'deki `index-XXXX.js` hash'i sabit kalıyor.
- Kontrol: build sonrası `grep index- apps/native/dist/index.html` — hash DEĞİŞMELİ. Değişmediyse `cd apps/native && pnpm build` çalıştır, tsc hatasını gör.
- Ayrıca WKWebView localhost:9527 asset'lerini cache'ler. Yeni build görünmüyorsa: `rm -rf ~/Library/Caches/com.ollie.app/WebKit/NetworkCache ~/Library/WebKit/com.ollie.app/WebsiteData/NetworkCache` (login = LocalStorage, dokunma).
- Release build'de devtools yok → görünür debug için geçici bir köşe-overlay bileşeni en hızlı teşhis (dosya-log invoke'a bağımlı, o da patlayabilir).

**iOS tuzakları:**
- Build'i gruba bağlarken `POST /v1/betaGroups/{grupId}/relationships/builds` kullan (builds→betaGroups yönü 204 dönüp SESSİZCE hiçbir şey yapmıyor). Bağladıktan sonra `GET .../betaGroups/{id}/builds` ile DOĞRULA.
- Xcode'a Apple hesabı GİRİLİ DEĞİL ve gerekmiyor — her şey API anahtarıyla dönüyor. "No Accounts" hatası görürsen API-key bayraklı manuel export kullan (bkz. git log 2026-06-11).
- `gen/apple/Externals` altında debug+release libapp.a aynı anda kalırsa "Multiple commands produce" hatası → debug'ı sil.
- İlk yüklemeden sonra build numarası (CFBundleVersion) her yüklemede artmalı, yoksa Apple reddeder.
- iOS push açılırken: apns-push worker `APPLE_BUNDLE_ID` = `app.ollie.ollie` olmalı.

## Bilinen tuzaklar
- "Works on my Mac" ≠ imzalı. Kontrol: `codesign -dv /path/Ollie.app` → `Signature=adhoc` görürsen O PAKETİ GÖNDERME.
- Notarize edilen dosya ile gönderilen dosya AYNI dosya olmalı (zip'i notarize edip dmg göndermek olmaz — 2026-05-29'da olan buydu büyük ihtimalle).
- `/Applications/Ollie.app` tek kopya kalsın; build klasörü kopyalarını `.bak` yap (instance çakışması).
