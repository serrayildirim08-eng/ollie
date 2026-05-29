/**
 * Regression fixtures for the Layer 1 brain-dump classifier.
 *
 * Coverage target: every (module, action) pair defined in
 *   src/router/dump-classify.ts > SYSTEM_PROMPT
 * with ~10 examples each, split ~4 EN / 3 ES / 3 TR, written in realistic
 * ADHD phrasing (incomplete thoughts, mid-sentence switches, typos, slang).
 *
 * Last 30 entries are edge cases (negation, time refs, mixed-language,
 * ambiguous-low-confidence, crisis tier 2 + 3).
 *
 * Total: 580 fixtures (see EXPECTED_FIXTURE_COUNT at end of file).
 *
 * Used by:
 *   - dump-coverage.test.ts (deterministic mock-Groq regression suite)
 *
 * Author hint:
 *   `payloadKeys` lists keys the classifier MUST emit on payload. The mock
 *   in dump-coverage.test.ts looks up the fixture by exact text match and
 *   returns the expected classification verbatim, so this file ALSO acts
 *   as the source of truth for the canonical answer. Add a new (module,
 *   action) pair here first, then thread it through dump-classify.ts.
 */

import type { Module } from '../src/router/dump-schema';

export interface DumpFixture {
  text: string;
  expected: {
    module: Module;
    action: string;
    /** Keys the payload object MUST contain (action-required slots). */
    payloadKeys: string[];
    /** Canonical payload values for the mocked-Groq response. */
    payload: Record<string, unknown>;
    /** Confidence ≥0.80 unless explicitly testing tier 2/3. */
    confidence?: number;
    /**
     * Cross-module side-effect. When set, the AI is expected to populate a
     * hint field on the PRIMARY payload (e.g. `pet`, `med_taken`,
     * `skipped_meals`) — NOT to emit a separate fragment. Approach B: the
     * primary handler mirrors to the secondary module. See grocery's
     * price→finance wire and the CROSS_ROUTE section below.
     */
    crossRoute?: { module: Module; action: string };
  };
}

// ─── BODY ───────────────────────────────────────────────────────────────────

const BODY: DumpFixture[] = [
  // log_symptom × 10
  { text: 'headache 7/10', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'headache', severity: 4 } } },
  { text: 'my back is killing me', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'back pain', bodyPart: 'back' } } },
  { text: 'stomach cramps again ugh', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'stomach cramps' } } },
  { text: 'nauseous all morning', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'nausea' } } },
  { text: 'me duele la cabeza', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'headache' } } },
  { text: 'tengo mareos otra vez', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'dizziness' } } },
  { text: 'dolor de espalda nivel 5', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'back pain', severity: 5 } } },
  { text: 'başım çok ağrıyor', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'headache' } } },
  { text: 'midem bulanıyor', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'nausea' } } },
  { text: 'boyun ağrısı 3/5', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'neck pain', severity: 3 } } },

  // log_water × 10
  { text: 'drank 500ml water', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 500 } } },
  { text: 'had a big glass of water', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 250 } } },
  { text: 'finally had some water', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: {} } },
  { text: 'chugged a liter', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 1000 } } },
  { text: 'bebí 750 ml de agua', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 750 } } },
  { text: 'tomé un vaso de agua', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 250 } } },
  { text: 'agua, por fin', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: {} } },
  { text: '2 bardak su içtim', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 500 } } },
  { text: '1 litre su içtim', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 1000 } } },
  { text: 'su içtim sonunda', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: {} } },

  // log_supplement × 10
  { text: 'took vitamin D 1000iu', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'vitamin D', dose: '1000iu' } } },
  { text: 'magnesium before bed', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'magnesium' } } },
  { text: 'had my omega 3', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'omega 3' } } },
  { text: 'b12 sublingual 1mg', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'b12', dose: '1mg' } } },
  { text: 'tomé vitamina C', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'vitamin C' } } },
  { text: 'magnesio 400 mg', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'magnesium', dose: '400 mg' } } },
  { text: 'tomé hierro hoy', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'iron' } } },
  { text: 'd vitamini aldım', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'vitamin D' } } },
  { text: 'magnezyum 300mg', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'magnesium', dose: '300mg' } } },
  { text: 'çinko içtim', expected: { module: 'body', action: 'log_supplement', payloadKeys: ['name'], payload: { name: 'zinc' } } },

  // log_episode × 10
  { text: 'panic attack lasted 10 min', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'panic attack', duration: '10 min' } } },
  { text: 'migraine episode this afternoon', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'migraine' } } },
  { text: 'dissociated for like an hour', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'dissociation', duration: '1 hour' } } },
  { text: 'shutdown after the meeting', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'shutdown' } } },
  { text: 'ataque de pánico 15 min', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'panic attack', duration: '15 min' } } },
  { text: 'migraña toda la tarde', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'migraine' } } },
  { text: 'crisis de ansiedad', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'anxiety attack' } } },
  { text: 'panik atak geçirdim 20dk', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'panic attack', duration: '20dk' } } },
  { text: 'migren tuttu', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'migraine' } } },
  { text: 'shutdown oldum', expected: { module: 'body', action: 'log_episode', payloadKeys: ['kind'], payload: { kind: 'shutdown' } } },

  // log_posture × 10
  { text: 'fixed my posture', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'sitting up straight finally', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'shoulders back', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'posture check passed', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'corregí mi postura', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'sentándome derecha', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'hombros hacia atrás', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'duruşumu düzelttim', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'dik oturdum', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },
  { text: 'omuzlar geride', expected: { module: 'body', action: 'log_posture', payloadKeys: [], payload: {} } },

  // log_hunger × 10
  { text: "i'm starving", expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'hungry again wtf', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'not hungry at all today', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'forgot to eat lunch', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'tengo mucha hambre', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'no tengo hambre', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'me olvidé de comer', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'çok açım', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'hiç açlık hissetmiyorum', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },
  { text: 'yemek yemeyi unuttum', expected: { module: 'body', action: 'log_hunger', payloadKeys: [], payload: {} } },

  // log_movement × 10
  { text: 'did yoga', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'yoga' } } },
  { text: '20 min walk', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'walk', duration_min: 20 } } },
  { text: 'lifted weights for an hour', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'lift', duration_min: 60 } } },
  { text: 'long stretch session this morning', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'stretch' } } },
  { text: 'hice estiramientos', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'stretch' } } },
  { text: 'corrí 5km', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'run' } } },
  { text: 'caminé 30 minutos', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'walk', duration_min: 30 } } },
  { text: 'yoga yaptım 30dk', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'yoga', duration_min: 30 } } },
  { text: 'koşuya çıktım', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'run' } } },
  { text: 'esnedim 10dk', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'stretch', duration_min: 10 } } },
];

