// Presentación de km por cubierta (domain/km-cubierta.js): qué se muestra y con qué nota de confiabilidad.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumenKm, indexarKm, COLUMNAS_KM, NOTA_FALTAN_LECTURAS, NOTA_ODOMETRO_DECRECIENTE, NOTA_SIN_DATO,
} from '../../assets/js/domain/km-cubierta.js';

const fila = (o = {}) => ({
  neumatico_id: 7, km_previos: 1000, km_en_vehiculos: 5000, km_tramo_actual: 300, km_totales: 6300,
  km_confiable: true, tramos_sin_dato: 0, odometro_anomalo: false, ...o,
});

describe('resumenKm', () => {
  test('datos completos: total, tramo actual y recorridos sin nota', () => {
    assert.deepEqual(resumenKm(fila()), {
      disponible: true, previos: 1000, recorridos: 5300, tramoActual: 300, totales: 6300, confiable: true, nota: null,
    });
  });
  test('cubierta en stock: sin tramo actual, recorridos = km en vehículos', () => {
    const r = resumenKm(fila({ km_tramo_actual: null, km_totales: 6000 }));
    assert.equal(r.tramoActual, null);
    assert.equal(r.recorridos, 5000);
    assert.equal(r.nota, null);
  });
  test('nunca usada: 0 km recorridos es un dato, no una ausencia', () => {
    const r = resumenKm(fila({ km_previos: 777, km_en_vehiculos: 0, km_tramo_actual: null, km_totales: 777 }));
    assert.equal(r.recorridos, 0);
    assert.equal(r.totales, 777);
    assert.equal(r.nota, null);
  });
  test('faltan odómetros con total parcial: nota «Estimado»', () => {
    const r = resumenKm(fila({ km_confiable: false, tramos_sin_dato: 1, km_tramo_actual: null, km_totales: 6000 }));
    assert.equal(r.nota, NOTA_FALTAN_LECTURAS);
    assert.equal(NOTA_FALTAN_LECTURAS, 'Estimado: faltan lecturas de odómetro');
    assert.equal(r.confiable, false);
    assert.equal(r.recorridos, 5000);
  });
  test('sin ningún tramo con dato: totales y recorridos NULL (no 0) y nota «Sin dato»', () => {
    const r = resumenKm(fila({ km_en_vehiculos: null, km_tramo_actual: null, km_totales: null, km_confiable: false, tramos_sin_dato: 1 }));
    assert.equal(r.totales, null);
    assert.equal(r.recorridos, null);
    assert.equal(r.tramoActual, null);
    assert.equal(r.nota, NOTA_SIN_DATO);
  });
  test('odómetro decreciente: nota propia', () => {
    const r = resumenKm(fila({ km_confiable: false, odometro_anomalo: true }));
    assert.equal(r.nota, NOTA_ODOMETRO_DECRECIENTE);
  });
  test('valores como texto o inválidos no se interpretan como 0', () => {
    const r = resumenKm(fila({ km_totales: '6300', km_tramo_actual: '', km_en_vehiculos: 'x' }));
    assert.equal(r.totales, 6300);
    assert.equal(r.tramoActual, null);
    assert.equal(r.recorridos, 5300);
  });
  test('sin fila (vista no disponible o neumático ajeno): no disponible y sin nota', () => {
    for (const f of [null, undefined]) {
      assert.deepEqual(resumenKm(f), { disponible: false, previos: null, recorridos: null, tramoActual: null, totales: null, confiable: false, nota: null });
    }
  });
  test('km_confiable ausente o null no se toma como confiable', () => {
    assert.equal(resumenKm(fila({ km_confiable: null })).confiable, false);
    assert.equal(resumenKm(fila({ km_confiable: undefined })).nota, NOTA_FALTAN_LECTURAS);
  });
});

describe('indexarKm y columnas', () => {
  test('indexa por neumatico_id y tolera listas vacías o nulas', () => {
    const m = indexarKm([fila({ neumatico_id: 1 }), fila({ neumatico_id: 2 })]);
    assert.equal(m.size, 2);
    assert.equal(m.get(2).neumatico_id, 2);
    assert.equal(indexarKm(null).size, 0);
    assert.equal(indexarKm([]).size, 0);
  });
  test('la consulta pide solo columnas de la vista', () => {
    for (const c of ['neumatico_id', 'km_previos', 'km_en_vehiculos', 'km_tramo_actual', 'km_totales', 'km_confiable']) {
      assert.ok(COLUMNAS_KM.split(',').includes(c), c);
    }
  });
});
