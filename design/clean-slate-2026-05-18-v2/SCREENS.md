# Ollie — Clean-Slate v2 · Complete Screen Inventory

**Date:** 2026-05-18 · design language locked in `DIRECTION.md` + `mockups/*.html`.
This is the exhaustive screen list for the approved v2 ("calm notebook"): every
screen the app needs, spec'd in the v2 grammar — calm in style, concrete in
substance, glance → expand → detail.

**Legend:** ✅ already mocked in v2 · ▢ spec-only (not yet mocked).

**The grammar, restated:** warm paper `#FAF6EF`, ink `#2A2622`, one amber accent
`#C9923E`, sage `#5B8C7E` for calm/observed marks. Find dot top-left, Safe dot
top-right — every non-capture screen. Back = swipe-down on the handle. One focus
object per screen, in air. Every line of data is real and concrete.

---

## Group 1 · Capture (the front)

The app opens here. Three swipeable screens + the modules view = four dots.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | **Throw** | home — the catcher | One input ("throw a thought…"), one ink mic. Nothing else. Idle pulse on the mic. Dots: position 1 of 4. |
| ✅ | **Listening** | voice capture, in progress | Dark canvas, one breathing sage ring, a live waveform. Zero words. Glyph-X dismisses. |
| ✅ | **Caught** | the thought landed | One card: the thought you threw, a sage checkmark, the drawer glyph it sorted into. Swipe-history dots for older catches. |
| ✅ | **Noticed** | one pattern the app found | One observed-link mark, one calm sentence ("coffee after 3pm — you sleep 40min less"). Faint dots = more patterns wait. No feed. |

**Subtotal: 4** (4 ✅ · 0 ▢)

---

## Group 2 · Always-on

Reachable from every screen via the two fixed dots, plus crisis above all gates.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | **Find** | search the whole notebook | One search field, swipe-down to dismiss. Result count line. Results in info-card grammar, each with its path crumb (`home › admin`, `caught · 3 days ago`). Reaches thrown thoughts, submodule data, grocery lines, goals, or a submodule by name. |
| ✅ | **Safe** | crisis surface | Full-bleed deep-green. One slow breathing orb, two big targets: Call · Breathe. No forms. One tap from any screen. Reachable above all gates. |
| ▢ | Find — empty result | nothing matched | Same field, one calm line ("nothing in the notebook yet"). No error styling. |
| ▢ | Safe — breathing | the pacer, expanded | Tapping Breathe: the orb fills the screen, slow 4-in / 4-hold / 6-out pacing, a quiet 5-4-3-2-1 grounding note. One exit. Zero telemetry. |

**Subtotal: 4** (2 ✅ · 2 ▢)

---

## Group 3 · The 4 modules (Level 1)

One swipe past capture. The only place all four rooms live together.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | **Modules** | the four calm rooms | Four cards, one word + glyph each: money · body · home · work. No counts, no titles. Tap a room → its page pushes on. Dots: position 4 of 4. |

**Subtotal: 1** (1 ✅ · 0 ▢)

---

## Group 4 · Module pages (Level 2)

Tap a room → its page pushes on. Submodules are expandable info-cards: collapsed
(glyph + name + one glanceable line) → expand inline (2–4 quiet lines) → tap → detail.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | **Money** | the money room | Special — one submodule, so the page *is* one rich finance card: safe-to-spend `$312`, horizon line, next bill, spent today. `open finance →`. |
| ✅ | **Body** | the body room | Five info-cards: cycle (`day 14 · luteal`) · sleep (`7h 20m`) · body (`last logged headache`) · medication (`next 2:00pm · 1 of 2`) · habits (`3 waiting`). |
| ✅ | **Home** | the home room | Three info-cards: admin (`2 due this week`) · pets (`flea drops for Mango · tomorrow`) · grocery (`4 on the list`, expands to peek the lines). |
| ✅ | **Work** | the work room | Two info-cards: work (`50m focused today · 1 running`) · goals (`learn Spanish · 40%`). |

**Subtotal: 4** (4 ✅ · 0 ▢)

---

## Group 5 · Submodule detail pages (Level 3)

Tap an expanded card → the leaf page pushes on. One focus object in air. Find +
Safe + swipe-down-back ride this level too.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | **finance** · in money | one number — safe to spend | `$312` huge, soft horizon line, "11 days left". One amber add-spend button. Drill for bills, income, subscriptions. |
| ✅ | **sleep** · in body | last night's length | Duration `7h 20m` on a progress ring, moon glyph. One amber log button. |
| ✅ | **cycle** · in body | where you are in the cycle | One travelling dot on a closed ring, soft fertile-window arc, `day 14 · luteal`, "period in 12 days". One amber log button. |
| ✅ | **habits** · in body | the single next check-in | One big tap-circle, the habit name large ("drink water"), dots below count what still waits. Tap = done, next slides in. No grid, no streaks. |
| ✅ | **grocery** · in home | the list | Plain torn-note lines, tap a line = strike through. One amber add button. The list is the one thing. |
| ▢ | **body** · in body | the last thing the body logged | One line — most recent symptom/episode ("headache · 2h ago") — on the same calm canvas. If an episode is open: a quiet "still going · day 2" with a close action. One amber log button. |
| ▢ | **medication** · in body | the next dose | One dose name + time large, "1 of 2 taken today" below. One big take-circle (mirrors habits). Quiet dots for remaining doses. |
| ▢ | **admin** · in home | the next thing due | One task headline + its due date, an umber urgency tint when overdue. Quiet count of others waiting. One amber add button. |
| ▢ | **pets** · in home | the next care item | One pet + the next care thing ("flea drops for Mango · tomorrow"). If multiple pets: swipe between them. One amber log-care button. |
| ▢ | **work** · in work | the focus state | If a task is running: a live focus timer is the one thing. If idle: the next deep-work block + a start-focus button. Quiet "tasks waiting · 4". |
| ▢ | **goals** · in work | one goal's progress | One goal name, a soft progress ring/bar, "next milestone in 3 days". Swipe between goals if more than one. |

**Subtotal: 11** (5 ✅ · 6 ▢)

---

## Group 6 · Entry / log / deeper sub-screens

Each detail page needs an add-flow and, where there's history, a log view. All
push on top of the leaf, all keep the v2 calm-canvas grammar.

### Capture-tied
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Caught — sort correction | the catch went to the wrong drawer | The caught card, the drawer glyphs in a quiet row, tap the right one. One calm line ("moved to admin"). |
| ▢ | Voice — review transcript | catch a mis-hear before sending | "heard · …" confirmation, the transcript editable inline, one send target. If speech unsupported: an honest "voice isn't available here" note. |

### finance
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Log a spend | the amount, fast | One number pad, one calm category line. Optional impulse-pause if the spend is large + similar to a recent one. |
| ▢ | Bills & income | the recurring picture | Quiet list of upcoming bills with dates; income set as one line. Add-as-bill / add-as-subscription. |
| ▢ | Subscription audit | what looks dormant | One subscription at a time — "Netflix · charged monthly, not in your words for 6 weeks". Keep / cancel-reminder. Calm, never accusatory. |
| ▢ | Savings | one saved-toward thing | A goal name, amount-so-far on a soft horizon line. Add to savings. |
| ▢ | Tax set-aside | the self-employed slice | One set-aside number, jurisdiction shown. Export the ADHD tax report (PDF). Only when self-employed is on. |

### sleep
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Log last night | bedtime + wake | Two time fields, calm. "noted." on save. |
| ▢ | Wind-down checklist | tonight's small steps | A short tap-list (3 of 5), one item per line. No streak. |
| ▢ | Sleep history | the trend, quietly | 7-night durations as a soft sparkline, the average as one line. No grades. |
| ▢ | Go-deeper survey | insomnia / Epworth screen | One survey question per screen (mirrors onboarding), a calm scored result line at the end. |
| ▢ | Sleep sounds | a quiet player | One sound name, play/pause, a soft timer. Brown noise etc. |

### cycle
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Log today | period / symptom / nothing | A few quiet taps — flow, a symptom or two. "noted." |
| ▢ | Pill log | today's pill | One tap-circle, "taken" / "not yet". Only when birth-control is on. |
| ▢ | Cycle history | past cycles, calm | Past cycle lengths as soft rings or a quiet list. Predictions stated as one line. |

### body
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Log a symptom | what the body did | One symptom field, an optional severity tap. Suggests an episode kind if it recurs. |
| ▢ | Episode timeline | a running thing | One open episode — its day count, the severity dots logged so far, a close action. |
| ▢ | Doctor summary | a thing to bring in | The episode written out plainly, copy-able. No diagnosis language. |
| ▢ | Water + supplements | the day's intake | A quiet water count, supplement taps. Never mentions calories. |

### medication
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a medication | name it once | Name, kind (vitamin / supplement / prescription / otc), optional schedule times. |
| ▢ | Adherence log | what was taken, when | A calm per-med list, today's logged doses. Dry "noted." voice, no streak. |

### habits
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a habit | name + cue | One name field, one cue line ("after coffee"), an optional morning/anytime/evening tag. |
| ▢ | Habit history | the quiet record | Each habit, its recent check-ins as soft dots. No grid wall, no streak number. |

### admin
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a task | the thing to do | One task field, an optional due date. Renewal tasks get a calm staged-cue line. |
| ▢ | Phone-call cluster | the calls to make | Tasks that need a phone call, grouped — the one ADHD-hard thing surfaced gently. |

