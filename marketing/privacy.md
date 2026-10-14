# privacy policy

**effective date:** 2026-05-14
**last updated:** 2026-10-14

ollie is an adhd-built personal tool for tracking finance, health, habits, journals, and life admin. this policy explains what data ollie collects, how it is stored, and what choices you have.

we wrote this in plain sentences. if anything is unclear, write to support@ollie.app.

---

## tl;dr

- most of your data lives on your device, in an encrypted database whose key is held in your device's secure keychain (protected by your device lock — face id, touch id, or passcode).
- to sort a brain dump into your modules, ollie sends it to ollie's ai service. before any outside ai model sees it, names, contact details, id-like numbers and sensitive health, mental-health, medication and sexual content are removed. the scrubbed text is then processed by the ai providers listed below. if a dump contains crisis language, ollie stops all ai processing for it.
- ollie collects crash reports and session replays so the app stays usable. you cannot turn this off and still use the app.
- ollie collects anonymized text contributions for research **only if you opt in**. the default is off.
- if you opt in and later change your mind, future contributions stop. past contributions are already anonymized and remain in the research corpus.
- you can export your data, or delete your account by writing to support@ollie.app at any time (every row tied to your account is erased).

---

## who runs ollie

ollie is operated by [TBD: legal entity name, jurisdiction, registered address]. contact: support@ollie.app.

---

## what data ollie collects

### 1. module entries (lives on your device)

ollie's modules let you log:

- **finance** — bills, subscriptions, transactions, and spending you log manually
- **cycle** — menstrual cycle dates, symptoms, mood, flow
- **body** — sleep, weight, food notes, symptoms, body observations
- **habits** — habit definitions and completion logs
- **goals** — goal definitions and progress notes
- **work** — tasks, project notes, focus sessions
- **grocery / pantry** — shopping lists, household items
- **pets** — pet records, vet visits, feeding logs
- **journal** — free-form writing
- **admin** — bills, appointments, documents, reminders
- **burhan** — chat history with the in-app companion

all of this is stored on your device. cloud sync of module content is not enabled in this version — these entries do not leave your device.

### 2. brain dumps

ollie's "brain dump" surface accepts free-form text, voice notes and photos. the entries you keep live on your device, but **to sort a dump into the right modules, ollie sends it to its own ai service** (running on cloudflare). this happens for every dump, whether or not research opt-in is on. see "how ollie's ai handles your text" below for exactly what is sent where.

if you have **research opt-in** turned on, ollie will also:

1. send the scrubbed text to ollie's research corpus;
2. label the corpus with anthropic's claude api to tag patterns.

### how ollie's ai handles your text

1. **scrub first.** before any outside ai model sees a dump, `@ollie/pii-scrub` removes, in this order: mental-health, medical, medication and sexual content; urls, email addresses, gps coordinates, postal addresses and phone numbers; long numbers that look like account or id numbers (money amounts are kept); and first and last names.
2. **crisis check.** if the dump contains crisis language (english, turkish or spanish), ollie stops: nothing is sent to an ai model, nothing is stored or logged as text, and the app shows support information instead.
3. **sorting.** the scrubbed text is split into items. each item is turned into a numeric "embedding" by **voyage ai** so ollie can recognise things you have said before; these embeddings and the module they were sorted into are kept in a cache that only matches your own earlier inputs. items ollie has not seen before are classified by **groq**, with **cloudflare workers ai**, **google gemini** and **openrouter** as fallbacks if groq is unavailable. ollie keeps a short-lived copy of the result for one hour so a repeated request does not run twice.
4. **filing an item into a module.** when an item is filed into a module (for example medication or sleep), that single item is sent to the model so it can read the domain term — such as a symptom or a medication name.
5. **photos and voice.** a photo you attach is described by **google gemini** first; the scrub then runs on the description together with your text. a voice note is transcribed by **groq** (whisper) before the same steps run.
6. the raw, unscrubbed text is returned only to your own device. ollie's ai service logs lengths and structure, never the text itself.