// ─── WORK ───────────────────────────────────────────────────────────────────

const WORK: DumpFixture[] = [
  // log_focus_session × 10
  { text: '90 min deep work on atelier', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 90, project: 'atelier' } } },
  { text: '45 minutes focused on the prd', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 45, project: 'prd' } } },
  { text: 'two pomodoros on the bug', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 50 } } },
  { text: 'finished a deep work block', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: {} } },
  { text: '60 min de trabajo profundo', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 60 } } },
  { text: 'sesión de foco en el ensayo', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { project: 'ensayo' } } },
  { text: 'trabajé 2 horas en ollie', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 120, project: 'ollie' } } },
  { text: '90dk derin çalışma atelier', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 90, project: 'atelier' } } },
  { text: 'odaklandım 1 saat', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 60 } } },
  { text: 'pomodoro yaptım', expected: { module: 'work', action: 'log_focus_session', payloadKeys: [], payload: { durationMin: 25 } } },

  // create_task × 10
  { text: 'need to write the PRD', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'write the PRD' } } },
  { text: 'todo: refactor the router', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'refactor the router' } } },
  { text: 'gotta review the PRs tomorrow', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'review the PRs' } } },
  { text: 'remember to push the migration', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'push the migration' } } },
  { text: 'tengo que escribir la doc', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'escribir la doc' } } },
  { text: 'pendiente: revisar el código', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'revisar el código' } } },
  { text: 'hay que mandar el reporte', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'mandar el reporte' } } },
  { text: 'prd yazmam lazım', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'prd yazmak' } } },
  { text: 'kodu review etmem lazım', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'kodu review etmek' } } },
  { text: 'migration push edilecek', expected: { module: 'work', action: 'create_task', payloadKeys: ['text'], payload: { text: 'migration push' } } },

  // log_deadline × 10
  { text: 'PRD due friday', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'PRD', dueDate: 'friday' } } },
  { text: 'tax form deadline next monday', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'tax form', dueDate: 'next monday' } } },
  { text: 'report has to land tomorrow', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'report', dueDate: 'tomorrow' } } },
  { text: 'beta cutoff is the 30th', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'beta cutoff', dueDate: '2026-05-30' } } },
  { text: 'la propuesta vence el viernes', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'propuesta', dueDate: 'friday' } } },
  { text: 'fecha límite del informe: lunes', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'informe', dueDate: 'monday' } } },
  { text: 'el contrato tiene que estar el 15', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'contrato', dueDate: '15' } } },
  { text: 'prd cuma deadline', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'prd', dueDate: 'friday' } } },
  { text: 'rapor pazartesi teslim', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'rapor', dueDate: 'monday' } } },
  { text: 'son tarih 30 mayıs', expected: { module: 'work', action: 'log_deadline', payloadKeys: ['text'], payload: { text: 'project', dueDate: '2026-05-30' } } },

  // log_meeting × 10
  { text: '30 min sync with boran', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'boran', durationMin: 30 } } },
  { text: 'just got out of standup', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: {} } },
  { text: '1:1 with sarah today', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'sarah' } } },
  { text: 'long meeting with the design team', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'design team' } } },
  { text: 'reunión con boran 30 min', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'boran', durationMin: 30 } } },
  { text: 'salí de la junta', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: {} } },
  { text: '1:1 con la PM', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'PM' } } },
  { text: 'boran ile toplantı 30dk', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'boran', durationMin: 30 } } },
  { text: 'standuptan çıktım', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: {} } },
  { text: 'tasarım ekibiyle toplantı', expected: { module: 'work', action: 'log_meeting', payloadKeys: [], payload: { with: 'design team' } } },

  // distraction_journal × 10
  { text: 'got sucked into twitter again', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'twitter' } } },
  { text: 'rabbit hole on hackernews fml', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'hackernews' } } },
  { text: 'kept checking slack', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'slack' } } },
  { text: 'youtube ate 40 min', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'youtube' } } },
  { text: 'me distraje con twitter', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'twitter' } } },
  { text: 'instagram me consumió', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'instagram' } } },
  { text: 'pasé 30 min en reddit', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'reddit' } } },
  { text: 'twitterda kayboldum', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'twitter' } } },
  { text: 'slack açık kaldı dikkatim dağıldı', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'slack' } } },
  { text: 'youtubea daldım', expected: { module: 'work', action: 'distraction_journal', payloadKeys: ['what'], payload: { what: 'youtube' } } },
];

// ─── ADMIN ──────────────────────────────────────────────────────────────────

