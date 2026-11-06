// Tests de domain/flota.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  semaforoVehiculo, agruparVehiculos, filtrarVehiculos, sumarResumen, kpisFlota,
  ordenarAlertas, filtrarAlertas, contarPorSeveridad, tiposPresentes, estadoLabel, severidadLabel, tipoLabel,
} from '../../assets/js/domain/flota.js';

const r = (vid, pos, estado, prom, extra = {}) => ({
  cliente_id: 1, vehiculo_id: vid, vehiculo_nombre: 'V' + vid, patente: 'P' + vid, posicion: pos, estado, promedio: prom,
  sin_medir: false, desgaste_irregular: false, ultima_medicion_at: '2026-06-10T10:00:00Z', ...extra,
});

describe('semaforoVehiculo', () => {
  test('toma el peor estado con datos', () => assert.equal(semaforoVehiculo(['ok', 'bajo', 'ok']), 'bajo'));
  test('crítico gana a todo', () => assert.equal(semaforoVehiculo(['bajo', 'critico', 'sin_datos']), 'critico'));
  test('sin_datos no degrada a un vehículo medido', () => assert.equal(semaforoVehiculo(['ok', 'sin_datos']), 'ok'));
  test('todo sin datos o vacío -> sin_datos', () => {
    assert.equal(semaforoVehiculo(['sin_datos']), 'sin_datos');
    assert.equal(semaforoVehiculo([]), 'sin_datos');
  });
  test('estado desconocido se ignora', () => assert.equal(semaforoVehiculo(['xx', 'ok']), 'ok'));
});

describe('agruparVehiculos', () => {
  const rows = [
    r(1, 1, 'ok', 12), r(1, 2, 'ok', 11),
    r(2, 1, 'critico', 3, { sin_medir: true }), r(2, 2, 'bajo', 6), r(2, 3, 'ok', 10, { desgaste_irregular: true }),
    r(3, 1, 'bajo', 6), r(3, 2, 'ok', 9),
    r(4, 1, 'sin_datos', null, { sin_medir: true, ultima_medicion_at: null }),
    r(5, 1, 'ok', 14, { sin_medir: true }), r(5, 2, 'ok', 13),
  ];
  const g = agruparVehiculos(rows);
  test('ordena por severidad: crítico, bajo, sin datos, ok (más sin medir primero)', () => {
    assert.deepEqual(g.map(v => v.vehiculo_id), [2, 3, 4, 5, 1]);
    assert.deepEqual(g.map(v => v.semaforo), ['critico', 'bajo', 'sin_datos', 'ok', 'ok']);
  });
  test('contadores y peor neumático', () => {
    const v = g[0];
    assert.equal(v.n_critico, 1); assert.equal(v.n_bajo, 1); assert.equal(v.n_ok, 1);
    assert.equal(v.n_sin_medir, 1); assert.equal(v.n_irregular, 1); assert.equal(v.n_neumaticos, 3);
    assert.equal(v.min_mm, 3); assert.equal(v.peor_posicion, 1);
  });
  test('sin datos: min_mm null y no inventa mediciones', () => {
    const v = g.find(x => x.vehiculo_id === 4);
    assert.equal(v.min_mm, null); assert.equal(v.peor_posicion, null); assert.equal(v.ultima_medicion_at, null);
  });
  test('a igual semáforo desempata por nº de críticos y luego por mm mínimo', () => {
    const x = agruparVehiculos([r(1, 1, 'critico', 4), r(2, 1, 'critico', 2), r(3, 1, 'critico', 3), r(3, 2, 'critico', 5)]);
    assert.deepEqual(x.map(v => v.vehiculo_id), [3, 2, 1]);
  });
  test('entrada vacía/nula', () => { assert.deepEqual(agruparVehiculos([]), []); assert.deepEqual(agruparVehiculos(null), []); });
  test('no expone el arreglo interno de estados', () => assert.equal('estados' in g[0], false));
});

describe('filtrarVehiculos', () => {
  const g = agruparVehiculos([r(1, 1, 'ok', 12), r(2, 1, 'critico', 3, { cliente_id: 2, vehiculo_nombre: 'Camión Rojo', patente: 'ZZ99' })]);
  test('por cliente', () => assert.deepEqual(filtrarVehiculos(g, { clienteId: '2' }).map(v => v.vehiculo_id), [2]));
  test('por estado', () => assert.deepEqual(filtrarVehiculos(g, { estado: 'ok' }).map(v => v.vehiculo_id), [1]));
  test('por texto (nombre o patente, sin mayúsculas)', () => {
    assert.deepEqual(filtrarVehiculos(g, { q: ' camión' }).map(v => v.vehiculo_id), [2]);
    assert.deepEqual(filtrarVehiculos(g, { q: 'zz9' }).map(v => v.vehiculo_id), [2]);
  });
  test('sin filtros devuelve todo', () => assert.equal(filtrarVehiculos(g).length, 2));
});

