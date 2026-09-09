/**
 * Global daily AI-spend ceiling (audit H2).
 *
 * Per-user rate limits (rate-limit.ts) bound ONE account, but they do nothing
 * against signup-abuse: many scripted accounts, each under the per-user cap,
 * can still collectively drain the AI budget. This is a coarse circuit-breaker
 * that counts expensive AI calls account-wide per day and refuses once a
 * configurable ceiling is hit.
 *
 * Storage: a per-day KV counter, env-scoped so staging can't consume prod's
 * budget (matches the H4 cache-key scoping). The read-then-write is racy, but
 * a safety ceiling only needs to be approximate.
 *
 * Failure mode: FAIL-OPEN. A transient KV error must not take down every AI
 * path — the per-user limits + model/token caps still apply. We log nothing
 * here; the caller decides.
 */

/** Default daily ceiling when GLOBAL_DAILY_AI_MAX is unset. Generous vs real
 *  usage (a few dozen calls/active user/day) but far below "drain the key". */
export const GLOBAL_DAILY_AI_MAX_DEFAULT = 20_000;

interface BudgetEnv {
  ENVIRONMENT?: string;
  GLOBAL_DAILY_AI_MAX?: string;
}

/** UTC day stamp (YYYY-MM-DD) for the counter key. */
function dayStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Returns true if the call is within the global daily budget (and records it),
 * false if the ceiling is already reached. Fail-open on any KV error.
 */
export async function checkGlobalBudget(
  kv: KVNamespace,
  env: BudgetEnv,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const max = Number(env.GLOBAL_DAILY_AI_MAX) || GLOBAL_DAILY_AI_MAX_DEFAULT;
  const key = `budget:global:ai:${env.ENVIRONMENT ?? 'dev'}:${dayStamp(nowMs)}`;
  try {
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    if (count >= max) return false;
    // 48h TTL: comfortably outlasts the UTC day without unbounded growth.
    await kv.put(key, String(count + 1), { expirationTtl: 60 * 60 * 48 });
    return true;
  } catch {
    return true; // fail-open — per-user caps + model/token caps remain in force
  }
}
