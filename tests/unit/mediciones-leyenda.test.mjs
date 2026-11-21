// Tests de la leyenda y zonas del gráfico de Mediciones.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medicionesZonaFill } from '../../assets/js/domain/desgaste.js';

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
  assert.match(block, /Buen estado/);
  assert.match(block, /Poco desgaste/);
  assert.match(block, /Mayor desgaste/);
  assert.match(block, /Desgaste límite/);
  assert.match(block, /Sin datos/);
  assert.doesNotMatch(block, /\bOK\b/);
  assert.doesNotMatch(block, /\bBajo\b/);
  assert.doesNotMatch(block, /\bCr[ií]tico\b/i);
});

test('Mediciones nombra la suma como «Buen estado o poco desgaste» y la rueda sin lecturas como «Sin datos»', () => {
  assert.match(html, /tire-counter-l">Buen estado o poco desgaste</);
  assert.doesNotMatch(html, /Buen estado \/ poco desgaste/);
  const js = readFileSync(new URL('../../assets/js/views/mediciones.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /\/ poco desgaste/);
  assert.match(js, /neutral:\{cls:'',txt:ESTADOS\.sinDatos\.texto\}/);
});

test('zona del gráfico de Mediciones: 4,2 mm es mayor desgaste (naranja), 2,8 mm es desgaste límite (rojo)', () => {
  assert.equal(medicionesZonaFill(4.2), 'rgba(255,149,0,0.04)');
  assert.equal(medicionesZonaFill(2.8), 'rgba(255,59,48,0.04)');
  assert.equal(medicionesZonaFill(7.0), 'rgba(52,199,89,0.04)');
  assert.equal(medicionesZonaFill(null), null);
});
