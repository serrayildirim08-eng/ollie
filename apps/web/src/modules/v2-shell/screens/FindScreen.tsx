/**
 * v2-shell · FindScreen — search the whole notebook (find.html)
 *
 * DIRECTION.md "Findability — the Find dot": a calm search dot, top-left
 * at every level, opens one search field; swipe-down to dismiss. It
 * reaches the whole notebook — thrown thoughts and any submodule, jumped
 * to by name — and every result shows its path crumb so the user learns
 * where things live.
 *
 * The shell's Find searches two real corpora:
 *   - the caught thoughts thrown this session (`caught · …`), and
 *   - the twelve submodules by name (`body › sleep`, `home › admin`, …).
 * Tapping a result jumps into that submodule's real `*-v2` app, or — for
 * a caught thought that routed somewhere — into its drawer.
 *
 * Searching the deep live data inside each submodule (a grocery line, a
 * goal, an admin task) is a documented follow-up — it needs every
 * submodule's selectors assembled here. The grammar (info-card + path
 * crumb) is already correct, so that is an additive change.
 */
import { useMemo, useState } from 'react';
import { v2, IconSearch } from '../../money-v2/v2';
import type { CaughtThought } from '../capture-routing';
import type { ModuleKey, SubmoduleKey } from '../types';

const box = { boxSizing: 'border-box' as const };

/** every submodule, with the module room it lives in — the Find corpus */
const SUBMODULE_INDEX: Array<{ key: SubmoduleKey; name: string; module: ModuleKey }> = [
  { key: 'money', name: 'finance', module: 'money' },
  { key: 'cycle', name: 'cycle', module: 'body' },
  { key: 'sleep', name: 'sleep', module: 'body' },
  { key: 'body', name: 'body', module: 'body' },
  { key: 'medication', name: 'medication', module: 'body' },
  { key: 'habits', name: 'habits', module: 'body' },
  { key: 'admin', name: 'admin', module: 'home' },
  { key: 'pets', name: 'pets', module: 'home' },
  { key: 'grocery', name: 'grocery', module: 'home' },
  { key: 'work', name: 'work', module: 'work' },
  { key: 'goals', name: 'goals', module: 'work' },
];

export interface FindScreenProps {
  /** dismiss Find — swipe-down handle / X */
  onClose: () => void;
  /** thoughts caught this session — the searchable thrown-thought corpus */
  caught: CaughtThought[];
  /** jump into a submodule's real `*-v2` app */
  onOpenSubmodule: (submodule: SubmoduleKey) => void;
}

interface FindResult {
  id: string;
  /** the path crumb — "home › admin", "caught · 3 days ago" */
  path: string;
  /** the result line, with the matched fragment marked */
  label: string;
  /** the matched substring, for the accent mark */
  match: string;
  /** where tapping it goes, if anywhere */
  submodule: SubmoduleKey | null;
}

function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function FindScreen({ onClose, caught, onOpenSubmodule }: FindScreenProps) {
  const [q, setQ] = useState('');

  const results = useMemo<FindResult[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: FindResult[] = [];

    // thrown thoughts caught this session
    caught.forEach((c, i) => {
      if (c.text.toLowerCase().includes(query)) {
        out.push({
          id: `caught-${i}`,
          path: `caught · ${ago(c.at)}`,
          label: c.text,
          match: query,
          submodule: c.submodule,
        });
      }
    });

    // submodules, jumped to by name
    for (const s of SUBMODULE_INDEX) {
      if (s.name.includes(query)) {
        out.push({
          id: `sub-${s.key}`,
          path: `${s.module} › jump to submodule`,
          label: s.name,
          match: query,
          submodule: s.key,
        });
      }
    }
    return out;
  }, [q, caught]);

  const trimmed = q.trim();

  return (
    <div
      data-testid="v2-find"
      style={{
        ...box,
        position: 'absolute',
        inset: 0,
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        zIndex: 40,
        overflowX: 'hidden',
      }}
    >
      {/* swipe-down handle — dismisses Find (also a tap target) */}
      <button
        type="button"
        aria-label="close find"
        onClick={onClose}
        style={{
          ...box,
          height: 34,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: 14,
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
      </button>

      <div style={{ ...box, flex: 1, overflowY: 'auto', padding: '20px 24px 26px', display: 'flex', flexDirection: 'column' }}>
        {/* the search field — one calm input */}
        <label
          htmlFor="v2-find-field"
          style={{
            ...box,
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            background: v2.card,
            border: `1px solid ${v2.line}`,
            borderRadius: 18,
            padding: '16px 18px',
            boxShadow: '0 10px 26px rgba(42,38,34,.05)',
          }}
        >
          <IconSearch stroke={v2.mute} size={19} />
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            search the notebook
          </span>
          <input
            id="v2-find-field"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search the notebook…"
            autoFocus
            style={{
              ...box,
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: v2.sans,
              fontSize: 18,
              color: v2.ink,
              fontWeight: 400,
              letterSpacing: '-.01em',
            }}
          />
        </label>

        {/* a quiet result count */}
        {trimmed.length > 0 && (
          <div style={{ fontSize: 12, color: v2.mute, fontWeight: 600, letterSpacing: '.04em', margin: '24px 4px 12px' }}>
            {results.length === 0
              ? 'nothing found'
              : `${results.length} across the notebook`}
          </div>
        )}

        {/* results — info-card grammar, each with its path crumb */}
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled={!r.submodule}
            onClick={() => r.submodule && onOpenSubmodule(r.submodule)}
            style={{
              ...box,
              width: '100%',
              background: v2.card,
              border: `1px solid ${v2.line}`,
              borderRadius: 18,
              boxShadow: '0 8px 22px rgba(42,38,34,.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '15px 16px',
              marginBottom: 10,
              cursor: r.submodule ? 'pointer' : 'default',
              textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              aria-hidden
              style={{ width: 40, height: 40, borderRadius: 12, background: v2.tile, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <IconSearch stroke={v2.accent} size={18} weight={1.7} />
            </span>
            <span style={{ ...box, flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 400, color: v2.ink, letterSpacing: '-.012em' }}>
                {highlight(r.label, r.match)}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: v2.mute, fontWeight: 500, marginTop: 2 }}>
                {r.path}
              </span>
            </span>
            {r.submodule && (
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={v2.mute} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
                <path d="M9 6l6 6-6 6" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** mark the matched fragment in a result line, accent-coloured */
function highlight(label: string, match: string) {
  const i = label.toLowerCase().indexOf(match.toLowerCase());
  if (i < 0 || !match) return label;
  return (
    <>
      {label.slice(0, i)}
      <span style={{ color: v2.accent, fontWeight: 600 }}>{label.slice(i, i + match.length)}</span>
      {label.slice(i + match.length)}
    </>
  );
}