### pets
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a pet | name + species | Name, species, optional nickname. (Also in onboarding.) |
| ▢ | Log care | what you did for them | One care line ("flea drops"), the pet picked. "noted." |
| ▢ | Pet observation | something you noticed | A free note about the pet, calm. Feeds health-flag detection. |
| ▢ | Pet profile | one pet, at rest | The pet's name + portrait, care gaps as one quiet line, milestones. |

### grocery
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add an item | say the next thing | One input. Duplicate detection shows a calm "already on the list". |
| ▢ | Pantry | what's kept at home | Plain lines of staples, the editorial torn-note grammar. Tap to remove. |
| ▢ | Recipes | what the list could become | One inferred recipe at a time from items on the list. Quiet, optional. |

### work
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a task | the thing to do | One task field. |
| ▢ | Focus session | a running block | One large timer, the task name, a stop target. 90-min block aware. |
| ▢ | Projects | the bigger things | A quiet list of projects, each with one progress line. |
| ▢ | Distraction journal | what pulled you away | One free line ("slack again"), a calm recent list. Non-judgmental — just makes the pattern visible. |
| ▢ | Deep-work scheduler | when the next block is | One next-block time, set against the best-work-time preference. |

### goals
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Add a goal | name + category | One goal name, a category (career / health / learning / …). |
| ▢ | Milestones | the steps inside a goal | A quiet list of milestones, tap to mark done — progress auto-computes. AI step-breakdown offered as one calm action. |
| ▢ | Goal review | a soft check-in | One reflective prompt, a free line. Ulysses-contract shown if one was set. No score. |

### dump (the thrown-thought archive)
| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Caught archive | every thought, by day | Day-grouped list of thrown thoughts ("today", "yesterday"), each one line. Reached via Find or a Caught "see all". |
| ▢ | Resurfaced | a thought worth seeing again | One older thought the app brought back up — an anniversary, a semantic echo. One calm line, like Noticed. |

**Subtotal: 36** (0 ✅ · 36 ▢)

---

## Group 7 · Onboarding (first run)

One question per screen, one glyph, skip top-right, progress dots. 8 steps.
`onboarding.html` mocks the shape — every step follows it.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ✅ | Onboarding shell | the calm precedent | One glyph, one question, one input, one forward target, skip. (`onboarding.html`) |
| ▢ | 0 · Name | what to call you | Name input + country picker. "let's go". |
| ▢ | 1 · Pets | any pets? | yes/no; if yes, add pet rows (name + species). |
| ▢ | 2 · Pantry | staples you keep | Tap-to-remove chips of default staples. |
| ▢ | 3 · Subscriptions | what you pay for | Tap-to-confirm subscription chips + a calm audit disclosure line. |
| ▢ | 4 · Apple Health | optional connect | HealthKit consent; auto-skips when HealthKit is off (the default). |
| ▢ | 5 · Work time | when you work best | Single-select chips: morning / afternoon / evening / late night / all over. |
| ▢ | 6 · Cycle | do you track a cycle? | Single-select: yes / no / not anymore / postpartum. Drives whether cycle shows at all. |
| ▢ | 7 · Burhan | meet the olive tree | Burhan seedling, one line ("he grows as you use ollie"), "let's go". |

**Subtotal: 9** (1 ✅ · 8 ▢) — 1 shell mock + 8 step specs.

---

## Group 8 · Gates (pre-app, first run / re-entry)

Blocking surfaces before the notebook. All in v2 calm grammar, none mocked yet.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Auth — fork | sign up or log in | First-launch picker. Two calm targets. |
| ▢ | Auth — sign up | email + passphrase | Email, passphrase + strength meter, confirm, one ack. Passphrase never leaves the device. |
| ▢ | Auth — sign in | returning user | Email + passphrase, email pre-filled. |
| ▢ | Auth — forgot | passphrase explainer | One calm screen: the passphrase is unrecoverable by design. No reset form. |
| ▢ | Consent | the one consent surface | Two toggles: marketing (default on) · necessary (off → tap to flip on, then locked). Continue gated on necessary. |
| ▢ | Research opt-in | the anonymized-data ask | One calm explainer, opt-in toggle, continue. Off-switch promised. |
| ▢ | Notification primer | what notifications are | One-time, after onboarding. Calm explainer, "turn them on" / "not now". Shown once. |
| ▢ | App-lock gate | the privacy curtain | Full-cover re-entry: Face ID / fingerprint prompt. Escape paths: try again → use passphrase. Honest "you're already signed in" framing. |

**Subtotal: 8** (0 ✅ · 8 ▢)

---

## Group 9 · Settings

Reached from a quiet entry (the `who` cluster or a Find result). One scrolling
page in v2 grammar; each section below is a distinct, spec-able region — and
the data flows (export/import/delete) are real sub-surfaces.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Settings — main | the one settings page | Calm scroll of sections, each a hairline-divided block. Back top-left. |
| ▢ | · Account | email · sign-out · delete | Email shown, sign-out, delete-account. |
| ▢ | · Invite a friend | private-beta invites | `x / 5 this week`, active code, generate / copy-link. Resets Sunday. |
| ▢ | · Notifications | how much ollie pings | Push permission, daily budget slider (1–10), per-category mute toggles. |
| ▢ | · Health | cycle-related toggle | Birth-control toggle (gates the pill log). |
| ▢ | · Finance | self-employed | Self-employed toggle → tax jurisdiction (us / uk / eu). |
| ▢ | · Privacy | consent + country + data | Necessary (locked-on), marketing toggle, country, export / import. |
| ▢ | · Security | the app-lock opt-in | Face ID / fingerprint toggle; honest "privacy curtain, not auth" hint. |
| ▢ | · Research data | the opt-in off-switch | Research toggle, an inline calm ack on flip. |
| ▢ | · About | version + links | Version, privacy policy, terms, support. |
| ▢ | Delete-account confirm | the final check | Modal: erases local + every server row, no undo. Cancel / delete. |
| ▢ | Export backup | encrypted .json out | Passphrase prompt (16+ chars), a calm "backup exported" line. |
| ▢ | Import backup | replace from a file | File pick, passphrase prompt, "imported · N modules". |

**Subtotal: 13** (0 ✅ · 13 ▢)

---

## Group 10 · Other (companion surfaces)

Real screens in the app that sit outside the 3-level IA.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | Garden | Burhan, the olive tree | A cinematic Mediterranean tableau. Burhan grows additively with use — never decays. No water, no health bar. One quiet exit. |
| ▢ | Insights | the weekly review | A calm editorial digest of the last 7 days across modules. Hide-not-lie: a section shows only if real data exists. No scores, no grades. |
| ▢ | Gallery | a shelf of finished things | Completed goals + milestones, set down to rest. Not a trophy wall, no counts-as-pressure. |
| ▢ | Day-30 prompt | the one-month card | Non-blocking dismissible card: share ollie / tell us what's missing. Fires once. |

**Subtotal: 4** (0 ✅ · 4 ▢)

---

## Group 11 · Key states (distinct enough to spec)

States that are a real, distinct screen — not just a variant. The v2 rule:
**empty states are loved more than full ones.** Each is one calm line + the
single action that fills it.

| | Screen | What it is | What's on it |
|---|---|---|---|
| ▢ | First-run notebook | the app before any data | Module pages with submodule cards still present, each glance-line reading the calm empty form ("no spend logged yet", "no habits yet — add one"). Never a blank page. |
| ▢ | Empty submodule card | a submodule with nothing in it | Collapsed card keeps its glyph + name; glance-line is a quiet invitation, not a zero. Expand shows one add cue. |
| ▢ | Caught — nothing yet | no thoughts thrown | One calm line on the Caught screen ("nothing caught yet — throw something"). |
| ▢ | Noticed — nothing yet | no patterns found | One calm line ("ollie hasn't noticed anything yet — it needs a few days"). No empty feed. |
| ▢ | Offline | no connection | A quiet inline line where sync would happen ("offline — saved on this device"). The notebook still fully works; no blocking wall. |
| ▢ | Error fallback | something broke | One calm full-screen surface: a plain line, one "reload" target. No stack trace, no red. |

**Subtotal: 6** (0 ✅ · 6 ▢)

---

## TOTAL

| Group | Count | ✅ mocked | ▢ spec-only |
|---|---:|---:|---:|
| 1 · Capture | 4 | 4 | 0 |
| 2 · Always-on | 4 | 2 | 2 |
| 3 · The 4 modules (L1) | 1 | 1 | 0 |
| 4 · Module pages (L2) | 4 | 4 | 0 |
| 5 · Submodule detail (L3) | 11 | 5 | 6 |
| 6 · Entry / log sub-screens | 36 | 0 | 36 |
| 7 · Onboarding | 9 | 1 | 8 |
| 8 · Gates | 8 | 0 | 8 |
| 9 · Settings | 13 | 0 | 13 |
| 10 · Other | 4 | 0 | 4 |
| 11 · Key states | 6 | 0 | 6 |
| **TOTAL** | **100** | **17** | **83** |

**100 screens** — 17 already mocked in v2, 83 to spec/mock. Plus the **Partner
system** (4 new screens, all ✅) — an approved new feature added after this
inventory was frozen; see the Partner section below. Effective mocked total: **21**.

---

## Money module — built 2026-05-18

