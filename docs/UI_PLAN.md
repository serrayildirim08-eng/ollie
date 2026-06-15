# Ollie UI Altitude Plan

Branch: `feat/ui-altitude` · başladı 2026-06-15
Kaynak: design-auditor incelemesi (desktop + mobile, `apps/native`).

## Amaç
Pahalı token temelini (`theme/tokens.ts`) ekranda görünür kılmak. Hiçbir faz
data modeline dokunmaz — sadece görünüş. Her faz tek başına merge edilebilir.

Sıra = en çok fark / en az iş önce.

---

## Faz 1 — Yazı ölçeğini aç *(motor)* — ✅
Text primitive token ölçeğinin sadece 5/8 sesini açıyordu. Göz 64→17 uçurumdan
zıplıyordu; ara basamak yoktu.

- [x] `Text` primitive 8 boy seçilebilir: hero(96)/display(64)/title(42)/heading(28)/lede(22)/body(17)/small(14)/caption(13)
- [x] `.display`'den zorla `text-align:center` kalktı (19 başlık artık sol-hizalı editorial)
- [x] Mevcut 5 kullanım (caption/body/display/heading/title) kırılmadı — 404 test yeşil, typecheck temiz

Dosya: `ui/Text.tsx`, `ui/Text.module.css` — DONE 2026-06-15

## Faz 2 — Basamakları ekranlara uygula + kimlik ver — ✅
Motor hazır; 22px ara basamağı gerçek hiyerarşiye konuldu + Home ile Box
yapısal olarak ayrıştı.

- [x] Goals bölüm başlıkları lede(22 serif) — 64→22→17 + serif/sans karşıtlığı
- [x] Goals göz testi: 3 net kademe (Goals 64 → bölüm 22 → satır 17)
- [x] Home = ortalı kapak (kicker yok), Goals = sol register (kicker + sol başlık) → yan yana farklı
- [x] Kicker+başlık iki farklı düzende (Home kapak / Box register)

Dosya: `dump/DumpScreen.tsx`, `modules/goals/GoalsBox.tsx` — DONE 2026-06-15

### Faz 2b — kalan box'lara desen yay — ✅ (8/12)
Goals deseni (lede 22 serif bölüm başlığı, kicker dokunulmadan) diğer box'lara
yayıldı. Sayfa kicker'ları her yerde korundu, 404 test yeşil, typecheck temiz.

- [x] admin / body / cycle / habits / mood / pets / sleep / work → çevrildi
- [ ] finance / grocery / medication / partner → ATLANDI (farklı yapı):
      finance=AreaCard span'leri, grocery=mode-view, medication=SectionLabel
      form-label'larla paylaşımlı, partner=pairing flow. Bunlar mekanik değil,
      tasarım kararı gerektiriyor → ileride tek tek elden geçer.

Dosya: 8× `*Box.tsx` — DONE 2026-06-16 · PR #40

Dosya: her `*Box.tsx` başlığı, `dump/DumpScreen.tsx`

## Faz 3 — "Okay!" selini kıs — ✅
Tam-ekran 2.4sn ack her dump'ta patlıyordu; `dump-ux-silent` kararıyla çelişiyordu.

- [x] Sıradan dump → input altında minik "okay" (1.6sn fade, ekran kaplamıyor)
- [x] Tam-ekran sel günde en fazla 1 kez — güne-ilk dump (`localStorage` tarih kapısı)
- [x] Yazmaya devam kesilmiyor (ikisi de pointer-events / non-blocking)

Dosya: `dump/DumpScreen.tsx`, `dump/DumpScreen.module.css` — DONE 2026-06-15
Not: "milestone'da da sel" tetikleyicisi şimdilik yok — sadece güne-ilk. İstenirse eklenir.

## Faz 4 — Mobil (iPhone) — ✅
Tip küçülmüyordu, alt menüde ikon yoktu, parmak hedefi < 44px'di.

- [x] Büyük başlıklar `clamp()` ile akışkan: display 36→64, hero 48→96, h1 30→42, h2 24→28 (üst sınır=masaüstü, masaüstü değişmez)
- [x] Alt menüde el-yapımı SVG ikon + label (yeni bağımlılık yok)
- [x] Her sekme hücresi tam tıklanabilir, ≥48px
- [x] body/caption/kicker sabit kaldı (küçük metin daha da küçülmesin)

Dosya: `theme/tokens.ts`, `navigation/TabBar.tsx` — DONE 2026-06-15
Not: typecheck + 404 test ile doğrulandı; canlı iPhone simülatör görsel kontrolü Serra'da.

## Faz 5 — Desktop (Mac) — ✅
220 rail + 720 ortalı kolon → geniş ekranda iki yan okyanus boşluk.

- [x] ≥1280px'de kolon ortada yüzmüyor: sol-çapa + editorial girinti (`clamp(40px,7vw,140px)`), sağ kenar bilinçli boşluk
- [x] Sidebar'da gerçek serif "Ollie" masthead (28px ink, soluk caption değil)
- [x] <1280px (laptop/mobil) ortalı kalıyor — responsive korundu
- [x] Reading kolonu 760'a sabit (ölçü bozulmadan)

Dosya: `navigation/Layout.tsx`, `navigation/TabBar.tsx` — DONE 2026-06-15
Not: tek başına büyük yeniden-yerleşim; canlı geniş-ekran görsel kontrolü Serra'da.

## Faz 6a — Hijyen (güvenli kısım) — ✅
- [x] Ölü `App.tsx`/`App.css` silindi (main.tsx Router'ı render ediyor, App'i değil) — 404 test yeşil, typecheck temiz

Dosya: `App.tsx` + `App.css` (silindi) — DONE 2026-06-15 · PR #40

### Faz 6b — dark mode + crisis token (AYRI PR) — ⬜
Riskli: inline `colors.*` (lightPalette JS alias) dark'ta dönmüyor; çok
bileşene dokunur. Crisis rengi de aynı konu (hardcode rgba). Ayrı PR'da.

- [ ] Inline `colors.*` → CSS-var / theme-aware (TabBar/Layout/GoalsBox/TodayNoticings/…)
- [ ] Dark mode açınca açık-renk parça kalmıyor
- [ ] Crisis rengi token'dan (hardcode rgba yok)

Dosya: inline `colors` kullanan tüm bileşenler, `theme/tokens.ts`, `dump/DumpScreen.tsx`

---

## v1'e GİRMEYECEKLER (scope freni)
- Yeni modül / yeni ekran
- Motion sistemi elden geçirme (Faz 3 hariç)
- Yeni font ailesi (DM üçlüsü kalıyor)
- Dark mode'u yeniden tasarlama (Faz 6 sadece kırığı onarır)
