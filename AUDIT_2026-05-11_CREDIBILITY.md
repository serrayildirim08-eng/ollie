# ollie · credibility audit · 2026-05-11

**Second pass. Different lens.** Audit 1 caught the auth leak (C1), the
dead Sprint 2 packages (C2), and the red sync tests (C3). Pattern Claude
admitted to: "I optimized for 'code exists + tests pass' instead of
'user experiences the feature.'" This audit extends that lens. It does
not repeat the three.

For everything below: file:line is cited. Code was read. Sprint
summaries were graded against the production code that ships on
`pets-front-facing` HEAD.

---

## 1. Executive summary

- The meta-pattern is **plumbing without taps**. Detectors run, events
  fire, orchestrators write derived state into the store. The UI
  doesn't read most of it. Sprint summaries describe these as
  "shipped" because the data flows; the user sees nothing.
- **Burhan's life-event tree (Sprint 3 D1) is 100% dead UI-side.** The
  burhan orchestrator writes append-only events to `burhan.state`. No
  React component reads `'burhan'` from the store. The `lifeEvents`
  prop on `BurhanTree` is never passed by any caller. Sprint 3
  acceptance — "Logging a period adds a flower (visible on next
  dashboard view)" — is provably false.
- **The cross-module router (Sprint 3 D2 + Sprint 4 E5) is 100% dead.**
  All 6 chain rules wire to source events (`sleep:pacing_breach_detected`,
  `sleep:short_sleep_run_detected`, `work:hyperfocus_detected`,
  `cycle:luteal_phase_entered`, `finance:spending_spike_detected`,
  `body:hydration_drop_detected`) that **no production code emits**.
  No UI reads any of the reflect targets (`finance.protective_cards`,
  `body.protective_cards`, `shared.reduce_motion_today`,
  `finance.cycle_card_visible`, `admin.reflected`). The whole router
  is a beautiful skeleton with no skin and no muscle.
- **The cycle orchestrator's outputs are unused.** It writes
  `cycle.prediction`, `cycle.healthFlags`, `cycle.adherence`,
  `cycle.stats`, `cycle.insights`, `cycle.cycles` to the store every
  recompute. CycleModule reads NONE of them; it re-derives the same
  values inline via `useMemo`. Same pattern in Finance, Grocery, Body.
  Audit 1 H5 flagged the duplication; this audit extends it: the
  orchestrator side is the dead branch.
- **The home-screen location/weather is literally hard-coded
  "ISTANBUL · 14° · CLEAR".** No geolocation, no Open-Meteo,
  no BigDataCloud. CLAUDE.md describes a fetch-on-load flow that
  doesn't exist in ollie. No sprint summary admitted this; it just
  isn't there.
- **Onboarding writes to a different key than the rest of the app
  reads.** Onboarding sets `shared.has_pets` (flat) and
  `shared.consent_spending_research` (underscored). Dashboard reads
  `shared.settings.has_pets` (nested). Garden gate reads
  `shared.consent.spending_research` (dotted). The onboarding's
  "no pets" answer is lost; the onboarding's research opt-in is lost.
- **Notification scheduling fires twice.** Every scheduled notify call
  invokes both `state.backend.schedule(spec, fireAt)` (native APNs /
  Capacitor / Electron schedules a native fire) AND
  `scheduleInProcessTimer(record)` (sets a JS `setTimeout` for the
  same time). On platforms with native scheduling, the user gets two
  notifications.
- **The garden's "water Burhan" button is theater.** It plays a
  droplets animation and a green glow, but `onWater?.()` is never
  wired in App.tsx. Water level is hardcoded `0.72`. The "health:
  thirsty | thriving" type literally encodes a decay state.
  Constitutional rule "Burhan never decays" survives by accident —
  nothing computes 'thirsty', so 'thriving' is always shown.
- **`droop` parameter on `BurhanTree` is a decay function in code.**
  At `droop=100` the tree desaturates and dims. No caller currently
  passes droop≠0 — but the primitive exists, ready to violate the
  constitutional rule the moment any future contributor wires it.
- **Sprint 0's "tracked time" widget writes nothing to the store.**
  The home screen TimeTracker counts seconds, then forgets them.
  The dashboard's "TRACKED" stat falls back to `'0m'`. Nobody can
  see the time they tracked.
- **`apps/web/src/lib/savings-digest.ts` calls `notify(...)` but
  notification permission is requested lazily**, AFTER the dispatcher
  is asked to fire. On web, Chrome blocks `requestPermission` outside
  a user gesture. The savings-digest schedule-on-boot path will never
  reach the user without an explicit "turn on reminders" gesture
  (Audit 1 H1, here re-confirmed as load-bearing).

The overall credibility picture: **about half of what the sprint
summaries call "shipped" is plumbed but unreachable from the UI**.
The user-facing app is closer to Sprint 0 + parts of Sprint 1 than
the four sprint summaries suggest.

---

## 2. CRITICAL

Bugs that break a constitutional promise, a security claim, or a "done
when" acceptance. Audit 1's C1–C5 still stand; the below are new.

### NC1 · Sprint 3 D1 acceptance criteria are false — `apps/web/src/components/Burhan3D.tsx:45`, `apps/web/src/components/BurhanTree.tsx:31`

Sprint 3 summary: *"Logging a period adds a flower (visible on next
dashboard view) · Cancelling a subscription adds a fruit · Elements
persist across reloads."* The orchestrator at
`packages/orchestrator/src/burhan.ts:86` does append events to
`burhan.state.events`. That's truth in the data layer. **Nothing in
`apps/web/src` ever reads from the `burhan` module of the store.**
`grep -rn "'burhan'" apps/web/src` returns zero hits.

