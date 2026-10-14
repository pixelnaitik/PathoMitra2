import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // The scratch/temp directories are build leftovers (an esbuild/OneDrive
  // workaround points TEMP inside the repo), never source — and app-builder-lib
  // unpacks a whole package under .tmp, which eslint would then lint.
  { ignores: ['dist', 'dist-electron', 'release-desktop', 'node_modules', 'coverage', 'public/sw.js', '**/*.json', 'android', '.build-tmp', '.tmp', '.tmp-build', 'promotion_website'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These newer compiler-based rules flag intentional (and pre-existing)
      // patterns across the dashboard; keep them visible without failing CI.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
);