The MONEY module (= the `finance` submodule; money is the only submodule, so
the Money page **is** finance — no module-card list) is fully mocked in v2
grammar. `money.html` **supersedes** the old `module-money.html` +
`module-finance.html` (both deleted; `index.html` re-pointed).

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Money** · the face | `money.html` | Hero: `safe to spend $312`, horizon line, "11 days left", one amber `+ spend`. Privacy eye glyph (top). Below, 5 calm expandable area-rows — `bills · rent $1,200 · fri` / `income · ~$3.2k/mo · irregular` / `subscriptions · 2 look dormant` / `savings · trip $340 / $1,000` / `adhd tax · $47 this month` — income shown expanded inline. |
| ✅ | **Bills** · L3 | `money-bills.html` | Quiet dated list of upcoming bills (rent, phone, car insurance, electric, internet); soonest amber-tinted. Add-as-bill / add-as-subscription. |
| ✅ | **Income** · L3 | `money-income.html` | Variable-income picture: `~$3.2k/mo · irregular`, a soft 6-month band, quiet/good month, last landed. The view that lowers a freelancer's panic. |
| ✅ | **Subscriptions** · L3 | `money-subscriptions.html` | The audit — ONE subscription at a time ("Netflix · $15/mo · not in your words for 6 weeks"). Keep / cancel (deep-link). Calm, never accusatory. `1 of 2` dots. |
| ✅ | **Savings** · L3 | `money-savings.html` | One saved-toward thing — `a trip`, $340 of $1,000 on a soft horizon line. Add to savings. |
| ✅ | **ADHD tax** · L3 | `money-adhdtax.html` | What ADHD cost this month — `$47`, flat gray breakdown (late fee, duplicate order). Ink number, never red, never shaming, no moralizing. |
| ✅ | **Log a spend** | `money-log-spend.html` | One number pad, one calm category chip. Fast — no date picker, no notes. |
| ✅ | **Impulse pause** | `money-impulse-pause.html` | Opt-in 24h-hold sheet over the dimmed spend screen — fires when a large non-essential spend resembles a recent one. An offer, not a block; neutral tone. |
| ✅ | **Private mode** | `money-private.html` | The Money face, every figure masked to monospace blocks; eye closed; Face ID prompt to unmask. |
| ✅ | **Shopping check** | `money-shopping-check.html` | Optional go-deeper survey (Bergen Shopping Addiction Scale, 7 items, 0–4 Likert). One question per screen, mirrors the sleep survey. Never pushed. |
| ✅ | **Tax set-aside** | `money-tax-setaside.html` | Self-employed only — one set-aside number ($340 ≈ 30%) + jurisdiction chip. Export the ADHD tax report (PDF). |
| ✅ | **Money — first run** | `money-empty.html` | The face with calm empty glance-lines ("nothing logged yet", row invitations). Never a blank page. |
| ✅ | **Notifications** | `money-notifications.html` | The 6 approved money notifications as iOS lock-screen cards — REMINDER (bill due single + aggregated, tax set-aside, impulse hold-up), PATTERN_ALERT (dormant subscription, spending anomaly), CONTENT_DELIVERY (weekly note, opt-in). A footer states what is deliberately never pushed: adhd-tax total, safe-to-spend status, savings progress — screen-only. |

**Money subtotal: 13** (13 ✅). Voice: lowercase, dry, no exclamation; figures
real and concrete. The 5 area-rows replace the old single-card finance L2 — the
face now carries one focus (the number) plus 5 calm rows, exact v2 grammar.

---

## Cycle submodule — built 2026-05-18

