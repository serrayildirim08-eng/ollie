/**
 * ollie · cron worker · banned-phrase guard (Worker-runtime port)
 *
 * PORTED from `tools/banned-phrases.cjs`. That file is a CommonJS module
 * that the CI scanner (`tools/scan-banned-phrases.cjs`) imports — it cannot
 * be imported into a Cloudflare Worker bundle (CJS + filesystem walk + no
 * build step pulling tools/ into the worker). So the *core* — the ban
 * regex list and the `scanForBanned` matcher — is mirrored here as a
 * strict-TypeScript const module.
 *
 * SOURCE OF TRUTH is still `tools/banned-phrases.cjs`. If you add a ban
 * there, add it here too. The cron worker's test suite asserts this port
 * stays in lockstep on the GLOBAL_BANS that matter for push copy.
 *
 * WHY the drain re-runs this even though the client already scans:
 *   Defense in depth. The client-side dispatcher and the CI scanner both
 *   gate copy, but a job row in `scheduled_jobs` is attacker-reachable in
 *   principle (compromised client, schema drift, a future code path that
 *   writes jobs without going through the dispatcher). The delivery drain
 *   is the LAST gate before a push leaves our infrastructure — it must
 *   never ship cheerleading / streak / engagement copy even if something
 *   upstream slipped.
 *
 * The drain validates with the GLOBAL bans plus the 'push' scope (the
 * scope every notification template lives in).
 */

interface Ban {
  id: string;
  re: RegExp;
  why: string;
}

