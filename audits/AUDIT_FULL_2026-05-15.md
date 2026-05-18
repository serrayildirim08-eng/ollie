# OLLIE — Tam Modül Denetimi (Konsolide)

**Tarih:** 2026-05-15
**Kapsam:** 12 özellik modülü + bahçe + ana ekran + 11 altyapı alanı
**Yöntem:** Her iddia gerçek koda karşı doğrulandı — yorumlara, sprint dokümanlarına veya eski audit dosyalarına güvenilmedi. Bir özellik ancak tam yol izlenebildiyse "çalışıyor" sayıldı (arayüz → işleyici → mantık → kayıt → çapraz-modül ise olay + dinleyici).
**Branch:** `recover-stranded-notifications` (= `origin/main` ile aynı içerik)

---

## Durum lejantı

- ✅ **Çalışıyor** — uçtan uca kullanılabilir, tam yol doğrulandı
- ⚠️ **Yarım** — bir kısmı çalışıyor, görünür bir kısmı sahte/boş
- 🔲 **İskelet** — kod/ekran var ama bağlı değil (stub, mock, ölü işleyici)
- ⛔ **Kapalı** — kasıtlı devre dışı
- 🔌 **Deploy bekliyor** — kod tam, sunucu/anahtar/ortam değişkeni eksik

---

## Tek bakışta özet tablo

| Modül | Genel durum | Kullanıcı bugün ne yapabilir |
|---|---|---|
| Cycle (regl) | ✅ | Her şey — en eksiksiz modül |
| Sleep (uyku) | ✅ | Uyku kaydı, istatistik, ritüel, sesler |
| Grocery (market) | ✅ | Liste, kiler, tarif, otomatik ekleme |
| Habits (alışkanlık) | ✅ | Ekle/işaretle, örüntü motoru gerçek |
| Dump (arşiv) | ✅ | Beyin dökümü arşivi + arama + yüzeye çıkarma |
| Work (iş) | ✅ | Odak zamanlayıcı, proje takibi, toplantı, planlama |
| Goals (hedef) | ✅ | Hedef, kilometre taşı, AI adım, alışkanlığa çevirme |
| Body (vücut) | ⚠️ | Su/takviye çalışır; "atak" kartı ölü |
| Admin (resmi iş) | ⚠️ | Görev yönetimi çalışır; akıllı uyarılar ölü |
| Finance (para) | ⚠️ | Manuel para takibi çalışır; banka bağlama yok |
| Pets (evcil) | ⚠️ | Bakım takibi çalışır; akıllı paneller boş |
| Astrology | ⛔ | Erişilemez — kasıtlı kapalı |

**Kabaca:** 7 modül gerçekten kullanılabilir, 4'ü "manuel araç olarak iyi ama akıllı kısmı sahte", 1'i kapalı.

---

# BÖLÜM 1 — ÖZELLİK MODÜLLERİ

## ✅ Cycle (regl takibi) — en eksiksiz modül

**Çalışan özellikler:**
- Regl / semptom / not kaydı (etiket çipleri), 1. günü tekilleştirme
- Döngü günü + faz + ay-evresi görsel kadranı
- Sonraki regl tahmini + güven seviyesi
- Yumurtlama tahmini + doğurgan pencere (doğurganlık takibi açıksa)
- Semptom korelasyonları (≥3 döngü) + doktora gösterilecek "klinik bayraklar" (kaynak bağlantılı)
- "Döngün uzadı mı?" uyumsuzluk uyarısı — kaçırılan kaydı tahminle dolduruyor
- Doğum kontrol hapı kaydı (bugün + 7 gün geriye)
- Ayarlar paneli (doğurganlık / kadran / hap / parola ipucu)
- "Partnere sor" seçici
- 6 bildirim: regl yaklaşıyor / çok yakın / gecikti, luteal başladı, yumurtlama yakın (opt-in), hap kaçtı

**Çalışmayan:** Alttaki dışa/içe aktarma butonları boş (işlevsiz).

**Çapraz modül (doğrulandı):** Regl kaydı → market'e ped/tampon ekler; → bahçeye büyüme verir; → finansa "luteal kartı" gösterir.

**Alt satır:** Beş modül içinde gerçekten tamamlanmış olan. Kullanıcı regl/semptom/hap kaydı yapar, tahmin/yumurtlama/korelasyon/klinik bayrak alır — hepsi işliyor.

---

## ✅ Sleep (uyku)