The CYCLE submodule (first submodule of the **body** cluster) is fully mocked in
v2 grammar. Reached by drilling the body page's cycle card. `cycle.html`
**supersedes** `module-cycle.html` (the old single-dot ring); `index.html`
re-pointed to `cycle.html` in the Level 3 grid.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Cycle** · the face · L3 | `cycle.html` | One LARGE phase ring (body.html's ring scaled up) — day-14 marker travelling, sage luteal arc, ovulation point marked. `day 14 · luteal` in the ring, prediction line `period likely · may 28 ± 2 days`. One amber `+ log today`. Calm drill rows: pill log · history · partner-ask · a sage `worth a look · 3 long cycles` row (only when a clinical flag is live) → cycle-flags. |
| ✅ | **Log today** | `cycle-log.html` | Symptom tag chips (cramps, bloating, fatigue, headache, mood, bleeding, spotting, cravings, tender, clear), a quiet free-text note line, and a distinct amber-edged `bleeding — day 1` action that starts a new cycle. `noted.` on save. |
| ✅ | **Pill log** | `cycle-pill.html` | The 7-day pill strip — 7 day-dots, each a tailored mark (logged = sage tick, missed = open ink ring, today = amber-edged tappable). Past days back-dateable up to 3. One quiet logged / not-yet state. Birth-control mode surface. |
| ✅ | **History** | `cycle-history.html` | Last 5 closed cycles as calm day-length bars (newest first), mean length as one headline number, an irregular flag as one sage line. No grades. |
| ✅ | **Worth a look** · clinical · screen-only | `cycle-flags.html` | The clinical screen — ACOG-referenced flags (oligomenorrhea, dysmenorrhea, prolonged bleed) + softer syndrome patterns (PCOS signal), each ONE calm line with a quiet `ACOG` source tag and a watch/discuss framing. Sage and ink only — **never red**, never alarmist, never a diagnosis. A "when you have a moment" surface, **never pushed**. |
| ✅ | **My partner** | `my-partner.html` | The cycle face's `my partner` drill row opens the partner system — see the dedicated Partner section below. |
| ✅ | **Cycle — first run** | `cycle-cold.html` | Cold-confidence state — the ring present but bare (no luteal arc, no ovulation point), the prediction honest (`still learning your cycle — a couple more and predictions warm up`). A sage confidence meter. Never a blank page. |
| ✅ | **Notifications** | `cycle-notifications.html` | The 6 approved cycle notifications as iOS lock-screen frames, one per scroll-snap frame — `period likely in ~2 days` · `pill · 9:00pm` · `yesterday's pill — not logged` · `fertile window starts tomorrow` · `heading into luteal — be a little gentler this week` · `it's been 38 days — did a period go unlogged?`. A closing frame states the ACOG clinical flags are deliberately never pushed (screen-only). |

**Cycle subtotal: 8** (8 ✅). How `cycle-flags.html` stays calm: sage + ink only,
never red; each flag is one margin-note line, not a badge or a count; framed as
watch/discuss, never diagnosis; a small outlined `ACOG` source tag is the only
authority mark; and it is screen-only — never delivered as a notification, so
health news never lands on a lock screen.

---

## Sleep submodule — built 2026-05-18

The SLEEP submodule (second submodule of the **body** cluster, after cycle) is
fully mocked in v2 grammar. Reached by drilling the body page's sleep card.
`sleep.html` **supersedes** the old `module-sleep.html` (the old ring leaf,
deleted; `index.html` re-pointed to `sleep.html` in the Level 3 grid).

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Sleep** · the face · L3 | `sleep.html` | One focus — last night's **duration** as the hero (`7h 20m`, big, light), a scaled-up 7-night bar (body.html's bar visual, last night amber) sitting just above it. Two calm lines: `this week · 1h 10m short` (sleep debt), `tonight · ~7h likely` (forecast). One amber `+ log last night`. Calm drill rows: `wind-down` · `history · 6h 50m mean` · `sounds` · `go deeper` · a sage `see the rest` row (only when a pattern is live) → sleep-patterns. |
| ✅ | **Log last night** | `sleep-log.html` | The 4-button quick log (`solid · ok · rough · bad`) as a calm 2×2 of soft tiles — the primary. A calm secondary, set apart by an `or` divider — `say more — i'll parse it` — opens a free-text line that accepts `bed 23:48, woke 6:30, two coffees`, with a quiet hint of the structured fields ollie pulls out (bed · woke · caffeine ×2). `noted.` on save. |
| ✅ | **Wind-down** | `sleep-winddown.html` | The 6-step bedtime ritual — `phone away · water · supplement · lights low · breath/journal · into bed`. A calm sequential tap-through: done steps are quiet sage ticks, one step sits IN FOCUS (amber-edged, larger, a "tap when done" cue), the rest quiet ahead. **No streak** — stated plainly in the closing line. |
| ✅ | **History** | `sleep-history.html` | Last 14 nights as a confident bar chart — body.html's bar grammar scaled up, 14 ink bars on a baseline rule, last night amber, a faint dashed `8h` reference line (a calm reference, never a pass/fail mark). The 14-night average as one headline number; shortest night + 14-day sleep debt as one calm key/value line each. **No grades.** |
| ✅ | **Sounds** | `sleep-sounds.html` | The quiet sleep-sound player — one sound name (`brown noise`) large, a soft play disc with concentric sage sound-rings + an amber play glyph, a 3-dot sound switcher. A soft **sleep timer** (`20m · 45m · 1h · off`) that "fades out gently — no hard stop". Minimal, deeply calm. |
| ✅ | **Go deeper** · clinical · screen-only | `sleep-survey.html` | The go-deeper surveys (Insomnia Check + Epworth). Two phones: the question shape — one question per screen, calm like onboarding, a 0–4 Likert column — and the **screen-only scored result**: a quiet score (`11 / 28`), a 4-segment severity band (the user's band sage-filled, plainly labelled `none · sub-threshold · moderate · severe`), a plain watch/discuss reading, a small sourced `insomnia severity index` tag. **Never red, never pushed.** |
| ✅ | **See the rest** · reflective · screen-only | `sleep-patterns.html` | The reflective home for the 24 sleep patterns ollie does NOT push. Each is ONE calm sage line + a soft reframe, grouped quietly under small section labels: `your shape` (chronotype, bedtime drift, the DSPS pattern — framed "a pattern, not a diagnosis"), `week vs weekend` (social jetlag, the weekend-recovery illusion), `the wind-down` (the stuck-step), `across your modules` (sleep×cycle, sleep×focus, sleep×mood). **No charts wall** — calm reading. A closing note: screen-only, never a notification. |
| ✅ | **Sleep — first run** | `sleep-cold.html` | The few-nights state — the face is present, last night's number real, but the 7-night bar shows 3 logged bars + 4 faint dashed empty slots (reads "filling up", never broken). The forecast is honest (`the forecast is still settling — a few more nights…`), a sage settling meter, no fake number. Wind-down + sounds work from night one; history + go-deeper read their cold form. **Never blank.** |
| ✅ | **Notifications** | `sleep-notifications.html` | The 5 approved sleep notifications as iOS lock-screen frames, one per scroll-snap frame — `wind-down — 6 small steps` · `last night — log it?` · `3 short nights — be gentle today` · `coffee at 4pm — that usually costs ~40min tonight` · `your week in sleep` (opt-in weekly). A closing frame states the analysis is deliberately **never pushed**: chronotype & bedtime drift, the DSPS pattern, the insomnia/epworth scores — all screen-only. |

**Sleep subtotal: 9** (9 ✅). How `sleep-survey.html` + `sleep-patterns.html`
stay calm + screen-only: both are sage + ink only, **never red**; every finding
is one margin-note line, never a badge or a count; the survey result is banded
with a plainly-labelled severity rule and a watch/discuss reading, never a
verdict; the DSPS pattern is explicitly framed "a pattern, not a diagnosis";
sources are a small outlined tag, the only authority mark. Crucially both are
**screen-only** — `sleep-notifications.html` carries just 5 pushes (cues + a
gentle "be gentle today" + an opt-in recap) and a closing frame that states the
analysis is deliberately kept off the lock screen, so sleep news never wakes you.

---

## Body submodule — built 2026-05-18

The BODY submodule (third submodule of the **body** cluster, after cycle and
sleep) is fully mocked in v2 grammar. Reached by drilling the body-cluster
page's body card. `body.html` (the 5-card body-cluster homepage) is **not**
touched — the body submodule screens are all named `body-*.html`.

Body is **three things in one**, and the design carries all three calmly: a
**light everyday** surface (water, supplements), a **clinical documentation
tool** (symptom episodes → doctor summary), and a **serious treatment tracker**
(chemo / IVF / allergy courses). The serious is never trivialized; the everyday
is never weighed down.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Body** · the face · L3 | `body-detail.html` | Leaf-focus rule — an episode is OPEN, so the **episode** is the hero: `headache · day 2`, a small severity-arc sparkline, `last check-in 3 of 5`. Water steps quietly into the background (a small glass · `4 of 8`, `supplements · 2 of 3`). One amber `+ log onto it`. Calm drill rows: `intake` (water + supplements) · `symptoms` · `conditions & treatment` · `doctor summary` · a `posture reminder` toggle line · a sage `see the rest` observation row → body-patterns. (When no episode is open, the focus falls to water — see body-cold.) |
| ✅ | **Intake** | `body-intake.html` | The day's water + supplements. body.html's filling-glass visual scaled way up — a tumbler outline filled to `4 of 8` with calm sage water; an amber `+ a glass` and a quiet `–` remove. Below, supplements as a calm tap-to-check list — each row a check circle (sage tick when taken) + name + reminder time, plus an add-a-supplement ghost row. **Never mentions calories.** |
| ✅ | **Log a symptom** | `body-symptom-log.html` | Start a symptom / episode — one quiet underlined symptom field, an optional `1–5` severity tap (`barely there → can't ignore it`), and a 3-tile kind picker — `acute · chronic · mental`. A quiet sage suggestion line: when the label matches a tracked condition ollie pre-picks `chronic` ("change it if that's not right"). `noted.` on save. |
| ✅ | **Episode** | `body-episode.html` | The active episode timeline — `headache · day 2`, the severity check-ins (1–5) drawn as a calm sparkline arc on a white card (two faint reference lines, no grade marks), meds logged as a quiet `name · dose · when` list with a log-a-med ghost row. A sage-outlined `this one's over` close action — closing is a gentle act, never an amber win — opens a recap card (`tracked for · check-ins · severity peak · meds logged`) shown **before** the amber `close it` confirm. |
| ✅ | **Doctor summary** · clinical | `body-doctor-summary.html` | The clinical brief — the episode written out plainly as a typed document card: `tldr` (one factual paragraph), a `severity, by check-in` sparkline, `medication taken`, `the 7 days around it` (plain factual context lines). An amber `copy` + a `.md file` download. Calm and factual, **NO diagnosis language** anywhere; a closing note states ollie records but does not diagnose or interpret. A real thing to bring to a doctor. |
| ✅ | **Conditions & treatment** · serious, handled gently | `body-conditions.html` | Chronic conditions as a calm list of plain facts (name + a quiet "tags matching episodes" note, no severity, no badge) with an add-a-condition ghost row. A treatment plan (chemo / IVF / allergy course) shown with **dignity** — `cycle 3 of 6 · day 4 of this cycle`, a quiet cycle-dot **map** (done = sage tick, current = amber ring, ahead = line ring — never a "% done" pressure bar), a sage side-effects-timing note, a sage-outlined non-celebratory `cycle 3 is done` advance, and a steady supportive line ("nothing here is a finish line — it's a map"). Serious content, **never clinical-cold, never falsely cheerful.** |
| ✅ | **See the rest** · reflective · screen-only | `body-patterns.html` | The reflective home for the ~28 body detections ollie does NOT push. Each is ONE calm sage line + a soft reframe, grouped quietly: `water & the body's signals` (headache↔water, hyperfocus dehydration, interoception drift, hunger–thirst confusion), `your episodes` (duration distribution, trigger correlation, multi-symptom recurrence), `pacing & your energy` (the afternoon crash window, the energy envelope, the movement gap), `across your modules` (body×cycle, body×sleep, body×intake, body×work). **Sage + ink only — no red, no charts wall.** A closing note: screen-only, never a notification. |
| ✅ | **Notifications** | `body-notifications.html` | The 6 approved body notifications as iOS lock-screen frames, one per scroll-snap frame — `water — you're a few glasses behind today` (smart / detection-based) · `supplement — vitamin d` · `posture — a small reset` · `treatment — cycle 3 starts tomorrow` · `be gentle today — yesterday was a lot` · `your week in body` (opt-in weekly). A closing frame states the episode patterns, the cross-module correlations and the doctor summary are deliberately **never pushed** — screen-only. |
| ✅ | **Body — first run** | `body-cold.html` | First-run / empty — the face present, **never blank**. No episode is open, so the focus falls to water at `0 of 8`: an empty ink-outline glass (a faint dashed half-line ghost keeps it reading as a scale) waiting to fill. A sage invitation ("this is body — water, supplements, anything the body does. a glass of water is the easiest first thing"), one amber `+ first glass`. `intake` works from day one; `symptoms` / `conditions` / `doctor summary` read their calm cold-invitation form; the posture toggle sits off; no pattern row yet. |

**Body subtotal: 9** (9 ✅). How the serious treatment content stays dignified +
calm: the treatment plan is a **map, not a scoreboard** — a quiet cycle-dot
sequence showing exactly where you are (`cycle 3 of 6 · day 4`), never a `%`
progress bar that turns a hard course into a target; `advance` is sage-outlined,
never a celebratory amber, and is worded as a plain fact (`cycle 3 is done`) not
a congratulation; a steady supportive line states outright that "nothing here is
a finish line." The doctor summary carries **zero diagnosis language** — only
logged facts and dates — and is reachable only on the page, never pushed. Episode
**close** shows a plain recap (no "well done") before confirming. The episode
patterns and cross-module correlations live on a sage-and-ink screen-only
surface, **never red**, and `body-notifications.html` carries just 6 light/cue
pushes plus a closing frame that keeps every health finding off the lock screen
— so serious health news never lands as a buzz. The light everyday (water,
supplements) and the serious (chemo / IVF) share one calm grammar without either
overwhelming the other.

---

## Medication submodule — built 2026-05-18

The MEDICATION submodule (fourth submodule of the **body** cluster, after cycle,
sleep and body) is fully mocked in v2 grammar. Reached by drilling the body
page's medication card. Plain adherence tracker — dry, factual voice (`noted.`
not `great job!`), **no streaks**, never shaming.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Medication** · the face · L3 | `medication.html` | One focus — the **next dose**. A small lead (`next · 2:00pm`), the med name large (`methylphenidate`), a big amber-edged **take-circle** that mirrors habits' tap-circle, quiet day's-dose dots (`1 of 2 taken` — no streak). Below, the user's meds as a calm notebook list (color dot · name · kind · dose · schedule, a sage tick + time on what's been taken). One quiet amber `+ add a medication` ghost line, one drill row → the adherence log. |
| ✅ | **Add a medication** | `medication-add.html` | Name it once — a quiet underlined name line, an **optional** dose, a 2×2 kind picker (`vitamin · supplement · prescription · otc`), and a comma-separated `HH:MM` schedule that previews as time-chips. Blank schedule = manual log only, stated honestly in a calm sage line. `noted.` on save. |
| ✅ | **Adherence log** | `medication-log.html` | What was taken, and when — **today** as a per-med view (each dose a slim taken/due pill, taken = sage + time, due = open ink ring, manual = a quiet dash); then **the last 14 days** as one plain `logged X of Y` line per med. A sage framing note states plainly this is a *pattern, not a medical reading*, a missed log isn't a missed dose, and it is **screen-only** — never pushed. |
| ✅ | **Medication — first run** | `medication-cold.html` | The face present, **never blank**, never a zero. No meds on file, so the take-circle stands as a calm ink-outline ring (no amber edge — no live dose) with a quiet `–` inside; the dose-dots are faint dashed placeholders. A sage invitation ("this is where your meds, vitamins and supplements live — add one and ollie tracks the next dose, or just logs what you took"), one amber `+ add your first`. The meds list reads one quiet placeholder line; the adherence log reads its cold form. No streak, no scoring. |
| ✅ | **Notifications** | `medication-notifications.html` | Just **2** medication notifications as iOS lock-screen frames, one per scroll-snap frame — `vitamin d · 9:00am` (a scheduled dose cue) · `evening meds — 2h past` (overdue, factual, never shaming, no red). A closing frame states medication sends exactly two things — a dose due and a dose overdue — and that the **adherence report** (the `logged X of Y` fortnight line) is deliberately **screen-only**: drift in the numbers is never pushed, missing a dose is never shame, so it never lands on a lock screen. |