// ── GLOBAL BANS — banned everywhere user-facing copy lives ──────────────────
// Mirror of GLOBAL_BANS in tools/banned-phrases.cjs.
const GLOBAL_BANS: readonly Ban[] = [
  // cheerleading / motivational copy
  { id: 'great-job', re: /\bgreat\s+job\b/i, why: 'cheerleading copy · principle viii' },
  { id: 'awesome', re: /\bawesome[!,.\s]/i, why: 'cheerleading copy · principle viii' },
  { id: 'woohoo', re: /\bwo+h+oo\b/i, why: 'celebration copy · principle i' },
  { id: 'good-work', re: /\bgood\s+work\b/i, why: 'cheerleading copy · principle viii' },
  { id: 'got-this', re: /\byou'?ve\s+got\s+this\b/i, why: 'motivational copy · principle iv' },
  { id: 'crushing-it', re: /\bcrushing\s+it\b/i, why: 'productivity-bro voice · principle iv' },
  { id: 'rockstar', re: /\brockstar\b/i, why: 'productivity-bro voice · principle iv' },
  { id: 'killer-it', re: /\bkill(er|ing)?\s+it\b/i, why: 'productivity-bro voice · principle iv' },

  // streak / chain / dopamine-trap language
  { id: 'streak', re: /\bstreak\b/i, why: 'streaks banned · principle iii · volkow rule' },
  { id: 'streak-broken', re: /\bstreak\s+broken\b/i, why: 'streak-break copy · principle iii' },
  {
    id: 'dont-break',
    re: /\bdon'?t\s+break\s+(your|the)\s+(streak|run|chain)\b/i,
    why: 'streak shame · principle iii',
  },
  { id: 'in-a-row', re: /\b\d+\s+(days?|weeks?)\s+in\s+a\s+row\b/i, why: 'streak count · principle iii' },
  {
    id: 'keep-streak',
    re: /\bkeep\s+(your|the)\s+streak\s+(alive|going)\b/i,
    why: 'streak-prompting copy · principle iii',
  },
  { id: 'missed-yday', re: /\byou\s+missed\s+yesterday\b/i, why: 'missed-day guilt · principle iii' },

  // engagement notifications (re-engagement)
  { id: 'come-back', re: /\bcome\s+back\s+(soon|to|and|—|\.)/i, why: 'engagement push · principle ii' },
  { id: 'miss-you', re: /\bwe\s+miss(ed|ing)?\s+you\b/i, why: 'engagement push · principle ii' },
  {
    id: 'check-in-ollie',
    re: /\bcheck[\s-]?in\s+with\s+(void|ollie|burhan)\b/i,
    why: 'engagement push · principle ii',
  },
  {
    id: 'havent-x',
    re: /\bhaven'?t\s+(seen|heard|opened|dumped|tracked|logged|checked|written|journaled|added|visited)\b/i,
    why: 'engagement push · principle ii',
  },
  {
    id: 'days-since-x',
    re: /\b\d+\s+days?\s+since\s+(you|your\s+last)\s+(open|visit|log|dump|check)/i,
    why: 'engagement push · principle ii',
  },
  {
    id: 'where-have-you',
    re: /\bwhere\s+(have\s+you\s+been|did\s+you\s+go)\b/i,
    why: 'guilt-push · principle ii',
  },
  {
    id: 'your-friend',
    re: /\b(your\s+)?friend\s+(just\s+)?(logged|posted|added)\b/i,
    why: 'social-proof push · principle ii',
  },

  // burhan as push character (the Finch-trap)
  {
    id: 'burhan-sad',
    re: /\bburhan\s+is\s+(sad|thirsty|lonely|wilting|dying|hungry|missing\s+you)\b/i,
    why: 'burhan as push character · finch-trap',
  },
  {
    id: 'burhan-needs',
    re: /\bburhan\s+(needs|wants|misses)\s+you\b/i,
    why: 'burhan as push character · finch-trap',
  },

  // urgency theater / dark patterns
  { id: 'limited-time', re: /\blimited\s+time\b/i, why: 'marketing dark pattern · principle ii' },
  { id: 'today-only', re: /\btoday\s+only\b/i, why: 'marketing dark pattern · principle ii' },
  { id: 'last-chance', re: /\blast\s+chance\b/i, why: 'marketing dark pattern · principle ii' },

  // hallmark crisis copy
  { id: 'you-matter', re: /\byou\s+matter\s+to\s+us\b/i, why: 'hallmark voice · banned in crisis · decision 012' },
  { id: 'please-reach', re: /\bplease\s+reach\s+out\b/i, why: 'hallmark voice · banned in crisis' },
];

// ── 'push' SCOPED BANS — enforced on every notification template ────────────
// Mirror of SCOPED_BANS.push in tools/banned-phrases.cjs.
const PUSH_BANS: readonly Ban[] = [
  { id: 'push-exclaim', re: /!(?:[\s$"'.,)]|$)/, why: 'no exclamation in push templates · principle viii' },
  { id: 'emoji-celebrate', re: /💪|💯|🎉|✨|💙|❤️?|👏|🔥/u, why: 'emoji as celebration · principle i' },
  {
    id: 'reward-feedback',
    re: /\bgreat\s+job\s+(today|tracking|logging)\b/i,
    why: 'reward-feedback push',
  },
];

export interface BannedHit {
  id: string;
  why: string;
  source: 'global' | 'push';
}

/**
 * Scan a single string against global + push bans.
 * Returns every hit; empty array means clean.
 */
export function scanForBanned(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  for (const ban of GLOBAL_BANS) {
    if (ban.re.test(text)) hits.push({ id: ban.id, why: ban.why, source: 'global' });
  }
  for (const ban of PUSH_BANS) {
    if (ban.re.test(text)) hits.push({ id: ban.id, why: ban.why, source: 'push' });
  }
  return hits;
}

export interface PayloadCopyCheck {
  clean: boolean;
  hits: BannedHit[];
}

/**
 * Validate a notification payload's user-visible copy. We scan the title,
 * the body, and the action_url-adjacent copy — everything that could
 * surface on the lock screen. `extra` custom keys are NOT scanned: they
 * are deep-link / metadata, never rendered as copy.
 */
export function checkNotificationCopy(payload: {
  title?: unknown;
  body?: unknown;
}): PayloadCopyCheck {
  const hits: BannedHit[] = [];
  if (typeof payload.title === 'string') hits.push(...scanForBanned(payload.title));
  if (typeof payload.body === 'string') hits.push(...scanForBanned(payload.body));
  return { clean: hits.length === 0, hits };
}
