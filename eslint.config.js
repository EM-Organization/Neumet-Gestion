const js = require('@eslint/js');
const globals = require('globals');
const noUnsanitized = require('eslint-plugin-no-unsanitized');

// HTML solo entra al DOM vía setHtml(el, html`...`): html`` escapa cada interpolación con esc().
const sanitizeOpts = { escape: { taggedTemplates: ['html'], methods: ['esc'] } };

const svelte = require('eslint-plugin-svelte');
const svelteParser = require('svelte-eslint-parser');

// Un solo cliente de Supabase (docs/19 §5.2): el front nuevo recibe `ctx.db`, el mismo cliente del panel viejo.
// Dos clientes dan «Multiple GoTrueClient» y se pisan los refrescos de sesión.
const msgUno = 'src/ usa ctx.db; no crear un segundo cliente (docs/19 §5.2).';
const sinClienteSupabase = {
  'no-restricted-imports': ['error', {
    paths: [{ name: '@supabase/supabase-js', message: msgUno }],
    patterns: [{ group: ['@supabase/*', '@supabase/**'], message: msgUno }],
  }],
  'no-restricted-syntax': ['error',
    { selector: "CallExpression[callee.name='createClient']", message: 'Prohibido createClient en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "CallExpression[callee.property.name='createClient']", message: 'Prohibido supabase.createClient en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "CallExpression[callee.property.value='createClient']", message: 'Prohibido supabase["createClient"] en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "ObjectPattern > Property[key.name='createClient']", message: 'Prohibido extraer createClient (ni con alias) en src/: usar ctx.db (docs/19 §5.2).' },
    // El global UMD de supabase-js no se toca desde src/ (cubre window.supabase, globalThis.supabase y llamadas indirectas como (0, window.supabase.createClient)()).
    { selector: "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='supabase']", message: 'Prohibido el global supabase en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "NewExpression[callee.name='SupabaseClient'], NewExpression[callee.property.name='SupabaseClient']", message: 'Prohibido new SupabaseClient en src/: usar ctx.db (docs/19 §5.2).' },
    { selector: "ImportExpression[source.value=/^@supabase\\//]", message: 'Prohibido importar @supabase/* en src/ (docs/19 §5.2).' },
    { selector: "ImportExpression[source.type='TemplateLiteral']", message: 'import() con plantilla prohibido en src/: no se puede comprobar el destino (docs/19 §5.2).' }],
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
    files: ['src/**/*.test.js'],
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
