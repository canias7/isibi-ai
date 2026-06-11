import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Lints the React frontend (src/) only. The Supabase Edge Functions under
// supabase/functions are Deno code (different globals/imports) and are excluded.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'android', 'ios', 'supabase', 'electron', 'release', '*.config.js'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The headline rules: enforce the Rules of Hooks and flag missing
      // effect/memo/callback dependencies (the stale-closure bug class).
      'react-hooks/rules-of-hooks': 'error',
      // error (not warn) so a missing effect dependency fails the build — that's
      // the "buggy hooks can't ship" gate. Intentional exceptions use an explicit
      // // eslint-disable-next-line react-hooks/exhaustive-deps comment.
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Allow the codebase's intentional patterns: `cond ? a() : b()` and
      // `cond && fn()` as statements, and `_`-prefixed deliberately-unused args
      // (e.g. dropping `node` in react-markdown component overrides).
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
);
