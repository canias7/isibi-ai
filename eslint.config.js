import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// Lints the React frontend (src/) only. The Supabase Edge Functions under
// supabase/functions are Deno code (different globals/imports) and are excluded.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'android', 'ios', 'supabase', '*.config.js'] },
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
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Allow the codebase's intentional patterns: `cond ? a() : b()` and
      // `cond && fn()` as statements, and `_`-prefixed deliberately-unused args
      // (e.g. dropping `node` in react-markdown component overrides).
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
);
