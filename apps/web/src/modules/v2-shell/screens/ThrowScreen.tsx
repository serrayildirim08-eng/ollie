/**
 * v2-shell · ThrowScreen — the capture deck's home (throw.html)
 *
 * DIRECTION.md: "Throw is the app's entry — one input + mic." The screen
 * is exactly that: a soft warm field and one ink mic. Nothing else.
 *
 * The input is wired to the REAL brain-dump capture — `onThrow(text)` is
 * the shell's bridge to `applyDump(text, 'text')`, the same router the
 * live app's home screen uses. Submitting a non-empty thought clears the
 * field and asks the shell to slide to Caught (the thought landed).
 *
 * The mic asks the shell to open Listening (the live voice-capture screen);
 * Listening owns the speech session and routes its transcript back through
 * the same `onThrow`.
 *
 * Built from throw.html verbatim: warm field, 26px radius, ghost copy, the
 * ink mic with the idle pulse ring.
 */
import { useCallback, useState } from 'react';
import { v2 } from '../../money-v2/v2';

const box = { boxSizing: 'border-box' as const };

export interface ThrowScreenProps {
  /** route a thrown thought through the real brain-dump pipeline */
  onThrow: (text: string) => void;
  /** open the Listening voice-capture screen */
  onMic: () => void;
}

export function ThrowScreen({ onThrow, onMic }: ThrowScreenProps) {
  const [text, setText] = useState('');

  const submit = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    onThrow(t);
    setText('');
  }, [text, onThrow]);

  return (
    <div
      style={{
        ...box,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 40px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <form
        style={{ ...box, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* the one thing — the input field */}
        <label
          htmlFor="v2-throw-field"
          style={{ ...box, width: '100%' }}
        >
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            throw a thought
          </span>
          <textarea
            id="v2-throw-field"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="throw a thought…"
            rows={3}
            onKeyDown={(e) => {
              // Enter (no shift) commits — a thought is one line, usually
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            style={{
              ...box,
              width: '100%',
              minHeight: 118,
              resize: 'none',
              background: v2.card,
              border: `1px solid ${v2.line}`,
              borderRadius: 26,
              boxShadow: '0 12px 30px rgba(42,38,34,.05)',
              padding: '26px 24px',
              fontFamily: v2.sans,
              fontSize: 21,
              lineHeight: 1.4,
              letterSpacing: '-.01em',
              color: v2.ink,
              outline: 'none',
            }}
          />
        </label>

        {/* the mic — the only other affordance */}
        <div
          style={{
            ...box,
            marginTop: 54,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* idle pulse ring */}
          <span
            aria-hidden
            style={{
              ...box,
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: '50%',
              border: `2px solid ${v2.ink}`,
              animation: 'v2ShellPulse 3.4s ease-out infinite',
            }}
          />
          <button
            type="button"
            aria-label="voice capture"
            onClick={onMic}
            style={{
              ...box,
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: v2.ink,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 14px 34px rgba(42,38,34,.22)',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={v2.paper} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
            </svg>
          </button>
        </div>
      </form>

      {/* the pulse keyframes — scoped, injected once */}
      <style>{`@keyframes v2ShellPulse{0%{transform:scale(1);opacity:.3}100%{transform:scale(1.9);opacity:0}}`}</style>
    </div>
  );
}
