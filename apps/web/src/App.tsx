import { REGISTRY } from '@ollie/events';
import { cycle } from '@ollie/logic';
import { getString } from './i18n';
import { useStoreSlice } from './store';

const eventCount = Object.keys(REGISTRY).length;

const DAY = 86_400_000;
const SAMPLE_STARTS = [0, 28, 56, 84, 112, 140].map((d) => ({
  ts: Date.now() - (140 - d) * DAY,
  action: 'started' as const,
}));
const samplePrediction = cycle.predictNextPeriod(cycle.detectBoundaries(SAMPLE_STARTS));

export function App() {
  const [visits, setVisits] = useStoreSlice<number>('shared', 'visit_count', 0);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-editor)',
        padding: '4rem 2rem',
      }}
    >
      <h1 style={{ fontSize: 'var(--t-h1)', fontWeight: 400, margin: 0 }}>
        {getString('en', 'onb.intro.title')}
      </h1>
      <p
        style={{
          color: 'var(--ink-soft)',
          fontSize: 'var(--t-body)',
          marginTop: '1rem',
          maxWidth: '40ch',
        }}
      >
        ollie · workspace scaffold · phase 3c
      </p>

      <p
        style={{
          color: 'var(--ink-faint)',
          fontSize: 'var(--t-caption)',
          marginTop: '2rem',
          fontFamily: 'var(--font-system)',
          letterSpacing: '0.04em',
          lineHeight: 1.7,
        }}
      >
        @ollie/events · {eventCount} events registered
        <br />
        @ollie/store · you've opened this page {visits} {visits === 1 ? 'time' : 'times'}
        <br />
        @ollie/logic · sample 6-cycle user · tier {samplePrediction.tier} · avg{' '}
        {samplePrediction.avgCycle}d · next around{' '}
        {samplePrediction.expectedStart?.toISOString().slice(0, 10) ?? '—'}
      </p>

      <button
        type="button"
        onClick={() => setVisits(visits + 1)}
        style={{
          marginTop: '1.5rem',
          padding: '0.5rem 1rem',
          background: 'transparent',
          color: 'var(--ink)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          fontFamily: 'var(--font-system)',
          fontSize: 'var(--t-caption)',
          cursor: 'pointer',
        }}
      >
        bump visit count
      </button>
    </main>
  );
}