const ADMIN: DumpFixture[] = [
  // create_task × 10
  { text: 'need to renew library card', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'renew library card' } } },
  { text: 'gotta drop a package at the post office', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'drop package at post office' } } },
  { text: 'todo update car registration', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'update car registration' } } },
  { text: 'need to email the landlord', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'email the landlord' } } },
  { text: 'tengo que renovar el carnet', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'renovar el carnet' } } },
  { text: 'pendiente mandar el correo', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'mandar el correo' } } },
  { text: 'hay que ir al correo', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'ir al correo' } } },
  { text: 'kütüphane kartı yenilemem lazım', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'kütüphane kartı yenilemek' } } },
  { text: 'kargo göndermem lazım', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'kargo göndermek' } } },
  { text: 'ev sahibine mail atmam lazım', expected: { module: 'admin', action: 'create_task', payloadKeys: ['text'], payload: { text: 'ev sahibine mail atmak' } } },

  // create_phone_task × 10
  { text: 'call mom about christmas', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'mom', reason: 'christmas' } } },
  { text: 'need to ring the dentist', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'dentist' } } },
  { text: 'phone the insurance company', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'insurance company' } } },
  { text: 'call dad back', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'dad' } } },
  { text: 'llamar a mamá', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'mom' } } },
  { text: 'tengo que llamar al dentista', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'dentist' } } },
  { text: 'llamar al banco mañana', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'bank' } } },
  { text: 'anneyi ara', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'mom' } } },
  { text: 'dişçiyi aramam lazım', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'dentist' } } },
  { text: 'babayı ara akşam', expected: { module: 'admin', action: 'create_phone_task', payloadKeys: ['person'], payload: { person: 'dad' } } },

  // schedule_appointment × 10
  { text: 'dentist next tuesday', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'dentist', date: 'next tuesday' } } },
  { text: 'doctor appointment thursday 3pm', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'doctor', date: 'thursday 3pm' } } },
  { text: 'haircut booked for saturday', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'haircut', date: 'saturday' } } },
  { text: 'therapy session monday morning', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'therapy', date: 'monday morning' } } },
  { text: 'cita con el dentista el martes', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'dentista', date: 'tuesday' } } },
  { text: 'turno médico jueves 3pm', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'médico', date: 'thursday 3pm' } } },
  { text: 'cita en la peluquería el sábado', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'peluquería', date: 'saturday' } } },
  { text: 'dişçi randevusu salı', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'dişçi', date: 'tuesday' } } },
  { text: 'doktor perşembe 3', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'doktor', date: 'thursday 3pm' } } },
  { text: 'kuaför cumartesi', expected: { module: 'admin', action: 'schedule_appointment', payloadKeys: ['what'], payload: { what: 'kuaför', date: 'saturday' } } },

  // log_paperwork × 10
  { text: 'filed taxes', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'taxes' } } },
  { text: 'submitted the rental application', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'rental application' } } },
  { text: 'signed the lease finally', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'lease' } } },
  { text: 'sent the visa docs', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'visa docs' } } },
  { text: 'mandé los impuestos', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'impuestos' } } },
  { text: 'firmé el contrato', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'contrato' } } },
  { text: 'envié la solicitud de alquiler', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'solicitud de alquiler' } } },
  { text: 'vergi beyannamesini gönderdim', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'vergi' } } },
  { text: 'kira sözleşmesini imzaladım', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'kira sözleşmesi' } } },
  { text: 'vize evraklarını yolladım', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'vize evrakları' } } },

  // recurring_decision × 10
  { text: 'keep netflix or cancel', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'netflix subscription' } } },
  { text: 'should i renew my gym membership', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'gym membership' } } },
  { text: 'thinking about dropping spotify', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'spotify subscription' } } },
  { text: 'amazon prime worth it?', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'amazon prime' } } },
  { text: '¿renovar netflix?', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'netflix subscription' } } },
  { text: 'pensando en cancelar el gym', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'gym membership' } } },
  { text: '¿vale la pena spotify?', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'spotify subscription' } } },
  { text: 'netflix iptal mi yenileme mi', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'netflix subscription' } } },
  { text: 'spor salonu üyeliği', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'gym membership' } } },
  { text: 'spotify değer mi', expected: { module: 'admin', action: 'recurring_decision', payloadKeys: ['what'], payload: { what: 'spotify subscription' } } },

  // log_renewal × 10
  { text: 'passport expires march', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'passport', due_date: 'march' } } },
  { text: 'license renewal due in 2 weeks', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'license', due_date: '2 weeks' } } },
  { text: 'car insurance up for renewal', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'insurance' } } },
  { text: 'lease ends in september', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'lease', due_date: 'september' } } },
  { text: 'el pasaporte vence en marzo', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'passport', due_date: 'march' } } },
  { text: 'renovación de licencia en 2 semanas', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'license', due_date: '2 weeks' } } },
  { text: 'seguro del coche se renueva', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'insurance' } } },
  { text: 'pasaport martta bitiyor', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'passport', due_date: 'march' } } },
  { text: 'ehliyet yenilenecek 2 hafta', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'license', due_date: '2 weeks' } } },
  { text: 'kira eylülde bitiyor', expected: { module: 'admin', action: 'log_renewal', payloadKeys: ['renewal_type'], payload: { renewal_type: 'lease', due_date: 'september' } } },
];

// ─── PETS ───────────────────────────────────────────────────────────────────

const PETS: DumpFixture[] = [
  // log_care × 10
  { text: 'brushed tontin', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'brushed', petName: 'tontin' } } },
  { text: 'cleaned olivia cage', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'cleaned cage', petName: 'olivia' } } },
  { text: 'gave buddy a bath', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'bath', petName: 'buddy' } } },
  { text: 'trimmed pinpon nails', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'trimmed nails', petName: 'pinpon' } } },
  { text: 'cepillé a tontin', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'brushed', petName: 'tontin' } } },
  { text: 'limpié la jaula de olivia', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'cleaned cage', petName: 'olivia' } } },
  { text: 'bañé a buddy', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'bath', petName: 'buddy' } } },
  { text: 'tontini fırçaladım', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'brushed', petName: 'tontin' } } },
  { text: 'pinpon\'u banyo yaptım', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'bath', petName: 'pinpon' } } },
  { text: 'olivia kafesini temizledim', expected: { module: 'pets', action: 'log_care', payloadKeys: ['what'], payload: { what: 'cleaned cage', petName: 'olivia' } } },

  // log_observation × 10
  { text: 'tontin seems lethargic', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'seems lethargic', petName: 'tontin' } } },
  { text: 'olivia is eating more than usual', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'eating more than usual', petName: 'olivia' } } },
  { text: 'buddy limping on left paw', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'limping on left paw', petName: 'buddy' } } },
  { text: 'pinpon hiding all day', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'hiding all day', petName: 'pinpon' } } },
  { text: 'tontin parece decaído', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'lethargic', petName: 'tontin' } } },
  { text: 'olivia come más de lo normal', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'eating more than usual', petName: 'olivia' } } },
  { text: 'buddy cojea de la pata izquierda', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'limping left paw', petName: 'buddy' } } },
  { text: 'tontin halsiz görünüyor', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'lethargic', petName: 'tontin' } } },
  { text: 'olivia normalden çok yiyor', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'eating more than usual', petName: 'olivia' } } },
  { text: 'pinpon gün boyu saklandı', expected: { module: 'pets', action: 'log_observation', payloadKeys: ['note'], payload: { note: 'hiding all day', petName: 'pinpon' } } },

  // log_vet × 10
  { text: 'vet for pinpon checkup', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'checkup', petName: 'pinpon' } } },
  { text: 'took tontin to the vet for vaccines', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'vaccines', petName: 'tontin' } } },
  { text: 'olivia vet visit tomorrow', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { petName: 'olivia' } } },
  { text: 'buddy at the vet for the limp', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'limp', petName: 'buddy' } } },
  { text: 'llevé a pinpon al veterinario', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { petName: 'pinpon' } } },
  { text: 'tontin al veterinario para vacunas', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'vaccines', petName: 'tontin' } } },
  { text: 'olivia tiene cita con el vet mañana', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { petName: 'olivia' } } },
  { text: 'pinponu vete götürdüm', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { petName: 'pinpon' } } },
  { text: 'tontin için aşı randevusu', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'vaccines', petName: 'tontin' } } },
  { text: 'buddy vet kontrolü', expected: { module: 'pets', action: 'log_vet', payloadKeys: [], payload: { reason: 'checkup', petName: 'buddy' } } },

  // log_feed × 10
  { text: 'fed tontin', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'tontin' } } },
  { text: 'i fed my guineapig tontin', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'tontin' } } },
  { text: 'fed the cat', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: {} } },
  { text: 'gave olivia breakfast', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'olivia' } } },
  { text: 'le di de comer a tontin', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'tontin' } } },
  { text: 'alimenté al perro', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: {} } },
  { text: 'desayuno para olivia', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'olivia' } } },
  { text: 'tontini besledim', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'tontin' } } },
  { text: 'kediye yemek verdim', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: {} } },
  { text: 'oliviaya kahvaltı', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'olivia' } } },

  // log_supplement × 10
  { text: 'gave tontin vitamin c', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'vitamin_c', petName: 'tontin' } } },
  { text: 'pinpon got calcium today', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'calcium', petName: 'pinpon' } } },
  { text: 'olivia b12 drops', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'b12', petName: 'olivia' } } },
  { text: 'buddy joint supplement', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'joint_supplement', petName: 'buddy' } } },
  { text: 'di vitamina C a tontin', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'vitamin_c', petName: 'tontin' } } },
  { text: 'calcio a pinpon', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'calcium', petName: 'pinpon' } } },
  { text: 'olivia tomó b12', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'b12', petName: 'olivia' } } },
  { text: 'pinpon C vitamini', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'vitamin_c', petName: 'pinpon' } } },
  { text: 'tontine kalsiyum verdim', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'calcium', petName: 'tontin' } } },
  { text: 'olivia b12 damlası', expected: { module: 'pets', action: 'log_supplement', payloadKeys: ['supplement'], payload: { supplement: 'b12', petName: 'olivia' } } },
];

