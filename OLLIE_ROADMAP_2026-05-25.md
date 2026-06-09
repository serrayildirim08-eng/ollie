# Ollie Roadmap — 2026-05-25

**Supersedes:** `ROADMAP_2026-05-15.md` (still relevant for context, but reality shifted after the 2026-05-25 audit).

**Beta target:** **2026-07-20** (8 hafta, 56 gün). Branding'in 2 ayıyla aynı pencerede biter.

**Reality check:** Code audit says 83% LIVE (352/423). Serra'nın dogfood'u söylüyor: çoğu çalışmıyor. Audit kod-tabanlı, dogfood davranış-tabanlı. **Phase 0 = dogfood verification** ile gerçek durumu önce çıkarırız, sonra fix-list ona göre.

---

## Phase 0 — Dogfood Verification (Week 1 · May 25 – Jun 1)

**Amaç:** 423 feature'ı gerçek iPhone'da tek tek dene, audit statüsünü gerçeklik ile değiştir.

**Workflow (kutu başına):**
1. Kutu aç (Box 1 → Box 30 sırayla, kötüden iyiye)
2. Feature feature dolaş
3. Her feature için: seed gerekiyorsa ben veriyorum → telefonda dene → ✅ / ❌ / 🟡 işaretle
4. Kutu biter → sonrakine geç
5. `OLLIE_BOXES_2026-05-25.md`'ye gerçek durumu yaz (audit'i de güncelle)

**Çıktı:** Her feature'da `dogfood_status` kolonu. Bilinmeyen kalmayacak.

**Tahmini efor:** Gün başına ~2-3 saat = haftada 15-20 saat. 423 feature × ~2 dk = ~14 saat saf test + seed/setup eklenince ~20 saat.

**Bağımlılık:** iPhone'da en güncel build çalışıyor olmalı. (Capacitor sync + TestFlight veya direkt Xcode install.)

---

## Phase 1 — Critical Structural Fixes (Weeks 2-3 · Jun 2 – Jun 15)

**Amaç:** Beta'yı bloke eden 4 büyük yapısal sorunu çöz.

| # | İş | Açar | Efor |
|---|----|------|------|
| 1 | **Box 1 — work focus_log/sessions mismatch** | 16 work feature | 2-3 saat |
| 2 | **Box 4 — cycle encryption** (sensitive veri şu an plain) | compliance + B2B credibility | 4-6 saat |
| 3 | **Box 4 — postpartum kararı + minimum yapı** | ~%30 hedef kullanıcı | 30 dk – 1 hafta (karara bağlı) |
| 4 | **Box 29 — Electron/Clerk auth convergence** | tüm AI feature'lar native'de | ~1 gün |
| 5 | **Dogfood findings'i triaj** (Phase 0'dan gelen gerçek broken'lar) | dogfood'un raporladığı en kritikler | 1-3 gün |

**Çıktı:** 4 kritik blocker kapanır + dogfood'un bulduğu en acil broken'lar fix.

---

## Phase 2 — Module Gap Closing (Weeks 4-5 · Jun 16 – Jun 29)

**Amaç:** Orta öncelikli modül boşluklarını kapat.

