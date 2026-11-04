import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'src/generated/', 'node_modules/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Company details come only through the typed config module.
      'no-restricted-syntax': ['error', { selector: "MemberExpression[object.property.name='env'][property.name=/^COMPANY_/]", message: 'Read company details through company.config.ts only.' }],
    },
  },
  { files: ['src/config/company.config.ts', 'test/**'], rules: { 'no-restricted-syntax': 'off' } },
);
