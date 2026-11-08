// Nombre de posición y modelo del mini vehículo (domain/posicion.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nombrePosicion, nombresPosiciones, resumenPosiciones, modeloMini, agruparPorVehiculo } from '../../assets/js/domain/posicion.js';
import { colorDesgaste, UMBRALES_DEFECTO } from '../../assets/js/domain/vehiculo-diagrama.js';

describe('nombrePosicion', () => {
  test('eje delantero: delantera izquierda / derecha', () => {
    assert.equal(nombrePosicion(1), 'Delantera izquierda');
    assert.equal(nombrePosicion(2), 'Delantera derecha');
    assert.equal(nombrePosicion('2', 10), 'Delantera derecha');
  });
  test('ejes duales: lado y exterior / interior (interior = junto al chasis)', () => {
    assert.equal(nombrePosicion(3), 'Eje 2 izquierda exterior');
    assert.equal(nombrePosicion(4), 'Eje 2 izquierda interior');
    assert.equal(nombrePosicion(5), 'Eje 2 derecha interior');
    assert.equal(nombrePosicion(6), 'Eje 2 derecha exterior');
    assert.equal(nombrePosicion(10), 'Eje 3 derecha exterior');
  });
  test('tipo 16: ejes 4 duales y eje 5 simple; posiciones extra forman ejes nuevos', () => {
    assert.equal(nombrePosicion(14, 16), 'Eje 4 derecha exterior');
    assert.equal(nombrePosicion(15, 16), 'Eje 5 izquierda');
    assert.equal(nombrePosicion(16), 'Eje 5 derecha');
    assert.equal(nombrePosicion(17), 'Eje 6 izquierda exterior');
  });
  test('auxilio y valores inválidos', () => {
    assert.equal(nombrePosicion(99), 'Auxilio');
    for (const v of [0, -1, 100, null, undefined, '', 'x', 2.5]) assert.equal(nombrePosicion(v), '', String(v));
  });
  test('nunca devuelve el formato antiguo «P3»', () => {
    for (let p = 1; p <= 16; p++) assert.ok(!/^P\d/.test(nombrePosicion(p)));
  });
});

describe('nombresPosiciones', () => {
  test('lista legible, ordenada y sin repetidos', () => {
    assert.equal(nombresPosiciones([2]), 'Delantera derecha');
    assert.equal(nombresPosiciones([2, 1]), 'Delantera izquierda y Delantera derecha');
    assert.equal(nombresPosiciones([6, 1, 1, 3]), 'Delantera izquierda, Eje 2 izquierda exterior y Eje 2 derecha exterior');
  });
  test('vacío, null o inválidos', () => {
    assert.equal(nombresPosiciones([]), '');
    assert.equal(nombresPosiciones(null), '');
    assert.equal(nombresPosiciones([0, 'a']), '');
  });
});

describe('resumenPosiciones', () => {
  test('hasta 3 posiciones con nombre; más, solo la cantidad', () => {
    assert.equal(resumenPosiciones([1]), 'Delantera izquierda');
    assert.equal(resumenPosiciones([1, 2, 3]), 'Delantera izquierda, Delantera derecha y Eje 2 izquierda exterior');
    assert.equal(resumenPosiciones([1, 2, 3, 4]), '4 posiciones');
    assert.equal(resumenPosiciones([]), '');
    assert.equal(resumenPosiciones(undefined), '');
  });
});

describe('modeloMini', () => {
  const u = { umbral_bajo_mm: 8, umbral_critico_mm: 5, umbral_retiro_mm: 3 };
  const filas = [
    { posicion: 1, promedio: 12, ...u }, { posicion: 2, promedio: 4, ...u }, { posicion: 3, promedio: 9, ...u },
  ];
  test('dibuja el chasis completo del tipo; ruedas sin dato en gris (fill null)', () => {
    const m = modeloMini(filas);
    assert.equal(m.ruedas.length, 10);
    assert.equal(m.ruedas.find(r => r.posicion === 7).fill, null);
    assert.equal(m.ruedas.find(r => r.posicion === 7).nivel, 'sin_datos');
  });
  test('color igual al del detalle de vehículo (misma escala y umbrales)', () => {
    const m = modeloMini(filas);
    assert.equal(m.ruedas.find(r => r.posicion === 1).fill, colorDesgaste(12, { bajo: 8, critico: 5, retiro: 3 }).hex);
    assert.equal(m.ruedas.find(r => r.posicion === 2).nivel, 'critico');
  });
  test('usa umbrales por defecto si la fila no los trae', () => {
    const m = modeloMini([{ posicion: 1, promedio: 6 }]);
    assert.equal(m.ruedas.find(r => r.posicion === 1).fill, colorDesgaste(6, UMBRALES_DEFECTO).hex);
  });
  test('resalta solo las posiciones pedidas y lo dice en el aria', () => {
    const m = modeloMini(filas, { destacadas: [2] });
    assert.deepEqual(m.ruedas.filter(r => r.destacada).map(r => r.posicion), [2]);
    assert.match(m.aria, /Resaltada: Delantera derecha\./);
    assert.ok(!/Resaltada/.test(modeloMini(filas).aria));
  });
  test('una posición destacada sin fila se dibuja igual (sin dato)', () => {
    const m = modeloMini([], { destacadas: [4] });
    const r = m.ruedas.find(x => x.posicion === 4);
    assert.ok(r && r.destacada && r.fill === null);
  });
  test('tipo 16 por posiciones altas; auxilio fuera del chasis; recorte válido', () => {
    const m = modeloMini([{ posicion: 12, promedio: 9 }, { posicion: 99, promedio: 9 }], { destacadas: [99] });
    assert.equal(m.ruedas.length, 17);
    assert.ok(m.ruedas.find(r => r.posicion === 99).destacada);
    assert.ok(m.ancho > 0 && m.alto > 0 && Number.isFinite(m.x0));
    for (const r of m.ruedas) assert.ok(r.x >= m.x0 && r.x + r.ancho <= m.x0 + m.ancho, `rueda ${r.posicion} dentro del recorte`);
  });
  test('entradas vacías o con filas inválidas no fallan', () => {
    assert.equal(modeloMini(null).ruedas.length, 10);
    assert.equal(modeloMini([null, { posicion: 'x' }, { posicion: 1, promedio: null }]).ruedas.find(r => r.posicion === 1).fill, null);
  });
});

describe('agruparPorVehiculo', () => {
  test('agrupa por vehiculo_id y descarta filas sin vehículo', () => {
    const m = agruparPorVehiculo([{ vehiculo_id: 1, posicion: 1 }, { vehiculo_id: 2, posicion: 1 }, { vehiculo_id: 1, posicion: 2 }, null, { posicion: 3 }]);
    assert.equal(m.get(1).length, 2);
    assert.equal(m.get(2).length, 1);
    assert.equal(m.size, 2);
    assert.equal(agruparPorVehiculo(null).size, 0);
  });
});
