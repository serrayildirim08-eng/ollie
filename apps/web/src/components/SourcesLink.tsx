import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getString, type Locale } from '../i18n';

interface SourcesLinkProps {
  sources: string[];
  label?: string;
  locale?: Locale;
}

/**
 * SourcesLink — used on health-flag cards and clinician-sourced content.
 * Renders a small "sources" trigger that on click reveals a list of
 * clickable citation URLs in a positioned dropdown.
 *
 * Keyboard: Enter/Space to toggle, ESC to close.
 * Click-outside closes.
 */
export function SourcesLink({ sources, label, locale = 'en' }: SourcesLinkProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Hooks must run on every render — only bail out after them.
  if (sources.length === 0) return null;

  const defaultLabel = getString(locale, 'help.sources_label');
  const displayLabel = label ?? defaultLabel;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--font-system)',
          fontSize: 'var(--t-meta)',
          letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase',
          color: open ? 'var(--ink-soft)' : 'var(--ink-faint)',
          textDecoration: open ? 'underline' : 'none',
          textUnderlineOffset: '3px',
          transition: `color var(--d-tap)`,
        }}
      >
        {displayLabel}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={displayLabel}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            width: 'min(360px, 90vw)',
            padding: '14px 16px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm)',
            zIndex: 'var(--z-overlay)' as React.CSSProperties['zIndex'],
            boxShadow: 'var(--sh-md)',
            animation: 'fadeUp 180ms var(--e-calm-out) both',
          }}
        >
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sources.map((url, i) => {
              // Display just the hostname + first path segment for brevity
              let display = url;
              try {
                const parsed = new URL(url);
                const pathParts = parsed.pathname.split('/').filter(Boolean);
                display = parsed.hostname + (pathParts.length > 0 ? '/' + pathParts[0] : '');
              } catch {
                // not a full URL — show as-is
              }

              return (
                <li key={i} role="option" aria-selected={false}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: 'var(--font-system)',
                      fontSize: 'var(--t-meta)',
                      letterSpacing: '0.04em',
                      color: 'var(--ink-soft)',
                      textDecoration: 'underline',
                      textUnderlineOffset: '3px',
                      display: 'block',
                      wordBreak: 'break-all',
                    }}
                  >
                    {display}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
