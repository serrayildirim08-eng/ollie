# Ollie — Orphan Event Catalogue

**Tarih:** 2026-05-15
**Kapsam:** `@ollie/events` REGISTRY (192 kayıtlı event) vs. gerçek `emit` / `.on` çağrıları + cross-module router kuralları + telemetri.
**Yöntem:** Her iddia gerçek koda karşı doğrulandı. Test dosyalarındaki `emit`/`on` çağrıları SAYILMADI — yalnız üretim kodu.
**Bu bir KATALOG.** Hiçbir event düzeltilmedi — her biri bir ürün kararı (Serra verecek).

---

## Tüketici sayılan üç kanal

Bir event'in "tüketicisi var" sayılması için şunlardan biri olmalı:

1. **Doğrudan `.on('event', ...)`** — bir orchestrator / UI bileşeni statik string ile dinliyor.
2. **Dinamik `.on`** — bir `SOURCE_EVENTS` dizisi üyesi olarak dinleniyor:
   - `packages/orchestrator/src/burhan.ts` → `SOURCE_EVENTS` (11 event; bahçe-element kaynakları)
   - `packages/orchestrator/src/research.ts` → `RESEARCH_INTAKE_EVENT` (= `research:row_written`)
   - `packages/orchestrator/src/finance.ts` → `FINANCE_TAX_SETASIDE_DUE_EVENT` (= `finance:tax_setaside_due`, self-consumed)
3. **Cross-module router** — `packages/router/src/cross-module.ts` `CROSS_MODULE_RULES` (9 kural). Bir rule'un `source`'u olan event'in tüketicisi VAR sayılır.

Ayrıca **telemetri** event'leri ayrı bir kategori: kasıtlı olarak tüketicisiz yayınlanırlar (gözlemlenebilirlik / ileride Sentry-analytics tüneli). Bunlar "orphan" değil — niyetli.

---

## Özet sayılar

| Kategori | Sayı |
|---|---|
| REGISTRY toplam | 192 |
| Üretimde emit edilen benzersiz event | ~108 |
| Üretimde `.on` ile dinlenen / router-source / burhan-source | ~70 |
| **Gerçek orphan (üretimde emit, sıfır tüketici, telemetri DEĞİL)** | **28** |
| Telemetri (kasıtlı tüketicisiz) | 8 |
| Dead registry entry (hiç emit edilmiyor) | ~15 |

---

# BÖLÜM 1 — GERÇEK ORPHAN'LAR (28)

Her biri için: yayınlayan dosya · mantıklı bir tüketici ne yapardı · öneri.

## 1.1 — Modül-içi `*:pattern_detected` ailesi (6 orphan)