`BurhanTree` exposes a `lifeEvents` prop
(`apps/web/src/components/BurhanTree.tsx:31`). No caller passes it.
`Burhan3D` doesn't take a `lifeEvents` prop at all
(`apps/web/src/components/Burhan3D.tsx:6-13`) and its fallback path
calls `<BurhanTree tone="garden" />` with no event data.

**Why it matters:** Sprint 3 D1 was framed as the emotional centerpiece
of the new growth model. Burhan visibly accumulates evidence of the
user's life. The data accumulates; the user sees a static tree. This
is the single biggest gap between sprint narrative and user reality.

**Fix:** wire `lifeEvents` from `store.get('burhan', 'state').events`
into `<BurhanTree>` calls in `DashboardScreen.tsx` (last 12) and
`GardenScreen.tsx` (all). Plumb the prop through `Burhan3D` so both
canvas-2D fallback and 3D path receive it. ~½ day.

### NC2 · The entire cross-module router (Sprint 3 D2 + Sprint 4 E5) has no live source events — `packages/router/src/cross-module.ts:64-228`

The router has 9 rules. Six of them source events:

```
sleep:pacing_breach_detected
sleep:short_sleep_run_detected
work:hyperfocus_detected
cycle:luteal_phase_entered
finance:spending_spike_detected
body:hydration_drop_detected
finance:reminder_set
habits:interest_capture_detected
```

A `grep -rn` across all of `packages/` and `apps/` finds **zero
`emit(...)` calls** for any of these events outside the test files
themselves. None of them fire in production. The router subscribes;
nothing publishes.

Furthermore, no UI consumes the reflect targets either —
`finance.protective_cards`, `body.protective_cards`,
`shared.reduce_motion_today`, `finance.cycle_card_visible`,
`admin.reflected` are written by the router (if the source were ever
emitted) and read by no React component.

**Sprint 4 acceptance criterion "Seed sleep deprivation triggers
spending caution card within 24h"** is provably untrue.

**Why it matters:** The cross-protective chains are Decision-level
features. They're the "ollie sees the pattern across modules and
quietly surfaces it" promise that distinguishes ollie from a checklist
app. Right now: zero chains can fire, zero UI would show them if they
did.

**Fix:** every chain source needs a detector emitting. Detectors exist
in `@ollie/logic/sleep`, `@ollie/logic/work`, etc. (the same code the
UI useMemos). Either: (a) move the detector outputs into the
orchestrator and emit when the relevant boolean transitions, or (b)
have UI emit when it surfaces a state. Plus: each reflect target needs
a React surface. ~3–4 days for all six chains to be alive end-to-end.

### NC3 · `body:doctor_visit_completed` is still registered but never emitted, AND `admin:appointment_completed` doesn't auto-fire on actual appointments — `packages/events/src/registry.ts:176`, `packages/orchestrator/src/admin.ts`

Audit 1 H6 already named this for `body:doctor_visit_completed`. Adding
to it: the alternative path (admin completion with `kind: 'doctor'` →
canopy_fruit) ALSO has no production emit site. `grep` for
`emit('admin:appointment_completed'` across orchestrator + UI:

```
$ grep -rn "appointment_completed" packages apps | grep -v test | grep -v dist
packages/events/src/registry.ts:175:
packages/orchestrator/src/burhan.ts:42:  ... 'admin:appointment_completed',
packages/orchestrator/src/admin.ts:316: events.emit('admin:appointment_completed', ...
apps/web/src/modules/admin/AdminModule.tsx — no emit
```

Looking at admin.ts:316 — let me re-verify that path exists with a
real trigger:

The admin orchestrator emits `admin:appointment_completed` only from
inside its own recompute path. Walk the AdminModule UI: there is no
"mark complete" button that lands in the admin orchestrator's input
state. The orchestrator scans for transitions; UI never produces them.

**Why it matters:** the most rewarding Burhan element (`canopy_fruit`)
is structurally unreachable. A user who completes a doctor visit and
marks it done in admin would expect the highest-value Burhan element
— which they wouldn't see anyway (NC1), but also which their UI
action doesn't trigger.

**Fix:** Either add an explicit `emit('admin:appointment_completed',
{ task_id, kind: 'doctor' })` in the AdminModule completion handler,
OR delete the unused event registrations from the registry. The bug
is the disconnect, not which side to fix.

### NC4 · Onboarding writes consent + has_pets to keys nothing else reads — `apps/web/src/pages/OnboardingScreen.tsx:159-165`

OnboardingScreen.tsx writes:

```
store.set('shared', 'has_pets', state.hasPets ?? false);                       // line 159
store.set('shared', 'consent_spending_research', state.spendResearch ?? false); // line 165
```

DashboardScreen.tsx reads:

```
const [hasPets] = useStoreSlice<boolean>('shared', 'settings.has_pets', true); // line 130
```

App.tsx (garden gate) reads:

```
const consent = store.get<boolean>('shared', 'consent.spending_research', false); // line 99
```

GardenConsentScreen.tsx writes:

```
const [, setConsent] = useStoreSlice<boolean>('shared', 'consent.spending_research', false);
```

**Three different key conventions for two settings.** Sprint 1
acceptance criterion *"Complete onboarding 'no pets' → home cluster
on dashboard hides pets"* is broken — DashboardScreen reads
`'settings.has_pets'` (defaulting to `true` when absent), so the
pets sub-module always shows regardless of onboarding answer.

The research-consent path is more dangerous: a user who explicitly
opts in during onboarding gets a fresh consent screen the first time
they tap the garden. Their onboarding answer was lost. They may
re-consent. They may opt out the second time. Either way: the
explicit "yes" they gave in onboarding never propagates.

