import { useRef, useState } from 'react';
import { FrostedCard } from './FrostedCard';

export interface BrainDumpInputProps {
  onSubmit: (text: string) => void | Promise<void>;
  placeholder?: string;
  /** Optional hint for the parent to scope routing (e.g. 'pets', 'grocery'). */
  module?: string;
}

/**
 * BrainDumpInput — bottom-fixed text input that captures free-text.
 * Routing is NOT done here; the parent owns onSubmit.
 * Frosted-glass style · DM Sans italic body · submit on Enter · clears after submit.
 * Accessibility: semantic role=search, visible focus ring, aria-label.
 */
export function BrainDumpInput({ onSubmit, placeholder, module }: BrainDumpInputProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolvedPlaceholder = placeholder ?? "what's on your mind...";

  async function handleSubmit() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setValue('');
    try {
      await onSubmit(text);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div
      role="search"
      aria-label={module ? `brain dump · ${module}` : 'brain dump'}
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        // Bottom padding clears the iPhone home indicator via
        // env(safe-area-inset-bottom); the 16px is the visual gap above it.
        padding: '14px 16px calc(14px + env(safe-area-inset-bottom, 0px))',
        // Reserve the right edge so the floating MicButton (right:16)
        // never overlaps the input/enter button on a ~390px screen.
        paddingRight: 'calc(16px + 64px)',
        zIndex: 40,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      <FrostedCard
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 8px 6px 20px',
          borderRadius: '16px',
          pointerEvents: 'auto',
          // Near-opaque so mid-scroll module content doesn't bleed
          // through the fixed bottom bar (FrostedCard's default 0.6 is
          // too sheer over busy module pages). Blur stays for depth.
          background: 'rgba(250, 249, 246, 0.94)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          data-brain-dump="true"
          data-module={module}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          placeholder={resolvedPlaceholder}
          disabled={busy}
          aria-label="type a note and press enter"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
            fontStyle: 'italic',
            fontSize: 'var(--t-body)',
            color: 'var(--ink)',
            lineHeight: 'var(--lh-body)',
          }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !value.trim()}
          aria-label="submit"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-pill)',
            padding: '6px 14px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-meta)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: value.trim() ? 'var(--ink-soft)' : 'var(--ink-ghost)',
            cursor: value.trim() ? 'pointer' : 'default',
            transition: 'color var(--d-tap) var(--e-calm-out)',
          }}
        >
          {busy ? '...' : 'enter'}
        </button>
      </FrostedCard>
    </div>
  );
}
