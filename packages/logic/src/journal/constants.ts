/**
 * @ollie/logic · journal · constants
 *
 * Static sets and patterns used across extraction functions.
 */

export const EMOTION_WORDS = new Set([
  'happy', 'sad', 'angry', 'anxious', 'anxiety', 'tired', 'exhausted', 'stressed',
  'frustrated', 'overwhelmed', 'numb', 'excited', 'scared', 'afraid', 'worried',
  'lonely', 'bored', 'calm', 'relieved', 'disappointed', 'hopeful', 'jealous',
  'guilty', 'ashamed', 'embarrassed', 'content', 'peaceful', 'restless',
  'irritated', 'pissed', 'furious', 'devastated', 'heartbroken', 'nervous',
  'hopeless', 'grateful', 'resentful', 'defeated', 'okay', 'fine',
  'awful', 'terrible', 'great', 'good', 'bad', 'low', 'high', 'flat',
]);

export const DECISION_PATTERNS: RegExp[] = [
  /\bgoing to\b/i, /\bwill\b/i, /\bdecided\b/i, /\bstopping\b/i,
  /\bstarting\b/i, /\bquitting\b/i, /\bsigned up\b/i, /\bbought\b/i,
  /\bcancelled\b/i, /\bbooked\b/i, /\bdid\b/i,
];

export const BANNED_FIELDS = new Set([
  'mood_score', 'sentiment', 'valence', 'polarity',
  'ai_tags', 'theme', 'category', 'topic',
]);

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'i', 'me', 'my', 'we', 'us', 'our',
  'you', 'your', 'he', 'she', 'it', 'its', 'this', 'that', 'these', 'those',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with',
  'as', 'from', 'up', 'down', 'not', 'no', 'so', 'if', 'then', 'than',
]);

export const VALID_MODULES_FOR_HINTS: readonly string[] = [
  'cycle', 'grocery', 'pets', 'finance', 'habits', 'sleep', 'work', 'goals',
  'admin', 'astrology', 'body', 'health', 'dump', 'journal', 'reminders',
];

export const TIME_PATTERNS: RegExp[] = [
  /\byesterday\b/i, /\btoday\b/i, /\btomorrow\b/i,
  /\bthis morning\b/i, /\bthis afternoon\b/i, /\btonight\b/i,
  /\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year)\b/i,
  /\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year)\b/i,
  /\b\d+ (hours?|days?|weeks?|months?|years?) ago\b/i,
  /\bin \d+ (hours?|days?|weeks?|months?|years?)\b/i,
];

export const DAY_MS = 86_400_000;
