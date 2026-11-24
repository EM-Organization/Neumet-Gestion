// Tests de domain/auxilio.js y de su uso en flota, inicio, seccional y reportes (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { esAuxilio, estadoContable } from '../../assets/js/domain/auxilio.js';
import { agruparVehiculos, kpisFlota } from '../../assets/js/domain/flota.js';
import { resumenNeumaticos, requierenAtencion } from '../../assets/js/domain/inicio.js';
import { resumenDesdeFilas } from '../../assets/js/domain/seccional.js';
import { resumenFlota } from '../../assets/js/domain/reportes.js';

const f = (pos, estado, prom, extra = {}) => ({
  cliente_id: 1, vehiculo_id: 7, vehiculo_nombre: 'V7', patente: 'P7', posicion: pos, estado, mm1: prom, mm2: prom, mm3: prom, promedio: prom,
  sin_medir: false, desgaste_irregular: false, ultima_medicion_at: '2026-06-10T10:00:00Z', semanas_hasta_retiro: null, ...extra,
});

describe('auxilio', () => {
  test('esAuxilio: manda la posición 99; el indicador auxilio no es confiable (queda desfasado tras rotar)', () => {
    assert.equal(esAuxilio({ posicion: 99 }), true);
    assert.equal(esAuxilio({ posicion: '99' }), true);
    assert.equal(esAuxilio({ posicion: 99, auxilio: false }), true);
    assert.equal(esAuxilio({ posicion: 3, auxilio: true }), false);
    assert.equal(estadoContable(f(3, 'desgaste_limite', 2, { auxilio: true })), 'desgaste_limite');
    assert.equal(esAuxilio({ posicion: 3 }), false);
    assert.equal(esAuxilio(null), false);
  });
  test('estadoContable: el auxilio en mayor desgaste o límite pasa a poco desgaste; el resto no cambia', () => {
    assert.equal(estadoContable(f(99, 'desgaste_limite', 1)), 'poco_desgaste');
    assert.equal(estadoContable(f(99, 'mayor_desgaste', 4)), 'poco_desgaste');
    assert.equal(estadoContable(f(99, 'nuevo', 9)), 'nuevo');
    assert.equal(estadoContable(f(99, 'desconocido', null)), 'desconocido');
    assert.equal(estadoContable(f(2, 'desgaste_limite', 1)), 'desgaste_limite');
  });
  test('flota: un vehículo con solo el auxilio en límite no es advertencia, pero cuenta en el total', () => {
    const [v] = agruparVehiculos([f(1, 'nuevo', 9), f(99, 'desgaste_limite', 1)]);
    assert.equal(v.n_desgaste_limite, 0);
    assert.equal(v.semaforo, 'poco_desgaste');
    assert.equal(v.n_neumaticos, 2);
    assert.equal(v.min_mm, 9);
    const k = kpisFlota([f(1, 'nuevo', 9), f(99, 'desgaste_limite', 1), f(2, 'mayor_desgaste', 4)]);
    assert.equal(k.limite, 0);
    assert.equal(k.mayor_desgaste, 1);
  });
  test('inicio: no requiere atención por el auxilio y la barra lo cuenta como poco desgaste', () => {
    const rows = [f(1, 'nuevo', 9), f(99, 'desgaste_limite', 1, { semanas_hasta_retiro: 0 })];
    assert.equal(requierenAtencion(rows).total, 0);
    const r = resumenNeumaticos(rows);
    assert.equal(r.desgaste_limite, 0);
    assert.equal(r.total, 2);
  });
  test('ficha de cliente (seccional): conteos sin el auxilio', () => {
    const s = resumenDesdeFilas([f(1, 'desgaste_limite', 1), f(99, 'desgaste_limite', 1), f(98, 'mayor_desgaste', 4, { auxilio: true })], []);
    assert.equal(s.n_critico, 1);
    assert.equal(s.n_mayor_desgaste, 1); // la posición 98 con el indicador desfasado NO es auxilio
    assert.equal(s.n_neumaticos_con_datos, 3);
  });
  test('reportes: el auxilio no suma en límite ni mayor desgaste', () => {
    const m = (pos, mm) => ({ vehiculo_id: 7, posicion: pos, idneumatico: 'N' + pos, mm1: mm, mm2: mm, mm3: mm, promedio: mm, created_at: '2026-06-01T00:00:00Z', vehiculos: { nombre: 'V7', patente: 'P7' } });
    const r = resumenFlota([m(1, 2), m(99, 2)]);
    assert.equal(r.limite, 1);
    assert.equal(r.neumaticos.length, 2);
  });
});
