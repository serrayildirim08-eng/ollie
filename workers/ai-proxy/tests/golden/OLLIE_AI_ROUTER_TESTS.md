# Ollie AI Router — Function Declarations + Golden Tests + CC Prompt (Gemini 2.5 Flash)

**Companion to** `OLLIE_AI_ROUTER_HYBRID.md` and `OLLIE_AI_ROUTER_EXPRESSIONS.md`.

This file contains everything Claude Code needs to ship v1 hybrid:
1. **All 13 Gemini function declarations** — paste into the ai-proxy Worker
2. **The golden test set** — 60 base inputs + 30 hybrid + 10 Gemini-specific, must pass ≥93% before deploy
3. **The CC handoff prompt** — paste into Claude Code at the bottom

---

## Part 1 · Gemini function declarations (paste into Worker)

All 13 functions below. Used with `toolConfig: { functionCallingConfig: { mode: 'ANY' } }` to force at least one function call (no prose escape).

### 1.1 — `add_to_grocery`

```json
{
  "name": "add_to_grocery",
  "description": "User wants to BUY, NEEDS, is OUT OF, or just BOUGHT a food, drink, household, bathroom, cleaning, or pet-supply item. Examples: 'I need to buy pasta', 'out of toilet paper', 'bought milk', 'we're running low on coffee', 'tp', 'süt almam lazım'.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add", "log_purchase", "mark_out", "mark_low", "remove"],
        "description": "add = future intent (need/buy); log_purchase = past tense (bought/got/picked up); mark_out = explicitly out of stock; mark_low = running low; remove = user no longer wants this item"
      },
      "item": {"type": "string", "description": "normalized item name, lowercase, singular, no articles"},
      "quantity": {"type": "number"},
      "unit": {"type": "string", "description": "piece, liter, kg, oz, dozen, etc."},
      "raw": {"type": "string", "description": "exact original user phrase"}
    },
    "required": ["action", "item", "raw"]
  }
}
```

### 1.2 — `log_pet_event`

