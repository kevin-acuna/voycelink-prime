import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/server.ts', 'src/config/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/public/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-redeclare': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
