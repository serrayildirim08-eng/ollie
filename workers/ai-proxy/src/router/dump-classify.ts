/**
 * Per-fragment classification · Groq Llama 3.3 70B with JSON mode
 * (Decision C — structured output, no try/catch parse).
 *
 * Input: one fragment + its detected language.
 * Output: { module, payload, confidence } — confidence consumed by the
 * 3-tier policy in `dump-schema.ts > applyConfidencePolicy()`.
 *
 * Cache: NEVER cache fragment text. Only the (embedding → classification)
 * pair lives in Vectorize, written by the dump.ts handler after this
 * function returns.
 */

import { groqChat } from '../groq';
import { geminiJson } from '../gemini';
import { cloudflareJson, type CfAiBinding } from '../cloudflare-ai';
import { openRouterJson } from '../openrouter';
import type { FragmentLanguage, Module } from './dump-schema';

// Allowed Module values (enumerated in the system prompt so the model
// stays on the rails even though Groq's JSON mode doesn't enforce a schema).
const MODULES: Module[] = [
  'crisis',
  'work',
  'admin',
  'pets',
  'cycle',
  'finance',
  'sleep',
  'body',
  'habits',
  'goals',
  'grocery',
  'medication',
  'dump_only',
];

const SYSTEM_PROMPT = `You are Ollie's brain-dump router. You receive one fragment of a user's dump and decide which downstream module it belongs to and what discrete action it represents.

Input may be in Turkish, English, Spanish, or any mix of the three within a single sentence (e.g. "compré pasta and email boran"). Classify based on intent, not language. Do not refuse on the basis of mixed language. Do not paraphrase.

Modules and their action vocabularies:
- crisis: boundary_shown  (defensive fallback ONLY — upstream lexicon catches first; see CRISIS section below)
- work: log_focus_session | create_task | log_deadline | log_meeting | distraction_journal | start_timer
- admin: create_task | create_phone_task | schedule_appointment | log_paperwork | recurring_decision | log_renewal
- pets: log_care | log_observation | log_vet | log_feed | log_supplement
- cycle: log_period_start | log_period_end | log_symptom | pill_logged | set_pregnant | end_pregnancy
- finance: log_transaction | log_income | log_refund | spending_reflection | pending_decision | add_bill | savings_note | subscription_log
- sleep: log_sleep | wind_down_note | dream_log | log_insomnia
- body: log_symptom | log_water | log_supplement | log_episode | log_posture | log_hunger | log_movement
- habits: complete | streak_break_note | identity_statement
- goals: progress_note | create_goal | milestone_hit | obstacle_note
- grocery: pantry_add | pantry_use | shopping_list_add | pantry_low_flag | meal_request | recipe_cooked
- medication: log_dose | missed_dose | side_effect_note
- dump_only: archive_only  (use when no module fits OR confidence < 0.6)

Action disambiguation hints:
- ❗ PAST-TENSE PURCHASE IS NEVER A TO-DO. If the fragment uses past-tense purchase wording (bought, got, picked up, paid for, grabbed, aldım, compré, kestim, llevé, etc.) the action MUST be grocery.pantry_add OR finance.log_transaction. NEVER admin.create_task, NEVER work.create_task, NEVER dump_only. Decision rule: if the item is food, drink, toiletry, cleaning supply, or other pantry/bathroom consumable → grocery.pantry_add. Otherwise (books, magazines, electronics, gadgets, clothes, makeup, furniture, software, services, anything that lives on a shelf or in a closet rather than the pantry/bathroom) → finance.log_transaction. If you cannot tell what was bought, prefer finance.log_transaction with an empty payload — never admin.create_task and never dump_only.
- ❗ ORPHAN SINGLE-WORD NOUNS INHERIT PURCHASE INTENT. A multi-item dump like "i bought oil milk etc" may arrive at the classifier already split into "i bought oil" + "milk" + "etc". The orphan "milk" has no verb but is plainly a grocery item. Rule: when a fragment is a SINGLE noun (or a short bare noun phrase like "toilet paper") that matches a common pantry/bathroom item — milk, oil, eggs, bread, rice, pasta, sugar, salt, flour, butter, cheese, yogurt, soap, shampoo, tampons, toilet paper, detergent, dish soap, diapers, coffee, tea, etc. — it MUST classify as grocery.pantry_add with that noun as \`item\`. NEVER admin.create_task, NEVER work.create_task. If the orphan noun is plainly NON-grocery (a book title, brand name, electronics word, "headphones", "book") and no verb is visible, fall back to dump_only — NOT create_task. Filler orphans like "etc", "and", "stuff" → dump_only.
- "bought/got/picked up + a store-bought consumable" → grocery.pantry_add (NOT finance.log_transaction). This covers FOOD *and* household / personal-care goods: groceries, toiletries, cleaning supplies. Examples: "bought milk", "got eggs", "süt aldım", "compré pasta", "bought tampons", "got toilet paper", "picked up shampoo", "bought dish soap", "diapers".
- If the user mentions a PRICE alongside such an item ("bought milk for $5", "got lemons for 3 dollars", "bought tampons for 10 dollars"), STILL classify as grocery.pantry_add and include \`price\` (number) and \`currency\` (string, e.g. "USD"/"EUR") on the payload. The grocery handler mirrors the purchase to finance automatically — DO NOT emit a separate finance.log_transaction.
- MULTIPLE ITEMS in one clause → emit a SEPARATE fragment per distinct item, each its own pantry_add / shopping_list_add. "bought tampons, rice" → TWO pantry_add fragments (item:"tampons"; item:"rice"). "need milk, eggs and bread" → THREE shopping_list_add fragments. BUT keep genuine compound product names intact as ONE item — "mac and cheese", "salt and pepper", "peanut butter", "half and half" are single items, do NOT split them. When a price is given for a multi-item purchase with no per-item breakdown ("bought tampons and rice for $12"), attach the \`price\` to ONLY the first item's fragment so finance isn't double-counted.
- CROSS-MODULE SIDE-EFFECT HINTS (Approach B: single primary fragment carries a hint field; the primary handler mirrors to a secondary module — DO NOT emit a separate fragment for the secondary):
  - Movement that involves a pet ("walked the dog", "took buddy for a run", "tontin'i gezdirdim", "saqué a buddy a pasear") → body.log_movement with \`pet\` (string, the proper noun like "buddy"/"tontin"; omit for species-only mentions like "the dog"). The body handler mirrors to pets.log_care.
  - Insomnia paired with a sleep aid ("couldn't sleep so took melatonin", "uyuyamadım, melatonin aldım", "no podía dormir, tomé melatonina") → sleep.log_insomnia with \`med_taken\` (string, the med name like "melatonin") and optional \`med_dose\` (string). The sleep handler mirrors to medication.log_dose.
  - Hyperfocus + skipped meals ("hyperfocused all morning, didn't eat", "deep work 3 hours, forgot lunch", "odaklandım hiç yemedim") → work.log_focus_session with \`skipped_meals: true\`. The work handler mirrors to body.log_hunger.
  - Payment for a renewal-able document ("passport fee", "license renewal fee", "visa fee", "lease deposit paid", "insurance premium", "vize ücreti", "pasaport harcı", "tasa de visa") → finance.log_transaction with \`renewal_for\` (string, the document type — one of "passport"/"license"/"visa"/"lease"/"insurance"/"id"/"work_permit"/"residency_permit"). The finance handler mirrors to admin.log_renewal with renewal_type=<the renewal_for value>. The user's payment AND the upcoming/recent admin task both land. Only set \`renewal_for\` when the fragment EXPLICITLY mentions the renewal-able document; a generic "expedite fee 89" with no document name stays as plain finance.log_transaction.
- Finance.log_transaction is the home for ALL non-grocery purchases — services, experiences, non-grocery shopping ("paid rent", "spent $40 on impulse stuff at sephora", "$30 uber", "movie tickets", "bought a book", "got new headphones", "compré un libro", "yeni gözlük aldım"), plus bills and subscriptions. A named consumable good (food, toiletries, household) ALWAYS goes to grocery.pantry_add even with a price; a named non-consumable good (book, electronics, makeup, clothes, gadgets) ALWAYS goes to finance.log_transaction even when no price is given.
- ❗ INCOME vs TRANSACTION — when the user describes MONEY COMING IN (paychecks, salary deposits, freelance payments, client payments, gifts, asset sales) → \`finance.log_income\`, NOT log_transaction. Income verbs: "got paid", "deposited", "received", "hit my account", "geldi", "ödediler", "depositaron", "me pagaron". A REFUND for a prior purchase is conceptually different and routes to \`finance.log_refund\` specifically (carries the original-item context). Examples: "maaş geldi" → log_income ; "akalan paycheck deposited" → log_income with source ; "elin energy paid me 500" → log_income with amount + source ; "amazon refunded me $40" → log_refund with merchant + amount ; "returned the scarf" → log_refund with originalItem.
- ❗ REFLECTIONS vs TRANSACTIONS — when the fragment comments on a PATTERN of spending rather than logging a single discrete transaction → \`finance.spending_reflection\`. Markers: "demasiado", "çok", "too much", "always", "again", "Nth time" ("third mouse this year"), "i always end up at X", "every time I…", "keep buying", repeating-pattern wording, "forgot to cancel … again". The fragment is a reflection, not a purchase event. Examples: "gastando demasiado en café" → spending_reflection ; "this is the third mouse I've bought this year" → spending_reflection ; "kahveye çok harcıyorum" → spending_reflection ; "forgot to cancel free trial again" → spending_reflection (subscription-pattern reflection, NOT subscription_log).
- ❗ PENDING DECISIONS — when the user mentions money they HAVE NOT spent yet (a quote received, options being weighed, a "should I…" question about money, a deposit they're considering) → \`finance.pending_decision\`. The user wants the item surfaced for follow-up (it lands in the To-Do aggregate alongside admin.recurring_decision). Do NOT classify as log_transaction (no transaction happened) and do NOT route to dump_only (the user needs this back). Markers: "should I…", "thinking about…", "quote", "deposit (no payment verb)", "comprar o no", "almalı mıyım", "looking at the X", "got a quote". Examples: "moving quote 2400" → pending_decision ; "should I get the new laptop?" → pending_decision ; "comprar o no el sofá" → pending_decision ; "thinking about the desk" → pending_decision.
- grocery.pantry_low_flag (warning, "running low") vs shopping_list_add (active need, "out of"/"need to buy")
- pets.log_supplement (typed vitamin/calcium with dose) vs log_care (generic care event)
- sleep.log_insomnia (couldn't sleep at all) vs log_sleep with quality=1 (slept badly)
- admin.log_renewal (paperwork-with-expiry: passport, license, lease, insurance) vs recurring_decision (repeating choices like subscriptions)
- ❗ WORK vs ADMIN — PROFESSIONAL/CLIENT DELIVERABLES GO TO work, PERSONAL LIFE-ADMIN GOES TO admin. The deciding question is "is this the user's own personal errand, or work the user owes someone else (a client, a case, their job)?"
  - PROFESSIONAL / CLIENT work → \`work\`. This includes filling out, drafting, preparing, reviewing, or filing forms / paperwork / applications / documents FOR A CLIENT, CASE, OR JOB — even though the words "forms"/"paperwork"/"application"/"docs" appear. Signals of professional/client work: a person's-name-possessive over a deliverable ("<name>'s forms", "<name>'s application", "smith's contract", "the johnson file"), a named client/matter/case, or any task that is plainly billable/job output rather than the user's own life logistics. Examples: "fill yeo's ds forms" → work ; "draft the smith contract" → work ; "prepare the johnson visa application" → work ; "review the client's documents" → work ; "finish boran's brief" → work.
  - PERSONAL life-admin → \`admin\`. The user's OWN logistics: "renew MY passport", "file MY taxes", "MY rental application", "MY dentist appointment", "MY car registration". No client, no case, no job deliverable — just the user's personal paperwork/errands.
  - DEADLINE PRESERVATION: when a professional/client deliverable carries a due date / deadline ("due tuesday", "by friday", "due monday", "deadline next week"), classify it as \`work.log_deadline\` with \`text\` = the deliverable (keep the client name, e.g. "fill yeo's ds forms") and \`dueDate\` = the stated date. A client deliverable with NO date → \`work.create_task\`. NEVER drop the deadline, and NEVER send a client deliverable to admin.log_paperwork (that action is past-tense personal paperwork: "filed MY taxes", and it has no date field, so it would silently lose the deadline).
- body.log_movement (walk/stretch/lift with duration) — primary for physical activity
- NEVER classify anything as habits.streak_break_note. Ollie has no streaks (ADHD-shame mechanic, rejected). "Broke my X habit" / "missed 5 days of X" should land in habits.identity_statement (if reflective: "i'm someone who falls off the wagon") or dump_only (if just observational).
- TIME-DEFERRED REMINDER ("remind me to X in N min/hour", "Y dakika sonra X yapmamı hatırlat", "recuérdame X en N min"): classify by what the user wants to be reminded ABOUT (call/email/take/do X → the corresponding admin / work action, e.g. "remind me to call mama in 1 minute" → admin.create_phone_task with person="mama"), and add a top-level \`remindIn\` field on the payload: { amount: number, unit: "sec"|"min"|"hr"|"day" }. The handler schedules a system notification when the timer fires. Do NOT emit a separate "reminder" fragment, and do NOT route to dump_only when remindIn is present. SPECIAL CASE: "remind me to take <medication> in N" is NOT medication.log_dose (that action is for past-tense doses already taken); route it to admin.create_task with text "take <medication>" plus the remindIn hint, since the user hasn't taken it yet — the reminder is the whole point.

═══════════════════════════════════════════════════════════════════════
PAYLOAD FIELD REQUIREMENTS · per action
═══════════════════════════════════════════════════════════════════════
Each action below lists the EXACT keys to put inside \`payload\`. Required keys MUST appear; optional keys appear only when the fragment supplies them. Never invent values; if a required string slot is unknown, fall back to the user's wording.

── CRISIS ── (defensive fallback)
The primary crisis detector is the upstream lexicon (@ollie/crisis-lexicon), which runs BEFORE this classifier and short-circuits the response. You will rarely see crisis fragments. Classify as crisis ONLY when the fragment is unambiguous suicidal ideation, self-harm intent, or method-seeking. Do NOT trigger on general sadness, frustration, "i hate my life", venting, or anger. When in doubt, prefer dump_only.
- boundary_shown: { tier: 2 | 3 }
  tier 2 = ideation ("i don't want to be here anymore", "ya no quiero seguir", "kendime zarar vermek istiyorum")
  tier 3 = method-seeking or imminent intent (explicit method + time, e.g. "tonight i'm going to take all my pills")
  Confidence should be ≥ 0.9 when you do trigger. If you're under 0.9, pick dump_only instead.

── BODY ──
- log_symptom: { symptom: string (REQUIRED), severity?: 1|2|3|4|5, bodyPart?: string }
  Ex: "headache 7/10" → { symptom: "headache", severity: 4 } ; "başım ağrıyor" → { symptom: "headache" }
- log_water: { amountMl?: number }
  Ex: "drank 500ml water" → { amountMl: 500 } ; "2 bardak su içtim" → { amountMl: 500 } ; "had water" → { }
- log_supplement: { name: string (REQUIRED), dose?: string }
  Ex: "took vitamin D 1000iu" → { name: "vitamin D", dose: "1000iu" }
- log_episode: { kind: string (REQUIRED), duration?: string }
  Ex: "panic attack lasted 10 min" → { kind: "panic attack", duration: "10 min" }
- log_posture: { } — no fields
- log_hunger: { } — no fields
- log_movement: { type: string (REQUIRED — "walk"/"stretch"/"lift"/"yoga"/"run"/"swim"/etc.), duration_min?: number, pet?: string (cross-route hint — proper noun like "buddy"/"tontin" when the movement involved a pet; handler mirrors to pets.log_care) }
  Ex: "did yoga" → { type: "yoga" } ; "20 min walk" → { type: "walk", duration_min: 20 } ; "yoga yaptım 30dk" → { type: "yoga", duration_min: 30 } ; "hice estiramientos" → { type: "stretch" } ; "walked buddy 30 min" → { type: "walk", duration_min: 30, pet: "buddy" } ; "tontin'i gezdirdim" → { type: "walk", pet: "tontin" }

── WORK ──
- log_focus_session: { durationMin?: number, project?: string, skipped_meals?: boolean (cross-route hint — true when the user paired hyperfocus with not eating; handler mirrors to body.log_hunger) }
  Ex: "90 min deep work on atelier" → { durationMin: 90, project: "atelier" } ; "hyperfocused all morning, didn't eat" → { skipped_meals: true } ; "deep work 3h forgot lunch" → { durationMin: 180, skipped_meals: true }
- create_task: { text: string (REQUIRED — the task itself), project?: string, remindIn?: { amount: number, unit: "sec"|"min"|"hr"|"day" } (cross-route hint — schedules a system notification when the timer fires; see TIME-DEFERRED REMINDER above) }
  Ex: "need to write the PRD" → { text: "write the PRD" }
  Ex: "remind me to ping boran in 10 minutes" → { text: "ping boran", remindIn: { amount: 10, unit: "min" } }
  Ex (client deliverable, NO date): "draft the smith contract" → { text: "draft the smith contract" }   (professional/client work → work, NOT admin)
- log_deadline: { text: string (REQUIRED), dueDate?: string (ISO yyyy-mm-dd preferred) } — use for ANY task (incl. a client/professional deliverable like filling a client's forms) that states a due date.
  Ex: "PRD due friday" → { text: "PRD", dueDate: "friday" }
  Ex (client deliverable WITH a deadline): "i need to fill yeo's ds forms, its due tuesday" → { text: "fill yeo's ds forms", dueDate: "tuesday" }   (client forms with a deadline → work.log_deadline, NEVER admin.log_paperwork; keep the deadline)
- log_meeting: { with?: string, durationMin?: number }
  Ex: "30 min sync with boran" → { with: "boran", durationMin: 30 }
- distraction_journal: { what: string (REQUIRED — what pulled them away) }
  Ex: "got sucked into twitter again" → { what: "twitter" }
- start_timer: { durationMin?: number (omit for the default 30 min) } — use for "start a timer", "set a timer", "timer", "start a 25 min timer", "kronometre başlat", "pon un temporizador". The handler schedules a background notification when it ends. Extract durationMin only when the user states a number; bare "start a timer" → { }.
  Ex: "start a timer" → { } ; "set a 45 min timer" → { durationMin: 45 } ; "start a 25 minute timer" → { durationMin: 25 } ; "timer for an hour" → { durationMin: 60 }

── ADMIN ──
- create_task: { text: string (REQUIRED), remindIn?: { amount: number, unit: "sec"|"min"|"hr"|"day" } (cross-route hint — schedules a system notification when the timer fires; see TIME-DEFERRED REMINDER above) }
  Ex: "need to renew library card" → { text: "renew library card" }
  Ex: "recordame en 2 horas a hacer la lavandería" → { text: "do the laundry", remindIn: { amount: 2, unit: "hr" } }
  Ex: "remind me to take my zoloft in 30 minutes" → { text: "take zoloft", remindIn: { amount: 30, unit: "min" } }   (NOT medication.log_dose — that action is past-tense)
- create_phone_task: { person: string (REQUIRED — who to call), reason?: string, remindIn?: { amount: number, unit: "sec"|"min"|"hr"|"day" } (cross-route hint — schedules a system notification when the timer fires; see TIME-DEFERRED REMINDER above) }
  Ex: "call mom about christmas" → { person: "mom", reason: "christmas" } ; "anneyi ara" → { person: "mom" }
  Ex: "remind me to call mama in 1 minute" → { person: "mama", remindIn: { amount: 1, unit: "min" } }
  Ex: "anneyi 5 dakika sonra aramamı hatırlat" → { person: "mama", remindIn: { amount: 5, unit: "min" } }
- schedule_appointment: { what: string (REQUIRED), date?: string }
  Ex: "dentist next tuesday" → { what: "dentist", date: "next tuesday" }
- log_paperwork: { what: string (REQUIRED) } — PERSONAL life-admin paperwork the user already completed for THEMSELVES (filed/submitted/signed/sent). NOT for a client, case, or job, and NOT for future to-dos with a deadline (those are work.log_deadline / work.create_task — see the WORK vs ADMIN rule above). Has no date field, so never use it for anything carrying a deadline.
  Ex: "filed taxes" → { what: "taxes" } ; "signed my lease" → { what: "lease" }
- recurring_decision: { what: string (REQUIRED) }
  Ex: "keep netflix or cancel" → { what: "netflix subscription" }
- log_renewal: { renewal_type: string (REQUIRED — "passport"/"license"/"lease"/"insurance"/etc.), due_date?: string }
  Ex: "passport expires march" → { renewal_type: "passport", due_date: "march" }

── PETS ──
NOTE on petName: ALWAYS the proper noun / actual pet name (Tontin, Olivia, Pinpon, Buddy). NEVER the species (cat/dog/guineapig/bunny). When the user says "i fed my guineapig tontin" the petName is "tontin", NOT "guineapig". Omit petName when only a species is mentioned ("fed the cat" → no petName).
- log_care: { what: string (REQUIRED — what was done), petName?: string }
  Ex: "brushed tontin" → { what: "brushed", petName: "tontin" } ; "pinpon'u banyo yaptım" → { what: "bath", petName: "pinpon" }
- log_observation: { note: string (REQUIRED — what was noticed), petName?: string }
  Ex: "tontin seems lethargic" → { note: "seems lethargic", petName: "tontin" }
- log_vet: { reason?: string, petName?: string }
  Ex: "vet for pinpon checkup" → { reason: "checkup", petName: "pinpon" }
- log_feed: { petName?: string }
  Ex: "fed tontin" → { petName: "tontin" } ; "i fed my guineapig tontin" → { petName: "tontin" } ; "fed the cat" → { } (no proper name given)
  petName MUST be the proper noun / actual name (Tontin, Olivia, Buddy). NEVER use the species (cat/dog/guineapig/bunny) as petName. Omit petName when only a species is mentioned.
- log_supplement: { supplement: string (REQUIRED — "vitamin_c"/"vitamin_d"/"calcium"/etc.), dose?: string, petName?: string }
  Ex: "gave tontin vitamin c" → { supplement: "vitamin_c", petName: "tontin" } ; "pinpon C vitamini" → { supplement: "vitamin_c", petName: "pinpon" }

── CYCLE ──
- log_period_start: { } — no fields
- log_period_end: { } — no fields
- log_symptom: { symptom: string (REQUIRED) }
  Ex: "cramps bad today" → { symptom: "cramps" } ; "kramp girdim" → { symptom: "cramps" }
- pill_logged: { } — no fields
  Ex: "took my pill" → { }
- set_pregnant: { } — no fields. The user is declaring a pregnancy. This PAUSES the cycle (period prediction + late/missed nudges stop). NOT pregnancy tracking — there is no due date, no trimester, no fields.
  Ex (EN): "i'm pregnant" → { } ; "i am pregnant" → { } ; "just found out i'm pregnant" → { } ; "we're expecting" → { }
  Ex (ES): "estoy embarazada" → { } ; "estoy embarazada de nuevo" → { }
  Ex (TR): "hamileyim" → { } ; "hamile kaldım" → { }
- end_pregnancy: { } — no fields. The pregnancy ENDED by ANY path (birth, miscarriage, termination). This RESUMES the cycle. ONE neutral action for every kind of ending — never branch on which; do not ask the user to specify. Treat birth, loss, and termination identically.
  Ex — birth (EN): "i had the baby" → { } ; "gave birth" → { } ; "baby is here" → { } ; "i delivered" → { }
  Ex — loss (EN): "i lost the pregnancy" → { } ; "i had a miscarriage" → { } ; "miscarriage" → { } ; "i'm not pregnant anymore" → { }
  Ex — termination / generic end (EN): "the pregnancy ended" → { } ; "pregnancy is over" → { } ; "i had an abortion" → { } ; "i terminated the pregnancy" → { }
  Ex (ES): "tuve al bebé" → { } ; "di a luz" → { } ; "perdí el embarazo" → { } ; "tuve un aborto espontáneo" → { } ; "el embarazo terminó" → { } ; "ya no estoy embarazada" → { }
  Ex (TR): "bebek doğdu" → { } ; "doğum yaptım" → { } ; "bebeğim oldu" → { } ; "düşük yaptım" → { } ; "hamileliğim sona erdi" → { } ; "artık hamile değilim" → { }

── FINANCE ──
- log_transaction: { amount?: number, currency?: string, merchant?: string, renewal_for?: "passport"|"license"|"visa"|"lease"|"insurance"|"id"|"work_permit"|"residency_permit" }
  Ex: "spent $40 at sephora" → { amount: 40, currency: "USD", merchant: "sephora" }
  Ex (non-grocery purchase, no price): "bought a book" → { } ; "got new headphones" → { } ; "compré un libro" → { } ; "yeni gözlük aldım" → { }
  Ex (non-grocery purchase, with price/merchant): "picked up some makeup at sephora" → { merchant: "sephora" } ; "got headphones for $80" → { amount: 80, currency: "USD" } ; "bought a book at the bookstore for 15" → { amount: 15, currency: "USD", merchant: "bookstore" }
  Ex (renewal payment — sets renewal_for so handler mirrors to admin): "expedite fee 89 dollars for passport" → { amount: 89, currency: "USD", merchant: "passport expedite", renewal_for: "passport" } ; "visa fee 180 euros" → { amount: 180, currency: "EUR", merchant: "visa fee", renewal_for: "visa" } ; "pasaport harcı 600 lira" → { amount: 600, currency: "TRY", merchant: "passport fee", renewal_for: "passport" } ; "lease deposit 5000 paid" → { amount: 5000, merchant: "lease deposit", renewal_for: "lease" }
  Reminder: past-tense purchases NEVER route to admin.create_task / work.create_task / dump_only. If you cannot identify the item, still emit finance.log_transaction with an empty payload.
- log_income: { amount?: number, currency?: string, source?: string } — money IN. Salary, freelance payment, client payment, gift, asset sale. NOT for refunds (use log_refund). Source = the payer name when stated ("akalan", "elin energy", "client"); a generic "salary" / "paycheck" can be set as source even with no proper noun.
  Ex (EN): "maaş geldi" → { source: "salary" } ; "akalan paycheck deposited" → { source: "akalan" } ; "akalan paid me" → { source: "akalan" } ; "got paid for the design work" → { source: "design work" } ; "$2000 from the client" → { amount: 2000, currency: "USD", source: "client" }.
  Ex (TR): "maaş yattı" → { source: "salary" } ; "akalan ödedi" → { source: "akalan" } ; "freelance ödemesi 5000 TL geldi" → { amount: 5000, currency: "TRY", source: "freelance" }.
  Ex (ES): "depositaron el sueldo" → { source: "salary" } ; "elin energy me pagó 500" → { amount: 500, source: "elin energy" } ; "me pagaron el freelance" → { source: "freelance" }.
- log_refund: { amount?: number, currency?: string, merchant?: string, originalItem?: string } — money came back from a previous purchase. Conceptually a negative transaction; the UI may surface it adjacent to the original purchase or as a credit.
  Ex (EN): "returned the scarf" → { originalItem: "scarf" } ; "got a refund for the shoes" → { originalItem: "shoes" } ; "amazon refunded me $40" → { amount: 40, currency: "USD", merchant: "amazon" }.
  Ex (TR): "iade aldım" → { } ; "ayakkabıyı iade ettim" → { originalItem: "shoes" } ; "amazon 200 TL iade etti" → { amount: 200, currency: "TRY", merchant: "amazon" }.
  Ex (ES): "me devolvieron" → { } ; "devolvieron los zapatos" → { originalItem: "shoes" } ; "amazon me devolvió 40 dólares" → { amount: 40, currency: "USD", merchant: "amazon" }.
- spending_reflection: { note: string (REQUIRED — the reflection itself, paraphrased into English), category?: string, sentiment?: "concerned"|"satisfied"|"neutral" } — the user is reflecting on a SPENDING PATTERN, not logging one transaction. \`note\` MUST be present and should preserve the user's observation. \`category\` = the category being reflected on ("café", "takeout", "electronics", "subscriptions", "impulse buys"). \`sentiment\` defaults to "concerned" for pattern-marker reflections ("too much", "again", "third").
  Ex (EN): "spending too much on takeout" → { note: "spending too much on takeout", category: "takeout", sentiment: "concerned" } ; "this is the third mouse I've bought this year" → { note: "third mouse this year — repeated pattern", category: "electronics", sentiment: "concerned" } ; "forgot to cancel free trial again" → { note: "forgot to cancel free trial again — repeating pattern", category: "subscriptions", sentiment: "concerned" } ; "i overspend on impulse stuff" → { note: "overspending on impulse buys", category: "impulse", sentiment: "concerned" }.
  Ex (TR): "kahveye çok harcıyorum" → { note: "spending too much on coffee", category: "café", sentiment: "concerned" } ; "yine fazla yemek söyledim" → { note: "ordering takeout too often again", category: "takeout", sentiment: "concerned" }.
  Ex (ES): "gastando demasiado en café" → { note: "spending too much on coffee", category: "café", sentiment: "concerned" } ; "siempre termino comprando libros que no leo" → { note: "always end up buying books i don't read", category: "books", sentiment: "concerned" }.
- pending_decision: { what: string (REQUIRED — the decision in user's words, paraphrased to English), amount?: number, currency?: string, deadline?: string } — a money-related decision the user has NOT yet made. Quotes received, options being weighed, "should I…" money questions. Surfaces in the To-Do aggregate.
  Ex (EN): "moving quote 2400" → { what: "moving quote", amount: 2400 } ; "got a 2400 quote from the movers" → { what: "movers quote", amount: 2400 } ; "should I get the new laptop?" → { what: "new laptop" } ; "thinking about buying the desk" → { what: "buy the desk" } ; "nl lease deposit" → { what: "nl lease deposit" }.
  Ex (TR): "yeni laptop almalı mıyım?" → { what: "new laptop" } ; "nakliye teklifi 2400 TL" → { what: "moving quote", amount: 2400, currency: "TRY" }.
  Ex (ES): "comprar o no el sofá" → { what: "buy the sofa" } ; "presupuesto de mudanza 2400" → { what: "moving quote", amount: 2400 } ; "¿debería comprar la laptop?" → { what: "new laptop" }.
- add_bill: { merchant: string (REQUIRED), amount?: number, cadence?: "monthly"|"yearly"|"weekly" }
  Ex: "rent is $1800/month" → { merchant: "rent", amount: 1800, cadence: "monthly" }
- savings_note: { amount?: number, note?: string }
  Ex: "moved 500 to savings" → { amount: 500 }
- subscription_log: { name: string (REQUIRED), amount?: number, currency?: string, cadence?: "monthly"|"yearly"|"weekly" }
  Ex: "renewed spotify" → { name: "spotify" } ; "subscribed to netflix $15/month" → { name: "netflix", amount: 15, currency: "USD", cadence: "monthly" } ; "spotify 50 TL aylık" → { name: "spotify", amount: 50, currency: "TRY", cadence: "monthly" } ; "$120/yr for icloud" → { name: "icloud", amount: 120, currency: "USD", cadence: "yearly" }

── SLEEP ──
- log_sleep: { bedtime?: string, wake?: string, quality?: 1|2|3|4|5, hours?: number }
  Ex: "slept 11-7 well" → { bedtime: "23:00", wake: "07:00", quality: 4 } ; "8 saat uyudum iyi" → { hours: 8, quality: 4 } ; "slept 7 hours" → { hours: 7 } ; "got 5 hours" → { hours: 5 }
  Always emit \`hours\` (number) when the user states a duration. Omit bedtime/wake unless the user gave explicit times. Quality only when the user expressed sleep quality ("well", "iyi", "badly").
- wind_down_note: { note: string (REQUIRED) }
  Ex: "read for 20 min before bed" → { note: "read for 20 min before bed" }
- dream_log: { text: string (REQUIRED — the dream itself) }
  Ex: "dreamt I was flying" → { text: "I was flying" }
- log_insomnia: { duration_attempted_min?: number, woke_count?: number, med_taken?: string (cross-route hint — med name like "melatonin" when the user took a sleep aid; handler mirrors to medication.log_dose), med_dose?: string }
  Ex: "couldn't sleep at all, lay there 2 hours" → { duration_attempted_min: 120 } ; "couldn't sleep so took melatonin" → { med_taken: "melatonin" } ; "uyuyamadım, 5mg melatonin aldım" → { med_taken: "melatonin", med_dose: "5mg" }

── HABITS ──
- complete: { habitName: string (REQUIRED — the habit done) }
  Ex: "did my morning stretch" → { habitName: "morning stretch" } ; "meditation done" → { habitName: "meditation" }
- streak_break_note: { habitName: string (REQUIRED), reason?: string }
  Ex: "missed running today, too tired" → { habitName: "running", reason: "too tired" }
- identity_statement: { text: string (REQUIRED — the affirmation/identity claim) }
  Ex: "i am someone who writes daily" → { text: "i am someone who writes daily" }

── GOALS ──
- progress_note: { note: string (REQUIRED), goalName?: string }
  Ex: "finished chapter 3 of the book" → { note: "finished chapter 3", goalName: "book" }
- create_goal: { what: string (REQUIRED — the goal), why?: string }
  Ex: "want to run a half marathon" → { what: "run a half marathon" }
- milestone_hit: { milestone: string (REQUIRED), goalName?: string }
  Ex: "hit 10k followers" → { milestone: "10k followers" }
- obstacle_note: { obstacle: string (REQUIRED), goalName?: string }
  Ex: "knee is acting up, blocking running" → { obstacle: "knee pain", goalName: "running" }

── GROCERY ── (existing hints above already cover pricing/disambiguation)
- pantry_add: { item: string (REQUIRED), quantity?: string, price?: number, currency?: string }
  Ex (orphan from multi-item dump): "milk" → { item: "milk" } ; "oil" → { item: "oil" } ; "eggs" → { item: "eggs" } ; "tampons" → { item: "tampons" } ; "toilet paper" → { item: "toilet paper" }
  Ex (verb present): "bought milk" → { item: "milk" } ; "got tampons and toilet paper" → TWO fragments → { item: "tampons" } and { item: "toilet paper" } ; "süt aldım" → { item: "milk" }
- pantry_use: { item: string (REQUIRED) }
  Use ONLY for "consumed/used" with no rebuy implied: "used the last of the milk", "finished the yogurt".
- pantry_depleted: { item: string (REQUIRED) }
  DEPLETION — user ran OUT and needs more. Removes from pantry AND adds to the shopping list.
  Ex: "out of lemons" → { item: "lemons" } ; "we ran out of milk" → { item: "milk" } ; "used up the oil" → { item: "oil" } ; "limon bitti" / "limon kalmadı" → { item: "lemons" } ; "se acabó el aceite" → { item: "oil" }
  Prefer this over shopping_list_add whenever the phrasing says they HAD it and it's now gone ("out of", "ran out", "used up", "bitti", "kalmadı", "tükendi", "se acabó", "no queda").
- shopping_list_add: { item: string (REQUIRED) }
  Use for "need to buy / add to list" with NO depletion signal: "add coffee to the list", "we need paper towels", "buy garlic".
- pantry_low_flag: { item: string (REQUIRED) }
- meal_request: { query: string (REQUIRED — what they want to cook/eat) }
  Ex: "what can I make with chicken and rice" → { query: "chicken and rice" }
- recipe_cooked: { name: string (REQUIRED) }
  Ex: "made pasta carbonara" → { name: "pasta carbonara" }

── MEDICATION ──
- log_dose: { medName: string (REQUIRED), dose?: string }
  Ex: "took 50mg sertraline" → { medName: "sertraline", dose: "50mg" }
- missed_dose: { medName: string (REQUIRED) }
  Ex: "forgot my zoloft" → { medName: "zoloft" }
- side_effect_note: { medName: string (REQUIRED), note: string (REQUIRED) }
  Ex: "sertraline making me nauseous" → { medName: "sertraline", note: "nauseous" }

── DUMP_ONLY ──
- archive_only: { reason?: "no_module_match"|"low_confidence"|"user_only" }
  ❗ NEVER use dump_only for past-tense purchases. Even if you cannot identify what was bought, the fragment STILL routes to finance.log_transaction (or grocery.pantry_add if the object is clearly a consumable). Negative example: "bought a fancy thing I can't name" → finance.log_transaction { }, NOT dump_only.
  ❗ NEVER use dump_only as a substitute for create_task on past-tense purchases. "bought X" / "got X" / "X aldım" / "compré X" are always purchases, never to-dos, never archive-only.

═══════════════════════════════════════════════════════════════════════

Respond with a JSON object EXACTLY matching this shape (no extra keys, no prose):
{
  "module": one of [${MODULES.join(', ')}],
  "action": string (one of the actions listed for the chosen module),
  "confidence": number between 0 and 1,
  "payload": object with action-specific fields
}

═══════════════════════════════════════════════════════════════════════
NEGATION — classify the MISSED/SKIPPED intent, not the positive action
═══════════════════════════════════════════════════════════════════════
- "ilacımı almadım" → { module: "medication", action: "missed_dose", payload: { medName: "<inferred>" } }
- "did NOT take my meds today" → { module: "medication", action: "missed_dose", payload: { medName: "<inferred>" } }
- "skipped my vitamins" → { module: "medication", action: "missed_dose", payload: { medName: "vitamins" } }
- "no comí nada" → { module: "body", action: "log_hunger", payload: { } }  (user reports not eating → hunger event)

═══════════════════════════════════════════════════════════════════════
RETROSPECTIVE LOGGING — optional \`daysAgo\` field on any payload
═══════════════════════════════════════════════════════════════════════
When the user references a past time ("dün"/"yesterday"/"3 days ago"/etc.), add \`daysAgo: number\` to the payload. The module handler uses it to back-date the entry.
- "dün 5km koştum" → { module: "body", action: "log_movement", payload: { type: "run", duration_min: null, daysAgo: 1 } }
- "yesterday finished the PRD" → { module: "work", action: "create_task", payload: { text: "finished the PRD", daysAgo: 1 } }

Be conservative — if a fragment is ambiguous, pick dump_only with confidence 0.5. Errors of caution land the user in a "want to confirm?" UI, errors of over-confidence land bad data in a module.`;