Altı modül kendi örüntü dedektöründen `pattern_detected` yayınlıyor ama hiçbiri dinlenmiyor. UI bu örüntüleri **kendisi yeniden hesaplayarak** telafi ediyor (audit'in "iç durum, kullanıcıyı etkilemiyor" notu). Yani event boşa gidiyor ama özellik çalışıyor.

| Event | Yayınlayan |
|---|---|
| `goals:pattern_detected` | `packages/orchestrator/src/goals.ts:202` |
| `sleep:pattern_detected` | `packages/orchestrator/src/sleep.ts:428` |
| `work:pattern_detected` | `packages/orchestrator/src/work.ts:174` |
| `finance:pattern_detected` | `packages/orchestrator/src/finance.ts:483` |
| `habits:pattern_detected` | `packages/orchestrator/src/habits.ts:147` |
| `grocery:pattern_detected` | `packages/orchestrator/src/grocery.ts:73` |

- **Mantıklı tüketici:** ortak bir "insights" / bildirim katmanı — örüntü tespit edildiğinde sessiz bir kart yüzeye çıkarır veya günlük bildirim bütçesine bir aday ekler. (Karşılaştır: `body:pattern_detected` GERÇEKTEN dinleniyor — `sleep.ts:562`. Ve `pattern:detected` (jenerik, `body-correlations.ts`) dinleniyor. Yani altyapı var, modül-spesifik olanlar bağlanmamış.)
- **Öneri:** **Dinleyici ekle** — tutarlılık için. Ya `body:pattern_detected`'i dinleyen mekanizmayı genelleştir, ya hepsini `pattern:detected`'e konsolide et. Düzeltme küçük ama bir ürün kararı: "fark ettim" örüntüleri bildirim üretmeli mi yoksa sadece UI'da mı kalmalı? Şu an UI-only çalışıyor, kopukluk kozmetik değil — bildirim fırsatı kaçıyor.

## 1.2 — Finance sinyal event'leri (5 orphan)

| Event | Yayınlayan | Mantıklı tüketici |
|---|---|---|
| `finance:adhd_tax_candidate_detected` | `finance.ts:814,835,857` | "bu bir ADHD-vergisi mi?" onay çipi; veya finance UI'da aday rozeti |
| `finance:savings_deposit_detected` | `finance.ts:750,776` | tasarruf hedefi ilerlemesini güncelle; bahçeye büyüme ver |
| `finance:savings_recorded` | `finance.ts:982` | tasarruf milestone kontrolü (`finance:savings_milestone` zaten dinleniyor) |
| `finance:recurring_candidate_detected` | `finance.ts` (recurring tarayıcı) | abonelik/fatura olarak sınıflandırma önerisi UI'da |
| `finance:record_added` | `finance.ts` | düşük seviye kayıt event'i — muhtemelen sadece downstream tetikleyici |

- **Öneri:** `finance:savings_deposit_detected` + `finance:adhd_tax_candidate_detected` için **dinleyici ekle** (gerçek ürün değeri: bahçe büyümesi + onay akışı). `finance:record_added` ve `finance:recurring_candidate_detected` muhtemelen iç sinyaller — eğer hiçbir downstream tasarımı yoksa **yayını sil** ya da en azından telemetri olarak işaretle. Serra karar versin: bu sinyaller bir ürün özelliğine bağlanacak mı?

## 1.3 — Finance impulse-pause event'leri (2 orphan)

| Event | Yayınlayan |
|---|---|
| `finance:impulse_pause_started` | `apps/web/src/modules/finance/FinanceModule.tsx:1386` |
| `finance:impulse_pause_resolved` | `apps/web/src/modules/finance/FinanceModule.tsx:1414` |

- Not: `finance:impulse_pause_summary` GERÇEKTEN dinleniyor — yani dürtü-duraklat akışının başı/sonu kopuk, sadece özeti bağlı.
- **Mantıklı tüketici:** retention/telemetri — kaç dürtü-duraklatma başladı vs. çözüldü (kullanıcı gerçekten satın almaktan vazgeçti mi?). Davranışsal sinyal değerli.
- **Öneri:** **Dinleyici ekle** — telemetri katmanına (session/retention) bağla. Bu metrik B2B pitch için anlamlı ("Ollie kullanıcısı dürtü harcamasını %X azalttı").

## 1.4 — Medication event'leri (3 orphan)

| Event | Yayınlayan |
|---|---|
| `medication:overdue_detected` | `packages/orchestrator/src/medication.ts:61` |
| `medication:adherence_drift` | `packages/orchestrator/src/medication.ts:73` |
| `medication:logged` | `apps/web/src/modules/medication/MedicationModule.tsx:80` |

- **Mantıklı tüketici:** `medication:overdue_detected` → bildirim zamanlayıcı (ilaç hatırlatması). `medication:adherence_drift` → sessiz "uyum düşüyor" kartı. `medication:logged` → bahçe büyümesi veya cross-modül (body/cycle korelasyonu).
- **Öneri:** **Dinleyici ekle** — özellikle `medication:overdue_detected` (ADHD'de ilaç kaçırma kritik bir kullanım senaryosu — bildirim olmadan değeri yarı yarıya). Diğer ikisi opsiyonel. Yüksek öncelikli ürün kararı.

## 1.5 — Pets event'leri (2 orphan)

| Event | Yayınlayan |
|---|---|
| `pets:guilt_copy_generated` | `packages/orchestrator/src/pets.ts:107` |
| `pets:health_flag_raised` | `packages/orchestrator/src/pets.ts:187` |

- Audit "Pets ⚠ akıllı paneller boş" diyor — bu iki orphan tam o boşluk.
- **Mantıklı tüketici:** `pets:health_flag_raised` → pets UI'da sağlık-bayrağı paneli + opsiyonel bildirim. `pets:guilt_copy_generated` → bakım-boşluğu kartında suçluluk-karşıtı kopya gösterimi.
- **Öneri:** **Dinleyici ekle** — pets modülünün "akıllı" kısmını canlandırmak için doğrudan bu iki event'in bağlanması gerekiyor. Ürün kararı: pets akıllı panelleri beta kapsamında mı?

## 1.6 — Admin event'i (1 orphan)

| Event | Yayınlayan |
|---|---|
| `admin:phone_task_detected` | `packages/orchestrator/src/admin.ts:145` |

- Audit "Admin ⚠ akıllı uyarılar ölü" — bu orphan o boşluğun parçası. (Karşılaştır: `admin:two_minute_tasks`, `admin:renewal_cue` vb. cross-module router veya `.on` ile bağlı.)
- **Mantıklı tüketici:** admin UI'da "telefonla halledilecek" görev kümeleme rozeti — ADHD'de telefon görevleri ayrı bir sürtünme sınıfı.
- **Öneri:** **Dinleyici ekle** veya admin akıllı uyarıları beta-sonrası ise **yayını sil**. Serra'nın admin modül kapsam kararına bağlı.

## 1.7 — Sleep event'leri (2 orphan)

| Event | Yayınlayan |
|---|---|
| `sleep:record_updated` | `packages/orchestrator/src/sleep.ts:224` |
| `sleep:wind_down_started` | `apps/web/src/modules/sleep/WindDownChecklist.tsx:279` |

- Not: `sleep:wind_down_completed` + `sleep:wind_down_skipped` + `sleep:wind_down_window` GERÇEKTEN dinleniyor — yatış-öncesi ritüelin başlangıcı kopuk, geri kalanı bağlı.
- `sleep:record_updated` audit'in "ritüel geri-besleme döngüsü kırık — yanlış kayıt anahtarına yazıyor" notuyla ilişkili olabilir.
- **Mantıklı tüketici:** `sleep:record_updated` → uyku-borcu / istatistik yeniden hesaplama tetikleyicisi (ya da telemetri). `sleep:wind_down_started` → telemetri (ritüel başlatma oranı).
- **Öneri:** `sleep:wind_down_started` → telemetri olarak işaretle ya da yayını sil (tek başına başlama event'inin ürün değeri düşük; tamamlanma/atlama zaten ölçülüyor). `sleep:record_updated` → Serra incelesin: gerçek bir downstream gerekiyorsa **dinleyici ekle**, yoksa **yayını sil**.

## 1.8 — Voice capture event'leri (3 orphan)

| Event | Yayınlayan |
|---|---|
| `voice:capture_started` | `apps/web/src/lib/voice-capture.ts:76` |
| `voice:capture_transcribed` | `apps/web/src/lib/voice-capture.ts:127,177` |
| `voice:capture_cancelled` | `apps/web/src/lib/voice-capture.ts:131,138` |

- Voice yakalama akışı transkripsiyon sonucu `MicButton` callback'i ile aktarılıyor (event yoluyla DEĞİL) — bu yüzden event'ler boşa gidiyor.
- **Mantıklı tüketici:** session telemetri — sesli giriş kullanımı oranı, transkripsiyon başarısızlık oranı (`capture_cancelled` reason payload'ı taşıyor). B2B/UX için değerli sinyal.
- **Öneri:** **Dinleyici ekle** — `sessionTracker`'a / telemetriye bağla. `voice:capture_cancelled`'ın `reason` alanı (`no-speech` vs. `error`) bir UX teşhis sinyali; şu an kayboluyor.

## 1.9 — Cycle tahmin event'leri (2 orphan)

| Event | Yayınlayan |
|---|---|
| `void:prediction:updated` | `packages/orchestrator/src/cycle.ts:297` |
| `void:flag:raised` | `packages/orchestrator/src/cycle.ts:309` |

- Cycle modülü `cycle.*` store anahtarlarını doğrudan okuyup tahminleri/klinik-bayrakları render ediyor — event'lere ihtiyaç duymuyor. Bu yüzden bu iki event vestijyal (eski `void:`-namespace döneminden kalma).
- **Mantıklı tüketici:** `void:flag:raised` → cross-modül "klinik bayrak" bildirimi olabilirdi; ama cycle UI zaten bayrakları gösteriyor.
- **Öneri:** **Yayını sil** — cycle UI store'dan okuyarak zaten çalışıyor; bu iki event eski mimariden kalan ölü kod. Düşük riskli silme.

## 1.10 — Grocery event'i (1 orphan)

| Event | Yayınlayan |
|---|---|
| `grocery:interest_capture_detected` | `packages/orchestrator/src/grocery.ts:91` |

- Audit "Grocery'nin arka plan örüntü motoru çalışıyor ama ürettiği olayları kimse dinlemiyor" — bu o event.
- Not: `habits:interest_capture_detected` (ayrı, farklı modül) cross-module router source'u — DİNLENİYOR. `grocery:` versiyonu dinlenmiyor.
- **Mantıklı tüketici:** "ilgi yakalama" örüntüsü — kullanıcı bir konuya takıldığında (ADHD ilgi-hijack) sessiz bir kart.
- **Öneri:** Serra karar versin — ya cross-module router'a `habits:interest_capture_detected` gibi bir kural ekle (**dinleyici ekle**), ya da grocery ilgi-yakalama bir özellik değilse **yayını sil**.

## 1.11 — Auth event'i (1 orphan)

| Event | Yayınlayan |
|---|---|
| `auth:signed_up` | `packages/auth/src/index.ts:343` |

- `auth:signed_in` + `auth:signed_out` GERÇEKTEN dinleniyor (`account-boot.ts` sync attach/detach). `auth:signed_up` dinlenmiyor.
- **Mantıklı tüketici:** retention/telemetri — yeni kayıt event'i (D0 funnel'ın başlangıcı). `void:retention:installed` zaten var ama o ilk-açılış; `signed_up` gerçek hesap-oluşturma anı.
- **Öneri:** **Dinleyici ekle** — telemetri/retention katmanına bağla (sign-up funnel ölçümü). Düşük riskli, yüksek değerli.

## 1.12 — Consent event'i (1 orphan)

| Event | Yayınlayan |
|---|---|
| `consent:set` | `apps/web/src/screens/onboarding/ConsentStep.tsx:294`, `apps/web/src/pages/SettingsScreen.tsx:1412` |

- ConsentStep'in kendi doc-yorumu "research-stream, sessionTracker subscriber'ları `consent:set`'i görür" diyor — ama HİÇBİR subscriber yok. Görev 1 (consent konsolidasyonu) sonrası consent state senkron olarak `@ollie/consent` `consent.state` satırından okunuyor; `consent:set` event'i artık tamamen gereksiz.
- **Mantıklı tüketici:** yoktu — bu event tasarım niyeti olarak vardı ama gerçeklenmedi. `consent-sync.ts`'in kendi yorumu da bunu açıkça söylüyor ("Why a separate sink — not just emit consent:set").
- **Öneri:** **Yayını sil** — Görev 1 sonrası consent durumu kanonik `consent.state` satırından senkron okunuyor; durable Supabase audit'i `configureConsent({ sync })` sink'i ile yapılıyor. `consent:set` event'i artık tamamen ölü. Düşük riskli silme. (Not: `consent_audit` Supabase loglaması `consent:set`'e BAĞLI DEĞİL — onu silmek loglamayı bozmaz.)

## 1.13 — Reminder event'i (1 orphan)

| Event | Yayınlayan |
|---|---|
| `void:reminder:fired` | `packages/router/src/scheduler.ts:43` |

- Zamanlayıcı bir hatırlatma tetiklendiğinde `void:reminder:fired` + `void:toast` yayınlıyor. `void:toast` GERÇEKTEN dinleniyor (`App.tsx` ToastHost köprüsü). `void:reminder:fired` dinlenmiyor.
- **Mantıklı tüketici:** telemetri (hatırlatma teslimat oranı) veya hatırlatma "atlandı/görüldü" durum takibi.
- **Öneri:** Kullanıcıya görünen davranış zaten `void:toast` ile sağlanıyor — `void:reminder:fired` salt-telemetri. **Dinleyici ekle** (telemetri) ya da değer düşükse **yayını sil**.

---

# BÖLÜM 2 — TELEMETRİ EVENT'LERİ (orphan DEĞİL — kasıtlı)

Bunlar gözlemlenebilirlik için yayınlanıyor; tüketicisiz olmaları niyetli (ileride Sentry-tüneli / analytics pipeline'ı bağlanacak). Katalogda **düzeltme gerektirmez** — ama "neden dinleyeni yok" sorusunun cevabı budur.

| Event | Yayınlayan | Niyet |
|---|---|---|
| `research:event_queued` | `research-stream/src/index.ts:182` | research-stream kuyruk gözlemlenebilirliği |
| `research:flush_succeeded` | `research-stream/src/index.ts:227` | research flush başarı sayacı |
| `research:flush_failed` | `research-stream/src/index.ts:230` | research flush hata sayacı |
| `void:retention:installed` | `apps/web/src/lib/retention.ts:75` | D0 retention markeri |
| `void:retention:session_started` | `apps/web/src/lib/retention.ts:86` | her oturum markeri |
| `sync:auth_expired` | `sync/src/index.ts:202`, `sync/src/finance.ts:366,391` | sync oturum-süresi-doldu sinyali |
| `sync:inbound_applied` / `sync:outbound_flushed` / `sync:finance_inbound_applied` / `sync:finance_outbound_flushed` | `sync/src/index.ts`, `sync/src/finance.ts` | sync gözlemlenebilirliği |
| `notifications:delivered` | `notifications/src/index.ts:229` | bildirim teslimat sayacı |

> Not: `void:retention:d1_returned` / `d7_returned` / `d30_returned` BUNLARDAN FARKLI — onlar GERÇEKTEN dinleniyor (retention izleme). Sadece `installed` + `session_started` tüketicisiz.
>
> **Öneri:** Bu kategoriyi düzeltme. İstenirse tek bir merkezi telemetri-subscriber'ı (Sentry-tüneli zaten deploy edilmiş — `project_ollie_workers_deployed`) bu event'leri tek noktadan toplayabilir. Bu bir gelecek-sprint kararı, orphan-temizliği değil.

---

# BÖLÜM 3 — DEAD REGISTRY ENTRY'LER (hiç emit edilmiyor)

REGISTRY'de tanımlı ama üretim kodunda **hiç emit edilmeyen** (bazıları sadece testte) event'ler. Bunlar "boşa giden olay" değil — hiç olay yok. Yine de registry'yi kirletiyorlar; konsolidasyon adayı.

| Event | Durum |
|---|---|
| `habits:drift` | sadece `burhan.test.ts`'te emit ediliyor; üretimde emit yok, dinleyici yok |
| `void:cycle:started` | sadece `events.test.ts`'te emit ediliyor; üretimde yok |
| `void:cycle:closed` / `void:cycle:asks_changed` / `void:cycle:symptom_logged` | emit yok |
| `void:episode:closed` / `void:episode:med_logged` / `void:episode:severity_logged` | emit yok |
| `void:inventory:refill` / `void:inventory:updated` | emit yok (eski inventory mimarisi) |
| `void:dump:receipt` | emit yok (`braindump:routed` ona devrolmuş olabilir) |
| `void:reminder:cancelled` / `void:reminder:dismissed` | emit yok |
| `notifications:suppressed` | emit yok |
| `astrology:transit_change` | emit yok (astroloji kasıtlı kapalı — audit ⛔) |
| `void:signals:updated` | emit yok |

- **Öneri:** Bunlar bir orphan-event sorunundan çok bir **registry-hijyen** sorunu. Serra'nın kararıyla tek seferde REGISTRY'den temizlenebilir (özellikle `void:`-namespace'li olanlar eski mimariden kalma). Düşük riskli ama ayrı bir görev — bu kataloğun ana konusu (yayınlanan ama dinlenmeyen) değiller.

---

# ÖNCELİKLENDİRİLMİŞ ÖZET (Serra için karar listesi)

**Yüksek değer — dinleyici ekle:**
- `medication:overdue_detected` — ilaç kaçırma bildirimi (ADHD kritik kullanım senaryosu)
- `pets:health_flag_raised` + `pets:guilt_copy_generated` — pets "akıllı panel" boşluğunu kapatır
- `finance:impulse_pause_started/resolved` — B2B pitch metriği (dürtü harcaması azaltma)
- `auth:signed_up` + `voice:capture_*` — funnel + UX telemetrisi
- `*:pattern_detected` (6 modül) — bildirim fırsatı; `body:pattern_detected` zaten örnek

**Düşük risk — yayını sil (ölü kod):**
- `consent:set` — Görev 1 sonrası tamamen gereksiz
- `void:prediction:updated` + `void:flag:raised` — cycle UI store'dan okuyor, vestijyal

**Serra incelesin (downstream tasarımı var mı?):**
- `finance:record_added`, `finance:recurring_candidate_detected`, `finance:savings_*`, `grocery:interest_capture_detected`, `admin:phone_task_detected`, `sleep:record_updated`, `sleep:wind_down_started`, `void:reminder:fired`

**Dokunma:** Bölüm 2 telemetri event'leri (8) — kasıtlı tüketicisiz.