**Çalışan özellikler:**
- Hızlı "nasıldı" kaydı (sağlam/iyi/kötü/berbat)
- "Anlat, ben ayıklarım" — serbest metni yapılandırılmış kayda çevirme
- Gerçek istatistikler: uyku borcu, kronotip, sosyal jetlag, gecikmiş-faz (DSPS), kısa-uyku serisi
- 14 gecelik çubuk grafik + örüntü çekmecesi
- Yatış öncesi ritüel kontrol listesi (sıralı dokunma)
- Uyku ses çalar (6 gerçek ses dosyası — kahverengi/beyaz/pembe gürültü, yağmur vb.)
- Bildirimler: yatış-öncesi penceresi, uyku borcu, kafein-uyku — bağlı (yatış saati ayarlanmışsa)

**Çalışmayan / yarım:**
- 🔲 "Bu gece tahmini" kartı — kalıcı boş (tahmin fonksiyonu hep boş dönüyor)
- 🔲 "Daha derine in" değerlendirme listesi (MCTQ/PSQI/ISI/ESS) — tıklanmıyor, ölü UI
- ⚠️ Ritüel listesinin geri-besleme döngüsü kırık — yanlış kayıt anahtarına yazıyor, o yüzden "ritüel sürtünmesi" örüntüsü hiç çıkmıyor

**Alt satır:** Güçlü modül. Kullanıcı 3 yolla uyku kaydeder, gerçek istatistik/kronotip/borç görür, ritüeli işler, ses çalar. Üç küçük kozmetik/işlevsel boşluk var.

---

## ✅ Grocery (market)

**Çalışan özellikler:**
- Alışveriş listesi ekle/işaretle/sil/topluca temizle
- Ürün ayrıştırma + niyet algılama (ekle / aldım / çıkar)
- Bilinmeyen ürünü "öğret" akışı (kalıcı kaydedilir)
- Kiler raf-ömrü segmentasyonu (kritik / izlemede / stokta)
- Tarif önerisi ("beni doyur" + arama) + "eksikleri ekle"
- "Fark ettim" örüntüleri (arayüz tarafında çalışır)

**Çapraz modül (doğrulandı):** Regl kaydedilince ped/tampon/günlük-ped otomatik listeye eklenir (5 dk geri-al hakkıyla).

**İç durum (kullanıcıyı etkilemiyor):** Market'in arka plan örüntü motoru çalışıyor ama ürettiği olayları kimse dinlemiyor — arayüz örüntüleri kendisi yeniden hesaplayarak telafi ediyor. Bildirim yok.

**Alt satır:** Gerçekten uçtan uca kullanılabilir.

---

## ✅ Habits (alışkanlıklar)

**Çalışan özellikler:**
- Alışkanlık ekle/işaretle/sil (sabah / herhangi / akşam bölümleri)
- "Streak yok / suçluluk yok" günlük defteri + tamamlanan sayısı
- 16 örüntü dedektörü → "fark ettim" bölümü (gerçek veriyle çalışıyor)
- Bildirim: sabah 9'da "günün şeyleri" — bağlı (kendini kuran zamanlayıcı)

**Çapraz modül (doğrulandı):** Goals'tan "alışkanlığa çevir" gelince gerçekten yeni alışkanlık ekleniyor. Body'den su-düşüşü gelince su alışkanlığı yüzeye çıkıyor.

**Küçük zayıflık:** Modül içinde ikinci bir banner-dedektör katmanı var ama boş veriyle besleniyor — neredeyse hiç tetiklenmez. Vestijyal kod.

**Alt satır:** Sağlam. Kullanıcı alışkanlık yönetiminin tamamını bugün yapabilir.

---

## ✅ Dump (beyin dökümü arşivi)

**Çalışan özellikler:**
- Beyin dökümü yakalama → arşive düşüyor (ana ekran/dashboard/modül girişi)
- Gün-gruplu akış görünümü, arama, tarih aralığı filtreleri, "yönlendirilmemişler" filtresi
- Sil / unut
- Yüzeye çıkarma rayları: "bugün geçen yıl" yıldönümleri, aynı döngü-günü, anlamsal yankılar
- "Bunu tekrar tekrar soruyorsun" örüntü bloğu

**Alt satır:** İşlevsel salt-okunur arşiv. Küçük not: dump'a yönlendirilen metin araştırma korpusuna beslenmiyor (farklı bir iç fonksiyon kullanılıyor) ama çekirdek deneyim çalışıyor.

---

## ✅ Work (iş)

