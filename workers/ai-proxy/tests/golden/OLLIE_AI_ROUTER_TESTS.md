# Ollie AI Router — Golden Tests (v2 RouterOutput shape)

**Schema:** v1.0 `RouterOutput` (see `workers/ai-proxy/src/router/dump-schema.ts`).
**Endpoint:** `POST /route/dump`.
**Companion:** original v1 function-calling tests preserved in git history at commit `b24c5aa`.

This file holds the v2 migration of the original 100 golden tests authored
2026-05-19. Migration was mechanical: same input strings, same routing
intent, expected output rewritten to v2 `RouterOutput` shape.

**Pass criteria:** ≥ 95 % on base (T-prefix) + ≥ 90 % on hybrid (H-prefix)
+ 100 % on gemini-specific (TG-prefix). 10 tests dropped (see § Dropped).

---

## § Mapping table — v1 function → v2 (module, action)

| v1 function       | v2 module      | v1 action            | v2 action            | notes |
|-------------------|----------------|----------------------|----------------------|-------|
| `add_to_grocery`  | `grocery`      | `add`                | `shopping_list_add`  | future intent |
|                   |                | `log_purchase`       | `pantry_add`         | past tense → now have |
|                   |                | `mark_out`           | `shopping_list_add`  | out → need to buy |
|                   |                | `mark_low`           | `shopping_list_add`  | low → need to top up |
|                   |                | `remove`             | — DROP               | no v2 remove action |
| `log_pet_event`   | `pets`         | `log_feeding`        | `log_feed`           | |
|                   |                | `log_vitamin`        | `log_care`           | vitamin = care |
|                   |                | `log_observation`    | `log_observation`    | |
|                   |                | `log_vet`            | `log_vet`            | |
|                   |                | `log_milestone`      | `log_observation`    | closest |
| `log_finance_event` | `finance`    | `add_bill`           | `add_bill`           | |
|                   |                | `log_payment`        | `log_transaction`    | |
|                   |                | `log_receipt`        | `log_transaction`    | |
|                   |                | `add_subscription`   | `subscription_log`   | |
|                   |                | `remove_subscription`| `subscription_log`   | with `operation: "cancel"` |
|                   |                | `add_savings_goal`   | `savings_note`       | |
|                   |                | `query`              | — DROP               | brain-dump ≠ query channel |
| `log_habit`       | `habits`       | `log_done`           | `complete`           | |
| `log_sleep`       | `sleep`        | `log_sleep`          | `log_sleep`          | |
|                   |                | `log_insomnia`       | `log_sleep`          | quality_1_10=1, duration_hrs=0 |
| `log_cycle_event` | `cycle`        | `log_period_start`   | `log_period_start`   | |
|                   |                | `log_cramps`         | `log_symptom`        | symptom=cramps |
|                   |                | `log_pms`            | `log_symptom`        | symptom=pms |
| `add_work_task`   | `work`         | `add_task`           | `create_task`        | |
|                   |                | `log_focus_session`  | `log_focus_session`  | |
|                   |                | `log_meeting`        | `log_meeting`        | |
|                   |                | `add_deadline`       | `log_deadline`       | |
| `add_goal`        | `goals`        | `add_goal`           | `create_goal`        | |
| `add_admin_task`  | `admin`        | `add_renewal`        | `recurring_decision` | renewal is recurring |
|                   |                | `add_appointment`    | `schedule_appointment` | |
|                   |                | `add_repair`         | `create_task`        | |
|                   |                | `add_paperwork`      | `log_paperwork`      | |
| `query_astrology` | — DROP         | —                    | —                    | no v2 astrology module |
| `log_body`        | `body`         | `log_water`          | `log_water`          | |
|                   |                | `log_supplement`     | `log_supplement`     | |
|                   |                | `log_walk`           | `complete` (habits)  | movement = habit |
| `log_medication`  | `medication`   | `log_taken`          | `log_dose`           | |
|                   |                | `mark_overdue`       | `missed_dose`        | |
| `log_to_dump`     | `dump_only`    | `log`                | `archive_only`       | mood_tag dropped (no field) |