### 3. crash analytics and session replay

ollie sends crash reports, error stack traces, and session replays to sentry. session replay records ui interactions, not raw input from sensitive fields (journal text and other sensitive inputs are masked).

this is collected under "necessary consent". ollie will not run without it. the data is used to diagnose bugs and ship fixes.

### 4. environment data

ollie may resolve your approximate location from your ip address (bigdatacloud) to surface relevant crisis hotlines and a weather widget (open-meteo). ip is not stored long-term; only the resolved city is.

### 5. account credentials

your email is stored by **clerk**, ollie's sign-in provider, so you can sign in across devices. if you allow notifications, your device's push token is stored so ollie can send them through **apple push notification service**. the key that encrypts your on-device data is generated on your device and held in its operating-system keychain — it **never leaves your device** and ollie never sees it.

---

## third-party services

ollie relies on the following third-party providers. each has its own privacy policy.

| provider | purpose | data shared |
|---|---|---|
| cloudflare | hosts ollie's ai service, short-lived request cache, embedding cache, scheduled jobs | brain dump text in transit; scrubbed embeddings and module labels; request metadata |
| voyage ai | embeddings for sorting | scrubbed brain dump items |
| groq | sorting and module filing (main model); voice transcription | scrubbed brain dump items; single items being filed; voice notes |
| google gemini | fallback sorting; photo description | scrubbed items (fallback); photos you attach |
| openrouter | last-resort fallback sorting | scrubbed brain dump items |
| anthropic claude | research corpus labeling and enrichment (only if you opt in) | pii-scrubbed brain dump text |
| clerk | sign-in and account identity | email, sign-in data |
| apple push notification service | notifications (only if you allow them) | device push token, notification content |
| sentry | crash analytics, session replay | error stacks, sanitized session interactions, device + browser metadata |
| bigdatacloud | ip → approximate city | your ip at request time |
| open-meteo | weather | resolved city coordinates |
| supabase | database for account metadata, consent records, hashed usage telemetry, optional encrypted sync, research corpus | account + consent metadata, telemetry keyed by a hashed id, encrypted sync data (if you turn sync on), (opt-in) anonymized research rows |

ollie does not sell your data. ollie does not use advertising networks.

---

## how data is stored

### on your device

modules are stored locally in an encrypted sqlite database (sqlcipher, aes-256). the encryption key is generated on your device at first launch and held in your device's operating-system keychain (apple keychain), protected by your device lock — face id, touch id, or passcode. ollie never sees this key and it never leaves your device. the most sensitive modules — cycle, medication, mood, journal, and brain dumps — are additionally never written to the browser's plaintext storage. if device encryption cannot be established, ollie refuses to start rather than run on plaintext.

### on ollie's server

cloud sync is optional and **off by default**. if you turn it on, your module data is encrypted on your device (aes-gcm-256, with a key derived from your passphrase) before upload, and ollie's server stores only the encrypted copy. ollie's server (supabase postgres) otherwise stores your account metadata and consent state, usage telemetry keyed by a hashed identifier (never your email or the text you write), and — if you opt in — anonymized research contributions (see below). the text of your brain dumps is not stored on ollie's server, except as the scrubbed embeddings and module labels described above.

note: this is **not** a zero-knowledge system. ollie's server operators have technical access to the database holding your email, account metadata, and consent state.

### research corpus

if you opt in, anonymized text contributions are stored in a separate `research_corpus` table. these rows are not tied to your account email. they carry a random pseudonym so duplicate contributions can be deduplicated, but they cannot be linked back to you by ollie.

### deletion

most of your data lives on your device, so deleting the app removes it. to also erase the account data ollie's server holds (your email, account metadata, and consent state), email support@ollie.app and ollie will delete every row tied to your account — your module, finance, notification, and account-metadata tables, then your auth user row — and confirm in writing. a one-tap in-app "delete account" flow is coming in a later version.

