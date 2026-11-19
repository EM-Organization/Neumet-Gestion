// Tests de la leyenda y zonas del gráfico de Mediciones.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../../adminpanel/index.html', import.meta.url), 'utf8');

function leyendaMediciones() {
  const start = html.indexOf('<div class="tire-legend"');
  if (start === -1) return '';
  let depth = 0, i = start;
  for (; i < html.length; i++) {
    if (html.slice(i, i + 5) === '<div ') depth++;
    else if (html.slice(i, i + 6) === '</div>') {
      depth--;
      if (depth === 0) return html.slice(start, i + 6);
    }
  }
  return '';
}

test('leyenda de Mediciones muestra las cinco categorías sin vocabulario viejo', () => {
  const block = leyendaMediciones();
  assert.ok(block, 'existe el bloque de leyenda');
  assert.match(block, /Nuevo/);
  assert.match(block, /Poco desgaste/);
  assert.match(block, /Mayor desgaste/);
  assert.match(block, /Desgaste límite/);
  assert.match(block, /Desconocido/);
  assert.doesNotMatch(block, /\bOK\b/);
  assert.doesNotMatch(block, /\bBajo\b/);
  assert.doesNotMatch(block, /\bCr[ií]tico\b/i);
});