// ─── CYCLE ──────────────────────────────────────────────────────────────────

const CYCLE: DumpFixture[] = [
  // log_period_start × 10
  { text: 'period started', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'got my period today', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'aunt flo arrived', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'spotting started this morning', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'me bajó la regla', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'empezó mi periodo', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'menstruación día 1', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'regl başladı', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'adetim oldu', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },
  { text: 'menstrüasyon 1. gün', expected: { module: 'cycle', action: 'log_period_start', payloadKeys: [], payload: {} } },

  // log_period_end × 10
  { text: 'period ended', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'finally done bleeding', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'cycle over for this month', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'last day of period', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'se acabó mi periodo', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'terminó la regla', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'último día de menstruación', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'regl bitti', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'adet bitti', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },
  { text: 'son gün menstrüasyon', expected: { module: 'cycle', action: 'log_period_end', payloadKeys: [], payload: {} } },

  // log_symptom × 10
  { text: 'cramps bad today', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'cramps' } } },
  { text: 'so bloated rn', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'bloating' } } },
  { text: 'pms is wrecking me', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'pms' } } },
  { text: 'breast tenderness all week', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'breast tenderness' } } },
  { text: 'tengo cólicos fuertes', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'cramps' } } },
  { text: 'hinchazón terrible hoy', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'bloating' } } },
  { text: 'sensibilidad en los pechos', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'breast tenderness' } } },
  { text: 'kramp girdim', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'cramps' } } },
  { text: 'şişkinlik var', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'bloating' } } },
  { text: 'göğüs hassasiyeti', expected: { module: 'cycle', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'breast tenderness' } } },

  // pill_logged × 10
  { text: 'took my pill', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'birth control done', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'pill taken', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'remembered the pill today', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'tomé la píldora', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'pastilla anticonceptiva tomada', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'me acordé de la píldora', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'hapımı aldım', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'doğum kontrol hapı içtim', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
  { text: 'hap alındı bugün', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },
];

// ─── FINANCE ────────────────────────────────────────────────────────────────

const FINANCE: DumpFixture[] = [
  // log_transaction × 10
  { text: 'spent $40 at sephora', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 40, currency: 'USD', merchant: 'sephora' } } },
  { text: 'paid rent', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { merchant: 'rent' } } },
  { text: 'dropped $120 at zara', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 120, currency: 'USD', merchant: 'zara' } } },
  { text: 'uber was $14', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 14, currency: 'USD', merchant: 'uber' } } },
  { text: 'gasté 40 en sephora', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 40, currency: 'USD', merchant: 'sephora' } } },
  { text: 'pagué el alquiler', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { merchant: 'rent' } } },
  { text: 'uber costó 14 USD', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 14, currency: 'USD', merchant: 'uber' } } },
  { text: 'sephoraya 40 dolar', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 40, currency: 'USD', merchant: 'sephora' } } },
  { text: 'kira ödendi', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { merchant: 'rent' } } },
  { text: 'uber 14 dolar', expected: { module: 'finance', action: 'log_transaction', payloadKeys: [], payload: { amount: 14, currency: 'USD', merchant: 'uber' } } },

  // add_bill × 10
  { text: 'rent is $1800/month', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'rent', amount: 1800, cadence: 'monthly' } } },
  { text: 'electric bill $90 monthly', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'electric', amount: 90, cadence: 'monthly' } } },
  { text: 'internet bill', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'internet' } } },
  { text: 'phone bill $60', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'phone', amount: 60 } } },
  { text: 'alquiler 1800 mensual', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'rent', amount: 1800, cadence: 'monthly' } } },
  { text: 'factura de luz 90 mensual', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'electric', amount: 90, cadence: 'monthly' } } },
  { text: 'factura de internet', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'internet' } } },
  { text: 'kira 1800 aylık', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'rent', amount: 1800, cadence: 'monthly' } } },
  { text: 'elektrik faturası 90 aylık', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'electric', amount: 90, cadence: 'monthly' } } },
  { text: 'internet faturası', expected: { module: 'finance', action: 'add_bill', payloadKeys: ['merchant'], payload: { merchant: 'internet' } } },

  // savings_note × 10
  { text: 'moved 500 to savings', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 500 } } },
  { text: 'saved 200 this paycheck', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 200 } } },
  { text: 'transferred 1k to emergency fund', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 1000, note: 'emergency fund' } } },
  { text: 'put money aside', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: {} } },
  { text: 'pasé 500 a ahorros', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 500 } } },
  { text: 'ahorré 200 este mes', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 200 } } },
  { text: 'transferí 1000 al fondo de emergencia', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 1000, note: 'emergency fund' } } },
  { text: '500 birikime attım', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 500 } } },
  { text: 'bu ay 200 biriktirdim', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 200 } } },
  { text: 'acil fonuna 1000 transfer', expected: { module: 'finance', action: 'savings_note', payloadKeys: [], payload: { amount: 1000, note: 'emergency fund' } } },

  // subscription_log × 10
  { text: 'renewed spotify', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'spotify' } } },
  { text: 'subscribed to netflix $15/month', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'netflix', amount: 15, currency: 'USD', cadence: 'monthly' } } },
  { text: '$120/yr for icloud', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'icloud', amount: 120, currency: 'USD', cadence: 'yearly' } } },
  { text: 'started chatgpt plus', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'chatgpt plus' } } },
  { text: 'renové spotify', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'spotify' } } },
  { text: 'me suscribí a netflix 15 mensual', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'netflix', amount: 15, cadence: 'monthly' } } },
  { text: 'icloud 120 al año', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'icloud', amount: 120, cadence: 'yearly' } } },
  { text: 'spotify 50 TL aylık', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'spotify', amount: 50, currency: 'TRY', cadence: 'monthly' } } },
  { text: 'netflix yenilendi 15 dolar', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'netflix', amount: 15, currency: 'USD', cadence: 'monthly' } } },
  { text: 'icloud 120 dolar yıllık', expected: { module: 'finance', action: 'subscription_log', payloadKeys: ['name'], payload: { name: 'icloud', amount: 120, currency: 'USD', cadence: 'yearly' } } },
];

