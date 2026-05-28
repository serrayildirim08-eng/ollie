/**
 * @ollie/logic · work · matter (Phase 1 — the matter container)
 *
 * A `Matter` is a profession-agnostic container for one ongoing body of
 * work — a legal case, a web project, a freelance client. Phase 1 builds
 * ONLY the data model + pure helpers; there is no AI here and there are
 * no manual create/file actions (manual filing contradicts the vision —
 * the user never files; Phase 2 routing populates matters automatically).
 *
 * Spec: design/clean-slate-2026-05-18-v2/WORK-VISION.md
 *   - Matter data model "locked 2026-05-18"
 *   - Phase 1 "The matter container (no AI, ~$0)"
 *
 * SCOPE BOUNDARY (locked):
 *   - tasks / people / dates / documents are FUTURE fields populated by
 *     Phase 3 AI extraction. They are intentionally NOT modelled here.
 *   - The 6-field secretary briefing is a Phase 3 DERIVED view, never a
 *     stored field — not modelled here.
 *
 * Everything in this file is pure: inputs → outputs, no I/O, no DOM, no
 * wall-clock reads (time is always a parameter).
 */

// ─── Matter ───────────────────────────────────────────────────────────

/**
 * How a dump came to be attached to a matter. Phase 2 routing writes
 * this; the UI uses it to decide whether a one-tap "correct" affordance
 * is shown.
 *   - `clear`  — deterministic name/alias match. Filed silently.
 *   - `guess`  — weak/fuzzy match. Filed but visibly MARKED; one-tap to
 *                correct or detach.
 *   - `manual` — reserved for a future user-confirmed correction path
 *                (Phase 2 UI). Never produced by routing itself.
 */
export type MatterLinkOrigin = 'clear' | 'guess' | 'manual';

/**
 * A reference from a matter to one routed dump. The dump's raw text
 * lives in its source slice (dump.items / work_records / …) — a matter
 * stores only the pointer + routing provenance, never a copy of text.
 */
export interface MatterDumpRef {
  /** id of the source dump row (e.g. dump.items[].id). */
  dump_id: string;
  /** store slice the dump row lives in, e.g. "dump" or "work". */
  source_slice: string;
  /** how this dump was attached — drives the UI "correct" affordance. */
  origin: MatterLinkOrigin;
  /** ms timestamp the dump was routed into this matter. */
  routed_at: number;
  /**
   * 0..1 routing score. 1 for a clear match; the fuzzy score for a
   * guess. Present for guesses so the UI can rank uncertainty.
   */
  score?: number;
}

/** Lifecycle status of a matter. */
export type MatterStatus = 'active' | 'archived';

/**
 * A matter — the universal container. Phase-1 shape only.
 *
 * `tasks`, `people`, `dates`, `documents` and the secretary briefing are
 * deliberately ABSENT — see the scope boundary above.
 */
export interface Matter {
  /** Stable unique id. */
  id: string;
  /** Primary human name, e.g. "Yılmaz E-2". */
  name: string;
  /**
   * Alternative names this matter gets dumped as ("yılmaz dosyası",
   * "the yilmaz thing"). Drives Phase 2 routing. May be empty.
   */
  aliases: string[];
  /**
   * The matter's category ("E-2 case", "web project", "logo client").
   * Type is what enables Phase 4 recurring-shape learning; in Phase 1 it
   * is a free string and may be empty. Profession-agnostic — no
   * profession-specific enum is baked into the container.
   */
  type: string;
  /** Lifecycle status. */
  status: MatterStatus;
  /** ms timestamp the matter was created. */
  created_at: number;
  /**
   * References to the dumps routed into this matter. Empty until Phase 2
   * routing runs. Order: oldest-routed first.
   */
  dumps: MatterDumpRef[];
}

// ─── Construction ─────────────────────────────────────────────────────

export interface CreateMatterInput {
  id: string;
  name: string;
  aliases?: string[];
  type?: string;
  created_at: number;
  status?: MatterStatus;
}

/**
 * Build a fully-formed Matter with normalised defaults. Pure — `id` and
 * `created_at` are caller-supplied (no wall-clock / id generation here).
 *
 * Normalisation: name is trimmed; aliases are trimmed, lower-cased,
 * de-duplicated, and any alias equal to the (lower-cased) name is
 * dropped so the name is never also listed as its own alias.
 */
export function createMatter(input: CreateMatterInput): Matter {
  const name = input.name.trim();
  const nameKey = name.toLowerCase();
  const aliases = normalizeAliases(input.aliases ?? [], nameKey);
  return {
    id: input.id,
    name,
    aliases,
    type: (input.type ?? '').trim(),
    status: input.status ?? 'active',
    created_at: input.created_at,
    dumps: [],
  };
}

/**
 * Trim + lower-case + de-dupe a list of aliases, dropping blanks and any
 * alias identical to `excludeKey` (the matter's own name key).
 */
export function normalizeAliases(aliases: string[], excludeKey?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    if (typeof raw !== 'string') continue;
    const key = raw.trim().toLowerCase();
    if (key.length === 0) continue;
    if (excludeKey && key === excludeKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// ─── Pure helpers ─────────────────────────────────────────────────────

/** All lookup keys for a matter: its name + every alias, lower-cased. */
export function matterKeys(matter: Matter): string[] {
  const keys = new Set<string>([matter.name.trim().toLowerCase()]);
  for (const a of matter.aliases) {
    const key = a.trim().toLowerCase();
    if (key.length > 0) keys.add(key);
  }
  return [...keys];
}

/**
 * Append a dump reference to a matter without mutating the input.
 * Idempotent on `dump_id`: if the dump is already referenced the matter
 * is returned unchanged. Returns a NEW Matter object.
 */
export function attachDumpRef(matter: Matter, ref: MatterDumpRef): Matter {
  if (matter.dumps.some((d) => d.dump_id === ref.dump_id)) return matter;
  return { ...matter, dumps: [...matter.dumps, ref] };
}

/**
 * Remove a dump reference from a matter (used by the Phase 2 one-tap
 * "correct" path). Returns a NEW Matter; unchanged if the id is absent.
 */
export function detachDumpRef(matter: Matter, dumpId: string): Matter {
  if (!matter.dumps.some((d) => d.dump_id === dumpId)) return matter;
  return { ...matter, dumps: matter.dumps.filter((d) => d.dump_id !== dumpId) };
}

/** Count of dumps attached to a matter. */
export function matterDumpCount(matter: Matter): number {
  return matter.dumps.length;
}

/**
 * Type-guard for a stored value being a Phase-1 Matter. Defensive —
 * persisted store data may predate the schema.
 */
export function isMatter(value: unknown): value is Matter {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.name === 'string' &&
    Array.isArray(m.aliases) &&
    typeof m.type === 'string' &&
    (m.status === 'active' || m.status === 'archived') &&
    typeof m.created_at === 'number' &&
    Array.isArray(m.dumps)
  );
}
