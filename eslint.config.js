import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * WindRide lint config (WR-001).
 *
 * Enforces the module-boundary law from ARCHITECTURE §3 and CLAUDE.md rule 4:
 *   - src/engine/** is PURE: it may not import from adapters/ui/state/nav/data,
 *     and may not read the wall clock (Date.now) — the clock is passed in.
 *   - src/ui/** and src/state/** never import from adapters directly; the flow is
 *     UI -> state (stores) -> adapters.
 */
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // engine/** — the pure core. No I/O, no DOM, no wall clock, no upward imports.
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '**/ui/**', '**/state/**', '**/nav/**', '**/data/**'],
              message:
                'engine/ must stay pure (ARCHITECTURE §3): no imports from adapters, ui, state, nav, or data.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'engine/ is clock-free (ARCHITECTURE §2): pass the current time in as a parameter.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ui/** and state/** — UI never fetches; stores own the adapter calls.
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'UI components never fetch (ARCHITECTURE §3): read stores; stores call adapters.',
            },
          ],
        },
      ],
    },
  },

  // Test files may use node + vitest globals freely.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier,
);