**Medication subtotal: 5** (5 ✅). How medication stays calm + non-shaming: the
voice is dry and factual (`noted.`, never a congratulation); there are **no
streaks** anywhere — the dose-dots count today's doses, never a running total to
beat; the take-circle is the live action, never a streak target. The 14-day
adherence report is one plain `logged X of Y` line, framed as a *pattern not a
medical reading*, and is **screen-only** — only 2 factual cue pushes ever reach
a lock screen, and the closing notification frame states the report is
deliberately kept off it, so missing a dose never lands as shame.

---

## Habits submodule — built 2026-05-18

The HABITS submodule (fifth and last submodule of the **body** cluster) is fully
mocked in v2 grammar. Reached by drilling the body page's habits card. ADHD-aware
habit tracker — *"no streaks · no shame · just today."* A gap is just a gap.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Habits** · the face · L3 | `habits.html` | ONE focus — the **single next check-in**. One soft tap-circle, the habit name large (`drink water`), its cue under it (`after coffee`). A 270° **open** progress arc (deliberately not a closed ring — a ledger of today, never a score), a waiting-dot row counting what still waits, one amber `add a habit`. Calm drill rows: `all habits` · a sage `see the rest` observation row (only when a pattern is live) → habits-patterns. No grid, no streak. |
| ✅ | **Add a habit** | `habits-add.html` | One name field, one **REQUIRED** cue line (`after coffee`) — its underline ticks sage, a conviction note states why it can't be skipped (*"a habit without a cue is wishful thinking — the cue is what actually fires it"*) — and a morning / anytime / evening cue-time tag. A closing line: *"no streak starts."* |
| ✅ | **All habits** | `habits-all.html` | The calm record — every habit as one quiet hairline-divided block, ordered morning → anytime → evening: name + cue + a `MOR/ANY/EVE` badge, recent days as a soft row of sage dots (today an open ring), a quiet `last · ...`. A soft record of recent days, **not a streak, not a score** — a gap is just a gap. |
| ✅ | **See the rest** · reflective · screen-only | `habits-patterns.html` | The calm home for the 24 habit detectors ollie does **NOT** push. Each is ONE calm sage line + a soft reframe, grouped quietly: `what makes them stick` (externalization, the keystone anchor, the friction signature, body vs cognitive), `when your week is different` (luteal collapse, stress collapse, sleep–habit coupling, hyperfocus spillover, med-adherence coupling), `how a habit lives and returns` (habit rebirth, habit drift, fresh-start crash, interest hijack), `what you tell yourself` (identity framing, self-talk coupling, the sensory flag). Supportive framing — *"habits don't die, they cycle"*, *"scaling expectations, not standards"*. **Sage + ink only — no red, no badges, no counts.** A closing note: screen-only, never a notification. |
| ✅ | **Habits — first run** | `habits-cold.html` | The face present, **never blank, never a guilt-zero**. Ollie seeds **6 default habits** (brush teeth, drink water, vitamin d, move, evening meds, wind down), so the day already has a shape — the first (`brush teeth`) is held up as the single next check-in, exactly like the live face. The progress arc reads `0` in **mute** ("the day's ahead"), the waiting row shows the first one now + 5 waiting, a sage invitation names the 6 seeds as a starting shape ("keep what fits, change the rest, add your own"). No pattern row yet — patterns warm up after a few days. |
| ✅ | **Notifications** | `habits-notifications.html` | **5** habits notifications as iOS lock-screen frames, one per scroll-snap frame — `morning — 3 small things` (cue nudge) · `evening — 2 still waiting` (cue nudge) · `your brain's different this week — scaling expectations, not standards` (the luteal-collapse reframe) · `a lot on right now — want stress mode?` (the stress-collapse offer) · `your week in habits` (opt-in weekly recap, no grade). A closing frame states there is deliberately **NO "you missed" / completion-count / streak-broken** notification — only gentle cue nudges and supportive reframes; the 24 detectors stay screen-only. |

**Habits subtotal: 6** (6 ✅). How habits stays no-streak + no-shame: the face
is ONE next check-in, never a grid wall; the progress arc is a 270° **open**
ledger, never a closed score-ring, and its centre count is a calm ledger mark,
not a grade; the waiting-dot row counts what *waits*, never what was missed;
`all habits` is a soft record of recent days where a gap is just a gap; the cold
state is never a guilt-zero — 6 seeded habits give the first run a shape and the
arc's `0` sits in mute, not ink. The 24 detectors live on a sage-and-ink
**screen-only** surface (`habits-patterns.html`), **never red, never a badge** —
and `habits-notifications.html` carries only gentle cue nudges and supportive
reframes, with a closing frame that states outright there is no "you missed"
push, so a quiet week never lands on a lock screen as a failure.

---

## Partner system — built 2026-05-18

The PARTNER system is an approved **new feature** — two linked Ollie users
(partners), opt-in, two-way. Once linked it is symmetric: each sees what the
other chooses to share. Sharing is granular opt-in, **default OFF**. Reached
from the cycle face's `my partner` drill row. `my-partner.html` + the 3 partner
sub-screens **supersede** the old `cycle-partner.html` (deleted; its 4-category
ask content moved into `partner-ask.html`).

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **My partner** · the face | `my-partner.html` | One calm page — the partner's name (`Sam · linked since march`); their **shared patterns** as sage observation lines in the body.html grammar (`low on sleep this week` · `in luteal — be gentle` · `a stretch of stress`); your **asks** — the last ask (`touch · 2 days ago · seen`), a quiet history, one amber `+ new ask`; a quiet footer route to `what Sam sees from you`. |
| ✅ | **Link a partner** | `partner-invite.html` | One focus — an invite code (`OLLIE·K4M9`) with copy-link / share pills. A calm 3-step sequence of what happens once they join (everything starts off). An honest sage note: shared patterns need Ollie on both sides; an ask alone can still go to anyone as a plain message. |
| ✅ | **New ask** | `partner-ask.html` | The 4-category ask flow — `material · touch · labor · emotional`, a few quiet chips each, selected = sage fill. ollie turns the picks into a calm note shown in a preview card before send. `send to Sam`. Renames/replaces the old `cycle-partner.html`. |
| ✅ | **What Sam sees** | `partner-sharing.html` | The granular opt-in control — calm toggles, **default OFF**: cycle phase · sleep · stress · energy · mood, each with a mute sub-line of what the partner would see. A fixed **stated** line (not a toggle) that medical flags — PCOS, endometriosis, PMDD, ACOG flags — are never shareable. A live **preview card** ("what Sam sees right now") showing exactly the current shared lines. |

**Partner subtotal: 4** (4 ✅). How clinical flags stay unshareable:
`partner-sharing.html` exposes toggles **only** for soft pattern types (sleep,
stress, energy, mood) and cycle *phase* (`in luteal — be gentle`, never a date,
never a diagnosis). Clinical flags are not a toggle at all — they are stated as a
fixed, locked line in sage + ink: *"medical flags are never shared — not even
with a toggle."* The preview card renders the partner's actual view, so the user
sees soft state only; a medical flag can never appear there because no control
ever feeds one in. Voice: lowercase, dry, calm; the boundary is stated, never
alarmed.

---

## Notes — surprises & gaps

- **Astrology is gone.** `modules/astrology-deferred/` exists but is deferred —
  not counted, no screen. Confirm it stays out of v2.
- **dump has no home in the IA.** The brain-dump archive is a real module
  (read-only thought archive + resurfacing) but the 3-level IA gives it no
  module or submodule. v2 routes it through **Caught** (the live view) and
  **Find** (search) — the archive + resurfaced screens (Group 6) are the only
  way to reach old thoughts. Worth a Serra decision: is Caught's swipe-history
  enough, or does dump need an explicit "see all" into the archive?
- **Garden / Insights / Gallery have no entry point in v2.** Three real screens
  exist in the app but the locked IA (capture · 4 modules · always-on) gives
  them no dot, no swipe, no tile. They need a home — likely a quiet entry from
  the `who` cluster or a fifth always-on affordance. Currently orphaned.
- **The L3 detail pages assume one focus object, but body/work/medication are
  multi-object.** body has episodes + water + supplements; work has focus +
  projects + distractions; medication has multiple meds. v2 resolves this by
  picking the single most-relevant object as the leaf (the open episode, the
  running focus, the next dose) and pushing the rest to entry/log sub-screens.
  This is a real design call per module, not a copy-paste of the 5 mocked leaves.
- **Settings is one long page in the current app** but has 12 distinct sections
  + 3 data flows. In v2's calm grammar a single 12-section scroll fights the
  "one focus" rule — Serra should decide: keep one scroll, or split into a calm
  settings index that pushes sub-pages (the latter fits v2 better).