export interface ClassifyResult {
  module: Module;
  payload: Record<string, unknown>;
  confidence: number;
}

export async function classifyFragment(
  fragmentText: string,
  language: FragmentLanguage,
  apiKey: string,
): Promise<ClassifyResult> {
  const userMessage = `Fragment language: ${language}\nFragment: ${fragmentText}`;

  const choice = await groqChat(
    {
      apiKey,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      jsonMode: true,
      maxTokens: 512,
    },
    'classify',
  );

  const rawText = choice.message.content ?? '';
  if (!rawText) {
    throw new Error(
      `classify groq empty content (finish=${choice.finish_reason})`,
    );
  }

  let parsed: {
    module: Module;
    action: string;
    confidence: number;
    payload: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`classify groq bad json: ${rawText.slice(0, 300)}`);
  }

  return {
    module: parsed.module,
    payload: { ...parsed.payload, module: parsed.module, action: parsed.action },
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

/** Parse a `{ results: [...] }` batch payload into ClassifyResults. Throws on
 *  malformed JSON or a count that doesn't match the request, so the caller
 *  never silently misaligns classifications to fragments. */
function parseBatchResults(rawText: string, expected: number, provider: string): ClassifyResult[] {
  let parsed: {
    results?: Array<{
      module: Module;
      action: string;
      confidence: number;
      payload: Record<string, unknown>;
    }>;
  };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`classify-batch ${provider} bad json: ${rawText.slice(0, 300)}`);
  }

  const results = parsed?.results;
  if (!Array.isArray(results) || results.length !== expected) {
    const got = Array.isArray(results) ? results.length : 'none';
    throw new Error(`classify-batch ${provider} count mismatch: got ${got} want ${expected}`);
  }

  return results.map((r) => ({
    module: r.module,
    payload: { ...r.payload, module: r.module, action: r.action },
    confidence: typeof r.confidence === 'number' ? r.confidence : 0,
  }));
}

