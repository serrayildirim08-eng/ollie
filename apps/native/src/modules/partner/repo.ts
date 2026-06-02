/**
 * Partner · local state + bilateral-sync orchestration.
 *
 * THIS device's state (pairing, consent, go-dark) is a kv singleton. The
 * partner's interpreted state comes over the wire from the ai-proxy /partner/*
 * endpoints (real pairing by code, snapshot store/fetch). A local "preview"
 * pairing (isDemo) short-circuits the network so the surface is usable before a
 * second real user exists.
 *
 * Privacy (decision 10): we only ever upload the *interpreted, consent-filtered*
 * snapshot — never raw mood/cycle/energy/focus.
 */

import { kv } from '../../storage';
import {
  getPartnerSnapshot,
  pairPartner,
  putPartnerSnapshot,
  unpairPartner,
  type PartnerSnapshotWire,
} from '../../api';
import { interpret, type RawSignals } from './interpret';
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

/** TODO(signals): replace with a real read of the user's mood/energy/cycle/
 *  focus. Until then a stable sample flows so the bilateral plumbing is real
 *  and demonstrable; consent filtering + go-dark are already honest. */
const SAMPLE_SIGNALS: RawSignals = { mood: 'low', energy: 'high', cyclePhase: null, focus: 'deep' };

type Bearer = () => Promise<string>;

function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function wireToInterpreted(w: PartnerSnapshotWire | null): InterpretedState {
  if (!w) return { phrases: [], selfWord: null, crisis: false, goneDark: false, updatedAtMs: Date.now() };
  return {
    phrases: Array.isArray(w.phrases) ? w.phrases : [],
    selfWord: w.self_word ?? null,
    crisis: !!w.crisis,
    goneDark: !!w.gone_dark,
    updatedAtMs: w.updated_at ? Date.parse(w.updated_at) : Date.now(),
  };
}

export const partnerRepo = {
  async load(): Promise<PartnerLocalState> {
    const saved = await kv.get<PartnerLocalState>(KEY);
    if (!saved) return { ...EMPTY, consent: { ...DEFAULT_CONSENT } };
    return {
      pairing: saved.pairing ?? null,
      consent: { ...DEFAULT_CONSENT, ...(saved.consent ?? {}) },
      goDarkDate: saved.goDarkDate ?? null,
    };
  },

  async save(state: PartnerLocalState): Promise<void> {
    await kv.set(KEY, state);
  },

  isDarkToday(state: PartnerLocalState, nowMs: number = Date.now()): boolean {
    return !!state.goDarkDate && state.goDarkDate === dayKey(nowMs);
  },

  /** The snapshot we publish: interpret the (sampled) signals through consent. */
  buildMySnapshot(state: PartnerLocalState): PartnerSnapshotWire {
    const i = interpret(SAMPLE_SIGNALS, state.consent, {
      nowMs: Date.now(),
      goneDark: this.isDarkToday(state),
    });
    return { phrases: i.phrases, self_word: i.selfWord ?? null, crisis: !!i.crisis, gone_dark: !!i.goneDark };
  },

  /** Real pairing — claim the partner's code, then publish my first snapshot. */
  async pairWithCode(
    code: string,
    partnerName: string,
    consent: ConsentFlags,
    getBearer: Bearer,
  ): Promise<{ ok: true; state: PartnerLocalState } | { ok: false; error: string }> {
    const bearer = await getBearer();
    if (!bearer) return { ok: false, error: 'not signed in' };
    const res = await pairPartner(code, { bearer });
    if (!res.ok) return { ok: false, error: res.error.code };
    const next: PartnerLocalState = {
      pairing: {
        partnerId: res.data.partnerId,
        partnerName: partnerName.trim() || 'your partner',
        pairedAtMs: Date.now(),
        isDemo: false,
      },
      consent: { ...consent },
      goDarkDate: null,
    };
    await this.save(next);
    await putPartnerSnapshot(this.buildMySnapshot(next), { bearer }).catch(() => {});
    return { ok: true, state: next };
  },

  /** Local-only preview pairing (decision-safe demo; never touches backend). */
  async pairDemo(consent: ConsentFlags): Promise<PartnerLocalState> {
    const next: PartnerLocalState = {
      pairing: { partnerId: 'demo:preview', partnerName: 'Pınar', pairedAtMs: Date.now(), isDemo: true },
      consent: { ...consent },
      goDarkDate: null,
    };
    await this.save(next);
    return next;
  },

  async unpair(state: PartnerLocalState, getBearer: Bearer): Promise<PartnerLocalState> {
    if (state.pairing && !state.pairing.isDemo) {
      const bearer = await getBearer().catch(() => '');
      if (bearer) await unpairPartner({ bearer }).catch(() => {});
    }
    const next = { ...EMPTY, consent: { ...DEFAULT_CONSENT } };
    await this.save(next);
    return next;
  },

  async setConsent(
    state: PartnerLocalState,
    key: ShareKey,
    value: boolean,
    getBearer: Bearer,
  ): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, consent: { ...state.consent, [key]: value } };
    await this.save(next);
    await this.publish(next, getBearer);
    return next;
  },

  async goDarkToday(state: PartnerLocalState, getBearer: Bearer): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, goDarkDate: dayKey(Date.now()) };
    await this.save(next);
    await this.publish(next, getBearer);
    return next;
  },

  async clearDark(state: PartnerLocalState, getBearer: Bearer): Promise<PartnerLocalState> {
    const next: PartnerLocalState = { ...state, goDarkDate: null };
    await this.save(next);
    await this.publish(next, getBearer);
    return next;
  },

  /** Push my current snapshot (real pairs only; demo is local). */
  async publish(state: PartnerLocalState, getBearer: Bearer): Promise<void> {
    if (!state.pairing || state.pairing.isDemo) return;
    const bearer = await getBearer().catch(() => '');
    if (!bearer) return;
    await putPartnerSnapshot(this.buildMySnapshot(state), { bearer }).catch(() => {});
  },

  /** The partner's interpreted state — mock for demo, live fetch for real. */
  async getPartnerInterpreted(state: PartnerLocalState, getBearer: Bearer): Promise<InterpretedState> {
    if (!state.pairing) return wireToInterpreted(null);
    if (state.pairing.isDemo) {
      return { phrases: ['tender day', 'low energy'], selfWord: null, crisis: false, goneDark: false, updatedAtMs: Date.now() };
    }
    const bearer = await getBearer().catch(() => '');
    if (!bearer) return wireToInterpreted(null);
    const res = await getPartnerSnapshot({ bearer });
    if (!res.ok) return wireToInterpreted(null);
    return wireToInterpreted(res.data.snapshot);
  },
};