describe('sumarResumen / kpisFlota', () => {
  const resumen = [
    { cliente_id: 1, n_vehiculos_activos: 2, n_neumaticos_con_datos: 6, n_ok: 4, n_bajo: 1, n_critico: 1, n_sin_datos: 0, n_alertas_sev1: 1, n_alertas_sev2: 2, n_alertas_sev3: 1 },
    { cliente_id: 2, n_vehiculos_activos: 1, n_neumaticos_con_datos: 2, n_ok: 2, n_bajo: 0, n_critico: 0, n_sin_datos: 1, n_alertas_sev1: 0, n_alertas_sev2: 0, n_alertas_sev3: 0 },
  ];
  test('suma todos los clientes', () => {
    const t = sumarResumen(resumen);
    assert.equal(t.n_vehiculos, 3); assert.equal(t.n_critico, 1); assert.equal(t.n_alertas, 4); assert.equal(t.n_sin_datos, 1);
  });
  test('un solo cliente', () => assert.equal(sumarResumen(resumen, '2').n_neumaticos, 2));
  test('valores nulos cuentan 0', () => assert.equal(sumarResumen([{ cliente_id: 1, n_critico: null }]).n_critico, 0));
  const rows = [r(1, 1, 'critico', 3, { sin_medir: true }), r(1, 2, 'ok', 10), r(2, 1, 'bajo', 6, { cliente_id: 2 })];
  test('con resumen: críticos/alertas del resumen, sin medir de las filas', () => {
    assert.deepEqual(kpisFlota(rows, resumen), { vehiculos: 3, criticos: 1, bajos: 1, sin_medir: 1, alertas: 4 });
  });
  test('con resumen y cliente filtrado', () => {
    assert.deepEqual(kpisFlota(rows, resumen, '2'), { vehiculos: 1, criticos: 0, bajos: 0, sin_medir: 0, alertas: 0 });
  });
  test('sin resumen: calcula de las filas y alertas = null', () => {
    assert.deepEqual(kpisFlota(rows, null), { vehiculos: 2, criticos: 1, bajos: 1, sin_medir: 1, alertas: null });
  });
});

describe('alertas', () => {
  const al = [
    { cliente_id: 1, vehiculo_nombre: 'B', posicion: 2, tipo: 'sin_medir', severidad: 1, ultima_medicion_at: '2026-05-01T00:00:00Z' },
    { cliente_id: 1, vehiculo_nombre: 'A', posicion: 1, tipo: 'critico', severidad: 3, ultima_medicion_at: '2026-06-10T00:00:00Z' },
    { cliente_id: 2, vehiculo_nombre: 'C', posicion: 1, tipo: 'critico', severidad: 3, ultima_medicion_at: '2026-06-01T00:00:00Z' },
    { cliente_id: 2, vehiculo_nombre: 'D', posicion: 4, tipo: 'desgaste_irregular', severidad: 2, ultima_medicion_at: null },
  ];
  test('ordena por severidad desc y luego antigüedad', () => {
    assert.deepEqual(ordenarAlertas(al).map(a => a.vehiculo_nombre), ['C', 'A', 'D', 'B']);
  });
  test('no muta la entrada', () => { const c = [...al]; ordenarAlertas(al); assert.deepEqual(al, c); });
  test('filtra por severidad, tipo y cliente (combinables)', () => {
    assert.equal(filtrarAlertas(al, { severidad: '3' }).length, 2);
    assert.equal(filtrarAlertas(al, { tipo: 'sin_medir' }).length, 1);
    assert.equal(filtrarAlertas(al, { clienteId: 2 }).length, 2);
    assert.equal(filtrarAlertas(al, { severidad: 3, clienteId: '2' }).length, 1);
    assert.equal(filtrarAlertas(al).length, 4);
  });
  test('cuenta por severidad', () => assert.deepEqual(contarPorSeveridad(al), { 3: 2, 2: 1, 1: 1 }));
  test('tipos presentes únicos', () => assert.deepEqual(tiposPresentes(al).sort(), ['critico', 'desgaste_irregular', 'sin_medir']));
});

describe('etiquetas', () => {
  test('conocidas y desconocidas', () => {
    assert.equal(estadoLabel('critico'), 'Crítico'); assert.equal(estadoLabel('zz'), 'Sin datos');
    assert.equal(severidadLabel('3'), 'Crítica'); assert.equal(severidadLabel(null), 'Informativa');
    assert.equal(tipoLabel('cruza_critico_pronto'), 'Cruzará nivel crítico'); assert.equal(tipoLabel('nuevo'), 'nuevo');
  });
});
