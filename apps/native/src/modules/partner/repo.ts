/**
 * Partner · local persistence + the (currently mocked) partner-state seam.
 *
 * THIS device's state — pairing, my consent flags, my go-dark day — is a small
 * singleton, so it lives under one kv key. The PARTNER's interpreted state
 * (what *they* are sharing) comes over the wire from their device; until the
 * bilateral sync backend lands, `getPartnerInterpreted()` returns a mock so the
 * card + screen are fully visible. The backend swap is isolated to that one
 * function — everything else is real.
 */

import { kv } from '../../storage';
import {
  DEFAULT_CONSENT,
  type ConsentFlags,
  type InterpretedState,
  type PartnerLocalState,
  type ShareKey,
} from './types';

const KEY = 'partner:state';

const EMPTY: PartnerLocalState = {
  pairing: null,
  consent: { ...DEFAULT_CONSENT },
  goDarkDate: null,
};

function dayKey(nowMs: number): string {
  // Local-date 'YYYY-MM-DD' so "today" matches the user's wall clock.
  const d = new Date(nowMs);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const partnerRepo = {
  async load(): Promise<PartnerLocalState> {
    const saved = await kv.get<PartnerLocalState>(KEY);
    if (!saved) return { ...EMPTY, consent: { ...DEFAULT_CONSENT } };
    // Defensive merge — tolerate older shapes.
    return {
      pairing: saved.pairing ?? null,
      consent: { ...DEFAULT_CONSENT, ...(saved.consent ?? {}) },
      goDarkDate: saved.goDarkDate ?? null,
    };
  },

  async save(state: PartnerLocalState): Promise<void> {
    await kv.set(KEY, state);
  },

  /** Wizard completion — store the pairing + the initial consent (decision 11). */
  async pair(partnerId: string, partnerName: string, consent: ConsentFlags): Promise<PartnerLocalState> {
    const next: PartnerLocalState = {
      pairing: { partnerId, partnerName: partnerName.trim() || 'your partner', pairedAtMs: Date.now() },
      consent: { ...consent },
      goDarkDate: null,
    };
    await this.save(next);
    return next;
  },

  /** Clean break (decision 13) — wipes everything, no cooldown, no approval. */
  async unpair(): Promise<PartnerLocalState> {
    const next = { ...EMPTY, consent: { ...DEFAULT_CONSENT } };
    await this.save(next);
    return next;
  },

  async setConsent(state: PartnerLocalState, key: ShareKey, value: boolean): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, consent: { ...state.consent, [key]: value } };
    await this.save(next);
    return next;
  },

  /** "taking today off" — silent go-dark for the rest of the day (decision 9). */
  async goDarkToday(state: PartnerLocalState): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, goDarkDate: dayKey(Date.now()) };
    await this.save(next);
    return next;
  },

  /** Manual early resume (the auto-resume is just the date no longer matching). */
  async clearDark(state: PartnerLocalState): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, goDarkDate: null };
    await this.save(next);
    return next;
  },

  /** True while I'm dark *today*; tomorrow it silently lapses (auto-resume). */
  isDarkToday(state: PartnerLocalState, nowMs: number = Date.now()): boolean {
    return !!state.goDarkDate && state.goDarkDate === dayKey(nowMs);
  },

  /**
   * The partner's interpreted state (what THEY share with me).
   *
   * TODO(backend): replace with a fetch of the partner's latest interpreted
   * snapshot from the bilateral sync worker (keyed by pairing.partnerId). The
   * shape returned here is exactly what the real endpoint must produce, so the
   * card + crisis + go-dark rendering is already correct.
   */
  async getPartnerInterpreted(): Promise<InterpretedState> {
    return {
      phrases: ['tender day', 'low energy'],
      selfWord: null,
      crisis: false,
      goneDark: false,
      updatedAtMs: Date.now(),
    };
  },
};
