# A6b Deploy Runbook — server-apply pilot (yarın, path B: Serra uygular)

Hedef: migration + secret'lar canlıya → sonra Claude curl demosunu koşar → Faz A kapanır.
Proje: **ollie-prod** (`ykxzfzkfsolwgmheiwpx`) · Worker: **ollie-ai-proxy** · hepsi shadow mode (flag arkasında, mevcut hiçbir şeyi bozmaz).

---

## 1) Migration'ı uygula (dump_inbox + grocery_pantry)

Dosya: `supabase/migrations/20260611000001_server_apply_a6b.sql`

**Yol A — supabase db push (tercih):**
```bash
cd ~/ollie
supabase link --project-ref ykxzfzkfsolwgmheiwpx   # bir kez; DB şifresi sorabilir
supabase db push
```
`db push` sadece yeni migration'ı (20260611000001) uygular, eskilere dokunmaz.

**Yol B — olmazsa, Supabase Dashboard → SQL Editor:**
`supabase/migrations/20260611000001_server_apply_a6b.sql` içeriğini yapıştır → Run.

**Doğrulama (iki tablo da var mı):**
```bash
supabase db remote query "select table_name from information_schema.tables where table_name in ('dump_inbox','grocery_pantry');"
```
İki satır dönmeli. (Olmazsa dashboard SQL Editor'da aynı sorgu.)

---

## 2) ENVELOPE_KEK üret + worker'a koy

KEK = base64'lenmiş 32 rastgele byte (envelope şifrelemenin ana anahtarı; DB'ye ASLA girmez).

```bash
# 32 byte rastgele anahtar üret (ekrana basmadan doğrudan secret'a vermek en güvenlisi):
openssl rand -base64 32
```
Çıkan satırı KOPYALA. Sonra:
```bash
cd ~/ollie/workers/ai-proxy
pnpm exec wrangler secret put ENVELOPE_KEK
# açılan prompta yukarıdaki base64'ü yapıştır + Enter
```
> Not: Bu anahtarı bir yere (1Password vb.) yedekle — kaybolursa şifreli veriler açılamaz. Sohbete YAPIŞTIRMA.

---

## 3) Flag'i aç (SERVER_APPLY_ENABLED=1)

```bash
cd ~/ollie/workers/ai-proxy
printf '1' | pnpm exec wrangler secret put SERVER_APPLY_ENABLED
pnpm exec wrangler deploy    # worker'ı yeni secret'larla yayınla
```

(Client tarafı `VITE_SERVER_APPLY=1` ayrı bir flag — demoyu sunucu-curl ile yapacağız, client build'i şart değil. İstersek device adımı için sonra açarız.)

---

## 4) (Claude koşar) curl demosu — done-when

Bunları Claude yapacak; senin sadece 1-3 bitmesi yeterli. Referans olsun diye:

```bash
# staging test bearer üret + worker'a ekle (demo için, prod auth'u bypass etmez — ayrı side-door)
BEARER=$(openssl rand -hex 24)
printf '%s' "$BEARER" | pnpm exec wrangler secret put STAGING_TEST_BEARER && pnpm exec wrangler deploy

# a) APP KAPALI simülasyonu: dump'ı doğrudan sunucuya gönder (Siri TELL gibi)
curl -s -X POST https://ollie-ai-proxy.ollieapp.workers.dev/route/dump \
  -H "authorization: Bearer $BEARER" -H "content-type: application/json" \
  -d '{"text":"süt aldım","dumpId":"demo-1"}' | head -c 200

# b) inbox'ı apply et
curl -s -X POST https://ollie-ai-proxy.ollieapp.workers.dev/apply-inbox \
  -H "authorization: Bearer $BEARER"        # → {"ok":true,"applied":1}

# c) device'ın göreceği şey (sunucudan pull):
curl -s https://ollie-ai-proxy.ollieapp.workers.dev/sync/grocery-pantry \
  -H "authorization: Bearer $BEARER"        # → rows: [{ item: "süt", ... }]
```
**Done-when:** (a) app kapalıyken dump → (b) apply → (c) pull'da "süt" görünüyor = uçtan uca server-apply çalışıyor.
İstersek son adımı gerçek device'ta da gösteririz (`VITE_SERVER_APPLY=1` ile build + app aç → süt pantry'de belirir).

---

## Geri alma (gerekirse)
- Flag'i kapat: `printf '0' | pnpm exec wrangler secret put SERVER_APPLY_ENABLED && pnpm exec wrangler deploy` → her şey eski haline (shadow bile durur).
- Tablolar boş + service-role-only; bırakmak zararsız. Tam geri alma için: `drop table public.dump_inbox, public.grocery_pantry;` (dashboard).

## Yarın açılış cümlesi (Claude'a)
"A6b runbook 1-3 bitti, curl demosunu koş ve Faz A'yı kapat." (STAGING_TEST_BEARER'ı sen 1-3'te koymadıysan Claude 4a'da koyar.)
