const js = require('@eslint/js');
const globals = require('globals');
const noUnsanitized = require('eslint-plugin-no-unsanitized');

// HTML solo entra al DOM vía setHtml(el, html`...`): html`` escapa cada interpolación con esc().
const sanitizeOpts = { escape: { taggedTemplates: ['html'], methods: ['esc'] } };

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['assets/js/**/*.js'],
    plugins: { 'no-unsanitized': noUnsanitized },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        supabase: 'readonly', // UMD de supabase-js
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unsanitized/property': ['error', sanitizeOpts],
      'no-unsanitized/method': ['error', sanitizeOpts],
      'no-useless-escape': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: 'warn',
      'no-unused-vars': 'warn',
    },
  },
];
