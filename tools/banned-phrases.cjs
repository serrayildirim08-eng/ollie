/**
 * ollie · banned phrases · voice library guard
 *
 * Ported from design-pitches/handoff/banned-phrases.js (legacy void-app)
 * and tools/notification_scope_tests.js. Both checks consolidated here
 * so a single CI pass catches voice-library violations AND
 * notification-scope violations.
 *
 * Sources of truth:
 *   - voice-library.html · part ii · the no list
 *   - CLAUDE.md · "Notification Scope — CONSTITUTIONAL RULE"
 *   - VOID_PRINCIPLES.md
 *
 * Whitelist:
 *   Add a `// notif-scope-allow` comment on the line where the banned
 *   phrase appears (or the line above). Used sparingly — only for
 *   legitimate non-push uses (LLM system prompts, factual answer-engine
 *   replies, doc strings describing banned patterns).
 *
 * To ban a new phrase:
 *   1. Add it to GLOBAL_BANS (always banned) or one of SCOPED_BANS.
 *   2. Log a decision-log entry referencing the principle.
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────
// GLOBAL BANS — banned everywhere user-facing copy lives
// ──────────────────────────────────────────────────────────────────────────

const GLOBAL_BANS = [
  // ── cheerleading / motivational copy ──────────────────────────────────
  { id: 'great-job',     re: /\bgreat\s+job\b/i,             why: 'cheerleading copy · principle viii' },
  { id: 'awesome',       re: /\bawesome[!,.\s]/i,            why: 'cheerleading copy · principle viii' },
  { id: 'woohoo',        re: /\bwo+h+oo\b/i,                 why: 'celebration copy · principle i' },
  { id: 'good-work',     re: /\bgood\s+work\b/i,             why: 'cheerleading copy · principle viii' },
  { id: 'got-this',      re: /\byou'?ve\s+got\s+this\b/i,    why: 'motivational copy · principle iv' },
  { id: 'crushing-it',   re: /\bcrushing\s+it\b/i,           why: 'productivity-bro voice · principle iv' },
  { id: 'rockstar',      re: /\brockstar\b/i,                why: 'productivity-bro voice · principle iv' },
  { id: 'killer-it',     re: /\bkill(er|ing)?\s+it\b/i,      why: 'productivity-bro voice · principle iv' },

  // ── streak / chain / dopamine-trap language ──────────────────────────
  { id: 'streak',        re: /\bstreak\b/i,                  why: 'streaks banned · principle iii · volkow rule' },
  { id: 'streak-broken', re: /\bstreak\s+broken\b/i,         why: 'streak-break copy · principle iii' },
  { id: 'dont-break',    re: /\bdon'?t\s+break\s+(your|the)\s+(streak|run|chain)\b/i, why: 'streak shame · principle iii' },
  { id: 'in-a-row',      re: /\b\d+\s+(days?|weeks?)\s+in\s+a\s+row\b/i, why: 'streak count · principle iii' },
  { id: 'keep-streak',   re: /\bkeep\s+(your|the)\s+streak\s+(alive|going)\b/i, why: 'streak-prompting copy · principle iii' },
  { id: 'missed-yday',   re: /\byou\s+missed\s+yesterday\b/i, why: 'missed-day guilt · principle iii' },

  // ── engagement notifications (re-engagement) ─────────────────────────
  { id: 'come-back',     re: /\bcome\s+back\s+(soon|to|and|—|\.)/i, why: 'engagement push · principle ii' },
  { id: 'miss-you',      re: /\bwe\s+miss(ed|ing)?\s+you\b/i, why: 'engagement push · principle ii' },
  { id: 'check-in-ollie', re: /\bcheck[\s-]?in\s+with\s+(void|ollie|burhan)\b/i, why: 'engagement push · principle ii' },
  { id: 'havent-x',      re: /\bhaven'?t\s+(seen|heard|opened|dumped|tracked|logged|checked|written|journaled|added|visited)\b/i, why: 'engagement push · principle ii' },
  { id: 'days-since-x',  re: /\b\d+\s+days?\s+since\s+(you|your\s+last)\s+(open|visit|log|dump|check)/i, why: 'engagement push · principle ii' },
  { id: 'where-have-you', re: /\bwhere\s+(have\s+you\s+been|did\s+you\s+go)\b/i, why: 'guilt-push · principle ii' },
  { id: 'your-friend',   re: /\b(your\s+)?friend\s+(just\s+)?(logged|posted|added)\b/i, why: 'social-proof push · principle ii' },

  // ── burhan as push character (the Finch-trap) ───────────────────────
  { id: 'burhan-sad',    re: /\bburhan\s+is\s+(sad|thirsty|lonely|wilting|dying|hungry|missing\s+you)\b/i, why: 'burhan as push character · finch-trap' },
  { id: 'burhan-needs',  re: /\bburhan\s+(needs|wants|misses)\s+you\b/i, why: 'burhan as push character · finch-trap' },

  // ── urgency theater / dark patterns ─────────────────────────────────
  { id: 'limited-time',  re: /\blimited\s+time\b/i,          why: 'marketing dark pattern · principle ii' },
  { id: 'today-only',    re: /\btoday\s+only\b/i,            why: 'marketing dark pattern · principle ii' },
  { id: 'last-chance',   re: /\blast\s+chance\b/i,           why: 'marketing dark pattern · principle ii' },

  // ── hallmark crisis copy ────────────────────────────────────────────
  { id: 'you-matter',    re: /\byou\s+matter\s+to\s+us\b/i,  why: 'hallmark voice · banned in crisis · decision 012' },
  { id: 'please-reach',  re: /\bplease\s+reach\s+out\b/i,    why: 'hallmark voice · banned in crisis' },
];

// ──────────────────────────────────────────────────────────────────────────
// SCOPED BANS — only enforced when a scope flag is supplied
// ──────────────────────────────────────────────────────────────────────────

const SCOPED_BANS = {
  // notification / push / nudge contexts: no exclamation marks, no emoji
  // celebration, ever.
  push: [
    { id: 'push-exclaim',  re: /!(?:[\s$"'.,)]|$)/,          why: 'no exclamation in push templates · principle viii' },
    { id: 'emoji-celebrate', re: /[💪💯🎉✨💙❤️👏🔥]/u,       why: 'emoji as celebration · principle i' },
    { id: 'reward-feedback', re: /\bgreat\s+job\s+(today|tracking|logging)\b/i, why: 'reward-feedback push' },
  ],

  // confirmation toasts: no emoji celebration either.
  confirmation: [
    { id: 'emoji-confirm', re: /[💪💯🎉✨💙❤️👏🔥]/u,         why: 'emoji as celebration · principle i' },
  ],

  // body + pantry · calorie/diet language never appears
  bodyPantry: [
    { id: 'calorie',       re: /\bcalor(ie|ies|ic|ically)\b/i, why: 'calories never appear · body principle' },
    { id: 'bmi',           re: /\bbmi\b/i,                   why: 'bmi never appears · body principle' },
    { id: 'weight-loss',   re: /\bweight[\s-]?loss\b/i,      why: 'no diet framing · body principle' },
  ],

  // cycle · diagnostic + fertility-default copy banned
  cycle: [
    { id: 'fertile-day',   re: /\bfertile\s+day\b/i,         why: 'no single ovulation day · principle 2.8' },
    { id: 'chance-pregnant', re: /\bchance\s+of\s+(getting\s+)?pregnan/i, why: 'fertility framing opt-in · principle 2.11' },
    { id: 'you-have-dx',   re: /\byou\s+(have|might\s+have)\s+(pmdd|endometriosis|pcos)\b/i, why: 'no diagnostic language · principle 2.2' },
  ],

  // pets · guilt copy banned
  pets: [
    { id: 'pet-sad',       re: /\b(tontin|pinpon|tofu|your\s+pet)\s+(is\s+)?(sad|lonely|misses)\b/i, why: 'no guilt copy · pets module rule' },
    { id: 'you-forgot',    re: /\byou\s+forgot\b/i,          why: 'no shaming language · pets module rule' },
  ],

  // habits · streak-canary (already global, but extra strict here)
  habits: [
    { id: 'streak-hard',   re: /\b(streak|chain|broke|broken)\b/i, why: 'principle iii · habits is the volkow rule canary' },
  ],
};

// ──────────────────────────────────────────────────────────────────────────
// scanForBanned — used by tests + the CI runner
// ──────────────────────────────────────────────────────────────────────────

/**
 * Scan a single string for banned phrases.
 *
 * @param {string} text   the string to check
 * @param {string|string[]} scope which scoped-ban set to apply (e.g. 'push',
 *                                'cycle', 'bodyPantry'). global bans always apply.
 * @returns {Array<{id:string, why:string, source:string}>} hits, empty when clean.
 */
function scanForBanned(text, scope = []) {
  const scopes = Array.isArray(scope) ? scope : [scope];
  const hits = [];

  for (const ban of GLOBAL_BANS) {
    if (ban.re.test(text)) {
      hits.push({ id: ban.id, why: ban.why, source: 'global' });
    }
  }

  for (const sc of scopes) {
    const list = SCOPED_BANS[sc] || [];
    for (const ban of list) {
      if (ban.re.test(text)) {
        hits.push({ id: ban.id, why: ban.why, source: sc });
      }
    }
  }

  return hits;
}

module.exports = {
  GLOBAL_BANS,
  SCOPED_BANS,
  scanForBanned,
};