**Çalışan özellikler:**
- Odak zamanlayıcı — 15 / 25 / 45 / 90 dakika modları
- Kahverengi gürültü kaplaması (zamanlayıcıya bağlı, ses açık/kapalı)
- Proje seçici + proje bazlı faturalanabilir saat takibi (Maya'nın freelance ihtiyacı)
- Odak oturum geçmişi (bugün / bu hafta)
- Toplantı takibi (manuel form + beyin dökümünden otomatik)
- İleri tarihe derin-iş bloğu planlama (yumuşak iptal)
- Beyin dökümünden görev listesi
- 17 örüntü dedektörü
- 7 bildirim cue'su (toplantı 30dk, odak bloğu 15dk, derin-iş, oturum bitti, 90dk uyarı, sharpest hours, 4 blok)

**Yapılmamış:** E-posta triyajı, dikkat dağınıklığı günlüğü, işbirliği notları, pomodoro mola takibi.

**Alt satır:** Bu session'da ~%22'den ~%85'e çıkarıldı. Çekirdek iş akışı tam.

---

## ✅ Goals (hedefler)

**Çalışan özellikler:**
- Hedef tanımı (başlık + neden + tarih + engel + premortem + ulysses sözleşmesi)
- 6 kategori (kariyer/ilişki/sağlık/finans/öğrenme/yaratıcı) + filtre çubuğu
- Kilometre taşları + otomatik ilerleme hesabı
- İlerleme çubukları (SVG)
- "Claude'a adımları sor" — yapay zeka adım dökümü (worker bugün canlıya alındı)
- Durum takibi (aktif/duraklatıldı/tamamlandı/bırakıldı)
- Hedef revizyonu (suçlama yok)
- Hedefi alışkanlığa çevirme
- Pazar haftalık check-in
- 16 hedef dedektörü + kategori-hız dedektörü
- 3 bildirim cue'su (haftalık check-in, 30 gün kala, 14 gün duraklatılmış)

**Yarım:** 🔲 Tamamlanan-hedef galerisi — mezarlık filtresi var ama başarı galerisi yok.

**Alt satır:** Bu session'da elden geçti. Çekirdek tam.

---

## ⚠️ Body (vücut)

**Çalışan özellikler:**
- Su takibi (bardak, hedef, geri-al)
- Takviyeler (ekle/sil/günlük işaret)
- Kronik durum listesi
- Döngü-bazlı tedavi planları
- "Bugün kendine iyi davran" koruyucu kartlar (uzun odak oturumu sonrası tetikleniyor — çapraz-modül doğrulandı)
- "Fark ettim" vücut örüntüleri

**Çalışmayan / sahte:**
- 🔲 **Aktif sağlık atağı + doktora özet kartı** — modülün en görünür kartı, pratikte ölü. Bir atağı düzgün başlatmanın UI'ı yok; beyin dökümünden gelen atak eksik alanlarla kaydoluyor, kart hiç düzgün görünmüyor.
- ⚠️ **Takviye hatırlatıcısı bozuk** — sen takviyeyi aldıktan sonra bile uyarı veriyor (işaretlemeyi yanlış yere bakıyor).
- ⚠️ Çapraz-modül "sinyaller" bölümü — yazıcısı olmayan bir veriye bağlı, muhtemelen hep boş.
- Duruş hatırlatıcısı opt-in ama açma UI'ı yok.

**Alt satır:** Yarı gerçek. Su/takviye/kronik durum/tedavi planı/koruyucu kartlar çalışıyor; en gösterişli kart (atak/doktor özeti) facade.

---

## ⚠️ Admin (resmi işler)

**Çalışan özellikler:**
- Görev CRUD — yenileme/görev/"top" ekle, tamamla, döngü kapat, ertele, sil, tekrar eden görevleri ileri taşı (hepsi kaydediliyor)

**Çalışmayan / sahte:**
- 🔲 **Etkileşimli akıllı uyarı kutuları TAMAMEN ÖLÜ** — "evrakı parçala", "2 dakikalık işleri topla", "yenileme cue'su", "bekleyen top" vb. — var olmayan bir iç olay sistemine bağlanmışlar. Arka plan bunları üretiyor, arayüz yanlış yerde dinliyor — hiçbiri görünmüyor.
- ⚠️ "Fark ettim" panelindeki uyarılar — bir alan-adı uyuşmazlığı yüzünden teker teker kapatılamıyor (birini kapatınca hepsi gidiyor).

**Çapraz modül (doğrulandı):** Doktor randevusu tamamlanınca bahçe büyüyor. Finanstaki hatırlatıcı admin'e yansıyor.

**Alt satır:** Manuel görev yöneticisi olarak çalışıyor. Etkileşimli akıllı katman tamamen ölü.

---

## ⚠️ Finance (para)

**Çalışan özellikler:**
- Manuel CRUD: faturalar, abonelikler, birikim hedefleri, ADHD-vergisi girdileri, işlemler
- Dürtüsel-harcama durdurma modalı
- Gizlilik maskesi (rakamları gizle)
- Abonelik denetimi
- ADHD-vergisi PDF raporu

**Yarım / sahte:**
- ⚠️ **Analiz motoru kendi formlarını dinlemiyor** — tekrar eden harcama tespiti, anomali kartları, F1-F7 örüntüleri çalışıyor AMA modülün kendi formlarından fatura/abonelik/işlem eklediğinde yeniden hesaplama tetiklenmiyor. Sadece beyin dökümünden gelen metinle besleniyor.
- 🔌🔲 **Banka bağlama (Plaid): kullanılamaz.** Kod gerçek ve ciddi yazılmış ama: (1) bağlama butonu sadece onboarding'de, finans modülünde hiç yok; (2) worker'ın anahtarları yok, deploy edilmemiş, KV kimliği hâlâ placeholder; (3) banka işlemini çekme akışı kod içinde "gelecek sprint" diye yarım; (4) bankadan gelen veriyi finans ekranına taşıyan fonksiyonun çağıranı yok. Banka bağlasan bile işlem görmezsin.
- TrueLayer (UK/EU alternatifi) — sadece iskelet.

**Bildirimler:** Fatura-vadesi, abonelik-tespiti, anomali, birikim kilometre taşı, vergi-ayır — bağlı ama push teslimatı kırık (bkz. Bölüm 3).

**Alt satır:** Manuel para takipçisi olarak bugün tam kullanılabilir. Banka entegrasyonu kullanılamaz; analiz motoru kendi UI'ından beslenmiyor.

---

## ⚠️ Pets (evcil hayvan)

**Çalışan özellikler:**
- Hayvan ekle / arşivle
- Manuel bakım kaydı (dokun-geri-al)
- Bakım-boşluğu tespiti + hayvan başına "bugün tahmini"
- "Uzaktayım" modu (bakım hatırlatıcılarını duraklatır)

**Çalışmayan / sahte:**
- 🔲 **Sağlık bayrakları** — gözlem girdileri hiçbir yerde toplanmıyor, inceleme çekmecesi kalıcı boş.
- 🔲 **Davranış "fark ettim" örüntüleri** — dedektör mevcut ama hiç çağrılmıyor, panel hep boş.

**Alt satır:** Bakım takibi sağlam (hayvan ekle, bakım kaydet, geciken görevleri gör, uzakta modu). İki "akıllı" yüzey facade.

---

## ⛔ Astrology (astroloji)

Kasıtlı kapalı (`ASTROLOGY_ENABLED = false`). 2195 satır kod korunuyor ama erişilemez — ekranda kutucuğu yok, rota dashboard'a geri çeviriyor. `DECISIONS_2026-05-14` kararı 2. Reaktivasyon için ayrıca bir AI endpoint + Merkür retrosu algoritması gerekiyor.

---

# BÖLÜM 2 — DESTEK BİLEŞENLERİ

## Bahçe / Burhan (3D zeytin ağacı) — ✅ kod / render doğrulanmadı
3D sahne kodu eksiksiz, varlık dosyaları yerinde, "siyah materyal" hatasına karşı koruma var. Bir varlık bozulursa sessizce yazı yedeğine düşüyor. Görsel render statik olarak doğrulanamadı — çalıştırıp görmek gerek.

## Ana ekran — ✅
Gökyüzü videosu (yerel→CDN yedek), canlı hava durumu, retention hoş geldin çubuğu, gökyüzü orbu, ayarlar/bahçe/dashboard navigasyonu, beyin dökümü girişi. İşlevsel sorun yok.

## Onboarding — ✅
İlk açılış zinciri çalışıyor: hesap → onam ekranı → araştırma opt-in → çok adımlı kurulum (ülke otomatik algılama, HealthKit alt-adımı). Dönen kullanıcı için temiz atlama.

---

# BÖLÜM 3 — ARKA PLAN MAKİNESİ (ALTYAPI)

| Alan | Durum | Not |
|---|---|---|
| Beyin dökümü yönlendirici | ✅ | Anahtar-kelime bazlı; yönlendirmede AI yok |
| Cihazda şifreleme (at-rest) | ⛔ | **Sahte — boş TODO. Cihazdaki veri düz metin.** |
| Buluta-yükleme şifrelemesi | ✅ | Bu gerçek — veri cihazdan çıkmadan şifreleniyor |
| Bildirimler / APNs | ⚠️ | **Kırık — telefona push gitmiyor** |
| Telemetri: oturum + modül | ✅ | Veritabanına akıyor |
| Telemetri: D1/D7/D30 retention | ⚠️ | **Veritabanına ulaşmıyor — köprü hiç çağrılmıyor** |
| Davet sistemi | ✅ | Üret→paylaş→yakala→doğrula→talep — tüm zincir çalışıyor |
| Onam (consent) | ✅ | İki paralel sistem — çalışıyor ama kafa karıştırıcı |
| Bulut senkron / Supabase | ✅ kod / 🔌 | Gerçek; ortam değişkenleri + deploy gerek |
| 5 Cloudflare worker | ✅ kod / 🔌 | Gerçek kod; deploy + gizli anahtar gerek (ai-proxy bugün deploy edildi) |

### En sık tekrar eden çürük kalıbı
Ollie iki yerde sistematik açık veriyor:
1. **"Fark ediyor ama kimse dinlemiyor"** — uygulama bir örüntü hesaplıyor, bir olay yayınlıyor, ama o olayı dinleyen kimse yok. Zeka hesaplanıp çöpe atılıyor.
2. **"Boş ekran"** — bir panel, hiçbir kodun üretmediği bir veriye bağlanmış. Kalıcı boş duruyor.

Bu kalıp grocery, pets, admin, sleep, body'de ayrı ayrı görünüyor. İskelet var, et eksik.

---

# BÖLÜM 4 — BETA'DA PATLAYACAK 3 KRİTİK ŞEY

1. **Push bildirimleri telefona hiç gelmez.** Cihazın bildirim jetonu sunucuya kullanıcı kimliği olmadan kaydediliyor → sunucu kimi dürteceğini bulamıyor. Tüm modüllerin bildirim cue'ları doğru hesaplanıp zamanlanıyor ama telefonu çalmıyor. (Yerel/uygulama-içi bildirimler çalışır.)

2. **"Şifreleme" anahtarı sahte.** `bootEncryption` fonksiyonu boş bir TODO. Settings'teki şifreleme anahtarı tiyatro — cihazdaki veri düz metin. (Buluta yüklenirken şifreleme gerçek; sadece cihazın kendisindeki şifreleme sahte.) — *Not: bu, session başında "tamam" dediğim ama sonradan kodda doğrulayıp yanlış olduğunu gördüğüm bir nokta.*

3. **Operatör retention göremez.** D1/D7/D30 retention işaretleri veritabanına ulaşmıyor — köprü fonksiyonu hiçbir yerden çağrılmıyor. Uygulama-içi "day 1, geri geldin" çubuğu görünür ama Serra retention eğrisini göremez. Beta'nın tek amacı buydu.

---

# BÖLÜM 5 — YAPILMAMIŞ / ERTELENMİŞ

- Work: e-posta triyajı, dikkat dağınıklığı günlüğü, işbirliği notları, pomodoro mola takibi
- Goals: tamamlanan-hedef başarı galerisi
- Finance: Plaid banka senkronu (yarım), TrueLayer (iskelet)
- Astrology: tümden kapalı
- Cron worker'ının günlük zeka işleri: bilerek stub (algoritmalar istemci tarafında)

---

# BÖLÜM 6 — ALT SATIR + ÖNERİ

**Ekran olarak ~%80 hazır, boru olarak ~%55.** Bir arkadaşa bugün versen: not alır, alışkanlık takip eder, regl/uyku izler, odak çalışır, market listesi tutar — hepsi gerçek ve iyi. Ama Ollie'yi "Ollie" yapan iki şey (doğru anda dürtmesi + gizliliği) şu an çalışmıyor; operatör de geri dönüşü ölçemiyor.

**Beta'dan önce sırasıyla 3 küçük düzeltme (~yarım gün):**
1. Bildirim jeton kaydına kullanıcı kimliğini ekle → push açılır
2. Retention köprüsünü bağla → retention eğrisi açılır
3. Ya gerçek at-rest şifrelemeyi bitir, ya Settings'teki sahte anahtarı kaldır → yanlış gizlilik iddiası riskini kapat

Bu 3'ten sonra beta gerçekten hazır. Banka bağlama, body atak kartı, admin akıllı uyarıları, pets panelleri beta-sonrasına bırakılabilir.

**Orta vadeli temizlik:** "fark ediyor ama dinleyen yok" kalıbını kapat (ölü olaylara dinleyici ekle ya da kaldır); finans analiz motorunu kendi formlarına bağla; admin'i gerçek olay sistemine taşı.
