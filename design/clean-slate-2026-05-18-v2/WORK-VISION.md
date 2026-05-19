# Ollie — Work Module Vision: Matters & the Secretary Briefing

*Handoff brief — the intent behind Ollie's "work" module, written so it can be
passed to the machine-learning side.*

## The user & the problem

The primary user is an ADHD professional (design case: a lawyer). Their work
information is chronically **scattered**. They capture by *dumping* — fast,
messy, partial brain-dumps — and never file or organize. Context for any one
case is spread across dozens of dumps over weeks. Reconstructing "where does
this stand" is itself an executive-function tax the user cannot reliably pay.

## The concept: matters

A **matter** is a container for one ongoing body of work — for a lawyer a case,
for an engineer a project, for a freelancer a client. The container is
*universal*; only its contents differ by domain.

1. The user dumps freely — no need to say which matter, no need to file.
2. Ollie **detects** which matter a dump belongs to and files it automatically.
3. Ollie **learns new matters**: when a name/identifier recurs across dumps,
   Ollie asks "is this a matter?" — **auto-detect, user-confirm**. The user
   never builds a matter from a blank form; they confirm what Ollie noticed.
4. Opening a matter gives a **secretary's briefing**, not a pile of raw dumps.

## The matter view = the secretary briefing

Opening a matter hands the user the file the way a good secretary would:

- **What it is** — one line, what this matter is.
- **Where it stands** — one line, the current situation.
- **Latest** — the most recent activity / movement.
- **Done** — what has been completed.
- **Missing / open** — what is incomplete.
- **Next** — what needs to be done.

The user must NOT reconstruct this themselves. The entire value is that Ollie
reconstructs it from the accumulated scatter.

## The hard part — why it needs ML

The user *could* explicitly dump "I still need X, Y is missing." But that is
exactly what an ADHD user will **not** reliably do. The value of the system is
**inferring the structure the user never stated**. Requiring them to spell it
out defeats the purpose.

The intelligence layer has four jobs:

1. **Matter detection & linking** — given a free-text dump, decide which
   existing matter it belongs to (entity recognition — case/client names,
   identifiers, aliases, fuzzy matching); and detect when a new recurring
   entity should be proposed as a matter.

2. **Information extraction** — from messy free text, pull structured items:
   tasks (+ done/open state), dates/deadlines, people, status signals.

3. **Briefing synthesis** — summarize a matter's full dump history into the six
   briefing fields above (what it is · where it stands · latest · done ·
   missing · next).

4. **Recurring-shape learning** — *the deep capability.* Ollie learns the
   typical **shape of a matter *type***. Across many matters of the same kind
   (e.g. many E-2 visa cases) the same stages, tasks and document types recur.
   Ollie learns that template from the user's own history, then uses it to
   **infer what is missing** in any individual matter: "matters like this
   usually have a signed lease by this stage — this one doesn't." This is how
   the *missing* field gets populated **without the user spelling it out** — it
   comes from the learned shape, not from an explicit dump.

## The key principle — state this to the ML side

> The user captures incompletely and messily *on purpose* — that incompleteness
> is the disability being designed around. The system's core job is to **infer
> the structure the user did not state**: which matter a dump belongs to, what
> the tasks/dates/people are, what is done, and — hardest — what is **missing**,
> by comparing each matter against the **learned recurring shape of its type**.

## Scope boundary

This module's job is **capture → organization → status inference**. It is NOT
legal drafting or domain advice. Ollie reports where a matter stands *based on
what the user has told it*; it does not independently know external/legal
requirements. "Missing" is inferred from the learned shape of the user's *own
past matters*, never from an outside rulebook.

---

## Matter data model (locked 2026-05-18)

A matter is a **profession-agnostic generic container**. The box is identical
for a lawyer, an engineer, a freelancer — nothing profession-specific is baked
into it. A matter holds:

- **identity** — a primary name + the aliases it gets dumped as ("Yılmaz E-2",
  "yılmaz dosyası", "the yilmaz thing")
- **type** — the matter's category ("E-2 case", "web project", "logo client").
  Type is what enables recurring-shape learning (ML job #4).
- **dumps** — the raw scattered notes routed into it
- **tasks** — to-dos
- **people** — who's involved
- **dates** — key dates / deadlines
- **documents** — files / artifacts referenced
- **status** — where it stands

**Universality principle:** profession-specificity is NOT coded into the
container. It emerges from the **learned per-type template** — Ollie never
needs to know "what a legal case is"; it just learns that matters tagged a
given type tend to contain certain tasks/docs. One design, every profession,
zero per-profession code.

The 6-field secretary briefing (what / where-it-left-off / last-move / done /
missing / next) is a **derived view** computed by Ollie, not stored fields.

*Naming note:* "matter" is legal jargon — the user-facing label may need a more
universal word, or be user-nameable. Deferred.

## LLM approach (locked 2026-05-18)

The 4 ML jobs are mostly **LLM tasks** (matter detection, extraction, briefing
synthesis are language work), not on-device statistics. Job #4 (recurring-shape
learning) is the exception: lightweight frequency-mining over structured matter
records + LLM for semantic gap-comparison — NOT a trained-from-scratch model.