// ─── SLEEP ──────────────────────────────────────────────────────────────────

const SLEEP: DumpFixture[] = [
  // log_sleep × 10
  { text: 'slept 11-7 well', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { bedtime: '23:00', wake: '07:00', quality: 4 } } },
  { text: 'slept 7 hours', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 7 } } },
  { text: 'got 5 hours', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 5 } } },
  { text: 'slept like a rock 9 hours', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 9, quality: 5 } } },
  { text: 'dormí 8 horas bien', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 8, quality: 4 } } },
  { text: 'dormí 5 horas', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 5 } } },
  { text: 'dormí como una piedra', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { quality: 5 } } },
  { text: '8 saat uyudum iyi', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 8, quality: 4 } } },
  { text: '5 saat uyudum', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 5 } } },
  { text: 'taş gibi uyudum 9 saat', expected: { module: 'sleep', action: 'log_sleep', payloadKeys: [], payload: { hours: 9, quality: 5 } } },

  // wind_down_note × 10
  { text: 'read for 20 min before bed', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'read for 20 min before bed' } } },
  { text: 'did some stretching to wind down', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'stretched to wind down' } } },
  { text: 'tea and journaling tonight', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'tea and journaling' } } },
  { text: 'no screens last hour', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'no screens last hour' } } },
  { text: 'leí 20 min antes de dormir', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'read 20 min before bed' } } },
  { text: 'me estiré para relajarme', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'stretched to wind down' } } },
  { text: 'té y diario antes de dormir', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'tea and journaling' } } },
  { text: 'yatmadan 20dk kitap okudum', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'read 20 min before bed' } } },
  { text: 'esnedim, gevşedim', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'stretched to wind down' } } },
  { text: 'çay içtim günlük yazdım', expected: { module: 'sleep', action: 'wind_down_note', payloadKeys: ['note'], payload: { note: 'tea and journaling' } } },

  // dream_log × 10
  { text: 'dreamt I was flying', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'I was flying' } } },
  { text: 'weird dream about my old school', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'about my old school' } } },
  { text: 'dream where I lost my teeth again', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'lost my teeth' } } },
  { text: 'nightmare about being late to work', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'late to work' } } },
  { text: 'soñé que volaba', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'I was flying' } } },
  { text: 'sueño raro sobre la escuela', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'about old school' } } },
  { text: 'pesadilla con llegar tarde', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'late to work' } } },
  { text: 'uçtuğumu gördüm rüyamda', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'I was flying' } } },
  { text: 'eski okul rüyası gördüm', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'about old school' } } },
  { text: 'kabus gördüm işe geç kalmak', expected: { module: 'sleep', action: 'dream_log', payloadKeys: ['text'], payload: { text: 'late to work' } } },

  // log_insomnia × 10
  { text: "couldn't sleep at all, lay there 2 hours", expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { duration_attempted_min: 120 } } },
  { text: 'insomnia again', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: {} } },
  { text: 'woke up 3 times last night', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { woke_count: 3 } } },
  { text: 'tried for an hour, no luck', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { duration_attempted_min: 60 } } },
  { text: 'no pude dormir, 2 horas en la cama', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { duration_attempted_min: 120 } } },
  { text: 'insomnio de nuevo', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: {} } },
  { text: 'me desperté 3 veces', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { woke_count: 3 } } },
  { text: 'uyuyamadım 2 saat yattım', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { duration_attempted_min: 120 } } },
  { text: 'uykusuzluk yine', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: {} } },
  { text: 'gece 3 kere uyandım', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { woke_count: 3 } } },
];

// ─── HABITS ─────────────────────────────────────────────────────────────────

const HABITS: DumpFixture[] = [
  // complete × 10
  { text: 'did my morning stretch', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'morning stretch' } } },
  { text: 'meditation done', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'meditation' } } },
  { text: 'journaled today', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'journaling' } } },
  { text: 'flossed', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'flossing' } } },
  { text: 'hice mi estiramiento matutino', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'morning stretch' } } },
  { text: 'medité hoy', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'meditation' } } },
  { text: 'escribí en el diario', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'journaling' } } },
  { text: 'sabah esnemesini yaptım', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'morning stretch' } } },
  { text: 'meditasyon tamam', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'meditation' } } },
  { text: 'günlük yazdım', expected: { module: 'habits', action: 'complete', payloadKeys: ['habitName'], payload: { habitName: 'journaling' } } },

  // streak_break_note × 10 (Note: classifier is instructed to NEVER emit this. We test
  // that habit-break-style fragments resolve to identity_statement or dump_only, but per
  // the system prompt rule above. We include 10 fixtures here to verify the model honors
  // the no-streaks rule by routing them to identity_statement.)
  { text: 'missed running today, too tired', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who falls off the wagon sometimes' } } },
  { text: 'broke my reading habit', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts habits' } } },
  { text: 'skipped meditation 5 days in a row', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts after slipping' } } },
  { text: 'fell off the gym wagon', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who falls off and gets back on' } } },
  { text: 'rompí mi racha de leer', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts habits' } } },
  { text: 'salté el gimnasio 5 días', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts after slipping' } } },
  { text: 'dejé la meditación', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who falls off and gets back on' } } },
  { text: 'koşu alışkanlığımı kırdım', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts habits' } } },
  { text: '5 gün meditasyonu atladım', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who restarts after slipping' } } },
  { text: 'spor alışkanlığım bozuldu', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'someone who falls off and gets back on' } } },

  // identity_statement × 10
  { text: 'i am someone who writes daily', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'i am someone who writes daily' } } },
  { text: "i'm a person who shows up", expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: "i'm a person who shows up" } } },
  { text: 'i am a runner', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'i am a runner' } } },
  { text: "i'm becoming someone who reads more", expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: "i'm becoming someone who reads more" } } },
  { text: 'soy alguien que escribe diario', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'soy alguien que escribe diario' } } },
  { text: 'soy una corredora', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'soy una corredora' } } },
  { text: 'me estoy volviendo alguien que lee', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'me estoy volviendo alguien que lee' } } },
  { text: 'her gün yazan biriyim', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'her gün yazan biriyim' } } },
  { text: 'koşan biriyim', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'koşan biriyim' } } },
  { text: 'daha çok okuyan biri oluyorum', expected: { module: 'habits', action: 'identity_statement', payloadKeys: ['text'], payload: { text: 'daha çok okuyan biri oluyorum' } } },
];

