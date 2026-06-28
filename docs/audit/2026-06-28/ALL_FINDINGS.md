# Ollie — Tüm Güvenlik Bulguları (Birleşik) — 2026-06-28

3 audit pass'in birleşimi: (1) 14-domain red-team + adversarial verify, (2) OWASP injection/deps/JWT taraması, (3) ai-proxy hardening + canlı `pnpm audit`. Branch: `redesign/olive-neumorphic`. Read-only.

**Severity, çürütücü-ajan doğrulamasından SONRAKİ değer.** "Latent" = kod gerçek ama yol henüz deploy edilmemiş/kullanılmıyor → aktif olunca canlı.

---

## CRITICAL

**C1 · Yerel düz-metin depolama + yanlış şifreleme sözü**
`apps/native/src/store.ts:61` (`browserAdapter` = ham localStorage, `packages/store/src/adapter.ts:35-61`) · `encryptedKv` yazılı ama kullanılmıyor · logout/silmede yerel temizlik yok · `marketing/privacy.md:14,97` AES-GCM-256 vaat ediyor.
Exploit: cihaz dosyalarına erişen biri cycle/ilaç/mood/finans notlarını düz okur. Asıl mesele yayınlanmış yalan söz.
Fix: (A) `encryptedKv`'yi hassas modüllere bağla + logout'ta temizle, VEYA (B) `privacy.md`'yi gerçeğe çek. **← Tek karar noktası.**

---

## HIGH

**H1 · Client model + max_tokens seçiyor (ham Anthropic passthrough)**
`index.ts:491,519-523` — gövde doğrulanmadan iletiliyor; model allowlist + max_tokens cap yok.
Exploit: authed kullanıcı `{"model":"claude-opus-…","max_tokens":64000}` × 10/dk. Worst case saatlik yüzlerce $.
Fix: proxy'de gövdeyi parse et, model'i allowlist'le, max_tokens'ı tavanla, çoklu completion reddet.

**H2 · Global harcama tavanı yok** · `rate-limit.ts` yalnız per-user. Fix: KV günlük global sayaç + eşikte fail-closed.

**H3 · `/brain-copy` rate-limit yok** · `index.ts:394` `checkRate` çağırmıyor. Fix: `checkRate()` ekle.

**H4 · Staging prod CF namespace'lerini paylaşıyor** · `workers/ai-proxy/wrangler.toml:128-152` prod KV/Vectorize/rate-limiter ID'lerini birebir kullanıyor. Exploit: tek staging test → prod cache bozulur, rate-limit tükenir, routing vektörleri zehirlenir. Fix: staging'e ayrı ID'ler.

**H5 · Hassas dump + görseller 3. parti AI'ya onaysız/açıklamasız** · `router/dump.ts:410-413` (Groq, consent kapısı yok) · `dump.ts:241`→`vision.ts:55` (Gemini, privacy.md'de listeli değil). Fix: consent'e kapıla VEYA politikada açıkla + Gemini ekle.

**H6 · `deploy-workers.yml` CI test-gate'i yok** · `needs:`/`workflow_run` bağı yok → testler patlasa da deploy olur. Fix: deploy'u CI başarısına bağla.

**H7 · Salt rotasyonu silmeyi sessizce bozuyor** · `apps/api/src/account-delete.ts:310-318` salt'ın SET olduğunu kontrol ediyor, DOĞRU olduğunu değil; `:542-574` 0 eşleşmede `ok:true`. Exploit: launch'ta `USER_HASH_SALT` rotasyonu → 0 satır silinir, "başarılı" der. Fix: kullanıcı-başı salt-versiyon; satır sayısı doğrula/sesli hata.

**H8 · Account-delete deploy edilmemiş** · `apps/api` worker dormant → "hesabımı sil" canlıda hiçbir şey silmiyor. Fix: worker'ı deploy et + giriş noktası bağla + completeness testi.

