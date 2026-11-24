// Huella MÍNIMA (RN-01, RN-08, P0-3): paridad con la base (tests/sql/t_103_huella_minima.sql).
// El estado, los conteos y el color salen de min(mm1, mm2, mm3); el promedio solo informa. Sin una huella, sin estado.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { huellaMinima, avgMm, tireStatus } from '../../assets/js/domain/desgaste.js';
import { estadoContable, umbralesEstado, wearStatus } from '../../assets/js/domain/estado-desgaste.js';
import { contarEstados } from '../../assets/js/domain/estado-desgaste.js';

// Cliente 1 con umbrales por defecto (migración 20261106020000): bajo 8, crítico 5, retiro 3.
const th = umbralesEstado({ bajo: 8, critico: 5, retiro: 3 });
const fila = (mm1, mm2, mm3, extra = {}) => ({ posicion: 3, mm1, mm2, mm3, promedio: avgMm({ mm1, mm2, mm3 }), ...extra });

describe('huellaMinima', () => {
  test('el mínimo de las tres huellas', () => {
    assert.equal(huellaMinima({ mm1: 2.8, mm2: 4.0, mm3: 4.2 }), 2.8);
    assert.equal(huellaMinima({ mm1: 8.5, mm2: 8.5, mm3: 2.9 }), 2.9);
  });
  test('sin una huella es NULL: Math.min(null, 4) daría 0 y least() de SQL ignora nulos', () => {
    assert.equal(huellaMinima({ mm1: null, mm2: 4, mm3: 4 }), null);
    assert.equal(huellaMinima({ mm1: 4, mm2: undefined, mm3: 4 }), null);
    assert.equal(huellaMinima({ mm1: '', mm2: 4, mm3: 4 }), null);
    assert.equal(huellaMinima({ mm1: 4, mm2: 4 }), null);
    assert.equal(huellaMinima(null), null);
  });
  test('un 0 medido es un valor, no un dato faltante', () => {
    assert.equal(huellaMinima({ mm1: 0, mm2: 6, mm3: 6 }), 0);
  });
  test('no depende del orden de las huellas', () => {
    assert.equal(huellaMinima({ mm1: 4, mm2: 2.9, mm3: 8 }), 2.9);
    assert.equal(huellaMinima({ mm1: 8, mm2: 4, mm3: 2.9 }), 2.9);
  });
});

describe('paridad con la base: estado por mínimo', () => {
  // [mm1, mm2, mm3, estado esperado en v_estado_neumaticos, caso]
  const casos = [
    [2.8, 4.0, 4.2, 'limite', 'CA-01: promedio 3,67 pero mínimo 2,8 => desgaste límite'],
    [8.5, 8.5, 2.9, 'limite', 'CA-08: una huella de 2,9 con las otras de 8,5 => desgaste límite'],
    [3.0, 8.0, 8.0, 'mayor', 'borde 3 mm: 3,0 es mayor (retiro es < 3)'],
    [2.99, 8.0, 8.0, 'limite', 'borde 3 mm: 2,99 es límite'],
    [8.0, 8.0, 8.0, 'bueno', 'borde 8 mm: 8,0 es nuevo'],
    [7.9, 9.0, 9.0, 'poco', 'borde 8 mm: 7,9 (promedio 8,6) es poco desgaste'],
    [6.0, 9.0, 9.0, 'poco', 'borde 6 mm: 6,0 es poco desgaste'],
    [5.0, 9.0, 9.0, 'poco', 'borde 5 mm: 5,0 es poco desgaste (crítico es < 5)'],
    [4.99, 9.0, 9.0, 'mayor', 'borde 5 mm: 4,99 es mayor desgaste'],
  ];
  for (const [a, b, c, esperado, caso] of casos) {
    test(caso, () => {
      assert.equal(estadoContable(fila(a, b, c), th), esperado);
    });
  }
  test('wearStatus recibe el mínimo, no el promedio: el promedio no decide', () => {
    assert.equal(wearStatus(huellaMinima({ mm1: 2.8, mm2: 4.0, mm3: 4.2 }), th), 'limite');
    assert.notEqual(wearStatus(avgMm({ mm1: 2.8, mm2: 4.0, mm3: 4.2 }), th), 'limite'); // lo que daría promediar
  });
  test('tireStatus (vista de mediciones) sigue la misma regla', () => {
    assert.equal(tireStatus({ mm1: 2.8, mm2: 4.0, mm3: 4.2 }), 'desgaste_limite');
  });
  test('sin una huella: sin estado (sinDatos), no bueno ni límite inventado', () => {
    assert.equal(estadoContable(fila(2.0, null, 9), th), 'sinDatos');
    assert.equal(estadoContable(fila(null, null, null), th), 'sinDatos');
  });
  test('la fila de la base ya trae estado: el auxilio sigue en su regla', () => {
    assert.equal(estadoContable(fila(2, 2, 2, { posicion: 99 }), th), 'poco');
  });
});

describe('conteos por el mínimo', () => {
  test('contarEstados cuenta por huella mínima (un neumático con 2,8 es límite aunque el promedio sea 3,67)', () => {
    const minimos = [huellaMinima({ mm1: 2.8, mm2: 4, mm3: 4.2 }), huellaMinima({ mm1: 9, mm2: 9, mm3: 9 }), null];
    const c = contarEstados(minimos, th);
    assert.equal(c.limite, 1);
    assert.equal(c.bueno, 1);
    assert.equal(c.sinDatos, 1);
    assert.equal(c.total, 3);
  });
});
