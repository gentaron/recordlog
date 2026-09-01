import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', '.wrangler', 'node_modules', 'coverage'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  /* ---- the PWA ---- */
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  /* ---- the Worker ---- */
  {
    files: ['worker/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.worker, ...globals.serviceworker },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'smart'],
    },
  },

  /* ---- plain-JS assets that ship as-is (worklet, model worker) ---- */
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.worker,
        // AudioWorkletGlobalScope
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },

  /* ---- tooling ---- */
  {
    files: ['*.config.{ts,js,mjs}', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  /* ---- end-to-end driver: Node outside, browser inside page.evaluate ---- */
  {
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },

  prettier,
);