**H9 · Push worker gövdeden user_id alıyor (LATENT)** · `apps/api/src/worker.ts:303-413` sahiplik kontrolü yok, service-role upsert/dispatch. Exploit: paylaşılan sırrı olan biri başkasının cihazına push. Fix: user_id'yi JWT'den türet. **Deploy etmeden önce.**

**H10 · `profile_recovery_lookup` anon enumerasyon + offline brute-force (LATENT)** · `supabase/migrations/20260519000001_profiles_anon_rpc_fix.sql:93-111` anon GRANT, rate-limit yok, `(salt, encrypted_server_pw)` döndürüyor. Fix: `REVOKE FROM anon`, rate-limitli worker arkasına.

**H11 · Multi-device sync bozuk (per-device salt) — veri kaybı** · `packages/auth/src/index.ts:150-163` her cihazda rastgele salt; `encrypted_state`'te salt kolonu yok → Cihaz B, A'nın anahtarını üretemez, sessizce decrypt fail (`sync/src/index.ts:351`). Leak değil, sessiz veri kaybı. Fix: anahtarı device-local rastgele yerine passphrase + synced/account salt'tan türet.

**H12 · `@clerk/clerk-react@5.61.3` auth-bypass advisory** · GHSA-w24r-5266-9c3c (≥5.9.0 ≤5.61.5). Pratik risk **düşük** (yalnız org/billing/reverification akışları, Ollie kullanmıyor). Fix: ≥5.61.6'ya bump (tek satır).

---

## MEDIUM

**M1 · `profiles` RLS Clerk altında bozuk (LATENT, legacy 0-row)** · `20260512000002_profiles.sql:107-126` `auth.uid()` = NULL. Fix: legacy tabloyu düşür/yeniden-pointle veya `auth.jwt()->>'sub'`.

**M2 · AI çıktısı MODULES enum'una karşı doğrulanmıyor** · `dump-classify.ts:257,288` `parsed.module` kontrolsüz yazılıyor. Fix: yazımdan önce allowlist kontrolü.

**M3 · ADHD pattern tag enum-doğrulanmıyor** · `label.ts:270` yalnız `typeof` kontrolü, 18 değere karşı membership yok. Fix: diğer label alanları gibi enum kontrolü.

**M4 · `invite_funnel` view'ları SECURITY DEFINER** · `20260519000003_invite_funnel_views.sql:33,81` `security_invoker` yok; fix migration `…0618000004` DRAFT (uygulanmamış). Şu an güvenli (service_role-only grant). Fix: fix migration'ı uygula.

**M5 · `dump_inbox`/`grocery_pantry` başta FORCE RLS değil** · `20260611000001_server_apply_a6b.sql:32,55` enable var force yok; `…0618000001`'de düzeltilmiş. Fix: fix migration'ın uygulandığını doğrula.

**M6 · `grocery_purchase_history` auth.uid cast (LATENT)** · `20260615000001_*.sql:30` `auth.uid()::text` = NULL. Fix: `auth.jwt()->>'sub'`.

**M7 · Verbose error sızıntısı** · `transcribe.ts:75,84` + `partner.ts` (mint/pair/snapshot) upstream/`err.message`'ı client'a döndürüyor. Fix: `upstreamError()` helper.

**M8 · CSP kapalı** · `tauri.conf.json:24` `"csp": null`. Önce XSS gerektiriyor (yüzey minimal). Fix: CSP string tanımla.

**M9 · devtools release build'de açık** · `Cargo.toml:21` `features=["devtools"]`, cfg guard yok → shipped binary'de WebKit inspector. Fix: `cfg(debug_assertions)` arkasına al.

**M10 · sync `applyModule` doğrulama yok** · `packages/sync/src/index.ts:340` herhangi `row.module`'ü uyguluyor. Tam cihaz+anahtar compromise gerektiriyor. Fix: modül enum doğrula.

**M11 · Crisis lexicon onay alanına CI gate yok** · `ci.yml` `PENDING_SERRA_APPROVAL` alanını kontrol etmiyor. (Düşük — hotline routing kaldırıldı.) Fix: opsiyonel CI kontrolü.

