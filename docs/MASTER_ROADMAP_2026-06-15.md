# Ollie — Master Yol Haritası (2026-06-15)

> **Bu dosya nedir:** Tek güncel ana plan. İki işi birleştirir:
> **(A) Launch hattı** = alpha'ya çıkmak için ne inşa edilecek (`docs/CHECKLIST.md`'den).
> **(B) Tamir hattı** = 2026-06-09 denetiminin bulduğu sorunlar (`docs/audit-2026-06-09/`'dan).
>
> İki hat **aynı anda** yürür. Aşağıdaki her fazda "ne ekliyoruz" + "ne tamir ediyoruz" yan yana.
>
> **Dil:** Açıklamalar sade (vibecoder için). Her satırda **`Dev:`** çıpası var → geliştirici arkadaşının takip edeceği teknik karşılık.
>
> **Doğruluk:** Her durum kanıta dayalı (commit / dosya). Uydurma yok. Bitince ⬜→✅ + kanıt yaz.

---

## 0. NEREDESİN (tek bakış)

- **Hedef:** 2026-07-20 closed alpha (kapalı, davetli test). Bugünden **~5 hafta**.
- **Motor çalışıyor:** dump at → ertesi sabah home'da doğru şey görünüyor (Faz 0 ✅, merge `d6e0cb4`).
- **En tehlikeli 10 hata kapandı** (6 düzeltildi, 1 yanlış alarmdı, **3 açık**).
- **Asıl tıkanıklık:** uygulamayı başka cihaza kurmak (Faz 0.5, yarım) + 14 günlük gerçek kullanım testi (Faz 1, başlamadı).
- **Senden bekleyen tek güvenlik kapısı:** kriz-kelime listesi onayı (#5) — alpha'dan önce şart.

---

## 1. İKİ HAT NASIL BİRLEŞİYOR

| | Launch hattı (A) | Tamir hattı (B) |
|---|---|---|
| Soru | "Ne inşa edip yayına çıkarayım?" | "Hangi bozukluğu düzelteyim?" |
| Kaynak | CHECKLIST.md (Faz 0→4) | Audit (264 kalan bulgu) |
| Kim sürer | Sen + dev arkadaş | Çoğu dev arkadaş |

**Mantık:** Tamir işlerini ayrı bir kuyruğa koyup unutmuyoruz. Her birini, en mantıklı launch fazının **içine** yerleştirdik. Örneğin güvenlik tamirleri = "yabancı eline vermeden hemen önce" (Faz 3).

---

## 2. MASTER TAKVİM (faz faz)

### FAZ 0 — Beyin döngüsü ✅ (neredeyse bitti)
**Sade:** "Not at, ertesi gün doğru şey karşına çıksın" motoru çalışıyor.
- ✅ Motor canlı + doğrulandı (`d6e0cb4`, 2026-06-11). `Dev:` feat/brain merged, brain-copy worker live.
- ⬜ **A5 token→keychain** — Siri'nin girişi okuyabilmesi için. `Dev:` Clerk JWT → App Group keychain; B1 (Siri) ile birlikte yap.
- ⬜ **KARAR (Serra):** Sprint 5/6 beta öncesi mi sonrası mı? → "sonra" dersen V1-dışı listesine.

### FAZ 0.5 — Dağıtım 🔶 (ASIL TIKANIKLIK — burada takılısın)
**Sade:** Ollie senin + arkadaşının telefon/Mac'ine kurulabilsin. Bir kez kurulur, sonra her güncelleme tek komut.
- 🔶 Mac paketi hazır (notarize ✓). Kalan: arkadaşın Mac'inde açılıp 1 dump. `Dev:` `~/Desktop/ollie/Ollie_0.1.0_universal_NOTARIZED.dmg`.
- 🔶 TestFlight yayında (build 0.1.0). Kalan: 2 telefonda kurulu + 1'er dump. `Dev:` iOS bundle `app.ollie.ollie`.
- 🔶 Serra iPhone: kablodan kuruldu. Kalan: TestFlight'tan tekrar dene.
- ⬜ iOS push: `apns-push` worker'da `APPLE_BUNDLE_ID=app.ollie.ollie` yap.
- ⬜ Güncelleme reçetesi (5 satır komut) yaz + 1 kez dene. `Dev:` docs/RELEASE.md.

**Done:** 3 cihazda Ollie çalışıyor + güncelleme reçetesi denenmiş.

### FAZ 1 — 14 gün acımasız dogfood ⬜
**Sade:** Ollie'yi gerçek hayatında kullan, her takıldığın yeri tek satır not et. Beta'ya en net sinyal bu.
- ⬜ 14 gün, her gün ≥1 gerçek dump. `Dev:` installed /Applications/Ollie.app.
- ⬜ Her sürtünme = tek satır log (ne yaptım/ne bekledim/ne oldu).
- ⬜ Haftada 1 triage: fix-şimdi / beta-sonrası / asla.
- ⬜ Dump hızı: P0 prompt diyeti (2800 token şişkin) + P1 anında "okay!". `Dev:` DUMP_LATENCY_ROADMAP_2026-06-07.md.
- 🔧 **TAMİR (B) — bu fazda fırsat buldukça:** veri-kaybı/yanlış-sonuç 🟠 bug'ları, çünkü dogfood bunları zaten yüzeye çıkarır:
  - `#70` uyku modülü yanlış alan okuyor (sessizce devre dışı). `Dev:` sleep orchestrator `debt_hours` vs `totalDeficitHours`.
  - `#71/#72` finance ayarları/vergi profili kayboluyor / hiç yazılmıyor.
  - `#56/#60` sync sırası bozulunca sessiz veri kaybı. `Dev:` enqueueUpsert + queue persist.
  - `#34` finance sync yarış durumu (eşzamanlı item kaybı).
  - `#64` cache her seferinde bozuluyor (createdAt düşüyor).

**Done:** 14 günlük log dolu + 2 triage + "fix şimdi" listesi boş + dump hızı hedefte.

### FAZ 2 — UI sadeleştirme ⬜ (Faz 1'in son haftasıyla paralel)
**Sade:** "Olduğundan karmaşık" hissini öldür. Kural: ekran SİL, yeni ekran çizme.
- ✅ KARAR: tek-ekran navigasyon (tab bar kalkar, ⚙ + ≡ Life).
- ⬜ Tek-ekran shell'i koda dök.
- ⬜ Obez 5 kutuya "tek odak" rejimi (grocery/finance/medication/work/goals).
- ⬜ Onaylı tasarımları uygula (thin-spine desktop + clean-slate grocery).

**Done:** Ana nav ≤3 hedef + home ≤3 öğe + 2 onaylı tasarım kodda.

### FAZ 3 — Beta kapıları ⬜ (yabancı eline vermeden ÖNCE — TAMİR HATTININ AĞIRLIK MERKEZİ)
**Sade:** Başkası kullanmadan kapanması ŞART olan güvenlik + temizlik. Yeni özellik yok.

**Launch (A) tarafı:**
- ⬜ Token rotasyonu: Voyage + Gemini + CF (hepsi chat'e sızdı). `Dev:` revoke + yeni secret + smoke.
- ⬜ Fake encryption UI kaldır (v1=alpha kararı).
- ⬜ Invite cap blocker + funnel deploy.
- ⬜ Crisis system commit/deploy durumu netleş.
- ⬜ Lokal branch temizliği (67 branch → ≤5). `Dev:` hepsi tag'le güvende.

**Tamir (B) tarafı — güvenlik 🟠, hepsi "yabancı girmeden önce":**
- 🔴 **`#5` KRİZ LEXİCON ONAYI (SADECE SERRA) — alpha-blocker.** Tehlike-kelime listesini onayla. `Dev:` `lexicon.{en,es,tr}.json` → `last_reviewed_by: @serra`.
- 🟠 `#43` STAGING_TEST_BEARER backdoor — Clerk'i atlayabilen yan kapı, prod kilidi yok. `Dev:` `env.ENVIRONMENT !== 'production'` guard.
- 🟠 `#44` ham kullanıcı girdisi log'a yazılıyor (PII sızıntısı). `Dev:` dump.ts:390 log'u metriğe çevir.
- 🟠 `#46/#47/#31` body/metin boyut limiti yok (DoS). `Dev:` request size + max length guard.
- 🟠 `#29/#30` JWT fallback issuer doğrulamasını atlıyor + spoof'lanabilir x-user-id.
- 🟠 `#75-82` Supabase: 4 tabloda GRANT eksik + 4 tabloda FORCE ROW LEVEL SECURITY yok.
- 🟠 `#11` CORS `*` — tüm worker endpoint'leri her origin'e açık.
- 🟠 `#6` Gemini key URL'de (log'a düşebilir). `Dev:` gemini.ts/feed-me.ts/vision.ts.
- 🟠 `#9` grocery_purchase_history `user_id uuid` ama Clerk text ID. `Dev:` kolon tipi vs gerçek ID.
- 🟠 `#90` Clerk paketi deprecated → `@clerk/react`.

**Done:** Yukarıdaki güvenlik listesinin hepsi ✅ + token rotasyonu + crisis canlıda + #5 onaylı.

### FAZ 4 — Closed alpha ⬜ (hedef 2026-07-20)
**Sade:** 5-10 davetli gerçek kişi Ollie'yi kullanıyor.
- ⬜ 5-10 davetli seç (ADHD'li öncelikli).
- ⬜ Davetler gitti, ≥5 onboard.
- ⬜ Haftalık feedback triage ritmi.

**Done:** 5 gerçek kullanıcı haftada ≥3 gün dump atıyor.

---

## 3. TAMİR HATTININ GERİ KALANI (alpha SONRASI kuyruk)

Bunlar alpha'yı bloke etmez — kullanıcı görmez, sadece kod sağlığı. Alpha'dan sonra, beta'ya doğru:
- **i18n (~10 bulgu):** hâlâ İngilizce-sabit metinler (MicButton, PhotoIntake, banner'lar). `Dev:` #20-23, #41, #92, #109.
- **Test boşlukları (~12):** AI cascade/segmentation/classifier/whisper testsiz. `Dev:` #24-27, #42, #88-89, #110-111.
- **Tip güvenliği (~10):** denetimsiz cast'ler + TS sürüm sapması. `Dev:` #13-15, #28, #91, #96-98, #106.
- **Performans/mimari:** N+1 sorgular (#83-85), dev fonksiyonlar (#62/#35/#36), kopya kod (#48/#49/#12).
- **205 düşük-güvenli (1/3) bulgu:** hepsi gerçek değil — örneklem usulü, beta hazırlığında elden geçir.

---

## 4. SENİ BEKLEYEN KARARLAR (sadece sen verebilirsin)

1. **#5 kriz lexicon onayı** — tehlike-kelime listelerini oku + onayla. *Alpha-blocker.* (3 dil: EN/ES/TR)
2. **Sprint 5/6** beyin işi — beta öncesi mi sonrası mı? "Sonra" = V1-dışı.
3. **TestFlight** mı kablo mu — dağıtımı hangisiyle kapatıyoruz (Faz 0.5).

---

## 5. DOKUNMA LİSTESİ (V1'e girmez — cazip gelirse "sonra" de)

Partner · Care Circle · Garden game · sıfırdan full redesign · HealthKit · Money-v2 kalan 2 madde · yeni modül/dil/platform.

---

## 6. SIRADAKİ 3 HAMLE (en düşük riskli sıra)

1. **Faz 0.5'i kapat** — arkadaşının cihazına Ollie kurulsun + güncelleme reçetesi denensin. *Neden önce:* Faz 1 dogfood'u 2 kişilik yapar, bütün sinyali açar. *Bitti =* 3 cihazda çalışıyor.
2. **#5 kriz lexicon'u onayla.** *Neden:* tek alpha-blocker ve sadece sen yapabilirsin; şimdi halledilirse Faz 3'te yol açılır. *Bitti =* 3 dosyada `@serra` damgası.
3. **Faz 1 dogfood'u başlat** (14 gün). *Neden:* gerçek bug listesi buradan çıkar; tamir hattının önceliğini bu belirler. *Bitti =* log dolu + ilk triage.

---

*Güncelleme kuralı: madde bitince ⬜→✅ + Kanıt (tarih/commit). Bu dosya güncel değilse hiçbir şey güncel değildir. Detay kaynaklar: `docs/CHECKLIST.md` (launch) · `docs/audit-2026-06-09/VERIFICATION_ROADMAP.md` (tamir).*
