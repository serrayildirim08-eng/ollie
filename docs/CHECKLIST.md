# OLLIE CHECKLIST — tek kaynak (başlangıç: 2026-06-11)

> Nasıl kullanılır: Bu dosya Roomie'deki CHECKLIST.md ile aynı mantık — **tüm ilerleme burada**.
> ✅ = bitti (kanıtı görüldü) · 🔶 = yarım · ⬜ = başlanmadı
> Her maddenin **Kanıt:** satırı var — "bitti mi?" diye düşünme, kanıtı kontrol et.
> Sıra önemli: bir fazı bitirmeden sonrakine atlamak yok (ADHD freni).

**Hedef:** 2026-07-20 closed alpha. Bugünden ~5,5 hafta.

---

## FAZ 0 — Brain döngüsünü kapat (bu hafta, ~2-3 gün)

Amaç: "dump at → ertesi sabah home'da doğru şey görünüyor" döngüsü %100 çalışıyor ve kanıtlı.

- ✅ feat/brain main'e merge (Sprint 1-4: watch→select→speak→learn)
  Kanıt: merge commit `d6e0cb4`, 2026-06-09.
- ✅ **Milk-on-home doğrulaması** — Serra gerçek kullanımda doğruladı: "motor pretty much çalışıyor" (2026-06-11).
  Kanıt: Serra'nın canlı kullanımı; debug-logging fallback'ine gerek kalmadı.
- ✅ Brain AI-copy worker DEPLOY (A1, 2026-06-11). `/brain-copy` canlı: https://ollie-ai-proxy.ollieapp.workers.dev — Clerk JWT'li, gpt-oss-120b, client fallback'i load-bearing değil. Lokal smoke (süt noticing, 3 dil): TR "süt bir gündür eksik, alışveriş listesine ekleyeyim?" / EN / ES hepsi 200. Auth: token yok→401, bozuk→401 (canlı doğrulandı). Kod: workers/ai-proxy/src/router/brain-copy.ts.
  Kanıt: yukarıdaki canlı 401 + lokal AI çıktısı. + item-name çeviri kuralı (süt→milk/leche, marka korunur) eklendi, 3 dil doğrulandı, copy.test 14/14.