**Confidence policy (Decision 2, server-side):**
- ≥ 0.80 → silent route, `needsConfirm: false`, source `cache` or `ai`
- 0.60 – 0.80 → silent route, `needsConfirm: true`
- < 0.60 → demoted to `dump_only`, `originalGuess` stashed

Tests assert `min_confidence` as a soft floor (the actual confidence depends
on Gemini's judgment). The `needsConfirm` flag is derived, not directly asserted.

---

## § Dropped tests (10)

| id                              | reason |
|---------------------------------|--------|
| `T08_negation`                  | v1 `add_to_grocery.remove` — no v2 grocery remove action |
| `T17_finance_query`             | v1 `log_finance_event.query` — brain-dump is not a query channel |
| `T38_astrology_horoscope`       | v1 `query_astrology` — no astrology module in v2 |
| `T39_astrology_mercury`         | same |
| `T55_finance_query_spend`       | same as T17 |
| `H10_negation_template`         | same as T08 |
| `H28_question_finance_slow`     | same as T17 |
| `TG02_malformed_retry`          | v2 uses `response_schema`; malformed output handled by upstream 502, no retry semantics |
| `TG07_required_field_missing_retry` | same — response_schema enforces required fields |
| `TG08_enum_violation_retry`     | same — response_schema enforces enum |

---

## § Migrated base tests (53 of 60)

```json
{
  "base_tests": [
    { "id": "T01_pasta_bug", "note": "THE headline bug. Was misrouting to work.", "input": "I need to buy pasta",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "pasta" }, "min_confidence": 0.75 }
      ] },
    { "id": "T02_past_tense_grocery", "input": "bought milk",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "milk" }, "min_confidence": 0.75 }
      ] },
    { "id": "T03_out_of", "input": "out of toilet paper",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "toilet paper" }, "min_confidence": 0.75 }
      ] },
    { "id": "T04_gen_z_abbrev", "input": "tp",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "toilet paper" }, "min_confidence": 0.6 }
      ] },
    { "id": "T05_quantity", "input": "got 2 dozen eggs",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "eggs", "quantity": 24, "unit": "piece" }, "min_confidence": 0.7 }
      ] },
    { "id": "T06_turkish_grocery", "input": "süt almam lazım",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "milk" }, "expected_language": "tr", "min_confidence": 0.7 }
      ] },
    { "id": "T07_spanish_grocery", "input": "necesito comprar leche",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "milk" }, "expected_language": "es", "min_confidence": 0.7 }
      ] },
    { "id": "T09_multi_grocery", "input": "bought milk, eggs, and bread",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "milk" } },
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "eggs" } },
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "bread" } }
      ] },
    { "id": "T10_pet_feeding", "input": "fed tontin",
      "expected_fragments": [
        { "module": "pets", "payload": { "module": "pets", "action": "log_feed", "petName": "tontin" }, "min_confidence": 0.7 }
      ] },
    { "id": "T11_pet_both", "input": "gave the pigs vitamin C",
      "expected_fragments": [
        { "module": "pets", "payload": { "module": "pets", "action": "log_care", "petName": "pigs", "what": "vitamin C" }, "min_confidence": 0.7 }
      ] },
    { "id": "T12_pet_supplies_to_grocery", "note": "Pet supplies route to GROCERY, not pets.", "input": "need more hay",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "hay" }, "min_confidence": 0.65 }
      ] },
    { "id": "T13_finance_bill", "input": "rent is due",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "add_bill", "merchant": "rent" }, "min_confidence": 0.7 }
      ] },
    { "id": "T14_finance_paid", "input": "paid rent",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "log_transaction", "merchant": "rent" }, "min_confidence": 0.7 }
      ] },
    { "id": "T15_finance_receipt", "input": "spent $40 on impulse stuff at sephora",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "log_transaction", "amount": 40, "currency": "USD", "merchant": "sephora" }, "min_confidence": 0.75 }
      ] },
    { "id": "T16_finance_subscription", "input": "netflix is $15/mo",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "subscription_log", "name": "netflix", "amount": 15, "currency": "USD", "cadence": "monthly" }, "min_confidence": 0.75 }
      ] },
    { "id": "T18_finance_stock_disambig", "note": "'buy stock' = finance, NOT grocery.", "input": "buy stock in nvda",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "savings_note", "note": "NVDA stock" }, "min_confidence": 0.7 }
      ] },
    { "id": "T19_habit_done", "input": "did yoga",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "yoga" }, "min_confidence": 0.75 }
      ] },
    { "id": "T20_habit_meditate_duration", "input": "meditated for 10 minutes",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "meditate" }, "min_confidence": 0.75 }
      ] },
    { "id": "T21_habit_dishes", "input": "dishes done",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "dishes" }, "min_confidence": 0.7 }
      ] },
    { "id": "T22_sleep_duration", "input": "slept 7 hours",
      "expected_fragments": [
        { "module": "sleep", "payload": { "module": "sleep", "action": "log_sleep" }, "min_confidence": 0.75 }
      ] },
    { "id": "T23_sleep_quality_qualitative", "input": "slept like trash",
      "expected_fragments": [
        { "module": "sleep", "payload": { "module": "sleep", "action": "log_sleep", "quality": 2 }, "min_confidence": 0.7 }
      ] },
    { "id": "T24_insomnia", "input": "didn't sleep at all",
      "expected_fragments": [
        { "module": "sleep", "payload": { "module": "sleep", "action": "log_sleep", "quality": 1 }, "min_confidence": 0.7 }
      ] },
    { "id": "T25_cycle_start", "input": "got my period",
      "expected_fragments": [
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_period_start" }, "min_confidence": 0.8 }
      ] },
    { "id": "T26_cycle_cramps", "input": "killer cramps",
      "expected_fragments": [
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_symptom", "symptom": "cramps" }, "min_confidence": 0.75 }
      ] },
    { "id": "T27_cycle_emotion_multi", "note": "Multi-intent. Cycle for the period, dump_only for the emotion (no mood payload in v2).", "input": "feel horrible and started my period",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } },
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_period_start" } }
      ] },
    { "id": "T28_period_drama_disambig", "note": "'period' as adjective, NOT cycle.", "input": "period drama tonight",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "T29_work_task", "input": "send invoice to client",
      "expected_fragments": [
        { "module": "work", "payload": { "module": "work", "action": "create_task", "text": "send invoice to client" }, "min_confidence": 0.7 }
      ] },
    { "id": "T30_work_focus", "input": "pomodoro done",
      "expected_fragments": [
        { "module": "work", "payload": { "module": "work", "action": "log_focus_session", "durationMin": 25 }, "min_confidence": 0.7 }
      ] },
    { "id": "T31_work_meeting", "input": "meeting with sarah at 3",
      "expected_fragments": [
        { "module": "work", "payload": { "module": "work", "action": "log_meeting", "with": "sarah" }, "min_confidence": 0.7 }
      ] },
    { "id": "T32_project_pasta_real_work", "note": "Actual work case with 'pasta' as project name.", "input": "project pasta deadline friday",
      "expected_fragments": [
        { "module": "work", "payload": { "module": "work", "action": "log_deadline", "text": "project pasta deadline friday", "dueDate": "friday" }, "min_confidence": 0.7 }
      ] },
    { "id": "T33_goal_with_date", "input": "save 50k by year end",
      "expected_fragments": [
        { "module": "goals", "payload": { "module": "goals", "action": "create_goal", "what": "save 50k" }, "min_confidence": 0.7 }
      ] },
    { "id": "T34_goal_move", "input": "want to move to netherlands by july",
      "expected_fragments": [
        { "module": "goals", "payload": { "module": "goals", "action": "create_goal", "what": "move to netherlands" }, "min_confidence": 0.7 }
      ] },
    { "id": "T35_admin_passport", "input": "passport renewal",
      "expected_fragments": [
        { "module": "admin", "payload": { "module": "admin", "action": "recurring_decision", "what": "passport renewal" }, "min_confidence": 0.6 }
      ] },
    { "id": "T36_admin_dentist", "input": "dentist on tuesday",
      "expected_fragments": [
        { "module": "admin", "payload": { "module": "admin", "action": "schedule_appointment", "what": "dentist", "date": "tuesday" }, "min_confidence": 0.7 }
      ] },
    { "id": "T37_admin_plumber", "input": "plumber needs to come",
      "expected_fragments": [
        { "module": "admin", "payload": { "module": "admin", "action": "create_task", "text": "plumber needs to come" }, "min_confidence": 0.6 }
      ] },
    { "id": "T40_body_water", "input": "3 glasses of water",
      "expected_fragments": [
        { "module": "body", "payload": { "module": "body", "action": "log_water", "amountMl": 720 }, "min_confidence": 0.7 }
      ] },
    { "id": "T41_body_supplement", "input": "took my vitamins",
      "expected_fragments": [
        { "module": "body", "payload": { "module": "body", "action": "log_supplement", "name": "vitamins" }, "min_confidence": 0.7 }
      ] },
    { "id": "T42_body_walk", "note": "v2 moves walk into habits (movement = habit).", "input": "went on a 20 min walk",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "walk" }, "min_confidence": 0.65 }
      ] },
    { "id": "T43_melatonin_to_body", "note": "Melatonin = supplement, NOT medication by default.", "input": "took melatonin",
      "expected_fragments": [
        { "module": "body", "payload": { "module": "body", "action": "log_supplement", "name": "melatonin" }, "min_confidence": 0.65 }
      ] },
    { "id": "T44_medication_adderall", "input": "20mg adderall at 9am",
      "expected_fragments": [
        { "module": "medication", "payload": { "module": "medication", "action": "log_dose", "medName": "adderall", "dose": "20mg" }, "min_confidence": 0.75 }
      ] },
    { "id": "T45_medication_overdue", "input": "forgot my meds",
      "expected_fragments": [
        { "module": "medication", "payload": { "module": "medication", "action": "missed_dose", "medName": "meds" }, "min_confidence": 0.7 }
      ] },
    { "id": "T46_dump_feeling", "input": "my brain feels like soup",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "T47_dump_ugh", "input": "ugh",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "T48_multi_3way", "note": "Three intents in one input.", "input": "bought milk, did yoga, period started",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "pantry_add", "item": "milk" } },
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "yoga" } },
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_period_start" } }
      ] },
    { "id": "T49_multi_chocolate_pms", "note": "PMS + chocolate craving = cycle + grocery.", "input": "pms-ing hard, need chocolate",
      "expected_fragments": [
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_symptom", "symptom": "pms" } },
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "chocolate" } }
      ] },
    { "id": "T50_pet_a_dog_disambig", "note": "'pet a dog' = verb, NOT pets module.", "input": "pet a dog today",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "T51_typo_resilience", "input": "toilet papre",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "toilet paper" }, "min_confidence": 0.55 }
      ] },
    { "id": "T52_observation_skip", "note": "Observation only — should NOT add to grocery.", "input": "we have plenty of rice",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "T53_skipped_workout", "input": "skipped workout today",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "streak_break_note", "habitName": "workout" }, "min_confidence": 0.6 }
      ] },
    { "id": "T54_back_hurts_not_body", "note": "v2 keeps symptoms in body (log_symptom) — v1 sent to dump.", "input": "my back hurts",
      "expected_fragments": [
        { "module": "body", "payload": { "module": "body", "action": "log_symptom", "symptom": "back pain", "bodyPart": "back" }, "min_confidence": 0.6 }
      ] },
    { "id": "T56_admin_visa_deadline", "input": "visa application deadline 6/1",
      "expected_fragments": [
        { "module": "admin", "payload": { "module": "admin", "action": "log_paperwork", "what": "visa application", "due_date": "2026-06-01" }, "min_confidence": 0.7 }
      ] },
    { "id": "T57_turkish_meds", "input": "ilacımı aldım",
      "expected_fragments": [
        { "module": "medication", "payload": { "module": "medication", "action": "log_dose" }, "expected_language": "tr", "min_confidence": 0.7 }
      ] },
    { "id": "T58_turkish_workout", "input": "spor yaptım",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "workout" }, "expected_language": "tr", "min_confidence": 0.7 }
      ] },
    { "id": "T59_spanish_period", "input": "me bajó",
      "expected_fragments": [
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_period_start" }, "expected_language": "es", "min_confidence": 0.65 }
      ] },
    { "id": "T60_subscription_cancel_multi", "note": "Canceling a gym subscription = finance subscription_log w/ cancel.", "input": "canceled gym membership",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "subscription_log", "name": "gym", "operation": "cancel" }, "min_confidence": 0.7 }
      ] }
  ]
}
```

---

## § Migrated hybrid tests (24 of 30)

Hybrid `expected_path: fast | slow` collapses in v2 (no template fast path —
everything goes through Voyage embed + Gemini, with Vectorize cache as the
"fast" lane on repeat). We assert `source: "ai" | "cache"` where the
distinction matters.

```json
{
  "hybrid_tests": [
    { "id": "H01_grocery_simple", "input": "buy eggs",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "eggs" }, "source": "ai" }
      ] },
    { "id": "H02_turkish_grocery", "input": "süt almam lazım",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "milk" }, "expected_language": "tr", "source": "ai" }
      ] },
    { "id": "H03_multi_intent_pair", "input": "bought milk and did yoga",
      "expected_fragments_count": 2 },
    { "id": "H04_finance_rent", "input": "rent is due",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "add_bill", "merchant": "rent" } }
      ] },
    { "id": "H05_pasta_short", "input": "i need pasta",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "pasta" } }
      ] },
    { "id": "H06_softened_intent", "input": "I'm thinking about maybe getting some pasta",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "pasta" }, "min_confidence": 0.6 }
      ] },
    { "id": "H07_love_pasta_dump", "note": "Should NOT match grocery — 'I love' is not 'buy'.", "input": "I love pasta",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "H08_pasta_bug_full", "input": "I need to buy pasta",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "pasta" }, "min_confidence": 0.75 }
      ] },
    { "id": "H09_disambig_walk", "input": "walk", "note": "could be habits or body — verify SOMETHING reasonable comes back, low confidence acceptable.",
      "expected_fragments_count": 1 },
    { "id": "H11_pet_fed", "input": "fed tontin",
      "expected_fragments": [
        { "module": "pets", "payload": { "module": "pets", "action": "log_feed", "petName": "tontin" } }
      ] },
    { "id": "H12_habit_yoga_known", "input": "did yoga",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete", "habitName": "yoga" } }
      ] },
    { "id": "H13_unfamiliar_habit", "input": "did some weird dance thing",
      "expected_fragments": [
        { "module": "habits", "payload": { "module": "habits", "action": "complete" }, "min_confidence": 0.55 }
      ] },
    { "id": "H14_body_water_3_glasses", "input": "3 glasses of water",
      "expected_fragments": [
        { "module": "body", "payload": { "module": "body", "action": "log_water", "amountMl": 720 } }
      ] },
    { "id": "H15_dump_ugh_fast", "input": "ugh",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "H16_finance_paid_rent", "input": "paid rent",
      "expected_fragments": [
        { "module": "finance", "payload": { "module": "finance", "action": "log_transaction", "merchant": "rent" } }
      ] },
    { "id": "H17_medication_meds", "input": "took my meds",
      "expected_fragments": [
        { "module": "medication", "payload": { "module": "medication", "action": "log_dose" } }
      ] },
    { "id": "H18_work_meeting", "input": "meeting at 3",
      "expected_fragments": [
        { "module": "work", "payload": { "module": "work", "action": "log_meeting" } }
      ] },
    { "id": "H19_cycle_start", "input": "period started",
      "expected_fragments": [
        { "module": "cycle", "payload": { "module": "cycle", "action": "log_period_start" } }
      ] },
    { "id": "H20_admin_dentist", "input": "dentist tuesday",
      "expected_fragments": [
        { "module": "admin", "payload": { "module": "admin", "action": "schedule_appointment", "what": "dentist", "date": "tuesday" } }
      ] },
    { "id": "H21_spanish_grocery", "input": "necesito comprar leche",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add", "item": "milk" }, "expected_language": "es" }
      ] },
    { "id": "H22_voyage_outage", "note": "Simulate Voyage failure — endpoint must return upstream 502.", "voyage_force_fail": true, "input": "buy eggs",
      "expected_response": { "status": 502 } },
    { "id": "H23_gemini_outage", "note": "Simulate Gemini failure — endpoint must return upstream 502.", "gemini_force_fail": true, "input": "buy eggs",
      "expected_response": { "status": 502 } },
    { "id": "H24_multi_intent_comma", "input": "milk, eggs, bread",
      "expected_fragments_count": 3 },
    { "id": "H25_low_confidence_demotion", "input": "the thing", "note": "vague — embedding shouldn't be confident; expect dump_only demotion or low confidence.",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "H26_cached_input_twice", "note": "Send same input twice — second must hit Vectorize cache.", "input": "buy eggs",
      "run_twice": true,
      "second_run_expected_source": "cache" },
    { "id": "H27_heavy_typos", "input": "i ned to by pst",
      "expected_fragments": [
        { "module": "grocery", "payload": { "module": "grocery", "action": "shopping_list_add" }, "min_confidence": 0.4 }
      ] },
    { "id": "H29_emotional_dump", "input": "i hate everything today",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "H30_pets_disambig_verb", "input": "pet a dog today",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] }
  ]
}
```

---

## § Migrated Gemini-specific tests (7 of 10)

```json
{
  "gemini_tests": [
    { "id": "TG01_response_schema_enforced", "input": "I need to buy pasta",
      "expected_response_shape": "RouterOutput v1.0",
      "must_have": ["schemaVersion", "originalDump", "dumpId", "timestamp", "language", "fragments", "summary"] },
    { "id": "TG03_multi_intent_fragments", "input": "bought milk and did yoga",
      "expected_fragments_count": 2,
      "expected_modules": ["grocery", "habits"] },
    { "id": "TG04_each_module_round_trip", "note": "Verify all 12 modules can be returned by Gemini and pass round-trip.",
      "expected_modules_to_observe_across_test_run": [
        "work", "admin", "pets", "cycle", "finance", "sleep", "body", "habits", "goals", "grocery", "medication", "dump_only"
      ] },
    { "id": "TG05_isolation_no_bleed", "note": "Send 5 different dumps consecutively — each must classify independently.",
      "inputs": ["bought milk", "did yoga", "rent is due", "feeling tired", "süt aldım"] },
    { "id": "TG06_empty_input_demoted", "input": "...",
      "expected_fragments": [
        { "module": "dump_only", "payload": { "module": "dump_only", "action": "archive_only" } }
      ] },
    { "id": "TG09_latency_p99", "note": "Send 100 brain dumps, measure latency.",
      "expected": "p99 < 2500ms (Vectorize lookup + Gemini Flash + Voyage)" },
    { "id": "TG10_rate_limit_handled", "note": "If Gemini returns 429, endpoint surfaces upstream error gracefully.",
      "expected_response": { "status": 502, "body_contains": "gemini_classify_failed" } }
  ]
}
```

---

## § Test harness conventions

- For each test, the harness POSTs `{ text: <input>, dumpId: <uuid>, locale: 'tr' }` to `/route/dump`.
- Compare `body.fragments` to `expected_fragments` (or `expected_fragments_count`).
- Match per-fragment on `module` (strict) + `payload.action` (strict) + key payload slots (soft — extra fields allowed, missing slots fail).
- `min_confidence` is a floor — actual must be ≥. Floor is conservative because Gemini judgment is noisy.
- `expected_language` is asserted on `fragment.language`.
- `source: "ai" | "cache"` asserted where the test specifies.
- For the crisis tests (added in step 4), assert `body.crisis.detected === true` plus the expected tier.

**Combined pass criteria (v2):** ≥ 95 % T-prefix base + ≥ 90 % H-prefix hybrid + 100 % TG-prefix Gemini = 90 of ~94 (after drops) green.