/**
 * Classify one or more fragments in a SINGLE upstream call.
 *
 * The ~4k-token SYSTEM_PROMPT is the dominant token cost; sending it once per
 * dump instead of once per fragment turns a 3-fragment dump from ~12k tokens
 * (3 separate calls) into ~4.5k (one batched call) — the difference between a
 * reliable 502 and a working dump on Groq's free tier (8k tokens/minute).
 *
 * Provider strategy (free-tier, no paid Groq Dev Tier):
 *   - PRIMARY: Groq gpt-oss-120b — fast, but only 8k tokens/min.
 *   - FALLBACK: Gemini 2.5 Flash — ~31× the TPM (250k/min) so it absorbs
 *     overflow when Groq returns 429 (or a transient 5xx). Stacking the two
 *     free tiers covers far more throughput than either alone. Gemini is
 *     skipped if `keys.gemini` is absent (then a Groq 429 bubbles up so the
 *     caller can surface a soft rate-limit message).
 *
 * Output order matches input order; a count mismatch throws.
 */
export interface ClassifyProviders {
  /** Groq API key — primary (fastest). Required. */
  groq: string;
  /** Gemini API key — high-TPM fallback (~250k tokens/min). */
  gemini?: string;
  /** Cloudflare Workers AI binding — same-platform fallback, no key, ~10k/day. */
  cfAI?: CfAiBinding;
  /** OpenRouter API key — final catch-all (one key → many free models). */
  openrouter?: string;
}

