// Número de quema y km del neumático (domain/quema.js) y su integración con el cálculo de km por neumático.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarQuema, claveQuema, parseKmPrevios, validarOdometroVehiculo, kmTotalesNeumatico, MAX_QUEMA,
} from '../../assets/js/domain/quema.js';
import { kmPorNeumatico } from '../../assets/js/domain/ciclo-vida.js';

describe('normalizarQuema', () => {
  test('recorta; vacío o solo espacios es null', () => {
    assert.deepEqual(normalizarQuema('  Q-123 '), { ok: true, valor: 'Q-123' });
    assert.deepEqual(normalizarQuema(''), { ok: true, valor: null });
    assert.deepEqual(normalizarQuema('   '), { ok: true, valor: null });
    assert.deepEqual(normalizarQuema(null), { ok: true, valor: null });
    assert.deepEqual(normalizarQuema(undefined), { ok: true, valor: null });
  });
  test('máximo 40 caracteres, contados después de recortar', () => {
    assert.equal(normalizarQuema('Q'.repeat(MAX_QUEMA)).ok, true);
    assert.equal(normalizarQuema(`  ${'Q'.repeat(MAX_QUEMA)}  `).ok, true);
    const r = normalizarQuema('Q'.repeat(MAX_QUEMA + 1));
    assert.equal(r.ok, false);
    assert.match(r.error, /hasta 40/);
  });
  test('acepta letras, dígitos, guiones y espacios internos', () => {
    assert.equal(normalizarQuema('AB 12-34/5').valor, 'AB 12-34/5');
  });
  test('claveQuema ignora mayúsculas y bordes (igual que el índice único)', () => {
    assert.equal(claveQuema(' Q-1 '), claveQuema('q-1'));
    assert.equal(claveQuema(null), '');
  });
});

describe('parseKmPrevios (km que ya traía el neumático)', () => {
  test('vacío = 0 y 0 es válido', () => {
    assert.deepEqual(parseKmPrevios(''), { ok: true, valor: 0 });
    assert.deepEqual(parseKmPrevios(null), { ok: true, valor: 0 });
    assert.deepEqual(parseKmPrevios(undefined), { ok: true, valor: 0 });
    assert.deepEqual(parseKmPrevios('0'), { ok: true, valor: 0 });
    assert.deepEqual(parseKmPrevios(0), { ok: true, valor: 0 });
  });
  test('enteros positivos', () => {
    assert.deepEqual(parseKmPrevios(' 45000 '), { ok: true, valor: 45000 });
    assert.deepEqual(parseKmPrevios('999999999'), { ok: true, valor: 999999999 });
  });
  test('rechaza negativos, decimales, notación científica, texto y más de 9 dígitos', () => {
    for (const v of ['-1', '1.5', '1,5', '1e3', 'abc', '1000000000', '+7', '0x10']) {
      assert.equal(parseKmPrevios(v).ok, false, v);
    }
  });
});

describe('validarOdometroVehiculo (dato aparte y opcional)', () => {
  test('vacío no se informa', () => {
    assert.deepEqual(validarOdometroVehiculo('', 1000), { ok: true, valor: null });
    assert.deepEqual(validarOdometroVehiculo(null, 1000), { ok: true, valor: null });
  });
  test('no puede ser menor al actual, con el mensaje claro', () => {
    const r = validarOdometroVehiculo('999', 1000);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'El odómetro del vehículo no puede ser menor al actual (1000 km)');
  });
  test('igual o mayor al actual es válido; 0 es válido si no hay odómetro o es 0', () => {
    assert.equal(validarOdometroVehiculo('1000', 1000).valor, 1000);
    assert.equal(validarOdometroVehiculo('1001', 1000).valor, 1001);
    assert.equal(validarOdometroVehiculo('0', null).valor, 0);
    assert.equal(validarOdometroVehiculo('0', 0).valor, 0);
    assert.equal(validarOdometroVehiculo('5', undefined).valor, 5);
  });
  test('rechaza negativos, decimales y texto', () => {
    for (const v of ['-1', '2.5', 'x', '1e3']) assert.equal(validarOdometroVehiculo(v, null).ok, false, v);
  });
});

describe('kmTotalesNeumatico = km previos + km recorridos desde el montaje', () => {
  const montaje = (odo, id = 7) => ({ tipo: 'montaje', neumatico_id: id, odometro_km: odo, created_at: '2026-01-01T00:00:00Z' });
  test('odómetro actual menos el del montaje, más los km previos', () => {
    const km = kmPorNeumatico([montaje(1000)], 4500);
    const t = kmTotalesNeumatico({ id: 7, km_previos: 20000 }, km.n7);
    assert.deepEqual(t, { previos: 20000, recorridos: 3500, total: 23500, completo: true });
  });
  test('neumático nuevo (0 km previos) y vehículo sin avanzar', () => {
    const km = kmPorNeumatico([montaje(1000)], 1000);
    assert.deepEqual(kmTotalesNeumatico({ id: 7, km_previos: 0 }, km.n7), { previos: 0, recorridos: 0, total: 0, completo: true });
  });
  test('montaje sin odómetro: no hay recorridos conocidos, el total son los km previos', () => {
    const km = kmPorNeumatico([montaje(null)], 4500);
    const t = kmTotalesNeumatico({ id: 7, km_previos: 12000 }, km.n7);
    assert.deepEqual(t, { previos: 12000, recorridos: 0, total: 12000, completo: false });
  });
  test('sin eventos o sin km_previos (datos anteriores a la migración)', () => {
    assert.deepEqual(kmTotalesNeumatico({ id: 1 }, undefined), { previos: 0, recorridos: 0, total: 0, completo: false });
    assert.deepEqual(kmTotalesNeumatico(null, null), { previos: 0, recorridos: 0, total: 0, completo: false });
    assert.equal(kmTotalesNeumatico({ km_previos: -5 }, null).previos, 0);
  });
  test('suma los tramos de montajes anteriores del mismo neumático', () => {
    const ev = [montaje(0), { tipo: 'desmontaje', neumatico_id: 7, odometro_km: 800, created_at: '2026-02-01T00:00:00Z' },
      { tipo: 'montaje', neumatico_id: 7, odometro_km: 900, created_at: '2026-03-01T00:00:00Z' }];
    const km = kmPorNeumatico(ev, 1400);
    assert.equal(kmTotalesNeumatico({ id: 7, km_previos: 100 }, km.n7).total, 100 + 800 + 500);
  });
});