- **Now:** use the hosted Claude API (existing ai-proxy worker). Ship fast.
- **Later:** if cost / privacy / independence demands it, self-host or
  fine-tune an open-weight model. The opt-in B2B research corpus is the fuel
  that makes future fine-tuning possible.
- Building a frontier LLM from scratch is out of scope (lab-scale, millions).

## Build roadmap (drafted 2026-05-18)

Forced order — the matter must exist before anything intelligent can attach to
it. Each phase ships standalone user value; cost discipline is baked in.

**Phase 1 — The matter container (no AI, ~$0).**
Build the matter data model (identity+aliases · type · dumps · tasks · people ·
dates · documents · status) + the two display screens (matter list, matter
detail) as PASSIVE views. **No manual create/file actions** — manual filing
contradicts the vision ("the user never files"). Matters stay empty until
Phase 2's routing populates them automatically. Phase 1 is invisible
foundation; real user value begins at Phase 2 — so Phases 1 and 2 ship as a
back-to-back pair. All UI chrome is English (user-written note content stays
in whatever language the user wrote it).

**Phase 2 — Routing: dump → matter (cheap-first, ~$0).**
Auto-file each dump into a matter. Free deterministic layer first — name /
fuzzy match does the bulk; AI fallback only for genuinely ambiguous dumps,
batched (not per-dump). ML job #1, done cheap. The user never files.
Three outcomes (locked 2026-05-18):
1. **Clear match** → file silently, no user touch.
2. **Recurring unknown name** → gentle one-tap "new matter?" nudge.
3. **Unsure** → blend: if Ollie has a hunch, file it as a *marked guess*
   (visible inside the matter, one-tap to correct); if genuinely clueless,
   hold it in a quiet "loose / unsorted" area — a low-emphasis row at the
   foot of the matter list — that self-drains as later dumps clarify.
   Routing NEVER interrupts the user mid-dump to ask.
Value: dumps self-organize — the user never files.

**Phase 3 — Extraction + secretary briefing (AI, cost-controlled).**
ML jobs #2 (extract tasks/dates/people/status from messy text) and #3 (the
6-field briefing). Cost discipline: extract once per dump and cache; build the
briefing lazily (only on matter-open) + cache + incremental re-synthesis; cheap
model for extraction, premium model only for the briefing prose and rarely;
prompt caching on the worker. Value: open a matter → the secretary briefing.
Matter detail screen (locked 2026-05-19): the briefing sits on top (6 fields —
what / left off at / last move / done / pending / next); raw notes sit below
it as a secondary list. Open a matter → you see "where I left off" instantly.
No separate checkable task list — the briefing's "next" field carries the
single next action (one focus, not an overwhelming list). Briefing + raw
notes is the entire matter screen.

**Phase 4 — Recurring-shape learning (mostly free).**
ML job #4. Mine the per-type template by counting structure across the user's
own past matters of that type (free, local arithmetic). Compare a live matter
to its template to infer template gaps (template-compare + a little AI for
semantic matching).

Presentation (locked 2026-05-19) — anti-shame is non-negotiable here:
- NEVER framed as "missing" / a deficit. Inferred template gaps surface in the
  briefing's **"next"** field, forward-framed: "matters like this usually have
  a signed lease around now" — guidance, not an accusation.
- The **"pending"** briefing field holds only user-STATED pending items
  ("waiting on docs from X") — neutral facts, not failures.
- One item at a time, never a list. No count, no badge, no notification.
- Surfaced only when timely (the stage that item usually appears) — never
  "everything's missing" on a fresh matter.
- Dismissable — "not needed here" teaches Ollie to loosen the template.
- Always a guess from the user's OWN past matters, never an external rulebook.

### Cost principles (apply to every phase)
1. Cheapest call = the one not made — the free deterministic layer does the bulk.
2. Cheap model for routine work; premium model only for briefing prose.
3. Batch, don't per-dump — the system is not real-time.
4. Lazy + cached briefings; incremental re-synthesis, never from scratch.
5. Phase 4's learning is counting, not a trained model — ~$0.

Long-term: self-hosting an open-weight model removes per-call cost entirely —
a post-alpha move, not a blocker.
