module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  rules: {
    // Disabilita regole troppo strict per questo progetto
    '@typescript-eslint/no-explicit-any': 'off', // Necessario per compatibilità con librerie esterne
    '@typescript-eslint/no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/ban-ts-comment': ['error', {
      'ts-expect-error': 'allow-with-description',
      'ts-ignore': false, // Non permettere @ts-ignore
      'ts-nocheck': false,
      'ts-check': false,
    }],
    // Code quality
    'no-console': 'off', // Logger usa console
    'prefer-const': 'warn',
    'no-var': 'error',
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    '*.config.ts',
    '*.config.js',
    '.eslintrc.cjs'
  ],
};