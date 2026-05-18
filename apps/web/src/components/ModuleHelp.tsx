import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getString, type Locale } from '../i18n';

interface ModuleHelpProps {
  moduleId: string;
  locale?: Locale;
}

/**
 * ModuleHelp — small "?" icon button that reveals a bullet-list popover
 * explaining the module. Bullets come from i18n help.<moduleId>.b1–b5.
 *
 * Keyboard: Enter/Space to toggle, ESC to close.
 * Click-outside closes.
 * Positioned absolutely within the module header — no portal needed.
 */
export function ModuleHelp({ moduleId, locale = 'en' }: ModuleHelpProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const bullets: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const key = `help.${moduleId}.b${i}`;
    const value = getString(locale, key);
    if (value && value !== key) bullets.push(value);
  }

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
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
  if (bullets.length === 0) return null;

  const heading = getString(locale, 'help.heading');
  const btnAria = getString(locale, 'help.btn_aria');
  const closeLabel = getString(locale, 'help.close');

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={btnAria}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          width: 26,
          height: 26,
          padding: 0,
          background: open ? 'var(--ink)' : 'transparent',
          color: open ? 'var(--bone)' : 'var(--ink-faint)',
          border: `1px solid ${open ? 'var(--ink)' : 'var(--rule)'}`,
          borderRadius: 'var(--r-pill)',
          cursor: 'pointer',
          fontFamily: 'var(--font-system)',
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: `background var(--d-tap), color var(--d-tap), border-color var(--d-tap)`,
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={heading}
          aria-modal="false"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 'min(420px, 90vw)',
            padding: '20px 22px',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm)',
            zIndex: 'var(--z-overlay)' as React.CSSProperties['zIndex'],
            boxShadow: 'var(--sh-md)',
            animation: 'fadeUp 220ms var(--e-calm-out) both',
          }}
        >
          {/* popover header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 12,
              marginBottom: 12,
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-meta)',
                letterSpacing: 'var(--ls-caps-small)',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
              }}
            >
              {heading}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label={closeLabel}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink-faint)',
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-meta)',
                letterSpacing: 'var(--ls-caps-small)',
                textTransform: 'uppercase',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {closeLabel}
            </button>
          </div>

          {/* bullet list */}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {bullets.map((bullet, i) => (
              <li
                key={i}
                style={{
                  padding: '8px 0',
                  fontFamily: 'var(--font-editor)',
                  fontSize: 'var(--t-caption)',
                  color: 'var(--ink)',
                  lineHeight: 'var(--lh-caption)',
                  display: 'flex',
                  gap: 12,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: 'var(--ink-faint)',
                    fontFamily: 'var(--font-system)',
                    fontSize: 'var(--t-meta)',
                    letterSpacing: '0.1em',
                    flexShrink: 0,
                    paddingTop: 2,
                  }}
                >
                  —
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
