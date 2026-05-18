/**
 * VoiceScreen — voice notes with reviewable transcripts.
 *
 * Today (pre-this-screen) voice is just the MicButton overlay: speak →
 * transcript fires straight into the brain-dump pipeline, no chance to
 * catch a mis-hear. This screen adds the missing step:
 *
 *   speak  →  "heard · …" confirmation  →  edit/correct  →  send to ollie
 *
 * On-device only (Web Speech API / SFSpeechRecognizer per voice-capture.ts).
 * Drafts live in the local store key `voice.transcripts` so a half-reviewed
 * transcript survives a reload. Applying one runs the brain-dump pipeline
 * via the onApply prop and marks the entry 'applied'.
 *
 * Hide-not-lie: if the platform has no speech recognition, the capture
 * affordance is replaced with an honest "voice isn't available here"
 * note instead of a dead button.
 */

import { useEffect, useRef, useState } from 'react';
import { startVoiceCapture, voiceCaptureSupported } from '../lib/voice-capture';
import { useStoreSlice } from '../store';
import { mkId } from '../lib/mkId';
import { getString, type Locale } from '../i18n';

export interface VoiceScreenProps {
  onNavigate: (to: 'home') => void;
  /** Runs the brain-dump pipeline on the reviewed transcript text. */
  onApply: (text: string) => void;
}

type TranscriptStatus = 'draft' | 'applied';

interface VoiceTranscript {
  id: string;
  text: string;
  /** captured-at ms epoch */
  ts: number;
  status: TranscriptStatus;
  applied_at?: number;
}

function uid(): string {
  return mkId('vt');
}

