/**
 * Partner module · domain types.
 *
 * The "intimate window" feature (design locked 2026-05-28, 14 decisions). NOT
 * household co-op, NOT accountability buddy, NOT Care Circle. Only four
 * channels are ever shared — cycle · mood · energy · focus — and only as
 * *interpreted* soft language, never raw numbers.
 *
 * Consent is asymmetric: each person controls their OWN outflow (these flags).
 */

/** The four — and only four — shareable channels. */
export type ShareKey = 'cycle' | 'mood' | 'energy' | 'focus';

export const SHARE_KEYS: ShareKey[] = ['cycle', 'mood', 'energy', 'focus'];

/** My outflow consent — which channels I let my partner see. Asymmetric. */
export type ConsentFlags = Record<ShareKey, boolean>;

export interface PartnerPairing {
  /** The other user's id (Clerk id once the real pairing backend lands). */
  partnerId: string;
  /** Display name shown on the ambient card ("Serra · tender day"). */
  partnerName: string;
  pairedAtMs: number;
}

/**
 * Everything we keep on THIS device. Singleton — persisted under one kv key.
 * `goDarkDate` is a 'YYYY-MM-DD' string: the day I tapped "taking today off".
 * It auto-clears the next day (silent go-dark, decision 9).
 */
export interface PartnerLocalState {
  pairing: PartnerPairing | null;
  consent: ConsentFlags;
  goDarkDate: string | null;
}

/**
 * The interpreted state a partner actually sees — soft phrases, never numbers
 * (decision 5). Produced device-side by the interpretation engine.
 */
export interface InterpretedState {
  /** e.g. ['tender day', 'low energy']. Empty → a gentle "steady day". */
  phrases: string[];
  /** Optional one-word self overlay the user added (decision 10, layer B). */
  selfWord?: string | null;
  /** Crisis Level-1: the card text changes ("needs you today"). No push. */
  crisis?: boolean;
  /** "taking today off" — the card gently freezes (decision 9 / 14). */
  goneDark?: boolean;
  updatedAtMs: number;
}

export const DEFAULT_CONSENT: ConsentFlags = {
  cycle: false,
  mood: false,
  energy: false,
  focus: false,
};

export const SHARE_LABELS: Record<ShareKey, string> = {
  cycle: 'cycle',
  mood: 'mood',
  energy: 'energy',
  focus: 'focus',
};
