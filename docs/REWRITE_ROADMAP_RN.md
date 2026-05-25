# Ollie React Native Rewrite — Roadmap

**Branch:** `platform/native-desktop-strategy`
**Hedef:** Sıfırdan React Native app. Desktop (macOS) + iOS tek codebase. Webview yok, Electron yok, Chrome yok.
**Yaklaşım:** Box-by-box. Her box bitince Serra dogfood. Eski app (`apps/web` + `apps/desktop` + `apps/ios`) yan yana çalışıyor — geçiş bitince sil.
**Toplam süre:** 14-16 hafta odaklı / 20-24 hafta gerçekçi (solo + ADHD + paralel alpha shipping)

---

## Faz 0 — Setup (1-2 gün) 🛠️

Yeni paket: `apps/native` (monorepo'ya ekle, eskileri silme).
- React Native 0.76 + new architecture (Fabric + TurboModules)
- `react-native-macos` (Microsoft maintained, RN paralel sürümü)
- iOS target (zaten RN)
- Metro bundler, TypeScript, ESLint
- "Hello Ollie" Mac + iPhone'da çalışsın → **KARAR KAPISI**

## Faz 1 — Foundation (1 hafta) 🏗️

Bütün modüllerin ortak ihtiyacı:
- Auth: Clerk RN SDK (mevcut Clerk web kalıyor, alpha 2 path)
- Storage: MMKV (hızlı KV) + react-native-sqlite-storage
- Backend bağlantısı: mevcut Supabase + CF workers (değişmez)
- Navigation: react-navigation v7 (tab bar + stack)
- Theme: ceramic/cream/sage/sky palette → StyleSheet tokens
- Reanimated 3 (Framer Motion yok)
- Component primitives: `<Box>`, `<Text>`, `<Button>`, `<Input>` (Tailwind benzeri prop API)

## Faz 2 — COMPLETE box'ları port (3-4 hafta) ✅

11 box zaten tam. Sıra (user-value + boyut):
1. Box 20 dashboard/home (foundation screen) — 4 gün
2. Box 12 dump (brain-dump = ana input) — 3 gün
3. Box 11 medication (küçük) — 1 gün
4. Box 16 onboarding — 2 gün
5. Box 17 crisis (kritik, küçük) — 2 gün
6. Box 18 gallery — 1 gün
7. Box 19 insights — 2 gün
8. Box 8 habits — 3 gün
9. Box 9 goals — 4 gün
10. Box 24 notifications + retention — 2 gün
11. Box 22 consent — 2 gün

Her box bitince Serra dogfood. Eksik modüller eski web app'te kullanılır.

## Faz 3 — HEALTHY box'ları port (3 hafta) 🟢

7 box, küçük UI sorunları var:
- Box 5 finance + money-v2 (v2 design'ı port et)
- Box 6 sleep
- Box 7 body
- Box 23 research (data layer, UI az)
- Box 25 AI routing (UI yok, sadece config)
- Box 30 CF workers (port yok, mevcut workers kalır)

## Faz 4 — Box 10 grocery + Feed Me (2 hafta) 🛒

En büyük modül, en yeni kod, kritik. Tek başına faz.

## Faz 5 — NEEDS_WORK box'ları port + fix (4 hafta) 🟡

Port ederken eksikleri kapat (rewrite avantajı):
- Box 1 work (15 detector stub'ı — rewrite sırasında focus_log mismatch'i de fix)
- Box 2 admin (5 stub orchestrator hook)
- Box 3 pets (cross-module writer'lar)
- Box 4 cycle (🔴 encryption + postpartum logic)
- Box 13 voice (iOS native speech, "Hey Ollie" Porcupine kararı)
- Box 14 settings (sub mgmt, language)
- Box 21 auth (Apple Sign-In + biometric app-lock)
- Box 26 encryption (sensitive modüllere apply)

## Faz 6 — Native-specific (2 hafta) 📱

RN dünyasında özel iş:
- **Box 15 garden — RİSK:** r3f web-only. RN'de `react-three-fiber/native` + `expo-gl` veya skia rewrite. POC gerek.
- HealthKit native module
- APNs push token (mevcut worker kalır)
- Face ID / Touch ID
- Background fetch (cues)
- Deep links
- App icons, splash, signing

## Faz 7 — Beta launch + decommission (1 hafta) 🚢

- `apps/web` sil (PWA bitti)
- `apps/desktop` sil (Electron bitti)
- `apps/ios` sil (Capacitor bitti)
- CI temizle
- Beta TestFlight + Mac DMG
- Eski branch'ler arşivle

---

## Zaman tablosu

| Senaryo | Süre |
|---------|------|
| Odaklı solo, başka iş yok | 14-16 hafta |
| Paralel iş (alpha shipping, T0 Clerk, vs.) | 20-24 hafta |
| Garden 3D yeniden çalışmazsa | +2 hafta |
| iOS HealthKit native module sıkıntısı | +1 hafta |

---

## Riskler

1. **🔴 Garden (r3f) çalışmaz** — RN'de three.js sınırlı. Skia veya farklı 3D engine.
2. **🟡 Framer Motion yok** — tüm animasyonlar Reanimated 3'e port
3. **🟡 Web Speech API yok** — iOS native speech recognition kullan
4. **🟡 Tailwind yok** — design system için custom StyleSheet wrapper
5. **🟡 Voyage/Gemini AI routing** — backend zaten worker'da, frontend sadece fetch — kolay
6. **🟢 Backend hiç değişmiyor** — CF workers + Supabase olduğu gibi

---

## Dogfood stratejisi

İki Ollie paralel:
- **Eski web app** = bitmemiş modüller burada
- **Yeni RN app** = biten modüller burada
- Her hafta yeni app daha çok modül kapsar
- Faz 7'de eski app silinir

Veri tek backend'de (Supabase) — iki app aynı veriyi görür.

---

## İlk karar

**POC Faz 0 başlat:** React Native + macOS + iOS init, "Hello Ollie" Mac ve iPhone'da çalışsın.
1-2 gün. Çalışırsa Faz 1, çalışmazsa kararı gözden geçir.