export function VoiceScreen({ onNavigate, onApply }: VoiceScreenProps) {
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale: Locale = settings?.locale === 'es' ? 'es' : 'en';
  const t = (key: string) => getString(locale, `voice.${key}`);

  const [transcripts, setTranscripts] = useStoreSlice<VoiceTranscript[]>(
    'voice',
    'transcripts',
    [],
  );

  const supported = voiceCaptureSupported();
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => () => sessionRef.current?.stop(), []);

  async function start() {
    if (!supported || recording) return;
    setInterim('');
    setError(null);
    setRecording(true);
    sessionRef.current = await startVoiceCapture({
      source: 'mic-button',
      onInterim: (txt) => setInterim(txt),
      onFinal: (text) => {
        setRecording(false);
        setInterim('');
        sessionRef.current = null;
        const entry: VoiceTranscript = {
          id: uid(),
          text: text.trim(),
          ts: Date.now(),
          status: 'draft',
        };
        // newest first
        setTranscripts([entry, ...(transcriptsRef.current ?? [])]);
      },
      onError: () => {
        setRecording(false);
        setInterim('');
        sessionRef.current = null;
        setError(t('error_no_speech'));
        setTimeout(() => setError(null), 4000);
      },
    });
  }

  function stop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setRecording(false);
  }

  // Keep a ref of the latest list so the async onFinal closure doesn't
  // capture a stale array.
  const transcriptsRef = useRef(transcripts);
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  function updateText(id: string, text: string) {
    setTranscripts(
      (transcripts ?? []).map((tr) => (tr.id === id ? { ...tr, text } : tr)),
    );
  }

  function discard(id: string) {
    setTranscripts((transcripts ?? []).filter((tr) => tr.id !== id));
  }

  function applyOne(id: string) {
    const entry = (transcripts ?? []).find((tr) => tr.id === id);
    if (!entry || entry.status === 'applied' || !entry.text.trim()) return;
    onApply(entry.text.trim());
    setTranscripts(
      (transcripts ?? []).map((tr) =>
        tr.id === id ? { ...tr, status: 'applied', applied_at: Date.now() } : tr,
      ),
    );
  }

  const drafts = (transcripts ?? []).filter((tr) => tr.status === 'draft');
  const done = (transcripts ?? []).filter((tr) => tr.status === 'applied');
  const isEmpty = (transcripts ?? []).length === 0;

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '0 max(env(safe-area-inset-left, 0px), 22px) 0 max(env(safe-area-inset-right, 0px), 22px)',
        }}
      >
        <BackButton label={t('back')} onClick={() => onNavigate('home')} />

        <header style={{ marginTop: 8, marginBottom: 24 }}>
          <h1
            style={{
              fontFamily: 'var(--font-editor)',
              fontSize: 'var(--t-h1)',
              fontWeight: 400,
              lineHeight: 1.1,
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {t('title')}
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontStyle: 'italic',
              fontSize: 'var(--t-body)',
              color: 'var(--ink-soft)',
              margin: '8px 0 0',
              lineHeight: 1.5,
            }}
          >
            {t('subtitle')}
          </p>
        </header>

        {/* live interim preview */}
        {recording && interim && (
          <div
            aria-live="polite"
            style={{
              padding: '14px 18px',
              marginBottom: 18,
              border: '1px solid var(--rule)',
              borderRadius: 'var(--r-md, 12px)',
              background: 'rgba(46,93,67,0.04)',
            }}
          >
            <span style={smallCaps('var(--accent)')}>{t('interim_label')}</span>
            <p
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink)',
                margin: '6px 0 0',
                lineHeight: 1.5,
              }}
            >
              {interim}
            </p>
          </div>
        )}

        {error && (
          <p
            role="status"
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 'var(--t-caption, 12px)',
              color: 'var(--ink-soft)',
              margin: '0 0 16px',
            }}
          >
            {error}
          </p>
        )}

        {/* unsupported — honest, no dead button */}
        {!supported && (
          <div
            style={{
              padding: '24px 22px',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--r-md, 12px)',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-editor)',
                fontSize: 'var(--t-body)',
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              {t('unsupported_title')}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-caption, 13px)',
                color: 'var(--ink-soft)',
                margin: '8px 0 0',
                lineHeight: 1.5,
              }}
            >
              {t('unsupported_body')}
            </p>
          </div>
        )}

        {/* empty state */}
        {supported && isEmpty && !recording && (
          <div style={{ padding: '8px 0 24px' }}>
            <p
              style={{
                fontFamily: 'var(--font-editor)',
                fontSize: 'var(--t-h3, 22px)',
                fontWeight: 400,
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              {t('empty_title')}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink-soft)',
                margin: '10px 0 0',
                lineHeight: 1.5,
              }}
            >
              {t('empty_body')}
            </p>
          </div>
        )}

        {/* drafts — newest, awaiting review */}
        {drafts.length > 0 && (
          <section aria-label={t('status_draft')} style={{ marginBottom: 28 }}>
            {drafts.map((tr) => (
              <TranscriptCard
                key={tr.id}
                transcript={tr}
                locale={locale}
                t={t}
                onChangeText={(text) => updateText(tr.id, text)}
                onApply={() => applyOne(tr.id)}
                onDiscard={() => discard(tr.id)}
              />
            ))}
          </section>
        )}

        {/* applied history */}
        {done.length > 0 && (
          <section aria-label={t('history_title')}>
            <h2 style={{ ...smallCaps('var(--ink-faint)'), margin: '0 0 12px' }}>
              {t('history_title')}
            </h2>
            {done.map((tr) => (
              <TranscriptCard
                key={tr.id}
                transcript={tr}
                locale={locale}
                t={t}
                onChangeText={() => undefined}
                onApply={() => undefined}
                onDiscard={() => discard(tr.id)}
              />
            ))}
          </section>
        )}

        {supported && (
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontStyle: 'italic',
              fontSize: 'var(--t-caption, 12px)',
              color: 'var(--ink-faint)',
              margin: '24px 0 0',
              lineHeight: 1.5,
            }}
          >
            {t('privacy_note')}
          </p>
        )}
      </div>

      {/* ── capture control — thumb-reachable, fixed above home indicator ── */}
      {supported && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: '0 22px',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
            pointerEvents: 'none',
          }}
        >
          <button
            type="button"
            onClick={recording ? stop : start}
            aria-pressed={recording}
            aria-label={recording ? t('stop') : t('start')}
            style={{
              pointerEvents: 'auto',
              minHeight: 56,
              padding: '0 32px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              background: recording ? 'var(--accent)' : 'var(--ink)',
              color: 'var(--bone)',
              border: 'none',
              borderRadius: 'var(--r-pill, 999px)',
              boxShadow: 'var(--sh-md)',
              fontFamily: "'DM Mono', monospace",
              fontSize: 'var(--t-caption, 12px)',
              letterSpacing: '0.12em',
              textTransform: 'lowercase',
              cursor: 'pointer',
            }}
          >
            <MicGlyph recording={recording} />
            {recording ? t('listening') : t('start')}
          </button>
        </div>
      )}
    </main>
  );
}

