import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCambio, traducirErrorCambio, stockDisponible, validarRotacion, DESTINOS } from '../../assets/js/domain/cambio-neumatico.js';

const neum = { id: 5, vehiculo_id: 10, posicion: 3, marca: 'Michelin', modelo: 'X', estado: 'montado', vida: 0 };
const stock = [{ id: 1, marca: 'Pirelli', modelo: 'FR', cantidad: 2 }, { id: 2, marca: 'Vacio', cantidad: 0 }];
const base = { neum, destino: 'baja', motivo: 'Desgaste', origen: 'stock', stockId: '1', stock, odometro: '', odometroActual: 1000 };

test('stockDisponible descarta lotes sin unidades', () => {
  assert.deepEqual(stockDisponible(stock).map(s => s.id), [1]);
  assert.deepEqual(stockDisponible(null), []);
});

test('validarCambio: del stock arma los parámetros de la RPC', () => {
  const r = validarCambio(base);
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_vehiculo_id: 10, p_posicion: 3, p_destino_viejo: 'baja', p_motivo: 'Desgaste',
    p_odometro_km: null, p_stock_id: 1, p_nuevo: null });
  assert.match(r.resumen, /P3: sale Michelin X/);
});

test('validarCambio: neumático nuevo ingresado y odómetro', () => {
  const r = validarCambio({ ...base, origen: 'nuevo', marca: ' Goodyear ', modelo: '', codigo: 'AB-1', odometro: '1500' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params.p_nuevo, { marca: 'Goodyear', codigo: 'AB-1' });
  assert.equal(r.params.p_stock_id, null);
  assert.equal(r.params.p_odometro_km, 1500);
});

test('validarCambio: rechazos', () => {
  assert.equal(validarCambio({ ...base, neum: null }).ok, false);
  assert.equal(validarCambio({ ...base, neum: { ...neum, estado: 'baja' } }).ok, false);
  assert.equal(validarCambio({ ...base, destino: 'tirar' }).ok, false);
  assert.equal(validarCambio({ ...base, motivo: '  ' }).ok, false);               // baja exige motivo
  assert.equal(validarCambio({ ...base, destino: 'reparacion', motivo: '' }).ok, true); // el resto no
  assert.equal(validarCambio({ ...base, destino: 'reencauche', neum: { ...neum, vida: 3 } }).ok, false);
  assert.equal(validarCambio({ ...base, stockId: '2' }).ok, false);               // lote sin unidades
  assert.equal(validarCambio({ ...base, stockId: '99' }).ok, false);
  assert.equal(validarCambio({ ...base, origen: 'nuevo', marca: '' }).ok, false);
  assert.equal(validarCambio({ ...base, origen: 'nuevo', marca: 'x'.repeat(61) }).ok, false);
  assert.equal(validarCambio({ ...base, origen: undefined }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '-1' }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '12.5' }).ok, false);
  assert.equal(validarCambio({ ...base, odometro: '999' }).ok, false);            // menor al actual (1000)
  assert.equal(validarCambio({ ...base, motivo: 'x'.repeat(201) }).ok, false);
});

test('traducirErrorCambio: mensajes comprensibles', () => {
  assert.match(traducirErrorCambio({ code: '42501', message: 'permiso denegado' }), /Sin permiso/);
  assert.match(traducirErrorCambio({ code: '55000', message: 'sin unidades en el stock seleccionado' }), /No quedan unidades/);
  assert.match(traducirErrorCambio({ code: 'P0002', message: 'stock inexistente' }), /stock/);
  assert.match(traducirErrorCambio({ code: 'P0002', message: 'no hay neumático en la posición 3' }), /posición/);
  assert.match(traducirErrorCambio({ code: '23514', message: 'el neumático ya alcanzó la vida máxima (3 reencauches)' }), /vida máxima/);
  assert.match(traducirErrorCambio({ code: '23514', message: 'el kilometraje no puede ser menor al actual (5)' }), /ilometraje/);
  assert.match(traducirErrorCambio({ message: 'boom' }), /No se guardó nada/);
  assert.match(traducirErrorCambio(null), /No se pudo registrar/);
});

test('validarRotacion', () => {
  const ns = [{ vehiculo_id: 10, posicion: 1, estado: 'montado' }, { vehiculo_id: 10, posicion: 2, estado: 'montado' },
    { vehiculo_id: 10, posicion: 9, estado: 'baja' }, { vehiculo_id: 11, posicion: 5, estado: 'montado' }];
  assert.equal(validarRotacion(ns, 10, 1, 2).intercambio.posicion, 2);
  assert.equal(validarRotacion(ns, 10, 1, 4).intercambio, null);
  assert.deepEqual(validarRotacion(ns, 10, '1', '4').params, { p_vehiculo_id: 10, p_pos_a: 1, p_pos_b: 4 });
  for (const [a, b] of [[1, 1], [4, 1], [1, 9], [1, 100], [0, 1], ['x', 1], [5, 1]]) assert.equal(validarRotacion(ns, 10, a, b).ok, false);
});

test('DESTINOS cubre los cuatro destinos de la RPC', () => {
  assert.deepEqual(DESTINOS.map(d => d.id), ['baja', 'reencauche', 'reparacion', 'almacenado']);
});
