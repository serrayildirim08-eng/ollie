import React from 'react';
import { useStoreSlice } from '../../store';
import type { AnyPattern } from '@ollie/logic/pets';

/**
 * PetsNoticed — renders computed P1-P5 patterns from the orchestrator.
 *
 * Paper card · umber left-border · DM Mono caps label · copy line ·
 * source footer dotted-underline · "×" dismiss persisted to
 * pets.patterns_dismissed.
 *
 * Run-length ≥3 + 72h cooldown enforced upstream by detectors.
 */
export function PetsNoticed() {
  const [patterns] = useStoreSlice<AnyPattern[]>('pets', 'patterns', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>(
    'pets',
    'patterns_dismissed',
    {},
  );

  const list = Array.isArray(patterns) ? patterns : [];
  const accent = '#4F6E5B'; // notebook moss — pets pattern accent

  function idOf(p: AnyPattern): string {
    if (!p || !p.pattern) return '?';
    if (p.pattern === 'vet-adherence-delay' && 'vet_id' in p && p.vet_id) {
      return `${p.pattern}:${p.vet_id}`;
    }
    if (
      p.pattern === 'care-activation-barrier' &&
      'pet_id' in p &&
      'task' in p
    ) {
      return `${p.pattern}:${(p as { pet_id: string; task: string }).pet_id}:${(p as { pet_id: string; task: string }).task}`;
    }
    if (p.pattern === 'pet-co-regulator' && 'pet_id' in p) {
      return `${p.pattern}:${(p as { pet_id: string | null }).pet_id ?? 'unknown'}`;
    }
    if (p.pattern === 'projection-pattern' && 'pet_id' in p) {
      return `${p.pattern}:${(p as { pet_id: string | null }).pet_id ?? 'unknown'}`;
    }
    return p.pattern;
  }

  function dismiss(id: string) {
    setDismissed({ ...(dismissed || {}), [id]: Date.now() });
  }

  function metaFor(p: AnyPattern): string[] {
    const bits: string[] = [];
    if ('confidence' in p && p.confidence) bits.push(`${p.confidence} confidence`);
    if ('run_length' in p && typeof p.run_length === 'number') {
      bits.push(`run length ${p.run_length}`);
    }
    if ('sample_n' in p && typeof p.sample_n === 'number') {
      bits.push(`${p.sample_n} samples`);
    }
    if ('days_overdue' in p && typeof p.days_overdue === 'number') {
      bits.push(`${p.days_overdue} days past`);
    }
    if (
      p.pattern === 'care-activation-barrier' &&
      'days_since' in p &&
      typeof p.days_since === 'number'
    ) {
      bits.push(`${p.days_since} days since`);
    }
    if ('lift' in p && typeof p.lift === 'number') {
      bits.push(`x${(p as { lift: number }).lift.toFixed(1)}`);
    }
    if ('crash_tagged_n' in p && typeof p.crash_tagged_n === 'number') {
      bits.push(`${p.crash_tagged_n} on crash days`);
    }
    if ('window_days' in p && typeof p.window_days === 'number') {
      bits.push(`over ${p.window_days}d`);
    }
    return bits;
  }

  const visible = list.filter(
    (p) => p && 'copy' in p && p.copy && !(dismissed && dismissed[idOf(p)]),
  );

  const hairline = 'rgba(20,19,15,0.10)';
  const ink = 'var(--ink)';
  const muted = 'var(--ink-soft)';
  const faint = 'var(--ink-faint)';
  const paper = 'var(--paper)';

  const labelStyle: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.26em',
    color: faint,
    textTransform: 'uppercase',
    fontWeight: 500,
  };

  return (
    <section
      style={{
        marginTop: 64,
        paddingTop: 28,
        borderTop: `1px solid ${hairline}`,
      }}
    >
      <div style={{ ...labelStyle, paddingBottom: 20 }}>— noticed</div>
      {visible.length === 0 ? (
        <div
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: 15,
            color: muted,
            lineHeight: 1.55,
            fontStyle: 'italic',
          }}
        >
          patterns surface after a few weeks of logging.
        </div>
      ) : (
        visible.map((p, i) => {
          const id = idOf(p);
          const meta = metaFor(p);
          const copy = 'copy' in p ? (p.copy as string) : '';
          const prompt = 'prompt' in p ? (p as { prompt?: string }).prompt : undefined;
          const nextAction =
            'next_action' in p ? (p as { next_action?: string }).next_action : undefined;
          const suggestion =
            'suggestion' in p ? (p as { suggestion?: string }).suggestion : undefined;
          const source =
            'source' in p
              ? (p as { source?: { citation: string; url: string } }).source
              : undefined;

          return (
            <div
              key={`${id}:${i}`}
              style={{
                padding: '18px 20px',
                background: paper,
                borderLeft: `2px solid ${accent}`,
                borderRadius: 2,
                marginBottom: 12,
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="dismiss"
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 12,
                  background: 'transparent',
                  border: 'none',
                  color: faint,
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '4px 6px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>

              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.24em',
                  color: faint,
                  textTransform: 'uppercase',
                  paddingBottom: 8,
                }}
              >
                {p.pattern.replace(/-/g, ' ')}
              </div>

              <div
                style={{
                  fontFamily: "'Spectral', serif",
                  fontSize: 16,
                  color: ink,
                  lineHeight: 1.55,
                  paddingRight: 24,
                }}
              >
                {copy}
              </div>

              {prompt && (
                <div
                  style={{
                    fontFamily: "'Spectral', serif",
                    fontSize: 14,
                    color: muted,
                    lineHeight: 1.55,
                    paddingTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  {prompt}
                </div>
              )}

              {nextAction && (
                <div
                  style={{
                    fontFamily: "'Spectral', serif",
                    fontSize: 13,
                    color: muted,
                    lineHeight: 1.5,
                    paddingTop: 8,
                  }}
                >
                  next: {nextAction}
                </div>
              )}

              {suggestion && (
                <div
                  style={{
                    fontFamily: "'Spectral', serif",
                    fontSize: 13,
                    color: muted,
                    lineHeight: 1.5,
                    paddingTop: 8,
                  }}
                >
                  {suggestion}
                </div>
              )}

              {meta.length > 0 && (
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    color: faint,
                    textTransform: 'uppercase',
                    paddingTop: 10,
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  {meta.map((m, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span>·</span>}
                      <span>{m}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {source?.citation && (
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    color: faint,
                    paddingTop: 8,
                    lineHeight: 1.5,
                  }}
                >
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: faint,
                        textDecoration: 'none',
                        borderBottom: `1px dotted ${faint}`,
                      }}
                    >
                      {source.citation}
                    </a>
                  ) : (
                    source.citation
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
