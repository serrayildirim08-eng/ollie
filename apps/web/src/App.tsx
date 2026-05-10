import { REGISTRY } from '@ollie/events';
import { getString } from './i18n';

const eventCount = Object.keys(REGISTRY).length;

export function App() {
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
        ollie · workspace scaffold · phase 3a
      </p>
      <p
        style={{
          color: 'var(--ink-faint)',
          fontSize: 'var(--t-caption)',
          marginTop: '2rem',
          fontFamily: 'var(--font-system)',
          letterSpacing: '0.04em',
        }}
      >
        @ollie/events · {eventCount} events registered
      </p>
    </main>
  );
}
