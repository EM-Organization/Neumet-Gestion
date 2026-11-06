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
      sourceType: 'module', // módulos ES nativos (sin bundler)
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
  {
    // assets/config.js (define window.NEUMET_CONFIG antes de los módulos) y landing.js son scripts clásicos
    files: ['assets/config.js', 'assets/js/landing.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: { ...js.configs.recommended.rules },
  },
  {
    // tests de Node (node:test)
    files: ['tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules },
  },
];
