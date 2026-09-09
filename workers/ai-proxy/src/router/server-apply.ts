/**
 * Server-apply pilot (A6b, migration step 1) — dual-write shadow mode.
 *
 * Flow (the durability fix for app-closed dumps / Siri TELL):
 *   1. writeInbox    — /route/dump encrypts each routed fragment + inserts into
 *                      dump_inbox (status=pending). Idempotent on `${dumpId}:idx`.
 *   2. applyInbox    — drains pending, applies grocery fragments into
 *                      grocery_pantry (encrypted), marks rows applied.
 *   3. pullGrocery   — device pulls grocery_pantry rows updated since a cursor.
 *
 * All payloads are envelope-encrypted (D1 + Serra: inbox is encrypted too).
 * Gated by SERVER_APPLY_ENABLED so it's pure shadow until we flip authoritative.
 */

import { envelopeEncrypt, envelopeDecrypt, type EnvelopeFields } from '../crypto/envelope';

export interface ServerApplyEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE?: string;
  ENVELOPE_KEK?: string;
  SERVER_APPLY_ENABLED?: string;
}

interface InboundFragment {
  module: string;
  payload: Record<string, unknown>;
}

function enabled(env: ServerApplyEnv): boolean {
  return (
    env.SERVER_APPLY_ENABLED === '1' &&
    !!env.SUPABASE_URL &&
    !!env.SUPABASE_SERVICE_ROLE &&
    !!env.ENVELOPE_KEK
  );
}

function rest(env: ServerApplyEnv, path: string): string {
  return `${env.SUPABASE_URL!.replace(/\/$/, '')}/rest/v1/${path}`;
}

function headers(env: ServerApplyEnv, prefer: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE!,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE!}`,
    prefer,
  };
}

/** A stable item id for a grocery pantry row, derived from user + item name. */
async function pantryItemId(userId: string, item: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${item.toLowerCase().trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Step 1 — write routed fragments into the encrypted inbox (idempotent). */
export async function writeInbox(
  env: ServerApplyEnv,
  userId: string,
  dumpId: string,
  fragments: InboundFragment[],
): Promise<void> {
  if (!enabled(env) || fragments.length === 0) return;
  const rows = await Promise.all(
    fragments.map(async (f, i) => {
      const e = await envelopeEncrypt(env.ENVELOPE_KEK!, f.payload);
      return {
        // SECURITY: namespace the row id with the JWT-derived userId. dump_inbox
        // id is the table PK and writes go through the service role (BYPASSRLS),
        // so a client-chosen dumpId alone would let one user collide with — and
        // via on_conflict=id merge, overwrite — another user's row. Prefixing
        // with the verified userId makes cross-user collision unforgeable.
        id: `${userId}:${dumpId}:${i}`,
        user_id: userId,
        routed_module: f.module,
        ...e,
        status: 'pending',
      };
    }),
  );
  // on_conflict=id + merge-duplicates → idempotent re-delivery.
  await fetch(rest(env, 'dump_inbox?on_conflict=id'), {
    method: 'POST',
    headers: headers(env, 'return=minimal,resolution=merge-duplicates'),
    body: JSON.stringify(rows),
  });
}

interface InboxRow extends EnvelopeFields {
  id: string;
  user_id: string;
  routed_module: string;
}

/** Step 2 — drain pending inbox rows → apply grocery into grocery_pantry. */
export async function applyInbox(
  env: ServerApplyEnv,
  userId: string,
): Promise<{ applied: number }> {
  if (!enabled(env)) return { applied: 0 };
  const res = await fetch(
    rest(env, `dump_inbox?user_id=eq.${encodeURIComponent(userId)}&status=eq.pending&select=*`),
    { headers: headers(env, 'return=representation') },
  );
  if (!res.ok) return { applied: 0 };
  const rows = (await res.json()) as InboxRow[];
  let applied = 0;
  for (const row of rows) {
    try {
      const payload = await envelopeDecrypt<Record<string, unknown>>(env.ENVELOPE_KEK!, row, {
        userId,
        recordId: row.id,
      });
      if (row.routed_module === 'grocery') {
        await applyGroceryFragment(env, userId, payload);
      }
      // Mark applied (other modules are no-ops in the pilot but still drain).
      await fetch(rest(env, `dump_inbox?id=eq.${encodeURIComponent(row.id)}`), {
        method: 'PATCH',
        headers: headers(env, 'return=minimal'),
        body: JSON.stringify({ status: 'applied', applied_at: new Date().toISOString() }),
      });
      applied++;
    } catch (err) {
      // Dead-letter: a row that fails to apply must be surfaced, not swallowed.
      console.warn(`[server-apply] inbox row ${row.id} failed to apply`, err);
      await fetch(rest(env, `dump_inbox?id=eq.${encodeURIComponent(row.id)}`), {
        method: 'PATCH',
        headers: headers(env, 'return=minimal'),
        body: JSON.stringify({ status: 'failed' }),
      });
    }
  }
  return { applied };
}

async function applyGroceryFragment(
  env: ServerApplyEnv,
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const action = String(payload.action ?? '');
  const item = String((payload.item ?? payload.name ?? '') as string);
  if (!item) return;
  const id = await pantryItemId(userId, item);
  const deleted = action === 'pantry_depleted' || action === 'pantry_use';
  const e = await envelopeEncrypt(env.ENVELOPE_KEK!, { ...payload, item });
  await fetch(rest(env, 'grocery_pantry?on_conflict=user_id,id'), {
    method: 'POST',
    headers: headers(env, 'return=minimal,resolution=merge-duplicates'),
    body: JSON.stringify([
      {
        id,
        user_id: userId,
        ...e,
        updated_at: new Date().toISOString(),
        device_origin: 'server-apply',
        deleted,
      },
    ]),
  });
}

export interface PantryPullRow {
  id: string;
  payload: Record<string, unknown>;
  updated_at: string;
  deleted: boolean;
}

/** Step 3 — device sync-down: grocery_pantry rows updated after `since`. */
export async function pullGroceryPantry(
  env: ServerApplyEnv,
  userId: string,
  sinceIso: string | null,
): Promise<PantryPullRow[]> {
  if (!enabled(env)) return [];
  const sinceFilter = sinceIso ? `&updated_at=gt.${encodeURIComponent(sinceIso)}` : '';
  const res = await fetch(
    rest(
      env,
      `grocery_pantry?user_id=eq.${encodeURIComponent(userId)}${sinceFilter}&order=updated_at.asc&select=*`,
    ),
    { headers: headers(env, 'return=representation') },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<EnvelopeFields & { id: string; updated_at: string; deleted: boolean }>;
  const out: PantryPullRow[] = [];
  for (const r of rows) {
    try {
      const payload = await envelopeDecrypt<Record<string, unknown>>(env.ENVELOPE_KEK!, r, {
        userId,
        recordId: r.id,
      });
      out.push({ id: r.id, payload, updated_at: r.updated_at, deleted: r.deleted });
    } catch (err) {
      // One undecryptable row must not fail the whole pull — skip + surface it.
      console.warn(`[server-apply] pantry row ${r.id} failed to decrypt; skipping`, err);
    }
  }
  return out;
}