// ─── TranscriptCard ───────────────────────────────────────────────────────────

interface TranscriptCardProps {
  transcript: VoiceTranscript;
  locale: Locale;
  t: (key: string) => string;
  onChangeText: (text: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}

function TranscriptCard({
  transcript,
  locale,
  t,
  onChangeText,
  onApply,
  onDiscard,
}: TranscriptCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(transcript.text);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const applied = transcript.status === 'applied';

  useEffect(() => {
    if (editing) {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }, [editing]);

  const timeStr = new Date(transcript.ts)
    .toLocaleTimeString(locale === 'es' ? 'es-ES' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
    .toLowerCase();

  function saveEdit() {
    onChangeText(draft.trim());
    setEditing(false);
  }

  return (
    <div
      style={{
        padding: '18px 20px',
        marginBottom: 14,
        background: applied ? 'transparent' : 'rgba(255,255,255,0.6)',
        backdropFilter: applied ? undefined : 'blur(16px)',
        WebkitBackdropFilter: applied ? undefined : 'blur(16px)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--r-md, 12px)',
        boxShadow: applied ? undefined : 'var(--sh-md)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={smallCaps(applied ? 'var(--ink-faint)' : 'var(--accent)')}>
          {applied ? t('status_applied') : t('heard_label')}
        </span>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-meta, 10px)',
            letterSpacing: '0.1em',
            color: 'var(--ink-faint)',
          }}
        >
          {timeStr}
        </span>
      </div>

      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t('edit_label')}
          rows={Math.max(2, Math.ceil(draft.length / 40))}
          style={{
            width: '100%',
            marginTop: 10,
            padding: '10px 12px',
            background: 'var(--bone)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm, 4px)',
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-body)',
            color: 'var(--ink)',
            lineHeight: 1.5,
            resize: 'vertical',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
      ) : (
        <p
          style={{
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-body)',
            color: applied ? 'var(--ink-soft)' : 'var(--ink)',
            margin: '8px 0 0',
            lineHeight: 1.55,
          }}
        >
          {transcript.text}
        </p>
      )}

      {/* actions */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 14,
          flexWrap: 'wrap',
        }}
      >
        {!applied && !editing && (
          <>
            <PillButton onClick={onApply} primary disabled={!transcript.text.trim()}>
              {t('apply')}
            </PillButton>
            <PillButton
              onClick={() => {
                setDraft(transcript.text);
                setEditing(true);
              }}
            >
              {t('edit')}
            </PillButton>
            <PillButton onClick={onDiscard}>{t('discard')}</PillButton>
          </>
        )}
        {!applied && editing && (
          <>
            <PillButton onClick={saveEdit} primary disabled={!draft.trim()}>
              {t('save')}
            </PillButton>
            <PillButton
              onClick={() => {
                setDraft(transcript.text);
                setEditing(false);
              }}
            >
              {t('cancel')}
            </PillButton>
          </>
        )}
        {applied && (
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 'var(--t-meta, 11px)',
              letterSpacing: '0.06em',
              color: 'var(--ink-faint)',
            }}
          >
            {t('applied')}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── small parts ──────────────────────────────────────────────────────────────

function PillButton({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 44,
        padding: '8px 18px',
        background: primary && !disabled ? 'var(--ink)' : 'transparent',
        color: primary && !disabled ? 'var(--bone)' : 'var(--ink-soft)',
        border: primary && !disabled ? 'none' : '1px solid var(--rule)',
        borderRadius: 'var(--r-pill, 999px)',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta, 11px)',
        letterSpacing: '0.1em',
        textTransform: 'lowercase',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function MicGlyph({ recording }: { recording: boolean }) {
  if (recording) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        border: 'none',
        padding: '14px 8px 14px 0',
        marginTop: 6,
        minHeight: 44,
        cursor: 'pointer',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta, 11px)',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 3 L5 8 L10 13"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}

function smallCaps(color: string): React.CSSProperties {
  return {
    fontFamily: "'DM Mono', monospace",
    fontSize: 'var(--t-meta, 10px)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color,
  };
}