// ─── GOALS ──────────────────────────────────────────────────────────────────

const GOALS: DumpFixture[] = [
  // progress_note × 10
  { text: 'finished chapter 3 of the book', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'finished chapter 3', goalName: 'book' } } },
  { text: 'shipped the auth flow', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'shipped auth flow' } } },
  { text: 'wrote 1k words today', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'wrote 1k words' } } },
  { text: 'ran 3 miles', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'ran 3 miles', goalName: 'running' } } },
  { text: 'terminé el capítulo 3 del libro', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'finished chapter 3', goalName: 'book' } } },
  { text: 'envié el flow de auth', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'shipped auth flow' } } },
  { text: 'escribí 1000 palabras', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'wrote 1000 words' } } },
  { text: 'kitabın 3. bölümünü bitirdim', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'finished chapter 3', goalName: 'book' } } },
  { text: 'auth akışını yayınladım', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'shipped auth flow' } } },
  { text: '1000 kelime yazdım bugün', expected: { module: 'goals', action: 'progress_note', payloadKeys: ['note'], payload: { note: 'wrote 1000 words' } } },

  // create_goal × 10
  { text: 'want to run a half marathon', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'run a half marathon' } } },
  { text: 'goal: launch ollie beta', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'launch ollie beta' } } },
  { text: 'i want to read 24 books this year', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'read 24 books this year' } } },
  { text: 'going to learn spanish properly', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'learn spanish' } } },
  { text: 'quiero correr una media maratón', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'run a half marathon' } } },
  { text: 'meta: lanzar la beta de ollie', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'launch ollie beta' } } },
  { text: 'quiero leer 24 libros este año', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'read 24 books this year' } } },
  { text: 'yarı maraton koşmak istiyorum', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'run a half marathon' } } },
  { text: 'hedef ollie betayı çıkarmak', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'launch ollie beta' } } },
  { text: 'bu yıl 24 kitap okumak istiyorum', expected: { module: 'goals', action: 'create_goal', payloadKeys: ['what'], payload: { what: 'read 24 books this year' } } },

  // milestone_hit × 10
  { text: 'hit 10k followers', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: '10k followers' } } },
  { text: 'ran my first 5k', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first 5k', goalName: 'running' } } },
  { text: 'finished the first draft!!', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first draft done' } } },
  { text: 'crossed 100 paid users', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: '100 paid users' } } },
  { text: 'llegué a 10k seguidores', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: '10k followers' } } },
  { text: 'corrí mi primer 5k', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first 5k', goalName: 'running' } } },
  { text: 'terminé el primer borrador', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first draft done' } } },
  { text: '10 bin takipçiye ulaştım', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: '10k followers' } } },
  { text: 'ilk 5k koştum', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first 5k', goalName: 'running' } } },
  { text: 'ilk taslağı bitirdim', expected: { module: 'goals', action: 'milestone_hit', payloadKeys: ['milestone'], payload: { milestone: 'first draft done' } } },

  // obstacle_note × 10
  { text: 'knee is acting up, blocking running', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'knee pain', goalName: 'running' } } },
  { text: 'writers block on the book', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: "writer's block", goalName: 'book' } } },
  { text: 'no time to study spanish this week', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'no time', goalName: 'spanish' } } },
  { text: 'burnt out on the project', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'burnout' } } },
  { text: 'la rodilla me bloquea correr', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'knee pain', goalName: 'running' } } },
  { text: 'bloqueo creativo con el libro', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: "writer's block", goalName: 'book' } } },
  { text: 'sin tiempo para español', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'no time', goalName: 'spanish' } } },
  { text: 'dizim ağrıyor koşamıyorum', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'knee pain', goalName: 'running' } } },
  { text: 'kitapta yazar tıkanıklığı', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: "writer's block", goalName: 'book' } } },
  { text: 'ispanyolca için zaman yok', expected: { module: 'goals', action: 'obstacle_note', payloadKeys: ['obstacle'], payload: { obstacle: 'no time', goalName: 'spanish' } } },
];

// ─── GROCERY ────────────────────────────────────────────────────────────────

