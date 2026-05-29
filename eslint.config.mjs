// Flat ESLint config for the ollie monorepo.
//
// Scope: ACTIVE code only — apps/native, packages/*, workers/*. Legacy
// surfaces (apps/web, apps/ios) and generated output (dist, coverage) are
// ignored so `pnpm lint` stays a usable signal rather than a wall of red on
// code we are deleting. Tighten coverage as legacy is removed.
//
// Wires the local eslint-plugin-ollie/no-banned-copy rule (voice-library
// guard) into ESLint proper — it previously shipped only via the standalone
// tools/scan-banned-phrases.cjs scanner.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import ollie from './tools/eslint-plugin-ollie/index.cjs';

export default tseslint.config(
  {
    // Global ignores — first config object with only `ignores` applies repo-wide.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.claude/**',
      '**/src-tauri/**',
      '**/*.d.ts',
      // Legacy surfaces slated for deletion (see audit 2026-05-29):
      'apps/web/**',
      'apps/ios/**',
      'marketing/**',
      // Dead: passphrase auth superseded by Clerk (main.tsx). Nothing outside
      // src/auth/ imports it — kept for reference until the folder is removed.
      'apps/native/src/auth/**',
      // Tooling + plugin internals are CommonJS scripts with their own checks:
      'tools/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },

  // Base JS + TypeScript recommended (non-type-checked: fast, no project graph).
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    plugins: { ollie },
    rules: {
      // Voice-library guard — the orphaned rule, now enforced.
      'ollie/no-banned-copy': 'error',

      // High-value bug catchers stay as errors.
      'no-debugger': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // Defensible default-init pattern (e.g. `let x = 'en'` then reassign in
      // try) trips this stylistic rule with no bug behind it. Off.
      'no-useless-assignment': 'off',

      // Noisy-on-mature-codebase rules → warnings (ratchet, not a gate fail).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  {
    // banned-phrases.ts files ARE the banned-word rule table (data, not
    // user-facing copy) — they must quote the banned words by definition.
    files: ['**/banned-phrases.ts'],
    rules: { 'ollie/no-banned-copy': 'off' },
  },
);
