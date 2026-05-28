import type { CrisisDetectResult, CrisisLang } from './types';

/**
 * Detects self-harm / suicidal-ideation AND method-seeking phrasing in
 * EN, ES and TR.
 *
 * Two intents are covered deliberately:
 *   - ideation        — "i want to die", "kendimi öldürmek istiyorum"
 *   - method-seeking  — "painless way to die", "nasıl ölürüm",
 *                       "en acısız ölüm yöntemi". This is the highest-risk
 *                       category and was the original blind spot: the old
 *                       regex only knew the exact phrase "öldürmek
 *                       istiyorum" and missed every "öldürebilirim" /
 *                       "nasıl öl…" conjugation.
 *
 * Design notes:
 * - The matcher is split into one regex per language so `detectCrisis`
 *   can report WHICH language the user wrote in — that drives the
 *   response copy. Turkish is the load-bearing case: the app UI ships
 *   en/es only, so a Turkish phrase is the *only* signal that the user
 *   needs a Turkish answer.
 * - EN / ES phrases use `\b` (ASCII word boundary). ES phrases carry NO
 *   trailing `\b`: several end in an accented char (`daño`, `más`) and JS
 *   `\b` is ASCII-only — a `\b` after ñ/á is always false and would break
 *   the match. Leading `\b` is safe (every ES phrase starts ASCII).
 * - TR splits again: ASCII-starting phrases (`intihar`, `nasıl öl…`) take
 *   a leading `\b`; phrases starting with a non-ASCII letter (`öl…`) use a
 *   `(?:^|(?<=\s))` lookbehind instead, because JS `\b` treats `ö` as a
 *   non-word char so `\b` before it is always false. No TR regex uses a
 *   trailing `\b` — Turkish suffixes are open-ended (öldür-ebilir-im).
 * - `suicid\w*` covers EN "suicide/suicidal" and also ES
 *   "suicidio/suicidarme/suicida"; the ES branch leans on it rather than
 *   repeating the stem.
 */

// ── English — ideation + method-seeking ─────────────────────────────────────
const EN_CRISIS_RE =
  /\b(?:wann?a\s+die|want(?:ing)?\s+to\s+die|don'?t\s+want\s+to\s+(?:live|be\s+(?:here|alive))|can'?t\s+(?:take\s+it\s+anymore|go\s+on|do\s+this\s+anymore)|kill(?:ing)?\s+(?:myself|yourself)|hurt(?:ing)?\s+myself|harm(?:ing)?\s+myself|self.?harm|suicid\w*|end(?:ing)?\s+(?:it\s+all|it|my\s+life)|tak(?:e|ing)\s+my\s+(?:own\s+)?life|no\s+(?:reason\s+to\s+live|point\s+(?:in\s+)?living)|better\s+off\s+dead|want\s+to\s+be\s+dead|(?:ways?|how)\s+to\s+die|how\s+(?:can|do)\s+i\s+die|(?:painless|quickest|easiest|best|least\s+painful)\s+(?:way\s+to\s+die|death)|methods?\s+to\s+die)\b/i;

// ── Spanish — ideation + method-seeking. Leading \b only (accent-endings). ──
const ES_CRISIS_RE =
  /\b(?:(?:me\s+)?quiero\s+morir|quiero\s+matarme|me\s+quiero\s+matar|matarme|quitarme\s+la\s+vida|(?:acabar|terminar)\s+con\s+mi\s+vida|no\s+quiero\s+(?:vivir|seguir\s+viviendo|estar\s+aqu[ií])|autolesi[oó]n\w*|lastimarme|hacerme\s+da[ñn]o|no\s+aguanto\s+m[aá]s|mejor\s+muert[oa]|c[oó]mo\s+(?:morir|matarme|suicidarme)|(?:forma|manera|modo)\s+(?:de\s+morir|de\s+matarme|menos\s+dolorosa)|morir\s+sin\s+dolor)/i;

// ── Turkish — ASCII-starting phrases. Leading \b, no trailing \b. ───────────
const TR_ASCII_CRISIS_RE =
  /\b(?:intihar|kendime\s+zarar|kendimi\s+öldür|olmak\s+istemiyorum|yaşamak\s+istemiyorum|hayat[ıi]ma\s+son\s+ver|(?:yokum|olmasam)\s+daha\s+iyi|canıma\s+kıy|nasıl\s+öl|acısız\s+(?:öl|intihar))/i;

// ── Turkish — non-ASCII-starting phrases. Lookbehind for word-boundary. ─────
const TR_UNICODE_CRISIS_RE =
  /(?:^|(?<=\s))(?:öldür\w*\s+istiyorum|ölmek\s+istiyorum|ölmeyi\s+düşün\w*|ölüm\s+yöntem\w*)/i;

/**
 * The EN matcher, exported for back-compat with callers that referenced
 * `CRISIS_RE` directly. New code should use `detectCrisis` — it covers all
 * three languages and reports the response language.
 */
export const CRISIS_RE: RegExp = EN_CRISIS_RE;

/**
 * Tests `text`, line by line, against the EN / ES / TR crisis matchers.
 *
 * @param text       the user input to scan.
 * @param localeHint the app locale (`'en'` | `'es'`) — used as the response
 *                    language when a non-Turkish phrase matches. A Turkish
 *                    match always overrides this to `'tr'`.
 *
 * Returns `{ match: true, line, lang }` for the first matching line, or
 * `{ match: false, line: '', lang: 'en' }`.
 *
 * Pure function — no side effects, no I/O.
 */
export function detectCrisis(
  text: string,
  localeHint: 'en' | 'es' = 'en',
): CrisisDetectResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { match: false, line: '', lang: 'en' };
  }
  const lines = text.split('\n');
  for (const line of lines) {
    if (TR_ASCII_CRISIS_RE.test(line) || TR_UNICODE_CRISIS_RE.test(line)) {
      return { match: true, line, lang: 'tr' };
    }
    if (ES_CRISIS_RE.test(line) || EN_CRISIS_RE.test(line)) {
      return { match: true, line, lang: localeHint as CrisisLang };
    }
  }
  return { match: false, line: '', lang: 'en' };
}
