import React, { useRef, useState } from 'react';
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
        padding: '16px 24px 28px',
        zIndex: 'var(--z-overlay)' as unknown as number,
        boxSizing: 'border-box',
      }}
    >
      <FrostedCard
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 8px 6px 20px',
          borderRadius: '16px',
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
