# Ollie, uygulamanın dışında yaşar — Plan (2026-06-28)

Tema: Ollie sadece kendi uygulamasında değil, telefonun OS'unda da var olsun.
Üç parça: **(1) Apple Reminders senkronu** · (2) Widget · (3) "Hey Siri, tell Ollie…".
Bu doküman şu an **(1)**'i tam yazıyor; (2) ve (3) konuşuldukça doldurulacak.

---

## 1) Ollie ↔ Apple Reminders

### Problem (1 cümle)
Ollie hatırlatmaları sadece kuruldukları cihazda çalışıyor; kullanıcı diğer Apple cihazlarında göremiyor ve Ollie kapalıyken bağlama göre ayarlayamıyor.

### Kullanıcı (1 kişi)
Serra — iPhone + Mac kullanıyor, ADHD, önemli yenileme/randevu/deadline hatırlatmalarını kaçırmak istemiyor.

### Ana fikir (akış)
1. **Ollie'nin beyni karar verir:** bu hatırlatma "önemli + tarihli" mi? (renewals, deadline, randevu, açık "remind me to X")
2. Evetse → Ollie, kullanıcının Apple Reminders'ında özel bir **"Ollie" listesine** yazar (EventKit API). iCloud bunu tüm Apple cihazlarına **bedava senkronlar**.
3. Ollie yazdığı her öğenin **kimliğini (identifier) saklar** → öğeler Ollie'nin malı kalır.
4. Bağlam değişince (mood düşük, plan değişti) Ollie o öğeyi **siler / erteler / yumuşatır**. Apple = teslim + senkron "kası"; **akıl Ollie'de** (Beyin/Beden ayrımı).
5. **Ne zaman ayarlar:** kullanıcı uygulamayı açınca anında + sunucu sessiz-dürtmesi / iOS arka-plan uyanmalarında (günde birkaç kez, anlık değil).
6. **Hassas + akıllı mikro-dürtmeler** (mood check-in, cycle, ADHD nudge merdiveni) Ollie-native kalır, iCloud'a gitmez.

### Data modeli (nerede saklanır)
- Ollie tarafı (yerel SQLite, reminder tablosu): `{ ollieReminderId, ekIdentifier, module, fireAt, status }`
- Apple tarafı: dedike **"Ollie"** listesi (kullanıcının diğer listelerine karışmaz).

### Başarı kriterleri (3, test edilebilir)
1. iPhone'da kurulan "renew passport" hatırlatması, Mac'in Apple Reminders'ında ~1 dk içinde görünür.
2. "Mood low" işaretlenince Ollie bugünün Apple hatırlatmasını bir sonraki uyanmada kaldırır/erteler (kanıt: öğe Apple listesinden gider).
3. Kullanıcı öğeyi Apple'da tamamlayınca Ollie bunu "yapıldı" olarak okur.