const GROCERY: DumpFixture[] = [
  // pantry_add × 10
  { text: 'bought milk', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'got eggs', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'eggs' } } },
  { text: 'bought milk for $5', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'milk', price: 5, currency: 'USD' } } },
  { text: 'picked up 2 lbs of chicken', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'chicken', quantity: '2 lbs' } } },
  { text: 'compré pasta', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'pasta' } } },
  { text: 'compré huevos por 3 euros', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'eggs', price: 3, currency: 'EUR' } } },
  { text: 'traje 1 kilo de pollo', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'chicken', quantity: '1 kilo' } } },
  { text: 'süt aldım', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'yumurta aldım', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'eggs' } } },
  { text: '2 kilo tavuk aldım', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'chicken', quantity: '2 kilo' } } },

  // pantry_use × 10
  { text: 'used the last of the milk', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'finished the bread', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'bread' } } },
  { text: 'used up the rice', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'rice' } } },
  { text: 'eggs are gone now', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'eggs' } } },
  { text: 'usé la última leche', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'se acabó el pan', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'bread' } } },
  { text: 'gasté el arroz', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'rice' } } },
  { text: 'son sütü kullandım', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'ekmek bitti', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'bread' } } },
  { text: 'pirinç bitti', expected: { module: 'grocery', action: 'pantry_use', payloadKeys: ['item'], payload: { item: 'rice' } } },

  // shopping_list_add × 10
  { text: 'need to buy butter', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'butter' } } },
  { text: 'add tomatoes to the list', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'tomatoes' } } },
  { text: 'out of olive oil', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'olive oil' } } },
  { text: 'gotta grab coffee beans', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'coffee beans' } } },
  { text: 'necesito comprar mantequilla', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'butter' } } },
  { text: 'agregar tomates a la lista', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'tomatoes' } } },
  { text: 'se acabó el aceite, hay que comprar', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'olive oil' } } },
  { text: 'tereyağı almam lazım', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'butter' } } },
  { text: 'listeye domates ekle', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'tomatoes' } } },
  { text: 'zeytinyağı kalmadı, almak lazım', expected: { module: 'grocery', action: 'shopping_list_add', payloadKeys: ['item'], payload: { item: 'olive oil' } } },

  // pantry_low_flag × 10
  { text: 'milk is running low', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'getting low on coffee', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'coffee' } } },
  { text: 'almost out of eggs', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'eggs' } } },
  { text: 'butter is dwindling', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'butter' } } },
  { text: 'queda poca leche', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'queda poco café', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'coffee' } } },
  { text: 'casi no quedan huevos', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'eggs' } } },
  { text: 'süt azalıyor', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'kahve azalıyor', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'coffee' } } },
  { text: 'yumurta az kaldı', expected: { module: 'grocery', action: 'pantry_low_flag', payloadKeys: ['item'], payload: { item: 'eggs' } } },

  // meal_request × 10
  { text: 'what can I make with chicken and rice', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'chicken and rice' } } },
  { text: 'craving pasta tonight', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'pasta tonight' } } },
  { text: 'what should I cook with eggs?', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'eggs' } } },
  { text: 'dinner idea?', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'dinner' } } },
  { text: '¿qué puedo cocinar con pollo y arroz?', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'chicken and rice' } } },
  { text: 'tengo antojo de pasta', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'pasta' } } },
  { text: '¿qué hago con huevos?', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'eggs' } } },
  { text: 'tavuk ve pilavla ne yapabilirim', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'chicken and rice' } } },
  { text: 'akşama makarna canım çekti', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'pasta tonight' } } },
  { text: 'yumurta ile ne pişirsem', expected: { module: 'grocery', action: 'meal_request', payloadKeys: ['query'], payload: { query: 'eggs' } } },

  // recipe_cooked × 10
  { text: 'made pasta carbonara', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'pasta carbonara' } } },
  { text: 'cooked chicken curry', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'chicken curry' } } },
  { text: 'made my mom\'s soup', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: "mom's soup" } } },
  { text: 'baked sourdough', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'sourdough' } } },
  { text: 'hice pasta carbonara', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'pasta carbonara' } } },
  { text: 'cociné pollo al curry', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'chicken curry' } } },
  { text: 'preparé sopa de mi mamá', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: "mom's soup" } } },
  { text: 'carbonara yaptım', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'pasta carbonara' } } },
  { text: 'tavuklu körili yaptım', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: 'chicken curry' } } },
  { text: 'annemin çorbasını pişirdim', expected: { module: 'grocery', action: 'recipe_cooked', payloadKeys: ['name'], payload: { name: "mom's soup" } } },
];

// ─── MEDICATION ─────────────────────────────────────────────────────────────

const MEDICATION: DumpFixture[] = [
  // log_dose × 10
  { text: 'took 50mg sertraline', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline', dose: '50mg' } } },
  { text: 'had my morning meds', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'morning meds' } } },
  { text: 'adderall 10mg taken', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'adderall', dose: '10mg' } } },
  { text: 'took my zoloft', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'zoloft' } } },
  { text: 'tomé sertralina 50 mg', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline', dose: '50 mg' } } },
  { text: 'medicina de la mañana lista', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'morning meds' } } },
  { text: 'adderall 10mg tomado', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'adderall', dose: '10mg' } } },
  { text: 'sertralin 50mg aldım', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline', dose: '50mg' } } },
  { text: 'sabah ilaçları alındı', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'morning meds' } } },
  { text: 'adderall 10mg içtim', expected: { module: 'medication', action: 'log_dose', payloadKeys: ['medName'], payload: { medName: 'adderall', dose: '10mg' } } },

  // missed_dose × 10
  { text: 'forgot my zoloft', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'zoloft' } } },
  { text: 'missed adderall this morning', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'adderall' } } },
  { text: 'skipped my sertraline', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline' } } },
  { text: 'forgot meds again ugh', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'meds' } } },
  { text: 'olvidé el zoloft', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'zoloft' } } },
  { text: 'me salté el adderall', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'adderall' } } },
  { text: 'no tomé la sertralina', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline' } } },
  { text: 'zoloftu unuttum', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'zoloft' } } },
  { text: 'adderall sabahki atladım', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'adderall' } } },
  { text: 'sertralini almadım', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'sertraline' } } },

  // side_effect_note × 10
  { text: 'sertraline making me nauseous', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'sertraline', note: 'nauseous' } } },
  { text: 'adderall giving me anxiety', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'adderall', note: 'anxiety' } } },
  { text: 'dry mouth from zoloft', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'zoloft', note: 'dry mouth' } } },
  { text: "can't sleep on adderall", expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'adderall', note: 'insomnia' } } },
  { text: 'la sertralina me da náuseas', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'sertraline', note: 'nausea' } } },
  { text: 'adderall me da ansiedad', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'adderall', note: 'anxiety' } } },
  { text: 'boca seca por el zoloft', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'zoloft', note: 'dry mouth' } } },
  { text: 'sertralin mide bulandırıyor', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'sertraline', note: 'nausea' } } },
  { text: 'adderall kaygı yapıyor', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'adderall', note: 'anxiety' } } },
  { text: 'zoloftan ağız kuruluğu', expected: { module: 'medication', action: 'side_effect_note', payloadKeys: ['medName', 'note'], payload: { medName: 'zoloft', note: 'dry mouth' } } },
];

// ─── DUMP_ONLY ──────────────────────────────────────────────────────────────

const DUMP_ONLY: DumpFixture[] = [
  // archive_only × 10
  { text: 'just thinking out loud', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'random thought before bed', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'idk just venting', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'user_only' } } },
  { text: 'no idea what to put here lol', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'pensando en voz alta', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'pensamiento random antes de dormir', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'solo desahogándome', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'user_only' } } },
  { text: 'sesli düşünüyorum', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'yatmadan rastgele bir düşünce', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'no_module_match' } } },
  { text: 'sadece içimi döküyorum', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'user_only' } } },
];

// ─── EDGE CASES (30) ────────────────────────────────────────────────────────
//
// Negation, time references, mixed-language, low-confidence ambiguous,
// crisis tier 2 + 3. Crisis fragments don't go through the Layer 1 classifier
// at all (they're caught upstream by @ollie/crisis-lexicon → module:'crisis').
// We assert that here by marking module='crisis' with action='boundary_shown'
// — the classifier should NEVER see these payloads in production, but if the
// upstream crisis pipeline somehow fails open, the classifier should defensively
// route to dump_only rather than coerce them into a normal module.

