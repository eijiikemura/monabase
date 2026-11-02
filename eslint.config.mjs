// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const typescriptFiles = ['src/**/*.{ts,tsx}', 'vite.config.ts'];

export default [
  { ignores: ['node_modules/**', 'dist/**', 'release/**', 'git/**', 'ai/**', 'trace/**'] },
  {
    ...js.configs.recommended,
    files: ['electron/**/*.js', 'tests/**/*.cjs', 'scripts/**/*.cjs', 'i18next-parser.config.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: {
      ...js.configs.recommended.rules,
      // IPC handlers have positional arguments; unused event arguments are intentional.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }]
    }
  },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: typescriptFiles })),
  {
    ...pluginReact.configs.flat.recommended,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { react: pluginReact, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  { files: ['vite.config.ts'], languageOptions: { globals: globals.node } }
];