### v1'e GİRMEYECEKLER
- Tüm uygulamanın çoklu-cihaz senkronu (regl / dump / mood) — ayrı, büyük proje. Bu plan onu çözmez.
- Tam iki yönlü düzenleme (kullanıcı Apple'da metni değiştirirse Ollie'ye yansısın) — sadece **tamamlama-okuma** var.
- Android — Ollie zaten Apple-only.
- Takvim (saat bloklu event'ler) — önce Reminders; Calendar sonraya.

### Bilinen riskler / önkoşullar
- EventKit izni (tek seferlik "Ollie Reminders'a erişsin mi?" popup'ı).
- iOS arka-plan limitleri: anlık değil; günde birkaç kez + açılışta. Sessiz-push (Ollie'nin mevcut sunucusu) sıklığı artırır (~saatte 1-2, garanti değil).
- Force-quit (uygulamayı yukarı kaydırıp atmak) + Düşük Güç Modu arka planı keser.
- Native köprü gerekir (Rust ↔ EventKit, mevcut `UNUserNotificationCenter` local-notification koduyla aynı desen).
- **Ortak önkoşul:** Apple Developer / Xcode imzalama kurulumu (widget + Siri ile paylaşılır).

---

## 2) Widget — KARARLAŞTIRILDI (2026-06-28)

### Problem (1 cümle)
ADHD'de düşünce uçar (yakalama sürtünmesi) + önemli tek şey uygulamayı açmadan göz ucuyla görünmüyor.

### Tasarım (hibrit: tek bakış + yakalama)
- **Küçük** widget (tek odak). Kilit ekranı / orta-büyük boy sonraya.
- Üstte **Ollie'nin beyninin seçtiği tek önemli şey** (hatırlatma / deadline / nazik dürtü).
- Acil bir şey yokken **sakin mesaj** ("bugün rahat") — sahte aciliyet yok.
- Altta **"+ bir şey at"** → dump.
- **İki dokunma bölgesi:** öğeye dokun → o modül açılır; "+ bir şey at" → dump ekranı.
- **ADHD-güvenli:** streak yok, sayı yok, sahte aciliyet yok (bkz. no-streaks kuralı).

```
DOLU:                 BOŞ:
┌────────────┐        ┌────────────┐
│ şimdi    🍃 │        │ 🍃         │
│ ilacını al  │        │ bugün rahat│
│ · 21:00     │        │ ────────── │
│ ────────── │        │ + bir şey at│
│ + bir şey at│        └────────────┘
└────────────┘
```

### Data modeli (nerede saklanır)
- Ollie, beyninin **o anki seçimini** + dump deep-link'ini paylaşımlı bir kaba (App Group container) yazar: `{ topItem: {text, time, deepLink} | null }`.
- Widget (WidgetKit extension) bu snapshot'ı okur + render eder.

### Yenileme
- WidgetKit timeline: günde birkaç kez (OS-throttled, bkz. arka-plan limitleri) + Ollie seçimi güncelleyince `reloadTimelines()`.

### Başarı kriterleri (3)
1. Acil bir şey varken widget onu gösterir; dokununca doğru modül açılır.
2. Hiçbir şey acil değilken "bugün rahat" görünür (boş/çökmüş değil).
3. "+ bir şey at" → dump ekranı anında açılır (deep-link).

### v1'e GİRMEYECEKLER
- Kilit ekranı + orta/büyük boy widget.
- Widget'tan doğrudan tamamlama/işaretleme (sadece açar, deep-link).

### Önkoşul
- App Group (uygulama ↔ widget extension paylaşımlı kap) + Swift WidgetKit extension. Tauri app snapshot'ı yazar.
- **Apple Developer / Xcode imzalama** (reminders + Siri ile ortak; widget işi daha önce burada bloke olmuştu — Apple ID Xcode'a eklenecek).

## 3) "Hey Siri, tell Ollie …" — KARARLAŞTIRILDI (2026-06-28)

### Problem (1 cümle)
Eller serbest, uygulamayı açmadan/yazmadan hem bir şey atmak hem hızlı cevap almak.

### Tasarım (yakalama + sınırlı soru)
- **Yakalama:** "Hey Siri, tell Ollie süt aldım" → Siri sesi yazıya çevirir → Ollie'nin App Intent'i → normal **dump pipeline** (AI yönlendirir) → Siri kısaca "tamam" (Ollie'nin sessiz-ack tarzı).
- **Soru (sınırlı):** "Hey Siri, Ollie sıradaki ne?" → App Intent, beynin seçtiği **tek önemli şeyi** (widget'taki aynı snapshot) okur → Siri sesli söyler.
- Tetik: "tell Ollie" + App Shortcut kısa ifade ("Ollie").
- **Eller serbest, kilitliyken** çalışır, uygulamayı açmadan (ağ + giriş yapılmış olmalı).

### Data modeli (nerede saklanır)
- Yakalama: mevcut dump pipeline'ı kullanır (yeni depo yok).
- Soru: widget'ın yazdığı **App Group snapshot**'ını (beynin top pick'i) okur — tek kaynak, çift kullanım.

### Başarı kriterleri (3)
1. Kilitli telefonda "tell Ollie X" → uygulama açılmadan dump kaydolur, Siri "tamam" der.
2. "Ollie sıradaki ne?" → Siri o anki tek önemli şeyi doğru okur.
3. Atılan şey, yazarak atılmış dump'la aynı şekilde doğru modüle gider.

### v1'e GİRMEYECEKLER
- Açık uçlu sohbet / çok-turlu Q&A (sadece "sıradaki/bugün" sorusu).
- Sesli uzun özet okuma.

### Önkoşul
- iOS **App Intents** (Swift) + App Shortcut ifadesi.
- **Apple Developer / Xcode imzalama** (reminders + widget ile ortak kapı).
