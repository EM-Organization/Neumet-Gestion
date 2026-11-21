// Pulido de tokens (docs/22): lo destructivo sale de los tokens de error y el detalle de vehículo no lleva colores sueltos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = a => readFileSync(new URL('../../' + a, import.meta.url), 'utf8');
const css = leer('assets/css/styles.css');
const tokens = leer('assets/css/tokens.css');
const regla = sel => (css.split('\n').find(l => l.trim().startsWith(sel)) || '');

test('.btn.danger usa los tokens de error, también al pasar el cursor', () => {
  assert.match(regla('.btn.danger {'), /background:var\(--err\).*color:var\(--n-blanco\).*border-color:var\(--err\)/);
  assert.match(regla('.btn.danger:hover'), /var\(--err-on-white\)/);
  assert.doesNotMatch(regla('.btn.danger'), /#[0-9a-f]{3,6}\b|white/i);
});

test('los tokens de error existen con el valor de docs/22', () => {
  assert.match(tokens, /--err:\s*#B3362A/i);
  assert.match(tokens, /--err-on-white:\s*#8E2419/i);
  assert.match(tokens, /--err-tint:\s*#F7E3E0/i);
});

test('el CSS del detalle de vehículo no trae rgba de error ni blanco literal', () => {
  const vd = css.split('\n').filter(l => /\.vd-/.test(l)).join('\n');
  assert.doesNotMatch(vd, /rgba\(179,\s*54,\s*42/);
  assert.doesNotMatch(vd, /#fff\b|#ffffff\b/i);
});

test('Flota nombra la ausencia de mediciones con «Sin datos», sin segunda persona', () => {
  const v = leer('assets/js/views/flota.js');
  assert.match(v, /ESTADOS\.sinDatos\.texto\} de medición/);
  assert.doesNotMatch(v, /'Sin mediciones'/);
});