only the anonymized `research_corpus` rows you contributed (if you opted in) remain after deletion; they carry no identifier linking them to you.

---

## consent model

ollie uses a two-toggle consent model, set during onboarding and revisitable in settings.

### necessary (locked on)

covers crash analytics and session replay. ollie cannot run without this. the only way to revoke necessary consent is to delete your account.

### research opt-in (default off)

covers anonymized brain dump contributions to ollie's research corpus.

- off by default
- togglable any time from settings
- turning it off stops **future** contributions
- past contributions, having already been anonymized and de-identified at the time of submission, remain in the corpus

ollie cannot retroactively scrub the research corpus of your past contributions because those contributions carry no identifier linking them to you.

---

## pii scrub

before any text is sent to an outside ai model or to the research corpus, ollie runs it through `@ollie/pii-scrub`, which removes:

- mental-health, medical, medication and sexual content
- urls, email addresses, gps coordinates and street addresses
- phone numbers (us, turkish, dutch and spanish formats)
- long numbers that look like account, card or id numbers
- first and last names

the scrub is heuristic, not perfect. if you mention something sensitive in a way the scrub does not catch, it may be transmitted. for that reason, ollie recommends not writing sensitive identifying details into brain dumps.

---

## what ollie does with the research corpus

contributions to the research corpus may be used to:

1. improve ollie's adhd-focused features internally
2. train internal models
3. share aggregate patterns or anonymized excerpts with research partners, including third-party companies in adjacent industries

ollie has not yet entered any partner-sharing agreements. when ollie does, users will be notified in-app and via email **before** any data is shared with that specific partner. opting out at that point stops future contributions; past corpus rows remain anonymized in storage.

---

## your rights

regardless of where you live, you can:

- **export** an encrypted .json backup of your local data from settings → export backup
- **import** the same backup on any device
- **toggle research opt-in** from settings at any time
- **delete your account** by emailing support@ollie.app: ollie erases every row tied to your account across its database (module blobs, finance records, scheduled jobs, profile metadata) and then deletes your auth user row, and confirms in writing. deleting the app removes your on-device data. anonymized research contributions, if you opted in, remain in the research corpus — they carry no identifier linking them back to you and cannot be retroactively scrubbed (see "research corpus" above)
- **request manual data deletion** by emailing support@ollie.app — useful if the in-app flow fails or you want a written confirmation

### gdpr (eu / uk users)

under gdpr you also have the right to:

- access the data ollie holds about you
- correct inaccurate data
- request erasure
- restrict or object to processing
- data portability (covered by export)
- withdraw consent at any time
- lodge a complaint with your local data protection authority

contact support@ollie.app to exercise any of these rights. ollie aims to respond within 30 days.

### ccpa (california users)

california residents can:

- know what categories of personal information ollie collects
- request deletion of personal information
- opt out of "sale" of personal information (ollie does not sell personal information; "sharing" anonymized research with future partners is governed by the opt-in toggle)
- not be discriminated against for exercising rights

contact support@ollie.app.

---

## data breach notification

if ollie discovers a breach affecting your personal data, ollie will notify the competent data protection authority within 72 hours where the law requires it, and will notify you by email **without undue delay** when the breach is likely to put your rights at high risk, explaining what was affected and what steps to take.

---

## cookies

ollie's app does not set marketing cookies. sentry may set tracing cookies under the necessary consent scope to correlate session events for error diagnosis. if ollie ever launches a marketing website that uses analytics cookies, those will be governed by a separate banner with explicit opt-in.

---

## children

ollie is not directed at children under 13. ollie does not knowingly collect data from children under 13. if you believe a child has provided data to ollie, contact support@ollie.app and the data will be deleted.

---

## changes to this policy

ollie may update this policy. the "last updated" date at the top reflects the most recent change. material changes (new third-party processors, new categories of data, changes to the research corpus terms) will trigger an in-app notice before they take effect.

---

## contact

questions, data requests, complaints:
**support@ollie.app**

physical mail: [TBD: postal address tied to legal entity]
