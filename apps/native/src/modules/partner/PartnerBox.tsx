/**
 * PartnerBox · /box/partner — pairing + consent + the intimate window.
 *
 * State machine: loading → pairing (QR + 6-digit, decision 12) → wizard
 * (4 intentional consent toggles, decision 11) → paired (partner's ambient
 * line + my asymmetric consent + silent go-dark + clean-break unpair).
 *
 * Everything here is local + real except the partner's shared state, which is
 * mocked in repo.getPartnerInterpreted() until the bilateral sync backend
 * lands. UI language follows the locked copy decisions (no poetic quiet-day,
 * plain "taking today off"; crisis is text-only).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { mintPartnerCode } from '../../api';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { partnerRepo } from './repo';
import { cardLine, interpret, type RawSignals } from './interpret';
import {
  DEFAULT_CONSENT,
  SHARE_KEYS,
  SHARE_LABELS,
  type ConsentFlags,
  type InterpretedState,
  type PartnerLocalState,
  type ShareKey,
} from './types';

const SMCP: React.CSSProperties = { fontVariantCaps: 'all-small-caps', letterSpacing: '0.13em' };

/** Sample of "your day" used to preview what your partner would see, live, as
 *  you flip consent toggles. Real signals replace this once outflow is wired. */
const PREVIEW_SIGNALS: RawSignals = {
  mood: 'low',
  energy: 'high',
  cyclePhase: null,
  focus: 'deep',
};

type Phase = 'loading' | 'pairing' | 'wizard' | 'paired';

/** Stable 6-digit code derived from the user id (no storage, no collision worry
 *  at this scale; the real backend will mint + match codes server-side). */
