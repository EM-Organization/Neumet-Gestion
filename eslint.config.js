const js = require('@eslint/js');
const globals = require('globals');
const noUnsanitized = require('eslint-plugin-no-unsanitized');

// HTML solo entra al DOM vía setHtml(el, html`...`): html`` escapa cada interpolación con esc().
const sanitizeOpts = { escape: { taggedTemplates: ['html'], methods: ['esc'] } };

const svelte = require('eslint-plugin-svelte');
const svelteParser = require('svelte-eslint-parser');

// Un solo cliente de Supabase (docs/19 §5.2): el front nuevo recibe `ctx.db`, el mismo cliente del panel viejo.
// Dos clientes dan «Multiple GoTrueClient» y se pisan los refrescos de sesión.
const sinClienteSupabase = {
  'no-restricted-imports': ['error', { paths: [{ name: '@supabase/supabase-js', message: 'src/ usa ctx.db; no crear un segundo cliente (docs/19 §5.2).' }] }],
  'no-restricted-syntax': ['error',
    { selector: "CallExpression[callee.name='createClient']", message: 'Prohibido createClient en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "CallExpression[callee.property.name='createClient']", message: 'Prohibido supabase.createClient en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "ImportExpression[source.value='@supabase/supabase-js']", message: 'Prohibido importar supabase-js en src/ (docs/19 §5.2).' }],
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**'] },
  // Svelte: las reglas recomendadas se acotan a src/ para no tocar el resto del repositorio.
  ...svelte.configs['flat/recommended'].map((c) => ({ ...c, files: c.files ?? ['src/**/*.{js,svelte}'] })),
  {
    // Front nuevo (F11): módulos ES con bundler. svelte/no-at-html-tags equivale a la regla del sumidero de core/html.js.
    files: ['src/**/*.{js,svelte}'],
    plugins: { 'no-unsanitized': noUnsanitized },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      ...js.configs.recommended.rules,
      ...sinClienteSupabase,
      'no-unsanitized/property': ['error', sanitizeOpts],
      'no-unsanitized/method': ['error', sanitizeOpts],
      'svelte/no-at-html-tags': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: 'warn',
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['src/**/*.svelte'],
    languageOptions: { parser: svelteParser, globals: { ...globals.browser } },
  },
  {
    files: ['src/**/*.test.js', 'src/vite.config.*'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['vite.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules },
  },
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
