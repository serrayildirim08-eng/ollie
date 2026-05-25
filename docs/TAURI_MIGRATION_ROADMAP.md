# Tauri Migration Roadmap

**Hedef:** Electron + Capacitor → Tauri 2 (desktop + iOS tek shell)
**Branch:** `platform/native-desktop-strategy`
**Süre:** 3-4 hafta odaklı, 6-8 hafta gerçekçi (paralel iş + ADHD bursts)

---

## Şu anki durum

- `apps/web` → React/Vite source (kalır)
- `apps/desktop` → Electron (gidecek)
- `apps/ios` → Capacitor (gidecek)
- `apps/api` → CF Workers (kalır)

---

## Aşamalar

### Faz 0 — POC (1-2 gün) → KARAR KAPISI
Tauri kuruluyor mu, React app açılıyor mu?
- `pnpm create tauri-app` ile new shell
- `apps/web` build'i Tauri'ye yükle
- Mac'te aç, React render olsun
- Hot reload dev çalışsın
- **GO/NO-GO:** Açılırsa devam, açılmazsa fallback (Electron'da kal, sadece Capacitor'ı RN'e çevir)

### Faz 1 — Desktop core (3-4 gün)
Electron'un yaptığı her şeyi Tauri'de yap:
- `apps/desktop` içeriği Tauri shell'e port
- Global shortcut (Cmd+Alt+Space)
- Tray icon
- Window state (boyut, pozisyon)
- Auto-updater
- `.dmg` + `.app` build pipeline
- Code signing (mevcut sertifika)

### Faz 2 — Desktop native features (3-5 gün)
- Touch ID (mevcut biometric kod)
- Native notifications
- Passphrase prompt (mevcut)
- Deep links (ollie://)
- Auto-launch on boot

### Faz 3 — iOS setup (3-4 gün)
- Tauri iOS init
- Apple Dev hesap + provisioning (memory: hesap onaylandı)
- Build .ipa
- Serra'nın telefonuna kur, açılsın
- Safe area / notch render OK

### Faz 4 — iOS native features (4-5 gün)
- APNs token registration → mevcut `apns-push` worker
- Face ID
- Background fetch (notification cues)
- iPhone gestures
- Status bar styling

### Faz 5 — CI/CD + dağıtım (2-3 gün)
- GitHub Actions: Mac `.dmg` + iOS `.ipa` build
- Notarize Mac app
- TestFlight setup
- Alpha kullanıcılara dağıtım

### Faz 6 — Temizlik (1-2 gün)
- `apps/desktop` (Electron) sil
- `apps/ios` (Capacitor) sil
- Docs güncelle
- Son QA

---

## Toplam süre

| Senaryo | Süre |
|---------|------|
| Odaklı solo, başka iş yok | 3-4 hafta |
| Paralel iş (alpha shipping, T0 Clerk vb.) | 6-8 hafta |
| Risk durumu (iOS push setup zorlanırsa) | +1 hafta |

---

## Riskler

1. **Tauri 2 iOS yeni** — APNs entegrasyonu Capacitor kadar olgun değil olabilir
2. **WKWebView quirks** — Chrome'da çalışan bazı CSS Safari'de farklı görünebilir
3. **Rust** — native API gerekirse Rust yazılır (frontend için değil, sistem entegrasyonu için)
4. **Plugin eksikliği** — bazı Tauri plugin'leri eksikse Rust'ta yazılır

---

## İlk adım

POC. 1 gün. Açılırsa devam, açılmazsa karar gözden geçirilir.
