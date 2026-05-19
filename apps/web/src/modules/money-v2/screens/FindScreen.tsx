/**
 * money-v2 · FindScreen — search (find.html, money-scoped)
 *
 * One search field, swipe-down to dismiss. In the full app Find reaches
 * the whole notebook; in the money preview it searches the finance
 * notebook — bills, subscriptions, savings goals, logged spends — and
 * jumps to the matching submodule. Each result wears the info-card
 * grammar and shows its path (`money › bills`).
 *
 * Real data: searches the live `finance.*` slices via useFinanceSlices.
 */
import { useMemo, useState } from 'react';
import { IconSearch, IconChevronDown, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { upcomingBillRows, subscriptionAudit, fmtMoney, fmtWhen } from '../selectors';
import type { MoneyRoute } from '../MoneyApp';

export interface FindScreenProps {
  now: number;
  onBack: () => void;
  navigate: (to: MoneyRoute) => void;
}

interface Result {
  path: string;
  title: string;
  detail: string;
  route: MoneyRoute;
}

export function FindScreen({ now, onBack, navigate }: FindScreenProps) {
  const slices = useFinanceSlices();
  const [q, setQ] = useState('');

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const out: Result[] = [];

    for (const b of upcomingBillRows(slices.bills, now)) {
      if (b.name.toLowerCase().includes(query)) {
        out.push({
          path: 'money › bills',
          title: b.name,
          detail: `$${fmtMoney(b.amount)} · ${fmtWhen(b.dueAt, now)}`,
          route: 'bills',
        });
      }
    }
    for (const s of subscriptionAudit(slices.subscriptions, slices.records, now)) {
      if (s.name.toLowerCase().includes(query)) {
        out.push({
          path: 'money › subscriptions',
          title: s.name,
          detail: s.priceLabel,
          route: 'subscriptions',
        });
      }
    }
    for (const g of slices.goals ?? []) {
      if (g.name.toLowerCase().includes(query)) {
        out.push({
          path: 'money › savings',
          title: g.name,
          detail: `$${fmtMoney(g.saved)} / $${fmtMoney(g.target)}`,
          route: 'savings',
        });
      }
    }
    for (const r of slices.records ?? []) {
      const m = r.merchant ?? r.category ?? '';
      if (m.toLowerCase().includes(query)) {
        out.push({
          path: `money › ${r.direction === 'in' ? 'income' : 'spends'}`,
          title: m,
          detail: `$${fmtMoney(r.amount ?? 0)} · ${r.event_date}`,
          route: r.direction === 'in' ? 'income' : 'adhdtax',
        });
      }
    }
    // submodules by name
    const areas: Array<[string, MoneyRoute]> = [
      ['bills', 'bills'],
      ['income', 'income'],
      ['subscriptions', 'subscriptions'],
      ['savings', 'savings'],
      ['adhd tax', 'adhdtax'],
    ];
    for (const [name, route] of areas) {
      if (name.includes(query)) {
        out.push({ path: 'money', title: name, detail: 'open this area', route });
      }
    }
    return out.slice(0, 12);
  }, [q, slices, now]);

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        aria-label="dismiss search"
        onClick={onBack}
        style={{
          height: 28,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: 12,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
      </button>

      <div style={{ padding: '14px 26px 0', boxSizing: 'border-box' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: `1px solid ${v2.line}`,
            background: v2.card,
            borderRadius: 16,
            padding: '0 16px',
            height: 52,
            boxSizing: 'border-box',
          }}
        >
          <IconSearch stroke={v2.mute} />
          <input
            ref={(el) => el?.focus()}
            aria-label="search the money notebook"
            placeholder="find a bill, a goal, a spend…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 16,
              color: v2.ink,
              fontFamily: v2.sans,
            }}
          />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 26px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
          boxSizing: 'border-box',
        }}
      >
        {q.trim() === '' ? (
          <div
            style={{
              marginTop: 60,
              textAlign: 'center',
              fontSize: 14,
              color: v2.mute,
              fontWeight: 500,
            }}
          >
            search the whole money notebook
          </div>
        ) : results.length === 0 ? (
          <div
            style={{
              marginTop: 60,
              textAlign: 'center',
              fontSize: 14,
              color: v2.mute,
              fontWeight: 500,
            }}
          >
            nothing matches “{q.trim()}” yet
          </div>
        ) : (
          results.map((r, i) => (
            <button
              key={r.path + r.title + i}
              type="button"
              onClick={() => navigate(r.route)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${v2.line}`,
                padding: '16px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                cursor: 'pointer',
                boxSizing: 'border-box',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: v2.mute,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    marginBottom: 3,
                  }}
                >
                  {r.path}
                </span>
                <span
                  style={{ display: 'block', fontSize: 15, color: v2.ink, fontWeight: 500 }}
                >
                  {r.title}
                </span>
                <span
                  style={{ display: 'block', fontSize: 13, color: v2.mute, marginTop: 2 }}
                >
                  {r.detail}
                </span>
              </span>
              <span style={{ transform: 'rotate(-90deg)' }} aria-hidden>
                <IconChevronDown stroke={v2.mute} />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
