import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ollie from './tools/eslint-plugin-ollie/index.cjs';

// Report-only ESLint setup. Most rules are "warn" on purpose:
// nothing here blocks builds or tests — see root `lint` script.
//
// Exception: ollie/no-banned-copy is "error" by design. It is the
// voice-library / notification-scope guard (formerly the standalone
// tools/scan-banned-phrases.cjs) and MUST block merge. The i18n-JSON pass
// it cannot cover lives in tools/scan-banned-json.cjs and runs in CI
// alongside `pnpm lint`.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.claude/**',
      '**/ios/App/**',
      '**/ios/www/**',
      '**/www/assets/**',
      '**/*.min.js',
      '**/*.config.*',
      '**/*.cjs',
      // only lint our own source — skip plain bundled .js
      '**/*.js',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // Voice-library guard. "error" so a banned phrase blocks merge — this is
    // the AST replacement for tools/scan-banned-phrases.cjs.
    //
    // `files` mirrors the legacy scanner's SCAN_DIRS exactly (apps/*/src +
    // the eight scanned packages/*/src). All source there is .ts/.tsx
    // (verified), so coverage is identical. Scoping it this way also keeps
    // the rule off rule-table mirrors that legitimately spell banned words —
    // notably workers/cron/src/banned-phrases.ts, which the legacy scanner
    // never scanned (workers/ was outside SCAN_DIRS).
    //
    // Test files are exempted INSIDE the rule (it short-circuits on
    // *.test.* / *.spec.* / tests/ paths) — tests quote banned words to
    // assert against them. Do not add a test-file override here; the rule
    // owns that distinction so RuleTester can exercise it.
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'apps/desktop/src/**/*.{ts,tsx}',
      'packages/logic/src/**/*.{ts,tsx}',
      'packages/orchestrator/src/**/*.{ts,tsx}',
      'packages/router/src/**/*.{ts,tsx}',
      'packages/events/src/**/*.{ts,tsx}',
      'packages/store/src/**/*.{ts,tsx}',
      'packages/api/src/**/*.{ts,tsx}',
    ],
    plugins: { ollie },
    rules: {
      'ollie/no-banned-copy': 'error',
    },
  },
);
