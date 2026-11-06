const js = require('@eslint/js');
const globals = require('globals');
const noUnsanitized = require('eslint-plugin-no-unsanitized');

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
        // Funciones expuestas vía window.X = ... (usadas por handlers inline)
        removeClient: 'readonly',
        openClienteModal: 'readonly',
        closeClienteModal: 'readonly',
        openGastoModal: 'readonly',
        closeGastoModal: 'readonly',
        openDispositivoModal: 'readonly',
        closeDispositivoModal: 'readonly',
        openNeumaticosModal: 'readonly',
        closeNeumaticosModal: 'readonly',
        openVehiculoModal: 'readonly',
        closeVehiculoModal: 'readonly',
        openStockModal: 'readonly',
        closeStockModal: 'readonly',
        medDeviceSelect: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unsanitized/property': 'warn',
      'no-unsanitized/method': 'warn',
      'no-useless-escape': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: 'warn',
      'no-unused-vars': 'warn',
    },
  },
];