function codeFromId(id: string | undefined): string {
  let h = 0;
  for (const ch of id ?? 'ollie') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${h % 1_000_000}`.padStart(6, '0');
}

export function PartnerBox(): JSX.Element {
  const { user } = useUser();
  const { getToken } = useAuth();
  const getBearer = useCallback(async () => (await getToken()) ?? '', [getToken]);

  const [myCode, setMyCode] = useState<string>(() => codeFromId(user?.id));
  const [phase, setPhase] = useState<Phase>('loading');
  const [state, setState] = useState<PartnerLocalState | null>(null);
  const [theirState, setTheirState] = useState<InterpretedState | null>(null);

  // wizard / pairing inputs
  const [partnerName, setPartnerName] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [wizardConsent, setWizardConsent] = useState<ConsentFlags>({ ...DEFAULT_CONSENT });

  const refresh = useCallback(async () => {
    const local = await partnerRepo.load();
    setState(local);
    if (local.pairing) {
      setPhase('paired');
      setTheirState(await partnerRepo.getPartnerInterpreted(local, getBearer));
    } else {
      setPhase((p) => (p === 'wizard' ? 'wizard' : 'pairing'));
      // Mint a real, shareable pairing code for the pairing screen.
      const minted = await mintPartnerCode({ bearer: await getBearer() }).catch(() => null);
      if (minted?.ok) setMyCode(minted.data.code);
    }
  }, [getBearer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── pairing → wizard ──
  const [pairError, setPairError] = useState<string | null>(null);
  const onConnect = () => {
    if (enteredCode.trim().length < 4) return;
    setPairError(null);
    setWizardConsent({ ...DEFAULT_CONSENT });
    setPhase('wizard');
  };

  const onFinishWizard = async () => {
    const res = await partnerRepo.pairWithCode(enteredCode.trim(), partnerName, wizardConsent, getBearer);
    if (!res.ok) {
      setPairError(
        res.error === 'code_not_found' ? "that code didn't match anyone"
        : res.error === 'code_expired' ? 'that code has expired — ask for a fresh one'
        : res.error === 'cannot_pair_self' ? "that's your own code"
        : 'couldn’t connect — try again',
      );
      setPhase('pairing');
      return;
    }
    setState(res.state);
    setTheirState(await partnerRepo.getPartnerInterpreted(res.state, getBearer));
    setPhase('paired');
  };

  const onToggleConsent = async (key: ShareKey) => {
    if (!state) return;
    const next = await partnerRepo.setConsent(state, key, !state.consent[key], getBearer);
    setState(next);
  };

  const onGoDark = async () => {
    if (!state) return;
    const dark = partnerRepo.isDarkToday(state);
    const next = dark
      ? await partnerRepo.clearDark(state, getBearer)
      : await partnerRepo.goDarkToday(state, getBearer);
    setState(next);
  };

  // Solo preview — no second user needed. Local demo pairing, never hits the
  // backend; "remove partner" cleans it right back out.
  const onPreview = async () => {
    const next = await partnerRepo.pairDemo({ cycle: true, mood: true, energy: true, focus: true });
    setState(next);
    setTheirState(await partnerRepo.getPartnerInterpreted(next, getBearer));
    setPhase('paired');
  };

  const onUnpair = async () => {
    if (!window.confirm('Remove your partner? This unlinks you both right away.')) return;
    const cur = state ?? (await partnerRepo.load());
    const next = await partnerRepo.unpair(cur, getBearer);
    setState(next);
    setTheirState(null);
    setPartnerName('');
    setEnteredCode('');
    setPhase('pairing');
  };

  return (
    <Stack gap={56}>
      <Stack gap={8}>
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          box · partner
        </Text>
        <Text scale="display">Partner</Text>
        <Text scale="body" color="var(--ollie-color-ink-soft)" style={{ maxWidth: 460 }}>
          a quiet window into each other’s day — not a to-do you share.
        </Text>
      </Stack>

      {phase === 'loading' && (
        <Text scale="caption" color="var(--ollie-color-ink-faint)">
          loading…
        </Text>
      )}

      {phase === 'pairing' && (
        <PairingView
          myCode={myCode}
          partnerName={partnerName}
          enteredCode={enteredCode}
          onName={setPartnerName}
          onCode={setEnteredCode}
          onConnect={onConnect}
          onPreview={() => void onPreview()}
          error={pairError}
        />
      )}

      {phase === 'wizard' && (
        <WizardView
          consent={wizardConsent}
          onToggle={(k) => setWizardConsent((c) => ({ ...c, [k]: !c[k] }))}
          onFinish={() => void onFinishWizard()}
          onBack={() => setPhase('pairing')}
        />
      )}

      {phase === 'paired' && state?.pairing && theirState && (
        <PairedView
          name={state.pairing.partnerName}
          their={theirState}
          consent={state.consent}
          dark={partnerRepo.isDarkToday(state)}
          onToggleConsent={(k) => void onToggleConsent(k)}
          onGoDark={() => void onGoDark()}
          onUnpair={() => void onUnpair()}
        />
      )}
    </Stack>
  );
}

// ─── pairing ────────────────────────────────────────────────────────────────

function PairingView({
  myCode,
  partnerName,
  enteredCode,
  onName,
  onCode,
  onConnect,
  onPreview,
  error,
}: {
  myCode: string;
  partnerName: string;
  enteredCode: string;
  onName: (v: string) => void;
  onCode: (v: string) => void;
  onConnect: () => void;
  onPreview: () => void;
  error?: string | null;
}): JSX.Element {
  return (
    <Stack gap={44}>
      {/* your code — the calm hero of this screen */}
      <Stack
        gap={20}
        style={{
          alignItems: 'center',
          textAlign: 'center',
          padding: '36px 24px',
          background: 'var(--ollie-color-paper)',
          border: '1px solid var(--ollie-color-hairline-soft)',
          borderRadius: 10,
        }}
      >
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          your invite
        </Text>
        <FauxQR seed={myCode} />
        <Stack gap={8} style={{ alignItems: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--ollie-font-mono, monospace)',
              fontSize: 34,
              letterSpacing: '0.34em',
              paddingLeft: '0.34em',
              color: 'var(--ollie-color-ink)',
            }}
          >
            {myCode}
          </span>
          <Text scale="caption" color="var(--ollie-color-ink-faint)" style={{ maxWidth: 280 }}>
            let them scan it side-by-side, or send these six digits any way you like.
          </Text>
        </Stack>
      </Stack>

      {/* enter theirs */}
      <Stack gap={18}>
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          or enter their code
        </Text>
        <Field label="their name" value={partnerName} onChange={onName} placeholder="e.g. Pınar" />
        <Field
          label="their 6-digit code"
          value={enteredCode}
          onChange={(v) => onCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder="••••••"
          mono
        />
        <PrimaryButton disabled={enteredCode.trim().length < 4} onClick={onConnect}>
          continue
        </PrimaryButton>
        {error && (
          <Text scale="caption" color="var(--ollie-color-ink-soft)">
            {error}
          </Text>
        )}
      </Stack>

      {/* no second user yet → see the inside */}
      <Row gap={8} align="baseline" style={{ borderTop: '1px solid var(--ollie-color-hairline)', paddingTop: 22 }}>
        <Text scale="caption" color="var(--ollie-color-ink-faint)">
          no partner on Ollie yet?
        </Text>
        <LinkButton onClick={onPreview} color="var(--ollie-color-sage-deep)">
          preview the inside →
        </LinkButton>
      </Row>
    </Stack>
  );
}

// ─── wizard (4 intentional toggles, decision 11) ──────────────────────────────

const WIZARD_COPY: Record<ShareKey, string> = {
  cycle: 'where you are in your cycle — softened, never dates or symptoms.',
  mood: 'the weather of your mood — "tender day", not a score.',
  energy: 'roughly how much you’ve got in the tank today.',
  focus: 'whether you’re heads-down or scattered right now.',
};

function WizardView({
  consent,
  onToggle,
  onFinish,
  onBack,
}: {
  consent: ConsentFlags;
  onToggle: (k: ShareKey) => void;
  onFinish: () => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="heading">What do you want them to see?</Text>
        <Text scale="body" color="var(--ollie-color-ink-soft)" style={{ maxWidth: 460 }}>
          you choose each one — and you can change any of it later. nothing is on
          until you turn it on.
        </Text>
      </Stack>

      <Stack gap={0}>
        {SHARE_KEYS.map((k, i) => (
          <Row
            key={k}
            gap={16}
            align="flex-start"
            justify="space-between"
            style={{
              padding: '18px 0',
              borderTop: i === 0 ? '1px solid var(--ollie-color-hairline)' : 'none',
              borderBottom: '1px solid var(--ollie-color-hairline)',
            }}
          >
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Text scale="body">{SHARE_LABELS[k]}</Text>
              <Text scale="caption" color="var(--ollie-color-ink-faint)">
                {WIZARD_COPY[k]}
              </Text>
            </Stack>
            <ConsentToggle on={consent[k]} onClick={() => onToggle(k)} />
          </Row>
        ))}
      </Stack>

      <Row gap={20} align="center">
        <PrimaryButton onClick={onFinish}>start sharing</PrimaryButton>
        <LinkButton onClick={onBack}>back</LinkButton>
      </Row>
    </Stack>
  );
}

// ─── paired ───────────────────────────────────────────────────────────────────

function PairedView({
  name,
  their,
  consent,
  dark,
  onToggleConsent,
  onGoDark,
  onUnpair,
}: {
  name: string;
  their: InterpretedState;
  consent: ConsentFlags;
  dark: boolean;
  onToggleConsent: (k: ShareKey) => void;
  onGoDark: () => void;
  onUnpair: () => void;
}): JSX.Element {
  return (
    <Stack gap={44}>
      {/* their ambient line */}
      <Stack gap={10}>
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          {their.crisis ? 'your person' : 'with you'}
        </Text>
        <Text scale="title" color={their.crisis ? 'var(--ollie-color-sage-deep)' : 'var(--ollie-color-ink)'}>
          {cardLine(name, their)}
        </Text>
      </Stack>

      {/* my outflow — asymmetric consent (decision 6) */}
      <Stack gap={0} style={{ borderTop: '1px solid var(--ollie-color-hairline)' }}>
        <Text scale="lede" color="var(--ollie-color-ink)" style={{ padding: '18px 0 6px' }}>
          what you share back
        </Text>
        {SHARE_KEYS.map((k) => (
          <Row
            key={k}
            gap={16}
            align="center"
            justify="space-between"
            style={{ padding: '13px 0', borderBottom: '1px solid var(--ollie-color-hairline)' }}
          >
            <Text scale="body" color={consent[k] ? 'var(--ollie-color-ink)' : 'var(--ollie-color-ink-faint)'}>
              {SHARE_LABELS[k]}
            </Text>
            <ConsentToggle on={consent[k]} onClick={() => onToggleConsent(k)} />
          </Row>
        ))}
      </Stack>

      {/* live preview — what your partner sees from you, reacting to the toggles */}
      <Stack
        gap={8}
        style={{ padding: '18px 20px', background: 'var(--ollie-color-paper)', border: '1px solid var(--ollie-color-hairline-soft)', borderRadius: 4 }}
      >
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          they see you as
        </Text>
        <Text scale="body" color="var(--ollie-color-ink)">
          {cardLine('you', interpret(PREVIEW_SIGNALS, consent, { nowMs: Date.now() }))}
        </Text>
        <Text scale="caption" color="var(--ollie-color-ink-faint)">
          a sample of today — flip the toggles above and watch it change.
        </Text>
      </Stack>

      {/* silent go-dark (decision 9) */}
      <Stack gap={8}>
        <LinkButton onClick={onGoDark} color={dark ? 'var(--ollie-color-sage-deep)' : 'var(--ollie-color-ink-soft)'}>
          {dark ? 'you’re dark today · turn back on' : 'taking today off'}
        </LinkButton>
        <Text scale="caption" color="var(--ollie-color-ink-faint)">
          {dark
            ? 'they just see “taking today off”. resumes on its own tomorrow.'
            : 'gently hides your window for the rest of today. no fuss, no alert.'}
        </Text>
      </Stack>

      {/* clean break (decision 13) */}
      <LinkButton onClick={onUnpair} color="var(--ollie-color-ink-faint)">
        remove partner
      </LinkButton>
    </Stack>
  );
}

// ─── small parts ──────────────────────────────────────────────────────────────

function ConsentToggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
        fontSize: 12,
        fontWeight: 600,
        ...SMCP,
        color: on ? 'var(--ollie-color-sage-deep)' : 'var(--ollie-color-ink-faint)',
      }}
    >
      {on ? 'sharing' : 'private'}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <Stack gap={6}>
      <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
        {label}
      </Text>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--ollie-color-hairline)',
          padding: '8px 0',
          fontSize: mono ? 22 : 18,
          letterSpacing: mono ? '0.12em' : undefined,
          fontFamily: mono ? 'var(--ollie-font-mono, monospace)' : 'inherit',
          color: 'var(--ollie-color-ink)',
          outline: 'none',
        }}
      />
    </Stack>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        appearance: 'none',
        alignSelf: 'flex-start',
        background: disabled ? 'var(--ollie-color-hairline)' : 'var(--ollie-color-sage-deep)',
        color: disabled ? 'var(--ollie-color-ink-faint)' : 'var(--ollie-color-cream)',
        border: 'none',
        borderRadius: 999,
        padding: '12px 26px',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function LinkButton({
  children,
  onClick,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  color?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: 'none',
        alignSelf: 'flex-start',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        color: color ?? 'var(--ollie-color-ink-soft)',
      }}
    >
      {children}
    </button>
  );
}

/** A deterministic decorative "QR" from the code — three corner finder squares
 *  + a seeded field, so it READS as a QR. Not actually scannable (no dep); the
 *  6-digit code is the working channel for now. */
function FauxQR({ seed }: { seed: string }): JSX.Element {
  const N = 11;
  let h = 0;
  for (const ch of seed) h = (h * 131 + ch.charCodeAt(0)) >>> 0;

  // Finder zones: top-left, top-right, bottom-left (3×3 each).
  const inFinder = (r: number, c: number): boolean =>
    (r < 3 && c < 3) || (r < 3 && c >= N - 3) || (r >= N - 3 && c < 3);

  const cells: boolean[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (inFinder(r, c)) {
        cells.push(true); // solid corner finder squares
        continue;
      }
      h = (h * 1103515245 + 12345) >>> 0;
      cells.push((h >>> 16) % 100 < 44);
    }
  }

  return (
    <div
      aria-hidden
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${N}, 1fr)`,
        gap: 2,
        width: 132,
        height: 132,
        padding: 12,
        background: 'var(--ollie-color-cream)',
        border: '1px solid var(--ollie-color-hairline)',
        borderRadius: 10,
        flexShrink: 0,
      }}
    >
      {cells.map((on, i) => (
        <div key={i} style={{ background: on ? 'var(--ollie-color-ink)' : 'transparent', borderRadius: 2 }} />
      ))}
    </div>
  );
}