- ✅ **A2 deep links ÇALIŞIYOR (2026-06-11):** `ollie://dump`/`box/:id`/`todo` → in-app route, CİHAZDA doğrulandı (grocery + todo ekran geçişi gözlendi). tauri-plugin-deep-link, onOpenUrl(sıcak)+getCurrent(soğuk), action_url admin→todo work→box/work. Yol boyunca STALE-DIST bug bulundu+düzeltildi (tsc fail → tauri eski dist gömüyordu; RELEASE.md'ye yazıldı). resolveDeepLink 8/8 test.
  Kanıt: ekran görüntüsü (market sayfası) + todo geçişi.
- ✅ **A3 bildirim aksiyon butonları ÇALIŞIYOR (macOS native, 2026-06-11):** "Got it ✓ / Snooze 1h" butonları cihazda doğrulandı — tıklayınca `action: actionId=complete extra={module,refId}` JS'e ulaştı. tauri-plugin-notification macOS'ta butonları DESTEKLEMİYOR (mobile-only) → objc2 ile native yazıldı: UNNotificationCategory + UNUserNotificationCenterDelegate + userInfo, local_notifications.rs. iOS plugin yolu (onAction) da bağlı. **BONUS BUG FIX:** app localhost'tan servis edildiği için ACL custom komutları blokluyordu — "app kapalıyken hatırlatma" aylardır sessizce çalışmıyordu; olay-tabanlı yola (emit `ollie-schedule-notif`) geçirildi, artık gerçekten çalışıyor. routeNotificationAction 7/7 test. ⬜ kalan: APNs aps.category geçişi (server push butonları, NotificationSpec.notification_category alanı hazır).
  Kanıt: ekran görüntüsü (native butonlar + complete event).
- ✅ **A4 App Group ÇALIŞIYOR (2026-06-11):** `LA5J9BSPKL.group.app.ollie.ollie` entitlement imzada, konteyner oluştu (~/Library/Group Containers/...), Rust boot-probe yazdı. Kod: Entitlements.plist + src-tauri/src/group_container.rs. Olay-tabanlı yazma (`ollie-write-snapshot`).
  Kanıt: a4_probe.json dosyası + containermanagerd metadata (kendim doğruladım).
- ✅ **A7 snapshot köprüsü ÇALIŞIYOR (2026-06-11):** TodayNoticings → App Group'a snapshot.json yazıyor: picks (brain copy) + quietState + canned ASK (ay harcama, kiler 6-ürün, sonraki fatura). Widget/Siri'nin okuyacağı veri hazır. Kod: src/snapshot/writeSnapshot.ts.
  Kanıt: snapshot.json içeriği doğrulandı (kendim).
- ✅ **A6a DESIGN DOC + ONAY (2026-06-11):** docs/SERVER_APPLY_DESIGN_A6a.md onaylandı. Kararlar: D1=app-layer envelope (anahtar DB'de yok, rotation+access-log), D2=pilot grocery_pantry (cycle/mood device-only), D3=consent metni legal'de (A6b'yi bloklamaz, beta'dan önce shipped şart). EK: dump_inbox payload'u da envelope şifreli.
- ✅ **A6b CANLI + DEMO GEÇTİ (2026-06-12).** Migration uygulandı (dashboard SQL), ENVELOPE_KEK + SERVER_APPLY_ENABLED=1 canlı (ollie-ai-proxy). curl demosu uçtan uca: app-kapalı dump (süt+yumurta) → /apply-inbox applied:1 → /sync/grocery-pantry rows=[süt,yumurta] şifreli roundtrip. Yol-bug: A6b route'ları POST-only guard altındaydı→üstüne taşındı (commit gerek). FAZ A KAPANDI.
  Kod: envelope crypto 6/6 + writeInbox/applyInbox/pullGroceryPantry 3/3 test; workers/ai-proxy/src/crypto/envelope.ts + router/server-apply*.ts, apps/native/src/sync/groceryPull.ts (client pull, VITE_SERVER_APPLY flag — device tarafı henüz açılmadı). Risk-1 şartı: consent metni beta'dan önce shipped olmalı.
- ⬜ **A5 token→keychain:** Clerk JWT → App Group keychain (Siri extension okusun diye). RİSKLİ (keychain-access-groups entitlement + Security framework) VE tüketicisi B1'de (Siri) doğuyor → B1 ile birlikte yapılması öneriliyor. Mekanizma hazır, tek başına kanıtı sınırlı.
  Kanıt: shared keychain'den geçerli bearer okuyan stub.
- ⬜ **Karar (Serra):** Sprint 5/6 beta öncesi mi sonrası mı? → "sonra" dersen v1-dışı listesine taşı.
  Kanıt: bu satırda karar yazıyor.

**Faz 0 done-definition:** Temiz veriyle süt senaryosu installed app'te çalışıyor + main push'lanmış + Sprint 5/6 kararı yazılmış.

---

## FAZ 0.5 — Dağıtım: Ollie başka cihazlara kurulabilsin (YENİ, 2026-06-11 — asıl tıkanıklık bu çıktı)

Amaç: Serra'nın iPhone'u + arkadaşının iPhone/MacBook'una Ollie kurulabiliyor. Bu aynı zamanda Faz 4 beta dağıtım altyapısı — bir kez kurulur, sonra her güncelleme tek komut.

Ön-tespit (2026-06-11): Mac'te 2 geçerli sertifika VAR — "Apple Development" (3RU4L23K7C) + "Developer ID Application" (LA5J9BSPKL). Xcode 26.5, gen/apple projesi, bundle id `com.ollie.app` hazır. Eksik olan sadece paketleme/dağıtım adımları.

- 🔶 **Mac dağıtımı:** PAKET HAZIR (2026-06-11). Kök sebep: eski dmg'ler adhoc imzalıydı → Gatekeeper reddediyordu. Yeni paket: main'den (d6e0cb4, brain dahil) universal build, Developer ID imzalı, Apple notarize **Accepted** (submission 4e526a73), staple ✓, spctl "accepted" ✓. Konum: `~/Desktop/ollie/Ollie_0.1.0_universal_NOTARIZED.dmg`. Eski bozuk dmg'ler `ESKI-BOZUK-gonderme/` klasörüne karantinaya alındı. Reçete: docs/RELEASE.md.
  Kanıt için kalan TEK adım: Serra dmg'yi arkadaşına gönderir → arkadaşının MacBook'unda Ollie açılır, 1 dump atılır.
- 🔶 **TestFlight kurulumu — YAYINDA (2026-06-11):** Build 0.1.0 yüklendi, işlendi, iç gruba bağlandı (`IN_BETA_TESTING`). iOS bundle id = `app.ollie.ollie` (com.ollie.app küresel olarak başkasında — değişmez karar). Dağıtım sertifikası + App Store profili API'yle oluşturuldu; reçete docs/RELEASE.md'de. İç grup "Ollie test": serrayildirim08@gmail.com + acikbetul@icloud.com (ikisi de ACCEPTED, Mayıs'tan).
  Kanıt için kalan: 2 telefonda TestFlight'tan Ollie kurulu + 1'er dump.
- 🔶 Serra'nın iPhone'u: KABLODAN KURULDU (2026-06-11, dev-imzalı 1.1.0, devicectl) — TestFlight "not available" hatası verdiği için bypass. TestFlight şüphesi: WWDC sözleşme onayının geç sindirimi; yarın tekrar dene, olmazsa external link. Dev profil: "Ollie iOS Dev" (1 yıl).
  Kanıt: Ollie telefonda açılıyor + 1 dump. (Developer Mode istenebilir: Ayarlar→Gizlilik ve Güvenlik→Geliştirici Modu.)
- ⬜ iOS push notlari (ileride): apns-push worker'da `APPLE_BUNDLE_ID` env'i `app.ollie.ollie` yapılmalı (şu an muhtemelen com.ollie.app).
  Kanıt: worker env güncellenmiş + 1 test push.
- ⬜ Güncelleme reçetesi yaz: "yeni sürümü 2 cihaza nasıl gönderirim" — 5 satırlık komut listesi, docs/RELEASE.md.
  Kanıt: reçeteyle 1 güncelleme baştan sona gönderilmiş.

**Faz 0.5 done-definition:** 3 cihazda (arkadaş-iPhone, arkadaş-Mac, Serra-iPhone) Ollie çalışıyor + güncelleme reçetesi denenmiş. → Faz 1 dogfood artık 2 kişilik!

---

## FAZ 1 — 14 gün acımasız dogfood (Faz 0 biter bitmez)

Amaç: Beta'ya en net sinyal. Ollie'yi gerçek hayatında kullan; her sürtünmeyi logla. Kod yazmak yasak değil ama sadece dogfood'un çıkardığı bug'lar için.

- ⬜ Gün 1-14: her gün ≥1 gerçek dump, installed /Applications/Ollie.app üzerinden.
  Kanıt: DOGFOOD_LOG_*.md'de 14 tarihli satır.
- ⬜ Her sürtünme anında tek satır log: "ne yaptım / ne bekledim / ne oldu".
  Kanıt: log dosyasında ≥10 gerçek gözlem.
- ⬜ Haftada 1 triage (2 oturum): gözlemleri "fix şimdi / beta sonrası / asla" diye ayır.
  Kanıt: log'da 2 triage bölümü.
- ⬜ Dump latency P0: prompt diyeti (2800 token şişkin prompt). P1: optimistic UI ("okay!" anında).
  Kanıt: dump_roundtrip sayacı düşüşü + dump→ack hissi <2sn.
- ⬜ "Fix şimdi" listesi sıfırlanmış.
  Kanıt: triage bölümünde açık madde yok.

**Faz 1 done-definition:** 14 günlük log dolu + 2 triage yapılmış + "fix şimdi" listesi boş + dump hızı hedefte.

---

## FAZ 2 — UI sadeleştirme (Faz 1 ile son hafta paralel başlayabilir, ~2 hafta)

Amaç: "Olduğundan karmaşık" hissini öldürmek. Kural: **çıkarma-önce** — yeni ekran tasarlamak değil, ekran/element silmek. Sıfırdan full redesign DEĞİL (o beta feedback'inden sonra).

- ✅ Ekran envanteri (2026-06-11): 4 ana sekme + 13 modül kutusu, çöp/duplicate YOK. Obez 5 kutu: grocery 1349 satır (4 mod!), finance 1268, medication 1082, work 1005, goals 998.
  Kanıt: envanter raporu bu oturumda çıkarıldı; özet burada.
- ✅ **KARAR (Serra, 2026-06-11): TEK EKRAN navigasyonu.** Tab bar tamamen kalkar. Açılış = dump kutusu + brain'in ≤3 seçimi. Sağ üst: ⚙ ayarlar + ≡ Life (modül listesi). To-Do sekmesi erir (bugün listesi ≡ altında ilk satır).
  Kanıt: bu satır.
- ⬜ Tek-ekran shell'i koda dök: tab bar kaldır, ⚙ + ≡ ekle, To-Do'yu ≡ altına taşı.
  Kanıt: home ekran görüntüsü — tek odak, ≤3 öğe + dump kutusu.
- ⬜ Obez 5 kutuya "tek odak" rejimi (grocery 4 mod→1 + finance + medication + work + goals): birincil görünüm tek soru, gerisi katlanır.
  Kanıt: her kutu için "bu ekran tek şu işi yapar" cümlesi yazılabiliyor.
- ⬜ Onaylı tasarımları uygula: thin-spine desktop (design/desktop-2026-05-19) + clean-slate grocery (design/clean-slate-2026-05-31).
  Kanıt: 2 ekran kodda, mockup'la yan yana karşılaştırma.
- ⬜ Her kalan ekran "tek odak" testinden geçiyor (Serra minimal-UI kuralı).
  Kanıt: ekran başına 1 cümleyle "bu ekran tek şu işi yapar" yazılabiliyor.

**Faz 2 done-definition:** Ana nav ≤3 hedef + home ≤3 öğe + envanter tablosu dolu + 2 onaylı tasarım kodda.

---

## FAZ 3 — Beta kapıları (1 hafta, teknik temizlik)

Amaç: Yabancı birinin eline vermeden önce kapanması ŞART olanlar. Yeni özellik yok.

- ⬜ **Token rotasyonu:** Voyage + Gemini + CF API token (hepsi chat'e sızdı, beta gate olarak işaretliydi).
  Kanıt: eski token'lar revoke + yeni secret'lar deploy + smoke test.
- ⬜ Fake encryption UI kaldır (v1=alpha kararı, 2026-05-17).
  Kanıt: UI'da sahte şifreleme göstergesi yok, commit linki.
- ⬜ Invite cap blocker + funnel deploy (Faz 1 marketing funnel'dan kalan).
  Kanıt: invite akışı canlıda 1 kez baştan sona çalıştı.
- ⬜ Crisis system commit/deploy durumu netleşmiş (2026-05-19'da uncommitted'dı — hâlâ mı?).
  Kanıt: 3-dil crisis detection main'de + canlıda.
- ✅ iPhone gerçek cihaz → Faz 0.5'e taşındı (2026-06-11).
- ✅ **PR hijyeni TAMAM (2026-06-11):** 19 PR superseded olarak kapatıldı + PR #31 (kurtarma: thin-spine + clean-slate v1/v2 + handoff specs + garden spec, 142 dosya) main'e MERGED (43e3a59). Açık PR: 0. 3 bağımsız kör denetçiyle doğrulandı. Sigortalar: 19× `archive/2026-06-11/*` tag + `archive/thin-spine-shell-2026-05` + docs/PR_SHA_SNAPSHOT_2026-06-11.txt.
  Kanıt: `gh pr list` boş; design/clean-slate-* main'de.
- ⬜ Lokal branch temizliği (~25 yerel branch — hepsi artık etiketle güvende, silinebilir).
  Kanıt: `git branch` listesi ≤5 satır.

**Faz 3 done-definition:** 6 madde ✅ — özellikle token rotasyonu ve fake encryption olmadan davet YOK.

---

## FAZ 4 — Closed alpha (hedef: 2026-07-20)

- ⬜ 5-10 davetli seç (yakın çevre, ADHD'li öncelikli).
  Kanıt: isim listesi burada.
- ⬜ Davetler gitti, ≥5 kişi onboard oldu.
  Kanıt: funnel view'da 5 activation.
- ⬜ Haftalık feedback triage ritmi kuruldu (Faz 1'deki formatın aynısı, başkalarının verisiyle).
  Kanıt: ilk haftalık triage notu.

**Faz 4 done-definition:** 5 gerçek kullanıcı haftada ≥3 gün dump atıyor.

---

## V1'E GİRMEYENLER (dokunma listesi)

Yarı yolda bunlardan biri cazip gelirse: **buraya bak, "sonra" de, devam et.**

- Partner feature (14 karar kilitli — beta SONRASI)
- Care Circle (14 karar kilitli — beta SONRASI)
- Garden game (spec hazır — beta SONRASI)
- Sıfırdan full UI redesign (Faz 2 sadeleştirmedir, redesign değil)
- HealthKit (Apple setup bekliyor)
- Money-v2 kalan 2 madde (ai-proxy + auth)
- Yeni modül, yeni dil, yeni platform — HİÇBİRİ

---

*Güncelleme kuralı: bir madde bittiğinde ⬜→✅ yap ve Kanıt satırına tarih/commit ekle. Bu dosya güncel değilse hiçbir şey güncel değildir.*
