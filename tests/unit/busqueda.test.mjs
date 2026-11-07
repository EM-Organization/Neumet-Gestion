// Buscador por matrícula o número de coche con datos como los del seed de demo y los que escribe un usuario real.
// Un PR que arregla un bug debe incluir un test que falle sin el arreglo: los casos con guion, punto y separadores
// fallaban cuando claveBusqueda solo quitaba espacios.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { claveBusqueda, buscarVehiculos, coincidenciaExacta, resolverBusqueda } from '../../assets/js/domain/vehiculo-busqueda.js';

// Patentes DEMO001..DEMO014 y números 101-109 / 201-205 como en supabase/seed/demo.sql, más patentes con formatos reales.
const demo = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: i + 1, nombre: `Camión 10${i + 1}`, patente: `DEMO00${i + 1}`, numero: `10${i + 1}`, activo: true })),
  { id: 10, nombre: 'Camión 201', patente: 'DEMO010', numero: '201', activo: true },
  { id: 11, nombre: 'Camión 202', patente: 'DEMO011', numero: '202', activo: true },
  { id: 20, nombre: 'Camión con guion', patente: 'SAB-1234', numero: null, activo: true },
  { id: 21, nombre: 'Camión con espacio', patente: 'SBC 5678', numero: 301, activo: true },
  { id: 22, nombre: 'Sin matrícula', patente: null, numero: null, activo: true },
];
const ids = (texto) => buscarVehiculos(demo, texto).map(v => v.id);

describe('claveBusqueda', () => {
  test('solo letras y dígitos, en mayúsculas y sin tildes', () => {
    assert.equal(claveBusqueda('sab-1234'), 'SAB1234');
    assert.equal(claveBusqueda(' SBC  56.78 '), 'SBC5678');
    assert.equal(claveBusqueda('Camión_01'), 'CAMION01');
    assert.equal(claveBusqueda(null), '');
    assert.equal(claveBusqueda(' - '), '');
  });
});

describe('matrícula', () => {
  test('mayúsculas, minúsculas y mezcla', () => {
    assert.deepEqual(ids('DEMO010'), [10]);
    assert.deepEqual(ids('demo010'), [10]);
    assert.deepEqual(ids('DeMo010'), [10]);
  });
  test('con espacios y guiones, tal como se escriba', () => {
    assert.deepEqual(ids(' demo 010 '), [10]);
    assert.deepEqual(ids('DEMO-010'), [10]);
    assert.deepEqual(ids('sab1234'), [20]);   // guardada con guion, escrita sin él
    assert.deepEqual(ids('SAB 1234'), [20]);
    assert.deepEqual(ids('sbc-5678'), [21]);  // guardada con espacio, escrita con guion
    assert.deepEqual(ids('SBC5678'), [21]);
  });
  test('parcial', () => {
    assert.deepEqual(ids('DEMO01').sort((a, b) => a - b), [10, 11]);
    assert.deepEqual(ids('1234'), [20]);
  });
});

describe('número de coche', () => {
  test('exacto y como número, no solo como texto', () => {
    assert.deepEqual(ids('201'), [10]);
    assert.deepEqual(ids('301'), [21]);   // numero guardado como número
  });
  test('el exacto va antes que los parciales', () => {
    assert.equal(buscarVehiculos([{ id: 1, nombre: 'a', numero: '101' }, { id: 2, nombre: 'b', numero: '10' }], '10')[0].id, 2);
  });
});

describe('resolverBusqueda', () => {
  test('una coincidencia exacta abre el detalle', () => {
    assert.equal(resolverBusqueda(demo, 'DEMO010').accion, 'abrir');
    assert.equal(resolverBusqueda(demo, 'DEMO010').vehiculo.id, 10);
    assert.equal(resolverBusqueda(demo, '201').vehiculo.id, 10);
    assert.equal(resolverBusqueda(demo, 'sab-1234').vehiculo.id, 20);
  });
  test('una única coincidencia parcial abre el detalle', () => {
    assert.equal(resolverBusqueda(demo, 'SBC56').accion, 'abrir');
  });
  test('varias coincidencias: lista acotada, con el total real', () => {
    const r = resolverBusqueda(demo, 'DEMO', 5);
    assert.equal(r.accion, 'lista');
    assert.equal(r.items.length, 5);
    assert.equal(r.total, 11);
    assert.equal(r.vehiculo, null);
  });
  test('sin coincidencias, texto vacío o solo separadores', () => {
    assert.equal(resolverBusqueda(demo, 'ZZZ999').accion, 'ninguno');
    assert.equal(resolverBusqueda(demo, '   ').accion, 'vacio');
    assert.equal(resolverBusqueda(demo, '--').accion, 'vacio');
  });
  test('catálogo vacío o nulo', () => {
    assert.equal(resolverBusqueda([], 'DEMO010').accion, 'ninguno');
    assert.equal(resolverBusqueda(null, 'DEMO010').accion, 'ninguno');
  });
  test('misma matrícula en dos clientes (admin): no se abre solo', () => {
    const dos = [{ id: 1, nombre: 'A', patente: 'AB123CD', numero: null }, { id: 2, nombre: 'B', patente: 'AB-123-CD', numero: null }];
    assert.equal(coincidenciaExacta(dos, 'ab123cd'), null);
    assert.equal(resolverBusqueda(dos, 'ab123cd').accion, 'lista');
  });
});