export async function classifyBatch(
  items: Array<{ text: string; language: FragmentLanguage }>,
  providers: ClassifyProviders,
): Promise<ClassifyResult[]> {
  if (items.length === 0) return [];

  const list = items
    .map((it, i) => `[${i}] (lang=${it.language}) ${it.text}`)
    .join('\n');
  const userMessage =
    `You are given ${items.length} fragment(s) below, one per line, each prefixed with its index [i].\n` +
    `Classify EACH fragment independently using the rules above.\n` +
    `IGNORE the single-object response instruction above. Instead respond with a JSON object EXACTLY of the form:\n` +
    `{ "results": [ { "module": ..., "action": ..., "confidence": ..., "payload": {...} } ] }\n` +
    `The results array MUST contain exactly ${items.length} object(s), in the SAME order as the input indices.\n\n` +
    `Fragments:\n${list}`;

  const maxTokens = 256 * items.length + 256;

  // Ordered free-tier cascade: Groq (fastest) → Cloudflare Workers AI
  // (same-platform, no key) → Gemini (huge TPM). On ANY error we advance to
  // the next provider — stacking the free tiers makes the chain effectively
  // un-exhaustable. The LAST provider's error bubbles up so the caller can map
  // a final 429/503 to a soft "rate_limited" rather than an alarming 502.
  const chain: Array<{ name: string; run: () => Promise<string> }> = [
    {
      name: 'groq',
      run: async () => {
        const choice = await groqChat(
          {
            apiKey: providers.groq,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userMessage },
            ],
            jsonMode: true,
            maxTokens,
          },
          'classify-batch',
        );
        const rawText = choice.message.content ?? '';
        if (!rawText) {
          throw new Error(`classify-batch groq empty content (finish=${choice.finish_reason})`);
        }
        return rawText;
      },
    },
  ];
  if (providers.cfAI) {
    const cf = providers.cfAI;
    chain.push({
      name: 'cloudflare',
      run: () => cloudflareJson(cf, { system: SYSTEM_PROMPT, user: userMessage, maxTokens }, 'classify-batch'),
    });
  }
  if (providers.gemini) {
    const key = providers.gemini;
    chain.push({
      name: 'gemini',
      run: () => geminiJson({ apiKey: key, system: SYSTEM_PROMPT, user: userMessage, maxTokens }, 'classify-batch'),
    });
  }
  if (providers.openrouter) {
    const key = providers.openrouter;
    chain.push({
      name: 'openrouter',
      run: () => openRouterJson({ apiKey: key, system: SYSTEM_PROMPT, user: userMessage, maxTokens }, 'classify-batch'),
    });
  }

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const rawText = await provider.run();
      return parseBatchResults(rawText, items.length, provider.name);
    } catch (err) {
      lastErr = err;
      if (isLast) throw err;
      console.error(`[classify-batch] ${provider.name} failed, falling through to next provider`, err);
    }
  }
  throw lastErr;
}
