// Tests de domain/seccional.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  idsVehiculosDeSucursal, filtrarPorVehiculos, resumenDesdeFilas, mostrarSelector,
  mensajeErrorSeccional, validarNombreSeccional, mensajeErrorCrearUsuario, cuerpoCrearUsuario,
} from '../../assets/js/domain/seccional.js';
import { kpisFlota } from '../../assets/js/domain/flota.js';

const vehs = [{ id: 1, sucursal_id: 10 }, { id: 2, sucursal_id: 20 }, { id: 3, sucursal_id: null }, { id: 4, sucursal_id: 10 }];

describe('idsVehiculosDeSucursal', () => {
  test('sin selección => null (sin filtro)', () => {
    assert.equal(idsVehiculosDeSucursal(vehs, ''), null);
    assert.equal(idsVehiculosDeSucursal(vehs, null), null);
  });
  test('devuelve solo los vehículos de la sucursal (ids como string)', () => {
    assert.deepEqual([...idsVehiculosDeSucursal(vehs, '10')].sort(), ['1', '4']);
    assert.deepEqual([...idsVehiculosDeSucursal(vehs, 20)], ['2']);
  });
  test('los vehículos sin sucursal nunca coinciden', () => assert.equal(idsVehiculosDeSucursal(vehs, '0').size, 0));
});

describe('filtrarPorVehiculos', () => {
  const rows = [{ vehiculo_id: 1 }, { vehiculo_id: 2 }, { vehiculo_id: 4 }];
  test('ids null => todo', () => assert.equal(filtrarPorVehiculos(rows, null).length, 3));
  test('filtra por vehiculo_id', () => assert.deepEqual(filtrarPorVehiculos(rows, new Set(['1', '4'])).map(r => r.vehiculo_id), [1, 4]));
  test('entrada vacía/nula', () => assert.deepEqual(filtrarPorVehiculos(null, new Set(['1'])), []));
});

describe('resumenDesdeFilas', () => {
  const est = [
    { cliente_id: 1, vehiculo_id: 1, estado: 'ok', ultima_medicion_at: '2026-06-10T00:00:00Z' },
    { cliente_id: 1, vehiculo_id: 1, estado: 'critico', ultima_medicion_at: '2026-06-12T00:00:00Z' },
    { cliente_id: 1, vehiculo_id: 4, estado: 'bajo', ultima_medicion_at: null },
    { cliente_id: 1, vehiculo_id: 4, estado: 'sin_datos', ultima_medicion_at: null },
  ];
  const al = [{ severidad: 3 }, { severidad: 2 }, { severidad: 2 }, { severidad: '1' }];
  test('cuenta estados, alertas por severidad y última medición', () => {
    const r = resumenDesdeFilas(est, al, { clienteId: 1, nombre: 'X' });
    assert.equal(r.n_ok, 1); assert.equal(r.n_bajo, 1); assert.equal(r.n_critico, 1); assert.equal(r.n_sin_datos, 1);
    assert.equal(r.n_neumaticos_con_datos, 3);
    assert.deepEqual([r.n_alertas_sev1, r.n_alertas_sev2, r.n_alertas_sev3], [1, 2, 1]);
    assert.equal(r.n_vehiculos_activos, 2);
    assert.equal(r.ultima_medicion_at, '2026-06-12T00:00:00Z');
  });
  test('nVehiculos explícito manda sobre el conteo de filas', () => assert.equal(resumenDesdeFilas(est, [], { nVehiculos: 5 }).n_vehiculos_activos, 5));
  test('es compatible con kpisFlota (vehículos, críticos y alertas)', () => {
    const k = kpisFlota(est, [resumenDesdeFilas(est, al, { clienteId: 1, nVehiculos: 2 })], '');
    assert.equal(k.vehiculos, 2); assert.equal(k.criticos, 1); assert.equal(k.alertas, 4);
  });
  test('vacío => ceros', () => {
    const r = resumenDesdeFilas([], []);
    assert.equal(r.n_critico, 0); assert.equal(r.n_vehiculos_activos, 0); assert.equal(r.ultima_medicion_at, null);
  });
});

describe('mostrarSelector', () => {
  test('perfil global con sucursales => sí', () => assert.equal(mostrarSelector({ esSeccional: false, sucursales: [{ id: 1 }] }), true));
  test('perfil de sucursal => no (la RLS ya limita)', () => assert.equal(mostrarSelector({ esSeccional: true, sucursales: [{ id: 1 }] }), false));
  test('cliente sin sucursales => no', () => assert.equal(mostrarSelector({ esSeccional: false, sucursales: [] }), false));
});

describe('mensajes y validación del ABM', () => {
  test('errores de la base en español', () => {
    assert.match(mensajeErrorSeccional({ code: '23505' }), /Ya existe/);
    assert.match(mensajeErrorSeccional({ code: '23503' }), /vehículos, dispositivos o usuarios/);
    assert.match(mensajeErrorSeccional({ code: '42501' }), /permiso/);
    assert.match(mensajeErrorSeccional(null), /No se pudo/);
  });
  test('validarNombreSeccional', () => {
    assert.equal(validarNombreSeccional('  ').ok, false);
    assert.equal(validarNombreSeccional('x'.repeat(101)).ok, false);
    assert.deepEqual(validarNombreSeccional(' Salto '), { ok: true, valor: 'Salto' });
  });
  test('mensajeErrorCrearUsuario', () => {
    assert.match(mensajeErrorCrearUsuario(409), /Ya existe/);
    assert.match(mensajeErrorCrearUsuario(403), /permiso/);
    assert.match(mensajeErrorCrearUsuario(404), /ya no existe/);
    assert.equal(mensajeErrorCrearUsuario(400, 'La sucursal no pertenece a ese cliente'), 'La sucursal no pertenece a ese cliente');
    assert.match(mensajeErrorCrearUsuario(500), /No se pudo/);
  });
  test('cuerpoCrearUsuario: sin password ni sucursal cuando están vacíos', () => {
    assert.deepEqual(cuerpoCrearUsuario({ clienteId: '7', sucursalId: '', email: ' a@b.cl ', password: '' }), { cliente_id: 7, email: 'a@b.cl' });
    assert.deepEqual(cuerpoCrearUsuario({ clienteId: 7, sucursalId: '70', email: 'a@b.cl', password: 'x' }), { cliente_id: 7, sucursal_id: 70, email: 'a@b.cl', password: 'x' });
  });
});