**Why it matters:** the consent flow is GDPR-relevant. Users believe
they opted in; the system doesn't know. If/when the research stream
ever ships (today it doesn't — Audit 1 C2), the device queue would
not start producing events for users who answered "yes" in
onboarding. They'd think they're contributing; they wouldn't be.

**Fix:** pick one key per setting. Standardize on dotted-with-`settings`
namespace (`shared.settings.has_pets`, `shared.consent.spending_research`)
and update both the writes in OnboardingScreen and the reads in
DashboardScreen / App.tsx / GardenConsentScreen.

### NC5 · Garden consent UI bypasses `grantConsent()` — `apps/web/src/pages/GardenConsentScreen.tsx:25-29`

The `@ollie/research-stream` package exposes `grantConsent()` which
flips the consent flag AND calls `ensureDeviceId()` so a device UUID
is generated. The GardenConsentScreen instead writes the consent flag
directly via `setConsent(true)` (line 28). No device id is created.

This is harmless today because the research-stream package isn't
imported anywhere in apps (Audit 1 C2). But the moment that's fixed,
the consent screen will need to be the one place that toggles consent
AND boots the stream. Right now the UI bypasses the constitutional
API of the package.

Worse, the screen says "change anytime in settings" — but no
settings UI exists with a research-consent toggle. (Audit 1 listed
this in "what's missing.")

**Why it matters:** the consent / withdraw / GDPR path is supposed
to be the protected boundary the user can trust. The UI doesn't go
through the package's public API.

**Fix:** when account-boot lands (Audit 1 C2 fix), make
GardenConsentScreen call `researchClient.grantConsent()` instead of
writing the flag directly. Build the settings-page toggle that calls
`withdrawConsent()`. Until then, the screen is benign but
structurally wrong.

### NC6 · Notification dispatcher double-schedules — `packages/notifications/src/index.ts:311-323`

When a future-scheduled notification is queued, the dispatcher does
both:

```ts
const id = await state.backend.schedule(spec, fireAt);  // line 314 — native schedule
...
scheduleInProcessTimer(record);                          // line 323 — JS setTimeout
```

On platforms whose backend actually schedules natively (Capacitor
LocalNotifications, Electron main-process `setTimeout`), this means
the fire time triggers BOTH:

1. The native scheduler delivers the platform notification.
2. The JS in-process timer (line 168 in same file) calls
   `deliverImmediate(r.spec)` → which goes back through the
   dispatcher → which calls `state.backend.deliver(spec)` → another
   notification appears.

On web, the lazy permission path swallows the second fire if perm
isn't granted. On Capacitor or Mac Electron, it'd duplicate.

**Why it matters:** if the app ships to Mac users today with the
APNs key generated, every scheduled reminder fires twice. Reminders
about important things (rent, meds) get doubled.

**Fix:** if `state.backend.schedule()` returns a truthy `platformId`,
skip `scheduleInProcessTimer()`. Use the in-process timer only as a
fallback when the backend returns undefined / null.

### NC7 · Worker cron is disabled AND KV namespace is a placeholder — `apps/api/wrangler.toml:24, 34`

Sprint 4 said "every-minute cron, manual `/cron/tick` endpoint, code
path complete." The wrangler.toml literally has:

```
SCHEDULED_JOBS_ENABLED = "0"
...
id = "REPLACE_AFTER_wrangler_kv_create_DEVICE_TOKENS"
```

Cron triggers are configured (`crons = ["* * * * *"]`) but the
handler will early-return because `SCHEDULED_JOBS_ENABLED !== "1"`.
The KV binding ID is a placeholder string — wrangler deploy would
fail OR (more likely) `env.DEVICE_TOKENS` is undefined and
`/register-token` 500s.

Audit 1 noted "Apple key not generated yet." That's true. But the
sprint summary made it sound like the only missing step was the .p8.
There are two more steps:

1. `wrangler kv namespace create DEVICE_TOKENS` → paste the real
   namespace ID into wrangler.toml.
2. `wrangler secret put SUPABASE_URL`, etc.

Then flip `SCHEDULED_JOBS_ENABLED = "1"`. Right now even with a .p8,
nothing works.

**Why it matters:** Sprint 4 "Done when: Schedule a reminder for 2
minutes in the future, close the app entirely, push fires on time"
is structurally untrue: there is no server-side cron running, no KV
namespace bound, no Apple key.

**Fix:** document the 4-step Apple+wrangler-secrets+kv setup in
`apps/api/README.md` as a single checklist. Stop calling cron "done"
in summaries until all four are real. (Pre-condition for ANY mobile
push to work.)

---

## 3. HIGH

Claims that don't match code, surfaces that don't render, "shipped"
features users can't reach.

### NH1 · Home screen weather/location is a hardcoded string — `apps/web/src/pages/HomeScreen.tsx:199`

CLAUDE.md section "Location/Weather (top left)" describes a flow
fetching Open-Meteo + BigDataCloud on load. The actual code:

```tsx
<span style={...}>ISTANBUL · 14° · CLEAR</span>
```

`grep -rn "geolocation\|open-meteo\|bigdatacloud" apps/web/src` returns
zero hits. No location, no weather, no temperature, no API calls.

The sky video selector (`apps/web/src/lib/skyVideo.ts:42`) does pick
by `hour` (from `new Date()`), so it at least varies by time of day —
but its `overcast` flag is never set true. So the overcast video
never plays.

**Why it matters:** none of the sprint summaries claimed this was
done, but CLAUDE.md does. A reader of CLAUDE.md would believe it's
working. A user from another timezone gets "ISTANBUL · 14° · CLEAR"
forever.

**Fix:** either implement the fetch (≤2 hours, both APIs are
key-free) OR delete the literal text and replace with something
that's honestly decorative. Right now it's neither.

### NH2 · Dashboard "stats bar" is dead — `apps/web/src/pages/DashboardScreen.tsx:128, 274-279` + `apps/web/src/App.tsx:119`

DashboardScreen takes `stats?: { dueToday, billsSoon, tracked }`. App.tsx
mounts `<DashboardScreen onNavigate={...} onBrainDump={dashDump} />`
with no `stats` prop. Defaults are `0 / 0 / '0m'`. The bar always
shows zeros.

Sprint 1 verification matrix said: *"Stats bar (due today / bills
soon / tracked) renders."* Technically true; the bar renders. But
the values are constants.

