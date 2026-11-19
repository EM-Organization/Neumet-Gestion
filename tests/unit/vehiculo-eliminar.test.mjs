import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumenNeumaticos, opcionesDestino, etiquetaDestino, textoResumen, validarEliminar, traducirErrorEliminar } from '../../assets/js/domain/vehiculo-eliminar.js';

const n = (estado, quema) => ({ id: Math.random(), estado, numero_quema: quema });

test('resumenNeumaticos: no cuenta los ya dados de baja y detecta los sin quema', () => {
  assert.deepEqual(resumenNeumaticos([n('montado', 'Q1'), n('reparacion', 'Q2'), n('baja', null), n('montado', '  '), n('montado', null)]),
    { total: 4, sinQuema: 2 });
  assert.deepEqual(resumenNeumaticos([]), { total: 0, sinQuema: 0 });
  assert.deepEqual(resumenNeumaticos(null), { total: 0, sinQuema: 0 });
  assert.deepEqual(resumenNeumaticos([n('baja', 'Q1')]), { total: 0, sinQuema: 0 });
});

test('opcionesDestino: el stock se preelige solo si todos tienen quema; la baja nunca', () => {
  assert.deepEqual(opcionesDestino({ total: 4, sinQuema: 0 }),
    { hayNeumaticos: true, stockPosible: true, porDefecto: 'stock', avisoStock: '' });
  const sin = opcionesDestino({ total: 4, sinQuema: 1 });
  assert.equal(sin.stockPosible, false);
  assert.equal(sin.porDefecto, '');
  assert.equal(sin.avisoStock, '1 neumático no tiene número de quema: no pueden volver al stock');
  assert.match(opcionesDestino({ total: 4, sinQuema: 3 }).avisoStock, /^3 neumáticos no tienen número de quema/);
  const vacio = opcionesDestino({ total: 0, sinQuema: 0 });
  assert.equal(vacio.hayNeumaticos, false);
  assert.equal(vacio.porDefecto, '');
});

test('textos: cuentan los neumáticos, sin segunda persona ni signos de exclamación', () => {
  assert.equal(etiquetaDestino('stock', 4), 'Enviar los 4 neumáticos al stock');
  assert.equal(etiquetaDestino('baja', 4), 'Dar de baja los 4 neumáticos');
  assert.equal(etiquetaDestino('stock', 1), 'Enviar el neumático al stock');
  assert.equal(textoResumen({ total: 2, destino: 'stock' }), '2 neumáticos vuelven al stock y conservan su historial.');
  assert.equal(textoResumen({ total: 1, destino: 'baja' }), '1 neumático queda dado de baja con el vehículo.');
  assert.equal(textoResumen({ total: 3, destino: 'baja' }), '3 neumáticos quedan dados de baja con el vehículo.');
  for (const t of [etiquetaDestino('stock', 4), textoResumen({ total: 0 }), textoResumen({ total: 2, destino: '' })]) assert.doesNotMatch(t, /[!¡]/);
});

test('validarEliminar: arma los parámetros de la RPC', () => {
  assert.deepEqual(validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 0, destino: 'stock' }).params, { p_vehiculo_id: 7, p_destino_neumaticos: 'stock' });
  assert.deepEqual(validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 2, destino: 'baja' }).params, { p_vehiculo_id: 7, p_destino_neumaticos: 'baja' });
  // Sin neumáticos no se manda destino aunque venga uno elegido.
  const vacio = validarEliminar({ vehiculoId: 7, total: 0, sinQuema: 0, destino: 'baja' });
  assert.equal(vacio.ok, true);
  assert.deepEqual(vacio.params, { p_vehiculo_id: 7, p_destino_neumaticos: null });
});

test('validarEliminar: rechaza lo incompleto o imposible sin llegar a la base', () => {
  assert.deepEqual(validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 0, destino: '' }), { ok: false, error: 'Elegir qué hacer con los neumáticos' });
  assert.equal(validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 0, destino: 'borrar' }).ok, false);
  assert.equal(validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 0, destino: undefined }).ok, false);
  const sinQuema = validarEliminar({ vehiculoId: 7, total: 4, sinQuema: 2, destino: 'stock' });
  assert.equal(sinQuema.ok, false);
  assert.match(sinQuema.error, /^2 neumáticos no tienen número de quema/);
  assert.equal(validarEliminar({ vehiculoId: NaN, total: 0, sinQuema: 0, destino: '' }).ok, false);
  assert.equal(validarEliminar({ vehiculoId: null, total: 0, sinQuema: 0, destino: '' }).ok, false);
});

test('traducirErrorEliminar: dice qué pasó y qué hacer', () => {
  assert.match(traducirErrorEliminar({ code: '42501', message: 'permiso denegado' }), /^Sin permiso para eliminar este vehículo/);
  assert.match(traducirErrorEliminar({ code: 'P0002', message: 'el vehículo ya fue eliminado' }), /^El vehículo ya fue eliminado/);
  assert.match(traducirErrorEliminar({ code: '22023', message: '2 neumático(s) sin número de quema no pueden ir al stock' }), /sin número de quema.*Darlos de baja/);
  assert.match(traducirErrorEliminar({ code: '55000', message: 'la cubierta está en recauchutado: cerrar el proceso antes' }), /recauchutado/);
  assert.match(traducirErrorEliminar({ code: '22023', message: 'elegir qué hacer con los neumáticos' }), /^Elegir qué hacer/);
  assert.match(traducirErrorEliminar({ message: 'boom' }), /No se guardó nada/);
  assert.match(traducirErrorEliminar(null), /No se guardó nada/);
});