```json
{
  "name": "log_pet_event",
  "description": "User logged something about their pet (Tontin or Pinpon, both guinea pigs). Feeding, vitamins, cleaning the cage, vet, or health flags. Pet-supply purchases route to add_to_grocery, NOT here.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["log_feeding", "log_vitamin", "log_clean", "schedule_vet", "log_health_flag"]
      },
      "pet_name": {
        "type": "string",
        "enum": ["tontin", "pinpon", "both"],
        "description": "both = 'the pigs', 'them', 'the boys', or no pet specified"
      },
      "item": {"type": "string", "description": "e.g. hay, pellets, bell pepper, vitamin C"},
      "amount": {"type": "string"},
      "date": {"type": "string", "description": "ISO 8601 date if mentioned"},
      "symptom": {"type": "string", "description": "for log_health_flag only"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.3 — `log_finance_event`

```json
{
  "name": "log_finance_event",
  "description": "Money in/out, bills, subscriptions, savings, the receipt (impulse purchases user wants to track without judgment). Also handles money questions (when is rent due, how much did I spend). Buying physical food/household items routes to add_to_grocery — finance is for money flows.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add_bill", "log_payment", "add_subscription", "log_receipt", "add_savings_goal", "log_income", "remove_subscription", "query"]
      },
      "item": {"type": "string", "description": "rent, netflix, electric, etc."},
      "amount": {"type": "number"},
      "currency": {"type": "string", "enum": ["USD", "EUR", "TRY", "GBP"], "description": "infer from context or user locale; default USD"},
      "due_date": {"type": "string", "description": "ISO 8601 if known"},
      "frequency": {"type": "string", "enum": ["once", "weekly", "biweekly", "monthly", "yearly"]},
      "vendor": {"type": "string", "description": "for log_receipt — where the impulse spend happened ('the receipt')"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.4 — `log_habit`

```json
{
  "name": "log_habit",
  "description": "User did a daily habit or wants to add one. Habits = recurring practices like workout, journal, meditate, dishes, laundry. Categories: health, mental, home, work, self_care. NO STREAKS — just done/not done today.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["log_done", "add_habit"]},
      "category": {"type": "string", "enum": ["health", "mental", "home", "work", "self_care"]},
      "habit": {"type": "string", "description": "normalized habit name"},
      "duration_min": {"type": "number"},
      "raw": {"type": "string"}
    },
    "required": ["action", "category", "habit", "raw"]
  }
}
```

### 1.5 — `log_sleep`

```json
{
  "name": "log_sleep",
  "description": "Sleep events — duration, bedtime, wake time, naps, insomnia, tiredness. Note: 'took melatonin' usually routes to log_body (supplement), not here.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["log_sleep", "log_nap", "log_tiredness", "log_insomnia"]},
      "bedtime": {"type": "string", "description": "HH:MM 24h"},
      "wake_time": {"type": "string", "description": "HH:MM 24h"},
      "duration_hrs": {"type": "number"},
      "quality_1_10": {"type": "number", "description": "1=terrible, 10=great; infer from qualitative phrases"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.6 — `log_cycle_event`

```json
{
  "name": "log_cycle_event",
  "description": "Menstrual cycle events — period start/end, cramps, PMS, ovulation, flow level. 'Period drama' or 'period at the end of sentence' = NOT this tool.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["log_period_start", "log_period_end", "log_cramps", "log_pms", "log_ovulation"]},
      "date": {"type": "string", "description": "ISO 8601"},
      "level": {"type": "string", "enum": ["spotting", "light", "medium", "heavy"]},
      "severity": {"type": "string", "enum": ["low", "medium", "high"]},
      "symptoms": {"type": "array", "items": {"type": "string"}},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.7 — `add_work_task`

```json
{
  "name": "add_work_task",
  "description": "Work-related task, focus session, meeting, or deadline. Phrases like 'project X' or 'send to client' or 'pomodoro done'. NOT for personal admin (dentist, passport) — that's add_admin_task.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["add_task", "log_focus_session", "log_meeting", "add_deadline", "query"]},
      "title": {"type": "string"},
      "deadline": {"type": "string"},
      "duration_min": {"type": "number"},
      "project": {"type": "string"},
      "with": {"type": "string", "description": "person, for log_meeting"},
      "time": {"type": "string"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.8 — `add_goal`

```json
{
  "name": "add_goal",
  "description": "Long-term aspirations and milestones. Examples: 'save 50k by year end', 'move to netherlands', 'launch ollie by november'. Daily habits go to log_habit, NOT here.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["add_goal", "log_milestone", "update_status"]},
      "title": {"type": "string"},
      "why": {"type": "string"},
      "target_date": {"type": "string"},
      "amount": {"type": "number"},
      "status": {"type": "string", "enum": ["active", "someday", "completed", "paused", "cancelled", "restarted"]},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.9 — `add_admin_task`

```json
{
  "name": "add_admin_task",
  "description": "Personal administrative tasks: renewals (passport, license, lease), appointments (doctor, dentist), repairs (plumber, electrician), paperwork (taxes, visa, insurance). Work tasks route to add_work_task.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["add_renewal", "add_appointment", "add_repair", "add_paperwork"]},
      "title": {"type": "string"},
      "due_date": {"type": "string"},
      "type": {"type": "string", "description": "doctor, dentist, dmv, legal, home, etc."},
      "provider": {"type": "string"},
      "raw": {"type": "string"}
    },
    "required": ["action", "title", "raw"]
  }
}
```

### 1.10 — `query_astrology`

```json
{
  "name": "query_astrology",
  "description": "Horoscope, zodiac, mercury retrograde, moon phases, birth chart. Light module — most astrology mentions in brain dumps should route to log_to_dump unless explicitly asking about a chart event.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["get_horoscope", "log_chart_event"]},
      "sign": {"type": "string"},
      "event": {"type": "string", "description": "mercury retrograde, full moon, eclipse, etc."},
      "scope": {"type": "string", "enum": ["daily", "weekly", "monthly", "now", "birth_chart"]},
      "date": {"type": "string"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.11 — `log_body`

```json
{
  "name": "log_body",
  "description": "Self-care logging: water intake, supplements, walks/steps, stretching, rest breaks. NEVER calories. Weight is opt-in only and not handled here in v1.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["log_water", "log_supplement", "log_walk", "log_rest", "log_stretch"]},
      "item": {"type": "string", "description": "for log_supplement: vitamin D, magnesium, etc."},
      "amount": {"type": "number"},
      "unit": {"type": "string", "enum": ["glass", "liter", "ml", "oz", "mg", "min", "steps"]},
      "area": {"type": "string", "description": "for log_stretch: neck, back, hips, etc."},
      "duration_min": {"type": "number"},
      "steps": {"type": "number"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.12 — `log_medication`

```json
{
  "name": "log_medication",
  "description": "Prescription or OTC medication events. Higher stakes than supplements — these have clinical impact (ADHD meds, SSRIs, antibiotics, birth control). Vitamins/magnesium/melatonin route to log_body (supplement) unless user explicitly tracks them as medication.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["add_med", "log_taken", "mark_overdue", "add_dose_schedule", "update_status"]},
      "med_name": {"type": "string"},
      "dose": {"type": "number"},
      "unit": {"type": "string", "enum": ["mg", "ml", "pill", "drop"]},
      "time": {"type": "string", "description": "HH:MM 24h"},
      "frequency": {"type": "string", "enum": ["once", "daily", "2x_daily", "3x_daily", "weekly", "as_needed"]},
      "reason": {"type": "string"},
      "raw": {"type": "string"}
    },
    "required": ["action", "raw"]
  }
}
```

### 1.13 — `log_to_dump`

```json
{
  "name": "log_to_dump",
  "description": "Feelings, observations, rants, half-formed thoughts. The catch-all. Use when message has NO actionable item across other modules, OR alongside another tool when emotion accompanies an action ('feel horrible and started my period' → cycle + dump).",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {"type": "string", "enum": ["log"]},
      "text": {"type": "string", "description": "the user's full thought, preserved as-is"},
      "mood_tag": {
        "type": "string",
        "enum": ["happy", "content", "neutral", "meh", "tired", "sad", "anxious", "angry", "overwhelmed", "scattered", "low", "excited"],
        "description": "infer from message, optional"
      },
      "raw": {"type": "string"}
    },
    "required": ["action", "text", "raw"]
  }
}
```

---

## Part 2 · Golden test set

Run before every deploy. Pass rate must be ≥93%.

**Note on test format:** `expected_calls[].input` represents what `args` should look like in Gemini's `functionCall.args` (same shape as Anthropic's `tool_use.input` — Gemini and Anthropic both follow JSON Schema property names).

### 2.1 — Base tests (60 — must pass on both fast and slow paths)

```json
{
  "tests": [
    {
      "id": "T01_pasta_bug",
      "note": "THE headline bug. Was misrouting to work.",
      "input": "I need to buy pasta",
      "expected_calls": [
        {"tool": "add_to_grocery", "input": {"action": "add", "item": "pasta", "raw": "I need to buy pasta"}}
      ]
    },
    {"id": "T02_past_tense_grocery", "input": "bought milk", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "milk", "raw": "bought milk"}}]},
    {"id": "T03_out_of", "input": "out of toilet paper", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "mark_out", "item": "toilet paper", "raw": "out of toilet paper"}}]},
    {"id": "T04_gen_z_abbrev", "input": "tp", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "toilet paper", "raw": "tp"}}]},
    {"id": "T05_quantity", "input": "got 2 dozen eggs", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "eggs", "quantity": 24, "unit": "piece", "raw": "got 2 dozen eggs"}}]},
    {"id": "T06_turkish_grocery", "input": "süt almam lazım", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "milk", "raw": "süt almam lazım"}}]},
    {"id": "T07_spanish_grocery", "input": "necesito comprar leche", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "milk", "raw": "necesito comprar leche"}}]},
    {"id": "T08_negation", "input": "not buying ice cream anymore", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "remove", "item": "ice cream", "raw": "not buying ice cream anymore"}}]},
    {"id": "T09_multi_grocery", "input": "bought milk, eggs, and bread", "expected_calls": [
      {"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "milk", "raw": "bought milk, eggs, and bread"}},
      {"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "eggs", "raw": "bought milk, eggs, and bread"}},
      {"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "bread", "raw": "bought milk, eggs, and bread"}}
    ]},
    {"id": "T10_pet_feeding", "input": "fed tontin", "expected_calls": [{"tool": "log_pet_event", "input": {"action": "log_feeding", "pet_name": "tontin", "raw": "fed tontin"}}]},
    {"id": "T11_pet_both", "input": "gave the pigs vitamin C", "expected_calls": [{"tool": "log_pet_event", "input": {"action": "log_vitamin", "pet_name": "both", "item": "vitamin C", "raw": "gave the pigs vitamin C"}}]},
    {"id": "T12_pet_supplies_to_grocery", "note": "Pet supplies route to GROCERY, not pets.", "input": "need more hay", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "timothy hay", "raw": "need more hay"}}]},
    {"id": "T13_finance_bill", "input": "rent is due", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "add_bill", "item": "rent", "raw": "rent is due"}}]},
    {"id": "T14_finance_paid", "input": "paid rent", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "log_payment", "item": "rent", "raw": "paid rent"}}]},
    {"id": "T15_finance_receipt", "input": "spent $40 on impulse stuff at sephora", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "log_receipt", "amount": 40, "currency": "USD", "vendor": "sephora", "raw": "spent $40 on impulse stuff at sephora"}}]},
    {"id": "T16_finance_subscription", "input": "netflix is $15/mo", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "add_subscription", "item": "netflix", "amount": 15, "currency": "USD", "frequency": "monthly", "raw": "netflix is $15/mo"}}]},
    {"id": "T17_finance_query", "input": "when is rent due?", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "query", "item": "rent", "raw": "when is rent due?"}}]},
    {"id": "T18_finance_stock_disambig", "note": "'buy stock' = finance, NOT grocery.", "input": "buy stock in nvda", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "add_savings_goal", "item": "NVDA stock", "raw": "buy stock in nvda"}}]},
    {"id": "T19_habit_done", "input": "did yoga", "expected_calls": [{"tool": "log_habit", "input": {"action": "log_done", "category": "health", "habit": "yoga", "raw": "did yoga"}}]},
    {"id": "T20_habit_meditate_duration", "input": "meditated for 10 minutes", "expected_calls": [{"tool": "log_habit", "input": {"action": "log_done", "category": "mental", "habit": "meditate", "duration_min": 10, "raw": "meditated for 10 minutes"}}]},
    {"id": "T21_habit_dishes", "input": "dishes done", "expected_calls": [{"tool": "log_habit", "input": {"action": "log_done", "category": "home", "habit": "dishes", "raw": "dishes done"}}]},
    {"id": "T22_sleep_duration", "input": "slept 7 hours", "expected_calls": [{"tool": "log_sleep", "input": {"action": "log_sleep", "duration_hrs": 7, "raw": "slept 7 hours"}}]},
    {"id": "T23_sleep_quality_qualitative", "input": "slept like trash", "expected_calls": [{"tool": "log_sleep", "input": {"action": "log_sleep", "quality_1_10": 3, "raw": "slept like trash"}}]},
    {"id": "T24_insomnia", "input": "didn't sleep at all", "expected_calls": [{"tool": "log_sleep", "input": {"action": "log_insomnia", "duration_hrs": 0, "raw": "didn't sleep at all"}}]},
    {"id": "T25_cycle_start", "input": "got my period", "expected_calls": [{"tool": "log_cycle_event", "input": {"action": "log_period_start", "raw": "got my period"}}]},
    {"id": "T26_cycle_cramps", "input": "killer cramps", "expected_calls": [{"tool": "log_cycle_event", "input": {"action": "log_cramps", "severity": "high", "raw": "killer cramps"}}]},
    {"id": "T27_cycle_emotion_multi", "note": "Multi-intent: cycle + dump.", "input": "feel horrible and started my period", "expected_calls": [
      {"tool": "log_cycle_event", "input": {"action": "log_period_start", "raw": "feel horrible and started my period"}},
      {"tool": "log_to_dump", "input": {"action": "log", "text": "feel horrible and started my period", "mood_tag": "low", "raw": "feel horrible and started my period"}}
    ]},
    {"id": "T28_period_drama_disambig", "note": "'period' as punctuation, NOT cycle.", "input": "period drama tonight", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "period drama tonight", "raw": "period drama tonight"}}]},
    {"id": "T29_work_task", "input": "send invoice to client", "expected_calls": [{"tool": "add_work_task", "input": {"action": "add_task", "title": "send invoice to client", "raw": "send invoice to client"}}]},
    {"id": "T30_work_focus", "input": "pomodoro done", "expected_calls": [{"tool": "add_work_task", "input": {"action": "log_focus_session", "duration_min": 25, "raw": "pomodoro done"}}]},
    {"id": "T31_work_meeting", "input": "meeting with sarah at 3", "expected_calls": [{"tool": "add_work_task", "input": {"action": "log_meeting", "with": "sarah", "time": "15:00", "raw": "meeting with sarah at 3"}}]},
    {"id": "T32_project_pasta_real_work", "note": "Actual work case with 'pasta' as project name.", "input": "project pasta deadline friday", "expected_calls": [{"tool": "add_work_task", "input": {"action": "add_deadline", "project": "project pasta", "deadline": "friday", "raw": "project pasta deadline friday"}}]},
    {"id": "T33_goal_with_date", "input": "save 50k by year end", "expected_calls": [{"tool": "add_goal", "input": {"action": "add_goal", "title": "save 50k", "target_date": "2026-12-31", "amount": 50000, "raw": "save 50k by year end"}}]},
    {"id": "T34_goal_move", "input": "want to move to netherlands by july", "expected_calls": [{"tool": "add_goal", "input": {"action": "add_goal", "title": "move to netherlands", "target_date": "2026-07-31", "raw": "want to move to netherlands by july"}}]},
    {"id": "T35_admin_passport", "input": "passport renewal", "expected_calls": [{"tool": "add_admin_task", "input": {"action": "add_renewal", "title": "passport renewal", "raw": "passport renewal"}}]},
    {"id": "T36_admin_dentist", "input": "dentist on tuesday", "expected_calls": [{"tool": "add_admin_task", "input": {"action": "add_appointment", "title": "dentist appointment", "provider": "dentist", "due_date": "tuesday", "raw": "dentist on tuesday"}}]},
    {"id": "T37_admin_plumber", "input": "plumber needs to come", "expected_calls": [{"tool": "add_admin_task", "input": {"action": "add_repair", "title": "plumber visit", "provider": "plumber", "raw": "plumber needs to come"}}]},
    {"id": "T38_astrology_horoscope", "input": "what's my horoscope today", "expected_calls": [{"tool": "query_astrology", "input": {"action": "get_horoscope", "scope": "daily", "raw": "what's my horoscope today"}}]},
    {"id": "T39_astrology_mercury", "input": "is mercury retrograde rn", "expected_calls": [{"tool": "query_astrology", "input": {"action": "get_horoscope", "event": "mercury retrograde", "scope": "now", "raw": "is mercury retrograde rn"}}]},
    {"id": "T40_body_water", "input": "3 glasses of water", "expected_calls": [{"tool": "log_body", "input": {"action": "log_water", "amount": 3, "unit": "glass", "raw": "3 glasses of water"}}]},
    {"id": "T41_body_supplement", "input": "took my vitamins", "expected_calls": [{"tool": "log_body", "input": {"action": "log_supplement", "item": "vitamins", "raw": "took my vitamins"}}]},
    {"id": "T42_body_walk", "input": "went on a 20 min walk", "expected_calls": [{"tool": "log_body", "input": {"action": "log_walk", "duration_min": 20, "raw": "went on a 20 min walk"}}]},
    {"id": "T43_melatonin_to_body", "note": "Melatonin = supplement, NOT medication by default.", "input": "took melatonin", "expected_calls": [{"tool": "log_body", "input": {"action": "log_supplement", "item": "melatonin", "raw": "took melatonin"}}]},
    {"id": "T44_medication_adderall", "input": "20mg adderall at 9am", "expected_calls": [{"tool": "log_medication", "input": {"action": "log_taken", "med_name": "adderall", "dose": 20, "unit": "mg", "time": "09:00", "raw": "20mg adderall at 9am"}}]},
    {"id": "T45_medication_overdue", "input": "forgot my meds", "expected_calls": [{"tool": "log_medication", "input": {"action": "mark_overdue", "raw": "forgot my meds"}}]},
    {"id": "T46_dump_feeling", "input": "my brain feels like soup", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "my brain feels like soup", "mood_tag": "overwhelmed", "raw": "my brain feels like soup"}}]},
    {"id": "T47_dump_ugh", "input": "ugh", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "ugh", "mood_tag": "meh", "raw": "ugh"}}]},
    {"id": "T48_multi_3way", "note": "Three function calls in one input.", "input": "bought milk, did yoga, period started", "expected_calls": [
      {"tool": "add_to_grocery", "input": {"action": "log_purchase", "item": "milk", "raw": "bought milk, did yoga, period started"}},
      {"tool": "log_habit", "input": {"action": "log_done", "category": "health", "habit": "yoga", "raw": "bought milk, did yoga, period started"}},
      {"tool": "log_cycle_event", "input": {"action": "log_period_start", "raw": "bought milk, did yoga, period started"}}
    ]},
    {"id": "T49_multi_chocolate_pms", "note": "PMS + chocolate craving = cycle + grocery.", "input": "pms-ing hard, need chocolate", "expected_calls": [
      {"tool": "log_cycle_event", "input": {"action": "log_pms", "raw": "pms-ing hard, need chocolate"}},
      {"tool": "add_to_grocery", "input": {"action": "add", "item": "chocolate", "raw": "pms-ing hard, need chocolate"}}
    ]},
    {"id": "T50_pet_a_dog_disambig", "note": "'pet a dog' = verb, NOT pets module.", "input": "pet a dog today", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "pet a dog today", "raw": "pet a dog today"}}]},
    {"id": "T51_typo_resilience", "input": "toilet papre", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "toilet paper", "raw": "toilet papre"}}]},
    {"id": "T52_observation_skip", "note": "Observation only — should NOT add to grocery.", "input": "we have plenty of rice", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "we have plenty of rice", "raw": "we have plenty of rice"}}]},
    {"id": "T53_skipped_workout", "input": "skipped workout today", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "skipped workout today", "mood_tag": "low", "raw": "skipped workout today"}}]},
    {"id": "T54_back_hurts_not_body", "note": "Body pain = dump, NOT log_body.", "input": "my back hurts", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "my back hurts", "mood_tag": "low", "raw": "my back hurts"}}]},
    {"id": "T55_finance_query_spend", "input": "how much did i spend this month", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "query", "raw": "how much did i spend this month"}}]},
    {"id": "T56_admin_visa_deadline", "input": "visa application deadline 6/1", "expected_calls": [{"tool": "add_admin_task", "input": {"action": "add_paperwork", "title": "visa application", "due_date": "2026-06-01", "raw": "visa application deadline 6/1"}}]},
    {"id": "T57_turkish_meds", "input": "ilacımı aldım", "expected_calls": [{"tool": "log_medication", "input": {"action": "log_taken", "raw": "ilacımı aldım"}}]},
    {"id": "T58_turkish_workout", "input": "spor yaptım", "expected_calls": [{"tool": "log_habit", "input": {"action": "log_done", "category": "health", "habit": "workout", "raw": "spor yaptım"}}]},
    {"id": "T59_spanish_period", "input": "me bajó", "expected_calls": [{"tool": "log_cycle_event", "input": {"action": "log_period_start", "raw": "me bajó"}}]},
    {"id": "T60_subscription_cancel_multi", "note": "Canceling a gym subscription = finance + maybe habits.", "input": "canceled gym membership", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "remove_subscription", "item": "gym", "raw": "canceled gym membership"}}]}
  ]
}
```

### 2.2 — Hybrid-specific tests (30 — verify fast/slow path routing)

```json
{
  "hybrid_tests": [
    {"id": "H01_fast_path_grocery_simple", "input": "buy eggs", "expected_path": "fast", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "eggs"}}]},
    {"id": "H02_fast_path_turkish", "input": "süt almam lazım", "expected_path": "fast", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "milk"}}]},
    {"id": "H03_slow_path_multi_intent", "input": "bought milk and did yoga", "expected_path": "slow", "expected_calls_count": 2},
    {"id": "H04_slow_path_finance_always", "input": "rent is due", "expected_path": "slow", "note": "finance always slow path"},
    {"id": "H05_fast_path_pasta", "input": "i need pasta", "expected_path": "fast", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "pasta"}}]},
    {"id": "H06_template_miss_falls_to_gemini", "input": "I'm thinking about maybe getting some pasta", "expected_path": "slow", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "pasta"}}]},
    {"id": "H07_false_positive_check", "note": "Should NOT match 'buy X' template — 'I love' is not 'buy'", "input": "I love pasta", "expected_path": "slow", "expected_calls": [{"tool": "log_to_dump"}]},
    {"id": "H08_pasta_bug_fast_path", "input": "I need to buy pasta", "expected_path": "fast", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "add", "item": "pasta"}}]},
    {"id": "H09_confidence_tie_falls_to_gemini", "input": "walk", "note": "could be habits or body — should fall to Gemini for disambiguation", "expected_path": "slow"},
    {"id": "H10_negation_template", "input": "not buying ice cream anymore", "expected_path": "fast", "expected_calls": [{"tool": "add_to_grocery", "input": {"action": "remove", "item": "ice cream"}}]},
    {"id": "H11_pet_template", "input": "fed tontin", "expected_path": "fast", "expected_calls": [{"tool": "log_pet_event", "input": {"action": "log_feeding", "pet_name": "tontin"}}]},
    {"id": "H12_habit_template_known", "input": "did yoga", "expected_path": "fast", "expected_calls": [{"tool": "log_habit", "input": {"action": "log_done", "habit": "yoga"}}]},
    {"id": "H13_habit_template_unknown_falls", "input": "did some weird dance thing", "expected_path": "slow", "note": "habit name not in dictionary, fall to Gemini"},
    {"id": "H14_body_water_template", "input": "3 glasses of water", "expected_path": "fast", "expected_calls": [{"tool": "log_body", "input": {"action": "log_water", "amount": 3, "unit": "glass"}}]},
    {"id": "H15_dump_fast_path", "input": "ugh", "expected_path": "fast", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "text": "ugh"}}]},
    {"id": "H16_finance_always_slow", "input": "paid rent", "expected_path": "slow", "note": "all finance goes slow"},
    {"id": "H17_medication_always_slow", "input": "took my meds", "expected_path": "slow"},
    {"id": "H18_work_always_slow", "input": "meeting at 3", "expected_path": "slow"},
    {"id": "H19_cycle_always_slow", "input": "period started", "expected_path": "slow"},
    {"id": "H20_admin_always_slow", "input": "dentist tuesday", "expected_path": "slow"},
    {"id": "H21_spanish_grocery_fast", "input": "necesito comprar leche", "expected_path": "fast"},
    {"id": "H22_voyage_outage_fallback", "note": "Simulate Voyage failure — should fall to Gemini gracefully", "voyage_force_fail": true, "input": "buy eggs", "expected_path": "slow"},
    {"id": "H23_gemini_outage_queue", "note": "Simulate both outage — should queue, not crash", "gemini_force_fail": true, "voyage_force_fail": true, "input": "buy eggs", "expected_path": "queued"},
    {"id": "H24_multi_intent_comma", "input": "milk, eggs, bread", "expected_path": "slow", "expected_calls_count": 3},
    {"id": "H25_low_confidence_falls", "input": "the thing", "note": "vague — embedding shouldn't be confident, falls to Gemini", "expected_path": "slow"},
    {"id": "H26_cached_input_no_voyage_call", "note": "Send same input twice — second should hit KV cache", "input": "buy eggs", "expected_path": "fast", "expected_voyage_calls": 0},
    {"id": "H27_typo_falls_to_slow", "input": "i ned to by pst", "note": "heavy typos — fast path templates won't match", "expected_path": "slow"},
    {"id": "H28_question_finance_slow", "input": "when is rent due?", "expected_path": "slow", "expected_calls": [{"tool": "log_finance_event", "input": {"action": "query"}}]},
    {"id": "H29_aggressive_dump", "input": "i hate everything today", "expected_path": "fast", "expected_calls": [{"tool": "log_to_dump", "input": {"action": "log", "mood_tag": "angry"}}]},
    {"id": "H30_pets_disambig", "input": "pet a dog today", "expected_path": "slow", "note": "'pet a dog' verb, should NOT match pets template"}
  ]
}
```

### 2.3 — Gemini-specific tests (10 — verify Gemini function-calling behavior)

```json
{
  "gemini_tests": [
    {"id": "TG01_mode_any_forces_call", "input": "I need to buy pasta", "expected": "at least one functionCall in response, no prose-only response"},
    {"id": "TG02_malformed_retry", "input": "buy fdslkfjsdlkfjsdf", "expected": "if first call returns malformed JSON, retry once, then fall to log_to_dump"},
    {"id": "TG03_multi_intent_multiple_calls", "input": "bought milk and did yoga", "expected": "response.candidates[0].content.parts contains 2 functionCall blocks"},
    {"id": "TG04_args_parsing_all_tools", "note": "Verify each of 13 tools can be invoked and args correctly parsed", "expected": "each tool returns its full args dict, no missing required fields"},
    {"id": "TG05_system_prompt_isolation", "note": "Send 5 consecutive different brain dumps — each must route independently, no context bleed", "expected": "no carryover between calls"},
    {"id": "TG06_empty_args_handling", "input": "...", "expected": "if Gemini returns empty args, fall to log_to_dump with raw text"},
    {"id": "TG07_required_field_missing_retry", "note": "If Gemini omits a 'required' field, retry once; if still missing, fall to log_to_dump", "expected": "graceful degradation"},
    {"id": "TG08_enum_violation_retry", "note": "If Gemini returns enum value not in declared set, retry once with reinforcement, else fall to log_to_dump", "expected": "graceful degradation"},
    {"id": "TG09_latency_p99_under_1500ms", "note": "Send 100 brain dumps, measure latency", "expected": "p99 < 1500ms, p50 < 700ms"},
    {"id": "TG10_rate_limit_handling", "note": "If Gemini returns 429, retry with backoff, then queue", "expected": "no user-visible failure on rate limit"}
  ]
}
```

**Test harness:** for each test, call the router endpoint, compare `expected_calls` to actual. Match on `tool` name + `action` + key slots. Soft-match `raw` field. Pass = all expected tools fired with correct actions and key slots present.

**Combined pass criteria:** ≥95% on T01–T60 + ≥90% on H01–H30 + 100% on TG01–TG10.

---

## Part 3 · The Claude Code prompt (paste as-is)

```
# Ollie AI Router v1 Hybrid Implementation (Voyage + Gemini 2.5 Flash)

Implement the hybrid Voyage + Gemini router for Ollie. Four spec files in this folder:

- OLLIE_AI_ROUTER_HYBRID.md — architecture and decisions
- OLLIE_AI_ROUTER_EXPRESSIONS.md — what real user inputs look like
- OLLIE_AI_ROUTER_TESTS.md — THIS FILE — function declarations + golden tests
- OLLIE_AI_ROUTER_SPEC.md — old pure-Haiku plan, kept for reference only

Read HYBRID.md fully and the relevant parts of EXPRESSIONS.md and TESTS.md
before starting.

## What you're building

A two-stage router in the ai-proxy Cloudflare Worker:

1. FAST PATH: Voyage embedding → cosine vs prototypes → template slot extraction
2. SLOW PATH: Gemini 2.5 Flash function-calling with 13 declarations

Both paths return the same `{calls: [...], meta: {...}}` shape to clients.

The headline bug to fix: "I need to buy pasta" must route to grocery, not work.
Goal: fix it via FAST path (sub-100ms) for free.

## Implementation steps

### 1. Vendor accounts + secrets

- Get a Voyage API key from voyageai.com (free tier covers years)
- Get a Gemini API key from aistudio.google.com (free for dev, paid for prod)
- Add both as Cloudflare Worker secrets:
    wrangler secret put VOYAGE_API_KEY
    wrangler secret put GEMINI_API_KEY
- Keep ANTHROPIC_API_KEY in env if other Claude calls exist, but the router
  no longer uses it

### 2. Voyage integration (Worker side)

- Use the Voyage REST API or `voyageai` npm package
- New helper: embedText(text) calls voyage-multilingual-2 endpoint
- Wrap with KV cache (24hr TTL on sha256(text))
- Timeout 2000ms — if Voyage is slow/down, skip fast path, go straight to Gemini

### 3. Prototype vector generation

- Write scripts/build-prototype-vectors.ts
- For each module, embed 15-25 utterances from EXPRESSIONS.md
- Average embeddings → module_vectors.json (committed to repo)
- Worker imports this JSON at boot

### 4. Cosine + confidence gating

Implement classifyFast(embedding, prototypes) per spec.
Default thresholds: top1 > 0.75, gap > 0.10.
Make thresholds env-tunable.

### 5. Multi-intent detector

Implement isMultiIntent(text) with the regex set in HYBRID.md section D.
If true → skip fast path entirely.

### 6. Template extractors

Implement template arrays for 5 modules: grocery, habits, body, pets, dump.
Each template runs in order; first match wins.
If no template matches → fall to Gemini.

### 7. Gemini integration

- Install @google/genai SDK
- Define the 13 function declarations from Part 1 of this file
- Call with:
    tools: [{functionDeclarations: TOOL_DEFS}]
    toolConfig: {functionCallingConfig: {mode: 'ANY'}}
- Parse response.candidates[].content.parts[].functionCall into the
  unified {tool, input} shape (note: Gemini uses `args` not `input` —
  rename in your parser)
- Wrap parse in try/catch — on failure, retry once, then fall to log_to_dump

### 8. Worker dispatcher

```
async function route(text) {
  if (isMultiIntent(text)) return geminiRoute(text);
  
  const embedding = await embedText(text);
  if (!embedding) return geminiRoute(text);
  
  const classification = classifyFast(embedding, prototypes);
  
  if (!classification.confident) return geminiRoute(text);
  if (!FAST_PATH_MODULES.includes(classification.module)) return geminiRoute(text);
  
  const fastResult = applyTemplate(classification.module, text);
  if (!fastResult) return geminiRoute(text);
  
  return {
    calls: [fastResult],
    meta: { path: 'fast', module_confidence: classification.score }
  };
}
```

### 9. Client updates (web + iOS)

- Parse new response shape `{calls, meta}`
- Same chip animation logic for each call
- Show meta.path in dev mode only (for debugging)

### 10. Tests

- Implement test runner that loads tests from this file
- Run T01–T60 (base tests) — ALL must pass with Gemini schemas
- Run H01–H30 (hybrid tests) — verify path correctness
- Run TG01–TG10 (Gemini tests) — verify Gemini-specific behavior
- Combined target: ≥93% pass rate

### 11. Deploy

- Use existing pipeline (DEPLOY_RUNBOOK.md)
- Smoke test in production: send all 100 golden tests
- Verify "I need to buy pasta" → grocery via fast path

## Rules

- Templates are HIGH-CONFIDENCE only — when in doubt, fall to Gemini
- Never default to a "best guess" — always fall through
- Use Gemini mode: 'ANY' to force function calls (no prose responses)
- Preserve user's exact phrase in `raw` field of every tool input
- Multi-intent → always slow path
- finance, medication, work, goals, admin, cycle, astrology, sleep → always slow path
- Old keyword router (KEYWORD_MAP, fallbackRoute) stays ONLY as offline-queue
  fallback for when both Voyage AND Gemini are unreachable

## Done criteria

- [ ] VOYAGE_API_KEY + GEMINI_API_KEY secrets set
- [ ] module_vectors.json committed and loaded by Worker
- [ ] classifyFast + isMultiIntent + 5 template extractors implemented
- [ ] Gemini SDK integrated with mode='ANY'
- [ ] Worker dispatcher routes correctly to fast or slow path
- [ ] Response shape unified across both paths
- [ ] Web + iOS clients parse the new shape
- [ ] All 100 golden tests pass (≥93%)
- [ ] "I need to buy pasta" verified in production via fast path
- [ ] Old keyword router isolated to offline-fallback code path only

Report back:
- Which tests passed, which failed
- Path breakdown (fast vs slow %)
- Average latency per path (p50 and p99)
- One-line diagnosis per failure
- Voyage + Gemini cost over the test run
```

---

## Reading order for the team

| Audience | Read |
|---|---|
| **You (Serra)** | HYBRID.md (architecture + decisions) → this file's Part 2 (the bug examples) |
| **Cofounder** | HYBRID.md TL;DR + cost table only |
| **Claude Code** | All three files, in order: HYBRID → EXPRESSIONS → TESTS |
| **Future designers** | EXPRESSIONS.md (this is the product surface) |

---

## Appendix · If you ever want to swap Gemini for Haiku

Same dispatcher pattern works. Replace:
- `@google/genai` import → `@anthropic-ai/sdk`
- `tools: [{functionDeclarations: ...}]` → `tools: [{input_schema: ..., strict: true}]`
- `toolConfig.functionCallingConfig.mode: 'ANY'` → `tool_choice: {"type": "any"}`
- `response.candidates[].content.parts[].functionCall` → `response.content[].type === "tool_use"`

The 13 schemas need format conversion (parameters → input_schema, add strict: true). 1-day change. Cost goes up ~3×. Quality goes up ~5-10%.
