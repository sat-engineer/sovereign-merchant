module.exports = {
  extends: [
    'eslint:recommended',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es2021: true,
  },
  rules: {
    'no-unused-vars': 'off', // Turn off base rule
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off', // Allow console.log in backend
    'prefer-const': 'error',
    'no-var': 'error',
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
};
