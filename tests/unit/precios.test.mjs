import test from 'node:test';
import assert from 'node:assert/strict';
import { conValor, textoCosto } from '../../assets/js/domain/precios.js';
import { puedeVerPrecios, ROL_ADMIN, ROL_CLIENTE, ROL_SIN_ACCESO } from '../../assets/js/domain/rol.js';

test('puedeVerPrecios: admin y perfil global sí; sucursal, sin acceso y sin sesión no', () => {
  assert.equal(puedeVerPrecios(ROL_ADMIN, null), true);
  assert.equal(puedeVerPrecios(ROL_ADMIN), true);
  assert.equal(puedeVerPrecios(ROL_CLIENTE, null), true);
  assert.equal(puedeVerPrecios(ROL_CLIENTE, undefined), true);
  assert.equal(puedeVerPrecios(ROL_CLIENTE), true);
  assert.equal(puedeVerPrecios(ROL_CLIENTE, 7), false);
  assert.equal(puedeVerPrecios(ROL_CLIENTE, 0), false, 'el id 0 no es "sin sucursal"');
  assert.equal(puedeVerPrecios(ROL_SIN_ACCESO, null), false);
  assert.equal(puedeVerPrecios('api', null), false);
  assert.equal(puedeVerPrecios(null, null), false);
  assert.equal(puedeVerPrecios(undefined, undefined), false);
});

test('conValor: incorpora el valor por id y deja null lo que no tiene', () => {
  const filas = [{ id: 1, marca: 'A' }, { id: 2, marca: 'B' }, { id: 3, marca: 'C' }];
  const r = conValor(filas, new Map([[1, 450.5], [3, 0]]), 'precio_unidad');
  assert.deepEqual(r, [{ id: 1, marca: 'A', precio_unidad: 450.5 }, { id: 2, marca: 'B', precio_unidad: null }, { id: 3, marca: 'C', precio_unidad: 0 }]);
  assert.equal('precio_unidad' in filas[0], false, 'no muta la entrada');
});

test('conValor: Map vacío (perfil de sucursal o fallo), sin filas, null y entradas inválidas', () => {
  assert.deepEqual(conValor([{ id: 1 }], new Map(), 'costo'), [{ id: 1, costo: null }]);
  assert.deepEqual(conValor([], new Map([[1, 5]]), 'costo'), []);
  assert.deepEqual(conValor(null, new Map(), 'costo'), []);
  assert.deepEqual(conValor(undefined, undefined, 'costo'), []);
  assert.deepEqual(conValor([{ id: 1 }], null, 'costo'), [{ id: 1, costo: null }]);
  assert.deepEqual(conValor([{ id: 1 }], { 1: 5 }, 'costo'), [{ id: 1, costo: null }], 'un objeto plano no es un Map');
});

test('conValor: el id se compara tal cual (número con número)', () => {
  assert.deepEqual(conValor([{ id: 1 }], new Map([['1', 9]]), 'costo'), [{ id: 1, costo: null }]);
});

test('textoCosto: solo con valor; el cero es un costo', () => {
  assert.equal(textoCosto(230.5), ' · costo 230.5');
  assert.equal(textoCosto('15.00'), ' · costo 15.00');
  assert.equal(textoCosto(0), ' · costo 0');
  assert.equal(textoCosto(null), '');
  assert.equal(textoCosto(undefined), '');
  assert.equal(textoCosto(''), '');
});
