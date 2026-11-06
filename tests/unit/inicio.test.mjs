import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoInicio } from '../../assets/js/domain/inicio.js';

test('sin vehiculos ni filas: vacio', () => {
  assert.equal(estadoInicio({}), 'vacio');
  assert.equal(estadoInicio({ vehiculosTotal: 0, estadoRows: [], alertas: [], salud: [] }), 'vacio');
});

test('14 vehiculos sin neumaticos medidos: NO es vacio (bug de Inicio)', () => {
  assert.equal(estadoInicio({ vehiculosTotal: 14, estadoRows: [], alertas: [], salud: [] }), 'sin_mediciones');
  assert.equal(estadoInicio({ vehiculosTotal: '14' }), 'sin_mediciones');
});

test('dispositivos o alertas sin vehiculos contados tampoco es vacio', () => {
  assert.equal(estadoInicio({ salud: [{ estado: 'activo' }] }), 'sin_mediciones');
  assert.equal(estadoInicio({ alertas: [{ tipo: 'critico' }] }), 'sin_mediciones');
});

test('con filas de estado: con_datos', () => {
  assert.equal(estadoInicio({ vehiculosTotal: 2, estadoRows: [{ estado: 'ok' }] }), 'con_datos');
});