| # | İş | Efor |
|---|----|------|
| 6 | **Box 2 — admin Phase 3 wire-up** (5 detector) | 3-4 saat |
| 7 | **Box 3 — pets external writers** (vet schedule UI, coregulation/miss/projection log writer'lar) | 1 gün |
| 8 | **Box 7 — body episode pattern detectors** (4 yeni detector) | 3-4 saat |
| 9 | **Box 9 — pets trust level** (stage-0 → gerçek logic) | 2 saat |
| 10 | **Box 13 — voice kararı** (Porcupine veya "Hey Ollie" branding'i kaldır + iOS speech plugin) | 30 dk – 4 saat |
| 11 | **Box 6 — sleep instruments kararı** (MCTQ/PSQI/ESS yap veya UI'dan kaldır) | 15 dk – 1 gün |
| 12 | **Box 26 — encryption rollout** (cycle'dan sonra body episodes + finance) | 1-2 gün |
| 13 | Dogfood findings devam | ongoing |

**Çıktı:** STUB feature'ların büyük çoğunluğu LIVE veya bilinçli kaldırılmış.

---

## Phase 3 — UX Polish + Decisions (Week 6 · Jun 30 – Jul 6)

**Amaç:** UX boşluklarını ve geciken kararları kapat.

| # | İş | Efor |
|---|----|------|
| 14 | **Box 14 — settings eksikleri** (subscription "later" placeholder, voice settings, language selector) | 1 saat – 1 gün |
| 15 | **Box 21 — biometric app-lock UI** (Apple Sign-In deferred ok) | 4 saat |
| 16 | **Box 22 — HealthKit consent finalize** (Apple Dev onayı var) | 2 saat |
| 17 | **Box 15 — garden Draco** (PR #11 review + merge) | 30 dk |
| 18 | **Box 5 — finance temizlik** (money-v2 karar, Plaid table drop, TrueLayer sil) | 2-3 saat |
| 19 | **Box 18 — astrology kararı** (revive veya 2200 LOC sil) | 30 dk – 1 gün |
| 20 | **Box 22 — privacy + terms** (Serra/hukuk 6 TBD doldurur) | Serra'ya bağlı |

**Çıktı:** Beta öncesi tüm "deferred" / "later" / "kararı bekliyor" yüzeyler temizlendi.

---

## Phase 4 — Native + Real Device (Week 7 · Jul 7 – Jul 13)

**Amaç:** Gerçek iPhone'da end-to-end çalışan beta build.

| # | İş | Efor |
|---|----|------|
| 21 | **Box 28 — iOS Capacitor build** (Xcode flow, entitlements, push, HealthKit) | 1-2 gün |
| 22 | **Box 27 — web shell verify** (v2-shell default mu, kalan iş var mı) | 4 saat |
| 23 | **Box 30 — worker re-deploy + smoke test** (ai-proxy, apns-push, cron, sentry-tunnel) | 2 saat |
| 24 | **Box 27/28/29 — cross-platform parity test** (web + iOS + Electron'da aynı AI feature çalışmalı) | 1 gün |
| 25 | **TestFlight build #1** (internal — sadece Serra) | 4 saat |
| 26 | E2E walkthrough — Serra 1 gün boyunca Ollie'yle yaşar | 1 gün |

**Çıktı:** TestFlight'a yüklenmiş, Serra'da çalışan tam beta build.

---

## Phase 5 — Beta Launch (Week 8 · Jul 14 – Jul 20)

**Amaç:** Closed alpha → wider beta.

| # | İş | Efor |
|---|----|------|
| 27 | Final QA pass (Phase 0 dogfood listesi tekrar) | 1 gün |
| 28 | Privacy + terms publish + domain | Serra'ya bağlı |
| 29 | Invite codes batch (arkadaşlar, dogfood crew) | 2 saat |
| 30 | Branding ile sync (Atelier'in 2 ay branding'i biter) | dış bağımlılık |
| 31 | Marketing landing (gerekli mi karar) | TBD |
| 32 | **Beta launch** — invite-only | — |
| 33 | İlk 48 saat: Sentry watch + invite onboarding feedback | 1-2 gün |

**Çıktı:** Beta canlı. Real users, real feedback.

---

## Post-Beta Backlog (Jul 20 sonrası)

Beta sonrası, gelen feedback ile sırala:

| Kutu | Niye sonra |
|------|-----------|
| **Box 19 — B2B research portal UI** | revenue path, beta'ya gerek yok |
| **Box 20 — cron daily intelligence** | server-side per-user data access, post-beta |
| **Box 21 — Apple Sign-In** | passphrase yeterli, sonra ergonomik |
| **Box 5 — money-v2 default** (eğer Phase 3'te merge edilmediyse) | dogfood sonrası karar |
| **Phase 0 dogfood'un ortaya çıkardığı yeni broken'lar** | gerçek kullanım gösterecek |

---

## Karar bekleyen 5 nokta (Serra)

Roadmap'in netleşmesi için Phase 1'den önce karar verilmesi gerekenler:

1. **Postpartum (Box 4):** minimum yapı mı (~1 hafta) / placeholder mı (1 saat) / soruyu mu siliyoruz (30 dk)?
2. **Sleep instruments (Box 6):** MCTQ/PSQI/ESS yap mı / kaldır mı?
3. **Money-v2 (Box 5):** default UI mı yap, branch'i sil mi?
4. **Voice wake word (Box 13):** Porcupine ekle mi, "Hey Ollie" branding'i kaldır mı?
5. **Astrology (Box 18):** revive mi, sil mi (2200 LOC)?

**Akış:** Phase 0 dogfood başlarken bu kararları Serra'ya tek tek getir, Phase 1 başlamadan netleştir.

---

## Risk + bağımlılık haritası

| Risk | Etki | Azaltma |
|------|------|---------|
| Dogfood Phase 0 audit'in beklediğinden çok daha fazla broken bulur | Phase 1-2 efor patlar | Phase 1-2 buffer aç, Phase 3-4'ten 1 hafta esnetebilir |
| Apple Dev / TestFlight gecikme | Phase 4 kayar | onaylar erkenden tetiklenir (zaten yapılmış) |
| Postpartum büyük yapı tercih edilirse | 1 hafta ekstra | Phase 2'ye paralel başlat |
| Cycle encryption migration eski plain veriyi bozar | data loss | dry-run test + rollback path |
| Branding 2 ay'ı geçer | Beta + branding senkronu kayar | branding'in real progresini her hafta sor |

---

## Şu an ne yapıyoruz

**Hemen:** Phase 0 dogfood — Box 1 (work) açıldı, feature feature ilerliyoruz. Seed yöntemi: feature'a göre brain-dump veya direkt UI test.

**Sonraki adım:** Serra Claude.ai'dan work modülü için seed data alıyor (bu konuşmanın sonunda). Geri döndüğünde devam.

---

*Generated 2026-05-25. Update each Friday with Phase progress + dogfood findings.*