**Why it matters:** the stats bar is a load-bearing visual ("what
needs my attention today") — and it always says nothing needs
attention. New users see a quiet bar; long-term users with real bills
due also see a quiet bar.

**Fix:** wire actual derived values. There's an unused
`usePendingCounts()` hook already at DashboardScreen.tsx:91 that
counts cycle/sleep/body/etc. items. Pass `pendingCounts` and a real
`dueToday` derivation as the `stats` prop from App.tsx.

### NH3 · Time tracker on home screen records nothing — `apps/web/src/pages/HomeScreen.tsx:49-95`

Sprint 0 verification matrix doesn't mention this, but the CLAUDE.md
spec for "Time Tracker (right side, above chat)" says "shows MM:SS
timer, stop button." The current code does run a timer but writes
nothing to the store on stop.

```ts
onClick={() => setActive(false)}    // stop just flips local state
```

No `store.set('work', 'sessions', ...)`, no event emit. The work
orchestrator's `todaySessions` (WorkModule.tsx:350) reads from
`work.sessions` — a key the home-screen timer never writes.

**Why it matters:** a user who taps "TRACK TIME" for 25 minutes and
then "STOP" expects that to show up in Work module's session total.
It doesn't. They'll either think the app is broken or stop using the
tracker.

**Fix:** on stop, emit `work:session_logged { duration_ms, ts }` and
have the work orchestrator append to `work.sessions`. ~½ day.

### NH4 · Cycle orchestrator writes 6 keys nobody reads — `packages/orchestrator/src/cycle.ts:65-124`

Cycle orchestrator writes on every recompute:

```
'cycle', 'phaseName'
'cycle', 'flags'
'cycle', 'currentDay'
'cycle', 'cycles'
'cycle', 'prediction'
'cycle', 'insights'
'cycle', 'healthFlags'
'cycle', 'stats'
'cycle', 'adherence'
```

CycleModule.tsx reads only `cycle.items`, `cycle.settings`,
`cycle.lastEditedByCycle`, `cycle.asks`. **Every derived value the
orchestrator writes is unused.** CycleModule re-derives all of them
inline:

```ts
const cycles = useMemo(() => detectBoundaries(items), [items]);     // line 557
const adherence = useMemo(() => detectAdherenceIssue(cycles), ...); // line 563
```

Plus `predictNextPeriod`, `detectHealthFlags`, `findCorrelations`,
`fertileWindow` — all run inline.

**Why it matters:** the architectural rule in CLAUDE.md (and the
intent in @ollie/orchestrator's docstring) says UI reads derived
values from store. The orchestrator owns derived values. Today the
UI ignores the orchestrator entirely for cycle. The orchestrator does
the same work the UI does, twice — once on every event, once on every
render. Wasted CPU; worse, two truths that could diverge.

**Fix:** either delete the cycle orchestrator's derived writes (and
accept "UI computes its own derived values") OR move all the inline
useMemo detectors out of CycleModule and read from store. Don't keep
the half-and-half — the next contributor won't know which is
authoritative.

### NH5 · 11 of 14 logic modules in apps/web run detectors in useMemo — `apps/web/src/modules/*/`

Same pattern as NH4, generalized:

- `cycle/CycleModule.tsx` — predictNextPeriod / detectHealthFlags /
  fertileWindow / findCorrelations / detectAdherenceIssue
- `grocery/GroceryModule.tsx` — learnKnownStore, inferRecipe,
  detectPatterns (the file's docstring at line 7 admits this:
  "(useMemo only, never in render)")
- `finance/FinanceModule.tsx` — detect* via useMemo (line 768)
- `body/BodyModule.tsx`, `work/WorkModule.tsx`,
  `habits/HabitsModule.tsx`, `sleep/SleepModule.tsx`,
  `goals/GoalsModule.tsx`, `pets/PetsModule.tsx`,
  `astrology/AstrologyModule.tsx`, `admin/AdminModule.tsx`

The architectural drift is now uniform: every module ignores the
orchestrator on the read side. **The orchestrator layer is, in
practice, a write-only black hole.**

**Why it matters:** Audit 1 H5 flagged it for cycle. It's actually
the dominant pattern. This is the architectural drift that will hurt
when sync ships — the orchestrator's writes are what `@ollie/sync`
would upload. The UI's inline useMemo derivations are local-only.
Sync between devices would show different "derived values" until both
re-render.

**Fix:** make a call. The CLAUDE.md doctrine ("UI reads, orchestrator
writes") is plausible, but right now the doctrine is documentation,
not code. Either:

(a) **commit to orchestrator-owns-derived** — strip useMemo detectors
from every UI; UI selects from store. Orchestrator's writes become
load-bearing. This is the spec.

(b) **commit to UI-derives-locally** — delete the orchestrator's
derived writes. Orchestrator only mediates cross-module events. Less
code, less drift surface.

Pick by Sprint 5. Don't ship sync (Audit 1 C2 fix) on top of the
current ambiguity.

### NH6 · "Remind me to cancel" button is a no-op — `apps/web/src/modules/finance/FinanceModule.tsx:325-331`

Sprint 3 D3 said the d3-subscription card has 3 buttons: "dismiss ·
this is intentional · remind me to cancel". The summary admitted
*"All three currently dismiss; the reminder hook into
`void:reminder:scheduled` lives in the existing router and is a
follow-on wire."*

Reading the code now: the third button is **literally labeled
`dismiss`**, not "remind me to cancel". The promised label is gone.
The promised hook is unwired.

**Why it matters:** Sprint 3's "what's next" item 1 was this hook.
It's not been done. The button copy itself was downgraded from
"remind me to cancel" to plain "dismiss" — quietly, without a sprint
log entry.

**Fix:** either restore the "remind me to cancel" label and wire it
to `createReminderScheduler.add(...)` with a 24h offset, or accept
the 2-button design and update the Sprint 3 narrative.

### NH7 · Garden has a working "water Burhan" button that does nothing — `apps/web/src/pages/GardenScreen.tsx:441-450, 740-761`

The garden screen has a `<button>water burhan 💧</button>`. Clicking
it sets local state for a droplets animation and a tree-glow effect,
then calls `onWater?.()`. **No caller of GardenScreen ever passes
`onWater`** — App.tsx:102 mounts `<GardenScreen onNavigate={...} />`
with no water handler.

So the button plays a 3.2-second animation and disappears. No data
change, no event, no orchestrator write, no "water level" ever
updates (it's hardcoded at 0.72 anyway, see Audit 1 H3 + NH8 below).

**Why it matters:** the user taps the only interactive element in the
garden expecting something to happen. Animation runs. They tap again.
Same animation. Nothing else.

**Fix:** either remove the button (cleanest, fits "Burhan never
decays" — no need to water) or wire it to a real event. The
animation can stay — but if the button is decorative-only, it should
look decorative.

### NH8 · Garden "burhan is thriving" implies a decay state model — `apps/web/src/pages/GardenScreen.tsx:9, 18, 661`

The `GardenStats` type literally encodes `health: 'thriving' | 'thirsty'`
(line 9). The default is `'thriving'`. The string is interpolated:
`burhan is {s.health}` (line 661).

The banned-phrase scanner has a regex for "burhan is thirsty"
(`tools/banned-phrases.cjs:60`). But because the string is composed
at runtime, the scanner sees `burhan is ` and `{s.health}` separately
— never the full phrase. So the scanner is clean, but the rendered
DOM the user reads is one state-flip away from "burhan is thirsty"
— a banned engagement push pattern.

Same problem with the `water 72%` bar: it visually communicates a
fillable / depletable state.

**Why it matters:** "Burhan never decays" is one of the 10
constitutional rules. The scanner enforces strings, not state
machines. The current code passes scanner; the UX implies decay; the
type system encodes decay. If a junior contributor ever writes
`if (water < 0.3) setHealth('thirsty')`, the constitutional rule
silently breaks and the scanner won't notice.

**Fix:** delete the `'thirsty'` arm of the union. Delete the water
bar (or rename to "elements grown this month"). Make the type system
incapable of expressing decay. Right now it's an opt-in foot-gun.

### NH9 · `droop` parameter on BurhanTree is a decay primitive — `apps/web/src/components/BurhanTree.tsx:18, 129, 513`

```ts
droop?: number;  // 0–100
const desat = Math.min(Math.max(droop, 0) / 100, 1);
...
filter: `saturate(${1 - desat * 0.4}) brightness(${1 - desat * 0.12})`,
```

No caller passes `droop`. The default is 0. But the primitive is
live in code, ready to be wired to anything. Same constitutional
risk as NH8 — a hidden gun pointed at the principle.

**Fix:** delete the `droop` prop and `desat` derivation. The
constitutional rule wants the **primitive** absent, not just
default-off.

### NH10 · 90+ registered events have no production emit site — `packages/events/src/registry.ts`

The full list (script-derived):

```
admin:activation_classified · admin:reflect_upcoming · app:reduce_motion_mode_on
astrology:transit_change · auth:decryption_failed · body:doctor_visit_completed
body:fatigue_warning_surfaced · body:hydration_drop_detected · body:suggest_rest_check
braindump:routed · braindump:routing_failed
burhan:add_* (5 manual add events)
consumption:* (8 events — entire B2B brand-detection foundation)
cycle:luteal_phase_entered · void:cycle:asks_changed · void:cycle:closed
void:cycle:started · void:cycle:symptom_logged · void:dump:receipt
void:episode:* (4) · finance:reminder_set · finance:spending_caution_surfaced
finance:spending_spike_detected · finance:surface_cycle_spending_card
goals:* (19) · habits:* (most of 14) · notifications:suppressed
pets:* (9 of 12) · sleep:pacing_breach_detected · sleep:short_sleep_run_detected
void:braindump:submitted · void:inventory:refill · void:inventory:updated
void:reminder:cancelled · void:reminder:dismissed · void:reminder:scheduled
void:signals:updated · work:hyperfocus_detected
work:suggest_break · work:suggest_pause_marked_missed
```

That's a lot. Some are by-design (e.g. `consumption:*` is foundation
code; `void:episode:*` is older shape). But many are referenced as
sources for cross-module rules (NC2), or as targets the burhan
orchestrator listens for (NC3). The registry has become an aspiration
list, not a contract.

**Why it matters:** the registry's job is to make event-driven flows
traceable. Right now `grep emit` and `grep registry` give different
answers. New contributors can't tell which events are real.

**Fix:** add a CI check: every entry in `REGISTRY` must have at least
one production `emit('<name>', ...)` site OR be marked
`// foundation: not yet emitted` so the intent is explicit. Today,
the only way to know is to grep.

### NH11 · Web push permission requested lazily means scheduled web pushes never fire — `packages/notifications/src/backends/web.ts:71-74`

Audit 1 H1 surfaced this. Adding teeth: the savings-digest scheduler
(`apps/web/src/lib/savings-digest.ts:99`) calls
`notify({ schedule_at, category: 'PATTERN_ALERT' })` at app boot
(via `installSavingsDigestLoop()` in main.tsx:14). The web backend's
`schedule` (web.ts:76) sets a `setTimeout` — fine — but the timer's
fire calls `show(spec)` which calls `Notif.permission !== 'granted'`
returning undefined. Permission is requested lazily inside `deliver`,
not `schedule`. The fire-time path goes through `show`, not
`deliver`.

So: on web, scheduled notifications fire at the right time, find no
permission, silently no-op. The user never sees the savings digest.
The opt-in toggle (`shared.settings.notify_savings_digest`) doesn't
do what the user expects.

**Why it matters:** F2 (Sprint 2.5) "savings monthly digest" is the
proof-of-value for the free→paid conversion narrative. On web, it
never shows up.

**Fix:** on web, the only path that works is: ask permission inside
a click handler before any scheduling happens. Add an explicit "turn
on monthly digest" UI that calls `Notif.requestPermission()` first.
Don't auto-schedule on boot.

### NH12 · MicButton's hotkey + voice path has no test of the transcript reaching the dissection router — `apps/web/src/components/MicButton.tsx`, `apps/web/src/lib/voice-capture.ts`

Sprint 4 E2 said: *"Mounted globally in App.tsx. Pipes transcript →
useApplyBrainDump() → existing dissection router."* The wiring exists
(MicButton receives `onTranscript={text => void apply(text)}` from
App.tsx:319 where `apply = useApplyBrainDump()`).

But: no test in `apps/web/src/hooks/useApplyBrainDump.test.ts`
verifies a voice-captured string actually reaches `applyRoute()`. No
end-to-end harness asserts mic-input → reminder-row appears.
`tests/voice-capture` doesn't exist. The path is structurally
plausible but unverified.

Sprint 4 "Done when: Tap mic, say 'rent is due friday', ollie creates
admin reminder for friday" — no test exists for any of: speech
recognition firing, transcript routing, reminder created.

**Why it matters:** voice is the brain-dump-without-typing flagship.
If `voice-capture.ts:webkitSpeechRecognition` behaves differently
from `useApplyBrainDump`'s expected input shape, the bug surface is
silent: the user speaks, nothing happens. There's no failing test to
catch a regression in the chain.

**Fix:** add an integration test that fakes a transcript event and
asserts the brain-dump pipeline produces the expected store write.
Vitest + jsdom can do this — `useApplyBrainDump.test.ts` is already
set up.

---

## 4. MEDIUM

Code-quality drift, dead code, unconsumed derived state.

### NM1 · Allowlist for "haven't logged bed in a while" prompt — `packages/logic/src/prompts/index.ts:72`

The string `"haven't logged bed in a while. anything to say?"` triggers
the global `havent-x` banned-phrase regex
(`tools/banned-phrases.cjs:54`). It's allowlisted with
`// notif-scope-allow — in-app prompt suggestion, not a push. Factual.`

But: (a) the entire prompts module isn't imported anywhere in
apps/web — it's dead code today (`grep '@ollie/logic/prompts' apps`
returns 0). (b) Even if it were used, the framing IS engagement-shaped
("haven't X" → friction → engagement loop). The allowlist comment
says "factual" — but factual doesn't excuse engagement framing. The
scanner exists to enforce voice; the allowlist erodes that.

**Fix:** delete the prompts module (it's unused), or rewrite the
copy to genuinely factual ("last sleep log: 3 days ago"). Don't
allowlist banned framing.

### NM2 · `DEFAULT_MODULES` in sync still missing `medication` — `packages/sync/src/index.ts:73`

Audit 1 M10 flagged this. Re-confirmed: medication is not in the
sync module list. If sync ever boots (Audit 1 C2), medication data
syncs to nowhere. Sprint 4 added medication; Sprint 4 forgot to add
it to sync.

### NM3 · `_eventLineage` debug surface still missing — `packages/router/src/cross-module.ts:62`

Audit 1 M5 flagged. Re-confirmed. Plus: since NC2 means nothing
emits the source events anyway, the lineage array would always be
empty even if a debug surface existed.

### NM4 · Two `ChipFlyHost` mount points — `apps/web/src/App.tsx:78, 316`

Both render to the same body portal. Only one is reached per render
path (early-return on onboarding), so it works. But it's a fragile
pattern — a contributor moving the early-return could end up with
two hosts mounted simultaneously.

### NM5 · BrainDumpInput doesn't capture origin rect — `apps/web/src/components/BrainDumpInput.tsx:5`

Sprint 0 admitted "ChipFly source rect ... sometimes null, falls
back to viewport center. Minor polish." Still true: `onSubmit:
(text: string) => void` has no rect parameter. Sprint 0's #3 known
gap is not fixed.

### NM6 · Sky video selector always picks by hour, never overcast — `apps/web/src/lib/skyVideo.ts:42`

`overcast` arg defaults undefined. No caller passes it true. The
overcast video (`sky-overcast.mp4`, 3.9 MB) ships in `apps/web/public/`
but never plays. ~4 MB of dead-cached asset.

### NM7 · `_research_device_id` stored in shared store unencrypted — `packages/research-stream/src/index.ts:114`

Audit 1 L2 noted this is by design (opt-in research). True. Adding:
since GardenConsentScreen bypasses `grantConsent()` (NC5), the
`device_id` is created lazily on first `track()` call only — but
since `track()` isn't called anywhere in apps/web (Audit 1 C2), no
device_id is generated. Means a user could opt in via garden, never
have a device_id created, and the opt-in is functionally a no-op.

### NM8 · `installSavingsDigestLoop` runs even though notify isn't permitted — `apps/web/src/main.tsx:14`

main.tsx:13-15 boots notifications then immediately
installSavingsDigestLoop. The digest is for a future date, so
`backend.schedule` is called. On web, that runs `setTimeout` for ~30
days. The user's tab probably won't be open for 30 days.
`scheduleInProcessTimer` in the dispatcher (index.ts:164) covers
this — it persists to `shared._notification_scheduled` so on boot
it can re-schedule expired ones via `resumeScheduled()` (line 145).
Good.

BUT: `resumeScheduled` calls `deliverImmediate` for expired ones,
which on web goes through `web.ts:71 deliver()` → permission check →
silently noop if denied. So digests "fire" but the user sees
nothing. (Same root as NH11.) Not a bug, but means the savings
digest path is effectively dead on web until permission UX is built.

### NM9 · Onboarding writes are scattered across schemas — `apps/web/src/pages/OnboardingScreen.tsx:158-188`

```ts
store.set('shared', 'name', ...);
store.set('shared', 'has_pets', ...);
store.set('shared', 'work_time', ...);
store.set('shared', 'cycle_tracking', ...);
store.set('shared', 'onboarded', true);
store.set('shared', 'consent_spending_research', ...);
store.set('shared', 'consent_cycle', ...);
store.set('pets', 'pets', ...);
store.set('grocery', 'pantry', ...);
store.set('finance', 'subscriptions', ...);
```

Mostly flat at top of `shared`. The rest of the app uses dotted
namespaces (`settings.has_pets`, `consent.spending_research`). See
NC4. Beyond NC4: also `work_time`, `cycle_tracking`, `name` etc. —
each potentially read by some module at a different keypath. Audit
not exhaustive on these, but the pattern is everywhere.

### NM10 · `tools/banned-phrases.cjs` regex doesn't catch composed strings — `tools/banned-phrases.cjs`

Audit limitation, not a bug per se: the scanner reads string literals
only. `burhan is {s.health}` evaluates at runtime to "burhan is
thirsty" — but the scanner never sees the composed form. Same for
any state-machine that builds copy from variables.

The scanner did catch a canary string. It will not catch dynamic
copy that interpolates banned tokens. Means voice protection has a
known blind spot.

**Fix:** add a manual checklist for new UI strings that interpolate
state values — every contributor must enumerate the possible runtime
strings and add literal copies of each to a `__scanner_canary` file.
Or: build a dynamic check (much harder).

### NM11 · Two reminder scheduler instances — Audit 1 H4 unfixed — `apps/web/src/store.ts:115` + `apps/web/src/hooks/useApplyBrainDump.ts:24`

Still two `createReminderScheduler` instances. The second one's
schedule isn't observable by the first. Cancel events emitted by
one don't affect the other's timers.

---

## 5. LOW

Naming, comments, polish.

- **NL1** Audio files all exactly 960932 bytes
  (`apps/web/public/audio/*.mp3`) — different content, different MD5,
  identical size. Probably a generator script padding to a fixed
  length. Cosmetic, no impact.
- **NL2** `SleepSoundPlayer.tsx:5` docstring says "All assets are CC0
  synthetic loops generated via Python + ffmpeg." `SOURCING.md` says
  rain/ocean/fire are CC0 freesound. Doc/manifest drift; pick one
  story.
- **NL3** `MicButton.tsx:97` uses 🎙 and ■ emoji directly in the
  button. The design system bans emoji in user-facing copy except
  where genuine. A mic button glyph is borderline; for consistency
  pick an SVG.
- **NL4** Sprint summary tallies are wrong:
  Sprint 4 says "1079 vitest + 21 scanner = 1100 checks" — Audit 1
  ran them and got 1067 passing / 2 failing. Sprint 4 also says
  "vitest 1066 → 1079, +13" but the breakdown only adds 13 from
  medication; the actual sync timing tests (which Sprint 4 claims
  "deflaked") regressed. Tally credibility is shaky.
- **NL5** Two `ChipFlyHost` mounts — see NM4.
- **NL6** STATUS_CHECK_2026-05-11.md is partly stale (Audit 1 H8); now
  also more stale because Sprint 4 changed test counts and Sprint 4
  isn't reflected in the status doc.
- **NL7** Astrology is hidden behind `?astrology=1` but the orchestrator
  inside `apps/web/src/store.ts` boots it eagerly if `astrology.birth`
  is set — meaning a user who set up astrology before it was hidden
  still pays the load cost on every page load (`astronomy-engine` is
  ~22 KB gz lazy chunk). Cheap fix: only boot when the URL flag is
  present.

---

## 6. The pattern

Three patterns repeat. Each one is a way of believing "I shipped this"
when the user hasn't actually received it.

### Pattern A · Data flows; the user can't see it

The orchestrator computes the value, writes it to the store, fires
the event. The UI is never wired. The sprint summary marks the
acceptance criterion green because the data exists. Examples: NC1
(Burhan life events), NH4/NH5 (orchestrator derived writes), NH2
(dashboard stats), NH3 (time tracker), NC2 (cross-module router
reflect targets).

This pattern shows up because the orchestrator code is the harder /
more architectural part; the UI wiring is "just one line in the
right place." So when budget runs out, the UI line is the thing that
gets deferred — and the sprint summary describes the orchestrator
work as if the UI line were there.

### Pattern B · Wires exist; the source/sink doesn't

The router rule is defined, the orchestrator listens. The source
event is never emitted. Or: the event is emitted but no listener
exists. Examples: NC2 (chains never fire), NC3 (doctor visit + admin
appointment events), NH10 (90+ registered-but-never-emitted events),
NM2 (medication missing from sync DEFAULT_MODULES).

This pattern is more insidious because grep alone won't catch it —
the code looks rich (registry entries, rule lists, orchestrator
subscriptions). You have to trace **both sides** of every wire.

### Pattern C · Constitutional rule passes the textual scanner but not the structural one

The banned-phrase scanner checks string literals. The constitutional
rules are about structure (no decay, no engagement framing, no
streaks). Examples: NH8 ('thirsty' as a type-system state), NH9
(droop parameter as a decay primitive), NM10 (composed strings the
scanner can't see), NM1 (allowlisting "haven't X" framing because
"factual" — voice rules are stricter than that).

This pattern surfaces because the scanner is the only enforcement we
have. The reviewer / writer reads "scanner is green" as "rules are
honored." The rules are stricter than the tool measures.

### What ties them together

The credibility failure mode is **summary-by-grep**: "did I write the
words 'finance:subscription_cancelled' anywhere? yes → shipped." The
actual question — "would a user, opening the app today, see / hear /
feel the new thing?" — is several steps further away and harder to
verify than `grep`.

Every "shipped" claim should be tested against this question, not
against "code exists + tests pass".

---

## 7. What to put in place to prevent this

Specific guardrails. Not "be more careful." Concrete process /
tooling additions.

### G1 · A `done-when` integration test for every Sprint acceptance criterion

For every line in a sprint summary that says "Done when X happens",
write a test in `apps/web/src/__e2e__/` (new folder) that **actually
simulates the user action and asserts the user-visible result**.
Not a unit test of the orchestrator's emit. Not a logic test of the
detector. A test that:

1. Renders the relevant React component.
2. Simulates the user action (click, type, etc.) via Testing
   Library.
3. Asserts the UI shows the promised effect.

For NC1 (Burhan + period): a test that mounts DashboardScreen,
seeds a period log, and asserts a flower SVG appears.

This is more expensive than current tests. But it's the only kind
that catches Pattern A.

CI rule: a sprint summary's "Done when" cannot be marked green
without a matching e2e test. The test name should literally be the
"done when" copy.

### G2 · Registry-emit-listener triple-grep check

A new pre-commit script (or `tools/check-events.cjs`):

For every entry in `REGISTRY`:
- If listed in `CROSS_MODULE_RULES.source` → require at least one
  production `emit('<name>'` site.
- If `emit` exists → require at least one production `events.on('<name>',`
  listener.
- If neither → require an explicit `// foundation` comment on the
  registry entry.

Fail CI on any violation. This catches Pattern B.

### G3 · Structural decay-grep

Extend `tools/banned-phrases.cjs` with a structural check:

```js
SCOPED_BANS.burhan = [
  ...,
  { id: 'decay-type', re: /'(thirsty|wilting|dying|hungry|missing|sad)'\s*[|}]/, scope: 'tsx/ts' },
  { id: 'decay-prop', re: /\b(droop|wilt|decay|wither|fade)\s*:\s*number/i, scope: 'tsx/ts' },
];
```

For Sprint 4 / NH8 / NH9, this would have flagged the `'thirsty'`
state and the `droop` prop. Catches Pattern C-structural.

### G4 · Composed-string canary file

For every UI surface that interpolates state into copy, the author
must add a `__scanner_canaries.ts` file in the module:

```ts
// File exists only to give the banned-phrase scanner real strings
// to grep. Not imported anywhere.
const _canaries = [
  'burhan is thirsty',
  'burhan is thriving',
  'burhan is hungry',
  // ... every possible interpolation
];
```

The scanner reads these literally and catches banned phrases. The
author is forced to enumerate the runtime strings. Catches Pattern
C-composed.

### G5 · "Reachability" report per sprint

At the end of every sprint, run a script that walks the diff and
classifies every new file:

- "User-reachable" = there's a chain from user action / page render
  / API call to this code.
- "Tested in isolation only" = unit tests exist but no e2e.
- "Orphaned" = imported by nothing.

The sprint summary publishes the count of each. Sprint 4's report
today would say:
- User-reachable: medication module, mic button, garden consent
  screen
- Tested-in-isolation: cross-module chain rules (no emitter),
  research-stream, auth, sync, backup
- Orphaned: `@ollie/research-stream`, `@ollie/auth`, `@ollie/sync`,
  `@ollie/backup`

That's the truth. Don't write the celebratory version on top of it.

### G6 · One canonical store schema

A single TypeScript file `packages/store/src/schema.ts` that declares,
typed, every namespaced store key for every module. Every read and
write must reference this schema. Type system rejects
`store.set('shared', 'consent_spending_research', ...)` when the
schema says `'shared.consent.spending_research'`. Catches NC4 and
NM9 at compile time.

Tedious to set up; eliminates an entire class of silent drift bugs.

### G7 · Strip sprint-summary celebration verbs

Ban these in sprint summaries: "shipped", "complete", "all green",
"production ready", "wired end-to-end". Replace with: "code merged",
"tests pass", "boot path includes the module", "no user-facing
surface yet".

A sprint summary's job is to give Serra ground truth, not morale.
Write summaries that another engineer could use to pick up where you
left off — not summaries that congratulate. The format above (G5)
makes this enforceable.

### G8 · An explicit `KNOWN_NOT_YET_USER_VISIBLE.md` per sprint

For every package or feature that exists but isn't visible to the
user yet, add a row. Sprint 2 should have had:

```
| Package | Why not user-visible | What user-visible step is missing |
|---|---|---|
| @ollie/auth | no UI imports it | sign-up screen + boot wiring |
| @ollie/sync | no UI imports it | account-boot.ts |
| @ollie/backup | no UI imports it | settings "export data" button |
```

If this doc exists, Serra reads it next to the celebration summary
and asks the right follow-up question. Without it, she trusts the
summary.

---

## Bottom line

Audit 1 found 3 lies. This audit finds the same pattern repeated about
15 more times. The packages are real. The code typechecks. The tests
pass (with 2 exceptions). The user doesn't experience most of what's
been "shipped" since Sprint 1.

The honest one-sentence ollie status:

> ollie is approximately Sprint 0 + 80% of Sprint 1 in user-facing
> terms; everything from Sprint 2 forward is real code that lives in
> the repository but isn't reachable from the dashboard. The
> credibility leak is the disconnect between "the package exists" and
> "the user can use it."

Fix the orphaned packages (Audit 1 C2), wire the Burhan life-event
overlay (NC1), kill the dead cross-module chains or wire their
emitters (NC2), align the onboarding/dashboard keys (NC4), and the
ratio rebalances dramatically. Until then: assume any sprint summary
older than this audit overstates user impact by roughly 2×.