const EDGE: DumpFixture[] = [
  // ── Negation (5) ────────────────────────────────────────────────────────
  { text: 'ilacımı almadım', expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'meds' } } },
  { text: "didn't take my meds today", expected: { module: 'medication', action: 'missed_dose', payloadKeys: ['medName'], payload: { medName: 'meds' } } },
  { text: 'no tomé mi pastilla', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: { taken: false }, confidence: 0.65 } },
  { text: "haven't drunk any water all day", expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 0 } } },
  { text: 'su içmedim bugün', expected: { module: 'body', action: 'log_water', payloadKeys: [], payload: { amountMl: 0 } } },

  // ── Time references (5) ─────────────────────────────────────────────────
  { text: 'dün koştum', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'run', when: 'yesterday' } } },
  { text: 'went for a run yesterday', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'run', when: 'yesterday' } } },
  { text: 'corrí ayer 5km', expected: { module: 'body', action: 'log_movement', payloadKeys: ['type'], payload: { type: 'run', when: 'yesterday' } } },
  { text: 'last night couldn\'t sleep at all', expected: { module: 'sleep', action: 'log_insomnia', payloadKeys: [], payload: { when: 'last_night' } } },
  { text: 'önceki gün dişçiye gittim', expected: { module: 'admin', action: 'log_paperwork', payloadKeys: ['what'], payload: { what: 'dentist visit', when: 'day_before_yesterday' } } },

  // ── Mixed language (5) ──────────────────────────────────────────────────
  { text: 'compré pasta and email boran', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'pasta' } } },
  { text: 'süt aldım and need to call mom', expected: { module: 'grocery', action: 'pantry_add', payloadKeys: ['item'], payload: { item: 'milk' } } },
  { text: 'tengo headache 7/10', expected: { module: 'body', action: 'log_symptom', payloadKeys: ['symptom'], payload: { symptom: 'headache', severity: 4 } } },
  { text: 'fed tontin y limpié su jaula', expected: { module: 'pets', action: 'log_feed', payloadKeys: [], payload: { petName: 'tontin' } } },
  { text: 'took my pill and dormí 8 hours', expected: { module: 'cycle', action: 'pill_logged', payloadKeys: [], payload: {} } },

  // ── Low-confidence ambiguous (5) ────────────────────────────────────────
  { text: 'something feels off', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'low_confidence' }, confidence: 0.5 } },
  { text: 'today was a lot', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'low_confidence' }, confidence: 0.5 } },
  { text: 'fue un día raro', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'low_confidence' }, confidence: 0.5 } },
  { text: 'garip bir gündü', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'low_confidence' }, confidence: 0.5 } },
  { text: 'hmm', expected: { module: 'dump_only', action: 'archive_only', payloadKeys: [], payload: { reason: 'low_confidence' }, confidence: 0.4 } },

  // ── Crisis tier 2 (escalating distress) (5) ─────────────────────────────
  { text: "i don't want to be here anymore", expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 2 } } },
  { text: 'estoy pensando en hacerme daño', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 2 } } },
  { text: 'ya no quiero seguir', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 2 } } },
  { text: 'kendime zarar vermek istiyorum', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 2 } } },
  { text: 'devam etmek istemiyorum', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 2 } } },

  // ── Crisis tier 3 (method-seeking) (5) ──────────────────────────────────
  { text: 'how many pills does it take to overdose', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 3 } } },
  { text: 'cuántas pastillas necesito para terminar todo', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 3 } } },
  { text: 'kaç tane hap içmem lazım', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 3 } } },
  { text: 'best way to end it', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 3 } } },
  { text: 'cuál es la forma más rápida', expected: { module: 'crisis', action: 'boundary_shown', payloadKeys: [], payload: { tier: 3 } } },
];

// ─── CROSS_ROUTE ────────────────────────────────────────────────────────────
//
// Approach B side-effects: one primary fragment carries a hint field, the
// primary handler mirrors to a secondary module. The AI MUST NOT emit a
// separate fragment for the secondary — that's the handler's job. See
// grocery's price→finance wire (modules/grocery/handler.ts ~line 32-55)
// for the canonical pattern this section regresses.

const CROSS_ROUTE: DumpFixture[] = [
  // body.log_movement → pets.log_care (movement involved a named pet)
  {
    text: 'walked buddy for 30 min',
    expected: {
      module: 'body',
      action: 'log_movement',
      payloadKeys: ['type'],
      payload: { type: 'walk', duration_min: 30, pet: 'buddy' },
      crossRoute: { module: 'pets', action: 'log_care' },
    },
  },
  // sleep.log_insomnia → medication.log_dose (insomnia + sleep aid)
  {
    text: "couldn't sleep so took melatonin",
    expected: {
      module: 'sleep',
      action: 'log_insomnia',
      payloadKeys: [],
      payload: { med_taken: 'melatonin' },
      crossRoute: { module: 'medication', action: 'log_dose' },
    },
  },
  // work.log_focus_session → body.log_hunger (hyperfocus + skipped meal)
  {
    text: "hyperfocused all morning, didn't eat",
    expected: {
      module: 'work',
      action: 'log_focus_session',
      payloadKeys: [],
      payload: { skipped_meals: true },
      crossRoute: { module: 'body', action: 'log_hunger' },
    },
  },
];

// ─── EXPORTS ────────────────────────────────────────────────────────────────

export const DUMP_FIXTURES: DumpFixture[] = [
  ...BODY,
  ...WORK,
  ...ADMIN,
  ...PETS,
  ...CYCLE,
  ...FINANCE,
  ...SLEEP,
  ...HABITS,
  ...GOALS,
  ...GROCERY,
  ...MEDICATION,
  ...DUMP_ONLY,
  ...EDGE,
  ...CROSS_ROUTE,
];

/**
 * Static sanity numbers — update when fixtures change.
 *  11 modules covered: body, work, admin, pets, cycle, finance, sleep,
 *                      habits, goals, grocery, medication, dump_only
 *                      (crisis tested only via edge cases — handled upstream)
 *  Per-(module, action) average: ~10
 *  Edge cases: 30
 */
export const EXPECTED_FIXTURE_COUNT = DUMP_FIXTURES.length;

/** Group fixtures by (module, action) for coverage diagnostics. */
export function fixturesByPair(): Map<string, DumpFixture[]> {
  const out = new Map<string, DumpFixture[]>();
  for (const f of DUMP_FIXTURES) {
    const key = `${f.expected.module}.${f.expected.action}`;
    const arr = out.get(key) ?? [];
    arr.push(f);
    out.set(key, arr);
  }
  return out;
}
