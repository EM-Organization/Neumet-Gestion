// Eje de cada posición según la distribución del vehículo (ejeDePosicion con tipo). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ejeDePosicion, layoutRuedas } from '../../assets/js/domain/vehiculo-diagrama.js';

const ejesDe = (tipo, hasta) => Array.from({ length: hasta }, (_, i) => ejeDePosicion(i + 1, tipo));

describe('ejeDePosicion con distribución del catálogo', () => {
  test('8x2 (SSDS): 1-2 eje 1, 3-4 eje 2, 5-8 eje 3, 9-10 eje 4', () => {
    assert.deepEqual(ejesDe('8x2', 10), [1, 1, 2, 2, 3, 3, 3, 3, 4, 4]);
  });
  test('8x4 (SSDD): 9-12 son el eje 4 doble', () => {
    assert.deepEqual(ejesDe('8x4', 12), [1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  });
  test('sin distribución la 9 cae en el eje 3 (numeración de siempre); con 8x2 cae en el eje 4', () => {
    assert.equal(ejeDePosicion(9), 3);
    assert.equal(ejeDePosicion(9, '8x2'), 4);
  });
  test('posición que no está en la distribución: null', () => {
    assert.equal(ejeDePosicion(11, '8x2'), null);
    assert.equal(ejeDePosicion(17, '8x2'), null);
  });
  test('el auxilio (99) es el eje 0 con cualquier tipo', () => {
    assert.equal(ejeDePosicion(99, '8x2'), 0);
    assert.equal(ejeDePosicion(99, 10), 0);
  });
  test('coincide con el eje que da layoutRuedas del mismo tipo', () => {
    for (const tipo of ['6x2', '6x4', '8x2', '8x4']) {
      const porLayout = Object.fromEntries(layoutRuedas([], tipo).ruedas.map(r => [r.posicion, r.eje]));
      for (const p of Object.keys(porLayout)) assert.equal(ejeDePosicion(Number(p), tipo), porLayout[p], `${tipo} posición ${p}`);
    }
  });
});

describe('ejeDePosicion sin distribución: igual que antes', () => {
  test('tipos numéricos 10 y 16 dan la numeración de siempre', () => {
    for (const tipo of [10, 16]) {
      for (let p = 1; p <= 40; p++) assert.equal(ejeDePosicion(p, tipo), ejeDePosicion(p), `tipo ${tipo} posición ${p}`);
    }
  });
  test('sin tipo, o con un tipo fuera del catálogo («otra»), no cambia', () => {
    for (let p = 1; p <= 40; p++) {
      assert.equal(ejeDePosicion(p, undefined), ejeDePosicion(p));
      assert.equal(ejeDePosicion(p, 'otra'), ejeDePosicion(p));
    }
  });
  test('entradas no válidas: null', () => {
    assert.equal(ejeDePosicion('x', '8x2'), null);
    assert.equal(ejeDePosicion(0, '8x2'), null);
  });
});