**M12 · Dev/build-time bağımlılık advisory'leri** · `vitest<3.2.6` (critical-rated ama dev-only UI server), `ws`/`undici`/`vite`/`esbuild`/`@babel/core`/`launch-editor` — hepsi `wrangler>miniflare`/`vitest` zincirinde, prod bundle'da değil. Fix: `vitest`→≥3.2.6, `wrangler`→güncel.

---

## LOW / INFO

**L1 · JWT `alg` pinlenmemiş + `aud` doğrulanmıyor** · `clerk-verify.ts:66-68`. jose+JWKS asimetrik → confusion pratikte imkânsız; issuer unik → aud implicit. Fix: `algorithms:['RS256']` + `audience`.

**L2 · iOS ATS gevşek** · `Info.plist:27-30` `NSAllowsArbitraryLoadsInWebContent`. localhost loopback → MITM yok. Fix: ATS daralt.

**L3 · URL encode nit'leri** · `apps/api/src/worker.ts:246` (cron URL, id DB-UUID); `apps/native/src/api/workers.ts:91` (modül path hardcoded). İstismar edilemez. Fix: `encodeURIComponent`.

**L4 · `@clerk/clerk-react` deprecated** · `@clerk/react`'a geçiş planla (bakım).

**L5 · `tauri-plugin-mobile-push-api@0.1.4` pre-1.0 deneysel** · undeployed push'ta. İzle/pinle.

---

## ✅ DOĞRULANMIŞ İYİ (endişe etme)

- **Auth kapısı fail-closed, bypass yolu YOK** — her ücretli rota izlendi (`index.ts:447-476`); dev escape-hatch prod'da reddediyor.
- **Per-user rate-limit native CF binding** (atomik, stateless-isolate sorunu yok) · `rate-limit.ts:37-39`.
- **Body 1MB cap** (`content-length` + gerçek bytes) · `index.ts:485-495`.
- **service-role key sadece secret** — toml'da/git history'de değer yok.
- **Client bundle'da secret yok** — sadece `VITE_` public.
- **sentry-tunnel SSRF/open-relay DEĞİL** — host hardcoded + DSN eşleşme + project-id allowlist.
- **cron fetch endpoint'leri secret-korumalı** (`CRON_TRIGGER_SECRET`, fail-closed).
- **CORS sıkı allowlist** (`index.ts:137-141`).
- **XSS temiz** — React escaping; `dangerouslySetInnerHTML` yalnız hardcoded SVG.
- **SQLi temiz** — PostgREST + `encodeURIComponent` + tablo/kolon allowlist.
- **Deserialization temiz** — `JSON.parse` try/catch'li, app-only veri.
- **Command injection/SSTI/XXE yok**; `exec/spawn/eval` yok.
- **Mass assignment temiz** (deployed yollar — user_id JWT'den).
- **`encrypted_state` Supabase'de at-rest şifreli + RLS FORCE'lu**; bypass yalnız ciphertext verir.

## ❌ YANLIŞ ALARMLAR

- Crisis lexicon "PENDING approval alpha'yı blokluyor" → REDDEDİLDİ (hotline routing kaldırıldı, commit 90349c1).
- finance `record_type` doğrulanmıyor → REDDEDİLDİ (mapping hardcoded `'transaction'`).
- store schema validation yok → REDDEDİLDİ (anahtar olmadan istismar edilemez; AES-GCM tampered ciphertext'i reddediyor).
- JWT alg "High" → Low'a indirildi (jose+asimetrik JWKS).

## 🔍 RUNTIME/MANUEL DOĞRULAMA GEREKEN

- Identity migration prod'a uygulandı mı: `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1;` (text bekleniyor).
- Clerk dashboard signup koruması (email-verify + bot) açık mı.
- `encrypted_state` A6b read filtresi userId'yi JWT'den mi alıyor (service-role olduğu için kritik).
