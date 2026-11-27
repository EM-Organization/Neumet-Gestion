// Pulido de tokens (docs/22): lo destructivo sale de los tokens de error y el detalle de vehículo no lleva colores sueltos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contraste, COLOR_NIVEL } from '../../assets/js/domain/vehiculo-diagrama.js';

const leer = a => readFileSync(new URL('../../' + a, import.meta.url), 'utf8');
const css = leer('assets/css/styles.css');
const tokens = leer('assets/css/tokens.css');
const regla = sel => (css.split('\n').find(l => l.trim().startsWith(sel)) || '');
const token = nombre => tokens.match(new RegExp(`--${nombre}:\\s*(#[0-9A-Fa-f]{6})`))[1];
const aRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

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

test('mayor es naranja y límite rojo (decisión del 2026-11-27); el diagrama usa los mismos trazos', () => {
  assert.deepEqual(['est-mayor-fill', 'est-mayor-stroke', 'est-mayor-sym'].map(token), ['#FDE3CF', '#C2570C', '#8A3A00']);
  assert.deepEqual(['est-limite-fill', 'est-limite-stroke', 'est-limite-sym'].map(token), ['#F7E3E0', '#B3362A', '#8E2419']);
  assert.deepEqual([COLOR_NIVEL.ok, COLOR_NIVEL.bajo, COLOR_NIVEL.critico, COLOR_NIVEL.retiro],
    [token('est-bueno-stroke'), token('est-poco-stroke'), token('est-mayor-stroke'), token('est-limite-stroke')]);
  assert.equal(token('err-tint'), token('est-limite-fill'));
});

test('contraste de docs/21 para mayor y límite: símbolo contra relleno >= 4,5; borde contra blanco >= 3', () => {
  for (const estado of ['mayor', 'limite']) {
    assert.ok(contraste(aRgb(token(`est-${estado}-sym`)), aRgb(token(`est-${estado}-fill`))) >= 4.5, `${estado}: símbolo`);
    assert.ok(contraste(aRgb(token(`est-${estado}-stroke`)), [255, 255, 255]) >= 3, `${estado}: borde`);
  }
});