- **No "edit a thrown thought" screen exists** anywhere — once caught and sorted,
  a thought can only be found, not corrected in place beyond re-sorting its
  drawer. Likely fine for v1, flagged for completeness.
- **HealthKit onboarding step auto-skips** when HealthKit is off (the default),
  so step 4 is effectively invisible in most builds — still spec'd for the
  enabled path.

---

## Admin submodule — built 2026-05-18

The ADMIN submodule (first submodule of the **home** cluster) is fully mocked in
v2 grammar. Reached by drilling the home page's admin card. A bureaucracy /
renewal / appointment tracker — *"the stuff you forget about. passport, lease,
taxes, dentist."* — deeply instrumented for ADHD executive function. Voice:
deadpan, calm, never shaming, research-cited.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Admin** · the face · L3 | `admin.html` | ONE focus — the **next thing due**, a renewal (`renew passport · 30 days left`) as a calm hero, over a tailored **renewal-runway** visual: a flat track with the staged renewal cues (90 / 30 / 7 / 0 days) marked as quiet ticks, an umber marker riding it at the 30-day stage. One amber `do this one`. Below, with air, calm drill rows: `calls to make · 3 waiting` · `all tasks · 9 active · 2 due this week` · `2-min burst · 5 quick things ready` · a sage `see the rest` observation row (only when a pattern is live) → admin-patterns. |
| ✅ | **Add to admin** | `admin-add.html` | One quiet underlined title field, then calm pickers: **kind** (task / renewal — renewal reveals an expiry date field), **category** (renewal / appointment / maintenance / financial / other), an **expiry date** for renewals, and optional **recurrence** pills (monthly / quarterly / yearly / 2 / 5 / 10 years; blank = a one-off). A sage line states the staged-cue behaviour — ollie raises a renewal at 90, 30, 7, 0 days, never all at once. `add it` → `noted.` |
| ✅ | **All tasks** | `admin-tasks.html` | The full task list — an **active / done / all** filter with live counts (`9 · 14 · 23`), the active segment underlined amber. Each task is ONE calm hairline-divided row: a quiet **ball-state mark** (a filled ink square = MINE, an open umber square = THEIRS, an open mute square = WAITING), the title, a one-line ball+category sub-line, and days-left right-aligned (warm umber when due-soon). One done task peeks, struck and demoted. One amber `add a task` floats at the bottom. |
| ✅ | **A task** · detail | `admin-task.html` | The task as the focus — title large, days-left + a one-sentence ball-state line (`the ball is yours — nothing to wait on`). One amber `mark it done`; calm action rows below — **close the loop** (sage dot, distinct from done: *"done is filled — closed is mailed and back"*), **defer** (shows the defer count), **whose move** (the ball state), **split it up** (umber dot, into GATHER the docs + FILL the form). A `documents` section attaches paperwork references (label + link) to the task — A14 cognitive-offload. |
| ✅ | **Calls to make** | `admin-calls.html` | The one ADHD-aversive thing, gathered in one place and surfaced **gently**. A calm reframe up top (a call bundles initiation, a script, holding the thread — that's why they wait), then each `phone_assist` task as one quiet block, **oldest-waiting first** (the oldest wears a warm umber wait). Each carries a sage `ask ollie for a call script` cue. Never a nag — a closing note frames it as neurology: *"one a day is plenty."* |
| ✅ | **2-min burst** | `admin-burst.html` | The momentum session — steps through sub-2-min tasks **ONE at a time**. A quiet progress-pip strip counts the run (2 done sage, 1 current amber, 2 waiting faint) + `task 3 of 5`; the current task fills the focus over a soft amber countdown ring (`2 min`), its name large, a one-line smallest-first-move hint. One amber `done — next` and the next slides in. A quiet text-only `skip`. One focus, momentum, calm — no list, no scroll; the focused-session chrome drops Find / Safe, swipe-down handle only. |
| ✅ | **See the rest** · reflective · screen-only | `admin-patterns.html` | The calm home for the **screen-only** EF detectors ollie does **NOT** push. Each is ONE calm sage line + a soft reframe + a quiet italic citation tag, grouped quietly: `what's still costing you` (A1 open-loop — Masicampo & Baumeister 2011; A11 EF-tier match — Barkley 2012), `where things stall` (A6 defer-chain — Steel 2007; A15 schedule-drift *"scheduling and doing are not the same thing"* — Gollwitzer 1999; A12 last-five-percent — Allen 2001), `what you already worked out` (A13 decision recall — Vohs et al. 2008; A10 recurring-annual — Einstein & McDaniel 2005). **Sage + ink only — no red, no badges, no charts.** A closing note: the reflective detectors are deliberately never a notification. |
| ✅ | **Notifications** | `admin-notifications.html` | The **7** approved admin notifications as iOS lock-screen frames, one per scroll-snap frame — `passport · expires in 30 days` (A3 renewal cue) · `dentist · tomorrow, 2:00pm` (appointment) · `the lawyer's had your file · 16 days` (A9 stale ball) · `the form's filled — did it get mailed?` (A12 last-five-percent) · `last march you renewed the registration — that time again` (A10 recurring-annual) · `taxes — deferred a few times, name what's blocking it` (A6 defer-chain) · `your week in admin` (opt-in weekly recap). A closing frame states the reflective EF detectors (A15 schedule-drift, A1 open loops, A11 the tier match) are deliberately **screen-only** — they wait in `see the rest`, never on a lock screen. |
| ✅ | **Admin — first run** | `admin-cold.html` | The face present, **never blank**. Where the live face has a renewal hero, the cold face holds a calm **empty renewal-runway** (faint dashed ticks, no marker), an honest line (`admin is empty — that's fine`) and a sage invitation naming what admin holds (passport, lease, taxes, the dentist). One amber `add the first thing`. A quiet "things people put here" example list (renew passport · book a dentist cleaning · file the taxes) keeps the page from being barren; the `all tasks` + `2-min burst` drill rows sit in their cold form. No pattern row yet. |

**Admin subtotal: 9** (9 ✅). How admin stays calm + non-shaming: the face is
ONE next thing due, never a backlog wall; the renewal-runway is a tailored data
object (90/30/7/0 staged cues), not a generic dot; ball-state is a quiet square
mark, never a badge; `close the loop` is held distinct from `done` so the last
5% is named, not blamed. The EF detectors live on a sage-and-ink **screen-only**
surface (`admin-patterns.html`) — A15 schedule-drift, A1 open loops, A11 the
tier match — **never red, never a badge**, each with its research citation
(Masicampo, Barkley, Gollwitzer, Allen). `admin-calls.html` surfaces the one
ADHD-aversive thing — phone calls — gently, oldest-first, with a script offer
and never a nag. `admin-notifications.html` carries only the 7 approved pushes,
with a closing frame stating outright the reflective detectors are screen-only,
so a stalled task never lands on a lock screen as a verdict. Voice throughout:
lowercase, dry, calm; a miss is framed as neurology, never laziness.

---

## Pets submodule — built 2026-05-18

The PETS submodule (second submodule of the **home** cluster) is fully mocked in
v2 grammar. Reached by drilling the home page's pets card. A species-adaptive
pet-care logbook for 10 species (guinea pig, rabbit, cat, dog, hamster, rat,
bearded dragon, leopard gecko, parakeet, betta fish) — *"a keeper's notebook"* —
each species with its own care cadences, behaviour tags and health-flag rules.
Voice: deadpan, anti-guilt, research-cited, never shaming a missed care task.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Pets** · the face · L3 | `pets.html` | ONE focus — the **next/overdue care thing across all pets**, a calm hero (`Mango · hay refill`) over a soft paw-disc, with a calm days-since line and a deadpan anti-guilt reframe (*"a day over isn't a crisis"*). One amber `+ log care`. Below, the **roster** — each pet on its own block with a tailored **30-day care strip** of soft sage dots (filled = care logged, gap = none), drill to its profile. Calm drill rows: `observe` · `health` · a sage `see the rest` observation row (only when a pattern is live) → pets-patterns. |
| ✅ | **Add a pet** | `pets-add.html` | One quiet underlined name field, then the **10-species picker** — a calm wrap of soft pills, each with a tiny line glyph; one tap, selected amber. A sage line states the species cadence ollie will keep (guinea pig → hay daily, cage clean weekly, vet yearly — each species runs on its own). Optional underlined nickname line + a free-text notes area. `add Mango` → `noted.` |
| ✅ | **A pet** · profile · at rest | `pets-profile.html` | One pet, calm — a soft paw-disc, name + species + solo status + adoption month, the **adoptversary line** when today is the day (`2 years with Mango today`, a warm umber band, never confetti). The **30-day care strip** scaled up (`23 of 30 days · a gap is just a gap`), recent observations (last 3) with behaviour tags + relative timestamps, milestones as calm sage-dot firsts. A quiet drill footer — `log care` / `observe` for this pet. No hero number, no streak. |
| ✅ | **Log care** | `pets-log.html` | Which pet (a calm 2-up of soft tiles), then the **per-species quick-pick care buttons** — for a guinea pig: hay refill, cage clean, vet checkup, feed, floor time, fresh water, weigh-in, something else — each a soft pill with a line glyph, one pre-selected amber. A sage line notes the set adapts to the picked pet's species. An optional quiet note line. `log it` → `noted.` — a closing line states the same-task-within-a-minute toggle-undo. |
| ✅ | **Observe** | `pets-observe.html` | Record an observation — which pet, an optional **weight** line (underlined number + unit, with the last reading shown), a free-text **what you saw** note area, and species **behaviour quick-tags** (low appetite, hiding, quiet, vocal, playful, popcorning, teeth grinding, limping… — multi-select, sage fill). A sage line states honestly that the note text feeds the health-flag detection — *"if the same thing shows up across a few days… one quiet day is just a day."* `save it` → `noted.` |
| ✅ | **Health** · welfare · screen-only | `pets-health.html` | The **screen-only** welfare panel — sensitive, like cycle-flags. Health flags from observations, each ONE calm block: the pet, the thing noticed in one calm line, the **days observed** (sage, factual — never urgent-red), a **species welfare note** (the gentle sourced reframe), a **consider-a-vet** line framed as *"worth a vet visit — just to be sure, not because something is wrong"* (never a diagnosis), a quiet italic citation source (RSPCA, PDSA). A `>7-day drawer` holds older pending notes. **Calm sage + ink only — NEVER red, never a badge, never alarmist.** A "when you have a moment" surface; a closing note states it's deliberately never pushed and that a real diagnosis only comes from a vet. |
| ✅ | **See the rest** · reflective · screen-only | `pets-patterns.html` | The calm home for the **screen-only** behavioural detections ollie does **NOT** push, grouped quietly — `what the pets do for you` (P2 pet-as-co-regulator — *"your calmest dumps land near Mango — regulation outside the body costs less"* — Beetz et al. 2012), `where care stalls, and why` (P3 care-activation barrier — *"starting is the most expensive minute — name the 30-second first move"* — Barkley 2012; P4 crash-context misses — *"pet care breaks first because it's the most goal-directed task in the day"* — Barkley & Murphy 2010; P1 vet-adherence delay — Gollwitzer 1999), `how you talk about them` (P5 anthropomorphic projection — *"pets run on present cues, not grudges — a sensitivity, not a flaw"* — Serpell 2003). Each ONE calm sage line + a soft supportive reframe + a quiet italic citation tag. **Sage + ink only — no red, no badges, no charts.** A closing note: these reflective detectors are deliberately never a notification. |
| ✅ | **Notifications** | `pets-notifications.html` | The **5** approved pets notifications as iOS lock-screen frames, one per scroll-snap frame — `Mango · hay refill` (care due — staged, deadpan, never guilt) · `Tonti · vet checkup — book within 2 weeks` (P1 vet cue, anchored to a daily event) · `too warm for Mango today` (weather alert — species temp threshold) · `2 years with Mango today` (adoptversary — warm, gentle, no task attached) · `your week with the pets` (opt-in weekly recap). A closing frame states outright that the **health flags and the behavioural patterns are deliberately screen-only** — a welfare note or a "noticed" pattern never lands on a lock screen as a verdict, and a missed care task is never sent as a notification. |
| ✅ | **Pets — first run** | `pets-cold.html` | The face present, **never blank**. Where the live face has a care hero, the cold face holds a calm **empty paw-disc** (an ink-outline ring with a soft paw glyph waiting, no marker), an honest line (`the notebook's empty — add your first pet`) and a sage invitation naming what pets is (*"a keeper's notebook — ollie carries the care cadences"*). One amber `+ add your first pet`. A quiet "ollie knows 10 species" example list (a guinea pig · a dog · a bearded dragon, each with its cadence tag) keeps the page from being barren. |

**Pets subtotal: 9** (9 ✅). How pets stays calm + non-shaming: the face is
ONE next care thing, never an overdue-care wall; the days-since line carries a
deadpan anti-guilt reframe (*"a day over isn't a crisis"*); the 30-day care
strip is a tailored data object of soft sage dots — *"a gap is just a gap"*,
never a streak to break. The per-species cadences mean the app fits the animal,
not a generic checklist. The **health** welfare panel lives on a sage-and-ink
**screen-only** surface (`pets-health.html`) — each flag a calm line with its
days observed, a species welfare note, a *"consider a vet visit"* framing
(**never a diagnosis, never red, never alarmist**) and a quiet sourced tag; it
is a "when you have a moment" surface, never pushed. The behavioural detections
(P2–P5) sit on a second screen-only surface (`pets-patterns.html`), each
supportively reframed (*"pets run on present cues, not grudges — a sensitivity,
not a flaw"*) with a research citation. `pets-notifications.html` carries only
the 5 approved pushes — care due, the vet cue, a weather alert, the warm
adoptversary, the opt-in weekly — with a closing frame stating outright that
health flags and patterns are screen-only, so a stalled care task or a welfare
note never lands on a lock screen as a verdict. Voice throughout: lowercase,
dry, calm; a missed care task is framed as neurology and context, never as
neglect or laziness.

---

## Grocery submodule — built 2026-05-18

The GROCERY submodule (third and last submodule of the **home** cluster) is
fully mocked in v2 grammar. Reached by drilling the home page's grocery card. A
**3-mode grocery tool** behind one calm near-zero-chrome switch — `shop` (a
torn-note shopping list with natural-language entry), `pantry` (shelf-life-aware,
3 shelves), `feed me` (a recipe matcher). Voice: deadpan, lowercase, calm; a
stale list or a duplicate buy is framed as routing, never as carelessness.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Grocery** · the face · L3 | `grocery.html` | The face — the **torn-note shopping list** as the default focus: each line plain text on a hairline rule with a soft round tick, a quiet quantity after the name. Tap a line = strike through, and it **moves into the pantry** with a computed shelf life (one line shown `got`, a sage `in pantry` note where it went). A calm **3-mode switch** above — `shop · pantry · feed me`, near-zero chrome, the active one underlined amber (admin-tasks filter grammar). One amber `+ add` → natural-language entry. Below, with air: a `recently bought` drill row + a sage `see the rest` observation row (only when a pattern is live) → grocery-patterns. |
| ✅ | **Pantry** · feed-by-shelf-life | `grocery-pantry.html` | The pantry mode — the shelf-life-aware view of the kitchen, **3 shelves** segmented by remaining shelf life: `critical` (≤2 days, warm umber), `watching` (≤7 days, amber), `stocked` (>7 days, mute, collapsible). Each item is a calm hairline row with the name, a **shelf-life fill-bar** (a thin track, the fill width = % life left, the fill colour following the shelf — umber/amber/sage) and a `"N days / today"` label, warm-toned per shelf. A closing note: the pantry fills on its own — each thing lands here when checked off the list. **Never red, never a badge.** |
| ✅ | **Feed me** · the recipe matcher | `grocery-recipes.html` | The recipe matcher — **one inferred recipe at a time** from what's in the pantry, never a grid. The dish big and light (`spinach & feta omelette`), a **coverage object** (a row of filled/hollow ingredient pips + `you have 4 of 6`), and a sage reframe naming *why* ollie picked it (`uses 2 things that turn soon`). A have/missing **ingredient split** (have ones a sage tick + a soon-tag, missing ones a hollow mark). A **diet filter** (all · vegetarian · vegan · mediterranean · turkish) + a **named-recipe search** line (shakshuka, mercimek çorbası…). One amber `add the 2 missing to the list` + a quiet next-idea line. |
| ✅ | **Add an item** | `grocery-add.html` | **Natural-language entry** — one quiet underlined line, said the way you'd say it (`2 bags of basmati rice`), never a structured form. Ollie reads it back in a calm **parse card**: the detected **intent** (add / bought / remove, drawn warm umber), the **item**, the **quantity + unit** — the trust surface, the user sees exactly what got understood. When the word is unknown to the alias table, a sage **teach me this item** block asks the user to point it at a canonical staple (rice · pasta · flour · bread · oats · lentils…) so the shelf life + category come along; the override is remembered. `add it` → `on the list.` A quiet examples line (`got milk`, `out of coffee`, `drop the bread`). |
| ✅ | **See the rest** · reflective · screen-only | `grocery-patterns.html` | The calm home for the **screen-only** grocery detections ollie does **NOT** push, grouped quietly — `what you keep getting drawn to` (**interest-capture / E8** — *"3 keyboards in 3 weeks — a pattern, not a medical thing"*, distinct from a consumable cascade — Wood & Neal 2007; Kasper et al. 2010), `your shopping rhythm` (shopping-cadence — *"about 6 days between trips"* — Altgassen 2014; stockout-cascade — Barkley & Murphy 2010; stale-shopping-list — Gollwitzer 1999), `where you shop` (**known-store learning** — *"ollie's learned 3 stores you visit"*, noticed from GPS, nothing shared), `across your modules` (grocery×sleep, grocery×cycle). Each ONE calm sage line + a soft supportive reframe + a quiet italic citation tag. **Sage + ink only — no red, no badges, no charts.** A closing note: never a notification. |
| ✅ | **Notifications** | `grocery-notifications.html` | The **5** approved grocery notifications as iOS lock-screen frames, one per scroll-snap frame — `olive oil turns soon` (**expiration-drift** — *"one dinner away, or it composts"*) · `you keep rebuying milk — make it a staple?` (**stockout-cascade**) · `4 things have sat on the list 2 weeks` (**stale-list**) · `about 6 days since the last shop — 7 on the list` (**shopping-cadence**, no rush) · `your week — 2 shops, nothing went off` (opt-in weekly). A closing frame states outright that the **reflective patterns** (interest-capture, shopping cadence, the learned stores) are deliberately **screen-only** — never on a lock screen — and that a **duplicate buy** surfaces quietly **in-app at check-off**, never as a push. |
| ✅ | **Grocery — first run** | `grocery-cold.html` | The face present, **never blank**. The **3-mode switch** is already there (shop selected) so the user sees from the first moment that grocery is a 3-mode tool. Where the live face has a torn-note list, the cold face holds a calm **empty note-block** (faint dashed hairline rules with empty ticks, lines waiting), an honest line (`the list's empty — add the first thing`) and a sage invitation naming grocery as a 3-mode tool (a list you talk to · a pantry that watches what turns soon · a feed me). One amber `+ add the first thing`. A quiet "the 3 ways in" example list (shop · pantry · feed me, each with what it becomes) keeps the page from being barren. |

**Grocery subtotal: 7** (7 ✅). Supersedes the stale `module-grocery.html` (deleted;
`index.html` re-pointed to `grocery.html`). How grocery stays calm + concrete:
the face is ONE thing — the running list as a torn note — with the other two
modes (pantry, feed me) one calm tap away behind a near-zero-chrome switch, not
a tab bar. The pantry's **3 shelves** (critical/watching/stocked) are a severity
*ladder*, never an alarm — each item a fill-bar + a plain `"N days / today"`
label, warm-toned, never red. `feed me` shows **one inferred recipe at a time**
from real pantry coverage, boosted by what turns soon — never a wall of recipe
cards. `grocery-add.html` keeps natural-language entry honest: ollie reads the
line back as a **parse card** (intent · item · quantity) so the user sees what
was understood, with a sage **teach me** fallback for unknown words. The
reflective detections (interest-capture / E8, shopping-cadence, known-store
learning) live on a sage-and-ink **screen-only** surface (`grocery-patterns.html`),
each a calm line with a research citation — *"3 keyboards in 3 weeks — a pattern,
not a medical thing"*. `grocery-notifications.html` carries only the 5 approved
pushes (expiration-drift, stockout-cascade, stale-list, cadence, the opt-in
weekly) with a closing frame stating outright that the reflective patterns are
screen-only and a duplicate buy surfaces in-app at check-off — never on a lock
screen. Voice throughout: lowercase, dry, calm; a stale list or a re-bought item
is framed as a routing problem, never as a personal failing.

**This completes the home cluster — admin · pets · grocery all fully mocked in
v2 grammar.**

---

## Goals submodule — built 2026-05-18

The GOALS submodule (second submodule of the **work** cluster, and the **last
module to design**) is fully mocked in v2 grammar. Reached by drilling the work
page's goals card. The big-picture surface — goals with a why / obstacle /
premortem, milestones, AI step-breakdown, soft reviews, Ulysses contracts, 6
categories. **Goals + ADHD is a shame minefield** — abandoned goals, unfinished
goals — so every screen here is **forward and kind, never backward and
blaming**. Voice: lowercase, dry, calm; a stalled goal is read as neurology and
interference, never as failure.

| | Screen | File | What's on it |
|---|---|---|---|
| ✅ | **Goals** · the face · L3 | `goals.html` | ONE focus — the goal in focus as a soft 270° **open** progress arc (deliberately not a closed score-ring — a ledger, never a grade), `40%` calm inside, the goal name large (`learn spanish`) and the next milestone (`hold a 5-minute conversation · whenever it's ready` — a forward line, never a deadline scold). Swipe-dots for multiple goals. One amber `open this goal`. Calm drill rows: `your goals · 2 more` · `a check-in` · a sage `see the rest` observation row (only when a pattern is live) → goals-patterns. A quiet `+ add a goal`. **No streak, no "time since you last touched it", no backlog wall.** |
| ✅ | **Add a goal** | `goals-add.html` | Calm and forgiving — one quiet underlined name field (a `fhint`: *"it doesn't have to be the final wording"*), then the **6-category picker** (learning / career / health / finance / relationship / creative) as soft pills with tiny line glyphs, one tap, selected amber. A sage permission note states plainly a goal isn't a contract: *"you can change it, park it, or let it go any time, no explaining"*. `add it` → `noted.` A quiet later-line — *why it matters*, *a block you see coming*, *a target date* can be added later on the goal itself, none required. |
| ✅ | **A goal** · at rest | `goals-goal.html` | A single goal — the name as the hero, a soft ink progress bar **computed from milestones** (`40% · 2 of 5 milestones done`). **Milestones** as tap-to-tick rings (done = sage tick disc, open = hollow ink ring, the next one drawn warm umber — progress auto-recomputes on tick). A calm sage **`ask ollie to break this into steps`** action (3–7 small moves, *"no pressure to do them"*). **The block you saw coming** — the obstacle/premortem in the user's own words in a soft paper-toned italic quote block. A **Ulysses contract** as a calm umber-marked note to their future self. The footer gives **`let this goal go`** the same calm weight (sage, not a red danger zone) as a check-in — dropping a goal is a valid, unshamed move, never hidden in a menu. |
| ✅ | **A check-in** · the soft review | `goals-review.html` | The **most carefully un-graded screen** in the cluster — ONE reflective prompt (`when you picture this goal, does it still feel like yours?`), a free underlined writing line in the user's own words, **NO score, NO percentage, NO grade, NO "you're behind"**. Two gentle tags — `still want it` / `carrying it from before` — *both honest, neither wrong*. `that's my check-in` → `noted. nothing else needed.` A closing note: a check-in is never graded; if *"carrying it from before"* keeps coming up, ollie gently asks — quietly, on-screen — whether it's time to let the goal rest. |
| ✅ | **See the rest** · reflective · screen-only | `goals-patterns.html` | The calm home for the **screen-only** goal detections ollie does **NOT** push, grouped quietly — `the blocks you saw coming` (obstacle-echo — *"the block you predicted for 'learn spanish' is showing up"* — Gollwitzer 1999; premortem-echo — *"your past self predicted this exact reason"* — Klein 2007), `where your goals pull against each other` (goal-interference — *"'save money' and 'travel more' pull against each other"* — Riediger & Freund 2004), `how your goals actually move` (velocity — per-category over 90d; research-as-progress — Barkley 2012; identity-drift — Oyserman 2015), `when a goal might be ready to rest` (sunk-cost — Arkes & Blumer 1985; experiment-candidate — Steel 2007). Each ONE calm sage line + a kind reframe + a quiet italic citation tag. **Sage + ink only — no red, no badges, no charts.** A closing note: never a notification, never a grade — a stalled goal is read as neurology, never failure. |
| ✅ | **Notifications** | `goals-notifications.html` | The **5** approved goals notifications as iOS lock-screen frames, one per scroll-snap frame — `learn spanish · milestone in 3 days` (a gentle forward nudge — *"a soft heads-up, not a deadline"*) · `a soft check-in on learn spanish?` (a review prompt — *"a minute, no grade"*) · `the block you predicted for 'learn spanish' is showing up` (obstacle-echo — *"not a slip, just worth a look"*) · `'save money' and 'travel more' are pulling against each other` (goal-interference — *"not you slacking"*) · `your week in goals` (opt-in weekly recap, no scoring). A closing frame states outright that the reflective patterns (velocity, sunk-cost, identity-drift) are deliberately **screen-only** — **nothing shaming is ever pushed**, goals never says *"you haven't touched this"*, and a stalled goal never lands on a lock screen as a verdict. |
| ✅ | **Goals — first run** | `goals-cold.html` | The face present, **never blank, never a guilt-zero**. Where the live face has a focus goal in a progress ring, the cold face holds a calm **empty 270° open ring** (line-colour only, no fill, no marker) with a soft **mute sprout glyph** inside (`nothing growing yet`) and an honest line (`no goals yet — a clean slate, not a gap`). A sage invitation names what goals holds (*"ollie holds the milestones, the block you saw coming, and a soft check-in now and then"*). One amber `add your first`. A quiet "the kinds of things that live here" example list (learn a language · run a half marathon · finish the side project, each with its category) keeps the page from being barren. A closing note: no goal is required; starting with none isn't behind. |

**Goals subtotal: 7** (7 ✅). How goals stays non-shaming: the face is ONE
goal's *progress* and its *next milestone* — forward-facing, never a backlog of
abandoned goals, never a streak, never a "time since you last touched it" line.
The progress arc is a deliberately **open** 270° arc (a ledger of how far, not a
closed score-ring). `goals-add.html` keeps the ask small and reversible — a sage
note states plainly a goal isn't a contract (*"change it, park it, or let it go
any time, no explaining"*). On `goals-goal.html`, **`let this goal go` is given
the same calm sage weight as a check-in** — dropping a stalled goal is an
unshamed, valid move, never a red danger zone, never buried. `goals-review.html`
is the most carefully un-graded screen in the whole app — ONE reflective prompt
about how the goal *feels*, a free line, **no score, no percentage, no grade**;
its two tags (*still want it* / *carrying it from before*) are both honest. The
reflective detections (obstacle-echo, premortem-echo, goal-interference,
velocity, identity-drift, sunk-cost, experiment-candidate) sit on a sage-and-ink
**screen-only** surface (`goals-patterns.html`), each kindly reframed (*"a
stalled goal isn't a failing — it's information"*, *"not you slacking"*) with a
research citation. `goals-notifications.html` carries only gentle pushes — a
forward nudge, a soft check-in, a non-verdict mirror — with a closing frame
stating outright that goals **never says "you haven't touched this"** and the
reflective patterns stay screen-only, so a stalled or abandoned goal never lands
on a lock screen as a verdict. Voice throughout: lowercase, dry, calm; a stalled
goal is framed as neurology and goal-interference, never as laziness or failure.

**This completes the work cluster — work · goals — and the full v2 redesign:
all 4 clusters (money · body · home · work) fully mocked in v2 grammar.**
