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

## Faz 2 — Basamakları ekranlara uygula + kimlik ver — ⬜
Motor hazır; şimdi 28/22 ara basamakları gerçek hiyerarşiye koy + her ekran
kicker+başlık = aynı şablon hissini kır.

- [ ] Bölüm başlıkları 64 değil 28(heading)/22(lede) kullanıyor
- [ ] Bir ekranda göz testi: 3 net kademe (büyük/orta/küçük)
- [ ] Home ile Goals yan yana "aynı şablon" demiyor
- [ ] En az 1 ekran ortalı-masthead'den çıktı
- [ ] Kicker+başlık kalıbı en az 2 farklı düzende

Dosya: her `*Box.tsx` başlığı, `dump/DumpScreen.tsx`

## Faz 3 — "Okay!" selini kıs — ⬜
Tam-ekran 2.4sn ack her dump'ta patlıyor; `dump-ux-silent` kararıyla çelişiyor.

- [ ] Sıradan dump → küçük inline "okay" (ekran kaplamıyor)
- [ ] Tam-ekran ack günde en fazla 1 kez (güne-ilk / milestone)
- [ ] Yazmaya devam kesilmiyor

Dosya: `dump/DumpScreen.tsx`, `dump/DumpScreen.module.css`

## Faz 4 — Mobil (iPhone) — ⬜
Tip küçülmüyor, alt menüde ikon yok, parmak hedefi < 44px.

- [ ] iPhone başlık tek/iki satır (3'e sarmıyor) — `clamp()`
- [ ] Alt menüde ikon + label
- [ ] Her sekme hücresi tıklanabilir, ≥48px
- [ ] 375px simülatörde taşma yok

Dosya: `theme/tokens.ts`, `navigation/TabBar.tsx`, `navigation/Layout.tsx`

## Faz 5 — Desktop (Mac) — ⬜
220 rail + 720 ortalı kolon → geniş ekranda iki yan okyanus boşluk.

- [ ] 1280px+ ekranda okyanus boşluk yok
- [ ] Sidebar'da gerçek "Ollie" masthead (soluk caption değil)
- [ ] Dar pencerede bozulmuyor (responsive korunur)

Dosya: `navigation/Layout.tsx`, `navigation/TabBar.tsx`

## Faz 6 — Hijyen + dark mode — ⬜
Ölü `App.tsx`; inline `colors.*` dark'ta dönmüyor; crisis rengi hardcode.

- [ ] `App.tsx`/`App.css` silindi, build yeşil
- [ ] Dark mode açınca açık-renk parça kalmıyor
- [ ] Hiçbir yerde hardcode renk yok (token'dan)

Dosya: `App.tsx` (sil), inline `colors` kullanan bileşenler, `theme/tokens.ts`

---

## v1'e GİRMEYECEKLER (scope freni)
- Yeni modül / yeni ekran
- Motion sistemi elden geçirme (Faz 3 hariç)
- Yeni font ailesi (DM üçlüsü kalıyor)
- Dark mode'u yeniden tasarlama (Faz 6 sadece kırığı onarır)
