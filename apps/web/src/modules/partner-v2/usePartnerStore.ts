/**
 * partner-v2 · usePartnerStore — the in-module stub data layer
 *
 * ── HONEST STUB NOTE ─────────────────────────────────────────────────────────
 * partner-v2 is a NEW feature with NO backend. There is no partner-linking
 * service, no remote sync — so this hook is NOT a bridge to a live store the
 * way `useHabitsSlices` is. It is the module's OWN local data layer: it
 * seeds `SEED_PARTNER_STATE` (realistic placeholder data) into a `partner`
 * store namespace and persists the user's edits there.
 *
 * The `partner` namespace is private to this preview module — no other code
 * reads or writes it. When a real partner-linking backend lands, THIS file
 * is the single seam to re-point (swap the `useStoreSlice` calls for the
 * real API); `selectors.ts` and the 4 screens stay unchanged.
 *
 * Read-state + a small set of mutations the 4 screens perform:
 *   - `setSharing` — flip one sharing opt-in toggle
 *   - `sendAsk`    — append a new ask to the (local) ask history
 *   - `regenerateCode` — mint a fresh invite code
 */
import { useCallback, useMemo } from 'react';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import {
  SEED_PARTNER_STATE,
  type PartnerState,
  type SharingKey,
  type AskCategory,
} from './selectors';

/** the private store namespace for the partner stub — preview-only */
const PARTNER_NS = 'partner';
const PARTNER_KEY = 'stub_state';

/** the alphabet a fresh invite code is minted from — no ambiguous chars */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** mint a fresh 4-char invite code */
function mintCode(): string {
  let out = '';
  const bytes = new Uint8Array(4);
  (globalThis.crypto as Crypto | undefined)?.getRandomValues?.(bytes);
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[(bytes[i] ?? Math.floor(Math.random() * 256)) % CODE_ALPHABET.length];
  }
  return out;
}

export interface PartnerActions {
  /** flip one sharing opt-in toggle on/off */
  setSharing: (key: SharingKey, on: boolean) => void;
  /** record a new ask the user sent — appended to the local history */
  sendAsk: (kind: AskCategory) => void;
  /** mint a fresh invite code */
  regenerateCode: () => void;
}

export interface PartnerStore {
  /** the current (stubbed) partner state */
  state: PartnerState;
  /** the mutations the screens perform against the stub */
  actions: PartnerActions;
}

/**
 * The partner stub store. `now` is injected so a freshly-sent ask gets a
 * deterministic timestamp in tests.
 */
export function usePartnerStore(now: number): PartnerStore {
  const [raw, setRaw] = useStoreSlice<PartnerState>(
    PARTNER_NS,
    PARTNER_KEY,
    SEED_PARTNER_STATE,
  );

  // tolerate a partial / missing persisted value — fold the seed in
  const state = useMemo<PartnerState>(() => {
    const s = raw && typeof raw === 'object' ? raw : SEED_PARTNER_STATE;
    return {
      linkedPartner: s.linkedPartner ?? SEED_PARTNER_STATE.linkedPartner,
      sharedPatterns: Array.isArray(s.sharedPatterns)
        ? s.sharedPatterns
        : SEED_PARTNER_STATE.sharedPatterns,
      asks: Array.isArray(s.asks) ? s.asks : SEED_PARTNER_STATE.asks,
      sharing: { ...SEED_PARTNER_STATE.sharing, ...(s.sharing ?? {}) },
      inviteCode: s.inviteCode || SEED_PARTNER_STATE.inviteCode,
    };
  }, [raw]);

  const setSharing = useCallback(
    (key: SharingKey, on: boolean) => {
      setRaw({ ...state, sharing: { ...state.sharing, [key]: on } });
    },
    [state, setRaw],
  );

  const sendAsk = useCallback(
    (kind: AskCategory) => {
      setRaw({
        ...state,
        asks: [
          { id: mkId('ask'), kind, sentAt: now, state: 'sent' as const },
          ...state.asks,
        ],
      });
    },
    [state, setRaw, now],
  );

  const regenerateCode = useCallback(() => {
    setRaw({ ...state, inviteCode: mintCode() });
  }, [state, setRaw]);

  const actions = useMemo<PartnerActions>(
    () => ({ setSharing, sendAsk, regenerateCode }),
    [setSharing, sendAsk, regenerateCode],
  );

  return { state, actions };
}
