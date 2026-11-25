// Tests de domain/rol-eje.js (CA-31). Ejecutar: npm test  (node:test, sin dependencias).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DISTRIBUCIONES, OTRA_DISTRIBUCION } from '../../assets/js/domain/distribucion.js';
import { rolEjePosicion, ROLES_EJE } from '../../assets/js/domain/rol-eje.js';

const D = 'direccion', T = 'traccion', L = 'loco';
const rep = (rol, n) => Array(n).fill(rol);

// Rol de cada posición de rueda, de adelante hacia atrás (la posición 1 es la primera rueda del eje delantero).
const ROLES_POR_DISTRIBUCION = {
  '4x2': [...rep(D, 2), ...rep(T, 4)],
  '6x2': [...rep(D, 2), ...rep(T, 4), ...rep(L, 2)],
  '6x4': [...rep(D, 2), ...rep(T, 8)],
  '8x2': [...rep(D, 4), ...rep(T, 4), ...rep(L, 2)],
  '8x4': [...rep(D, 4), ...rep(T, 8)],
};

describe('rolEjePosicion: las cinco distribuciones del catálogo', () => {
  test('la tabla de la prueba cubre el catálogo entero', () => {
    assert.deepEqual(Object.keys(ROLES_POR_DISTRIBUCION), DISTRIBUCIONES.map(d => d.id));
  });
  for (const [id, roles] of Object.entries(ROLES_POR_DISTRIBUCION)) {
    test(`${id}: cada posición tiene su rol y la siguiente no existe`, () => {
      roles.forEach((rol, i) => assert.equal(rolEjePosicion(id, i + 1), rol, `${id}, posición ${i + 1}`));
      assert.equal(rolEjePosicion(id, roles.length + 1), null);
    });
  }
});

describe('rolEjePosicion: auxilio y casos sin distribución', () => {
  test('la posición 99 es el auxilio, con cualquier distribución o sin ella', () => {
    assert.equal(rolEjePosicion('6x2', 99), 'auxilio');
    assert.equal(rolEjePosicion(null, 99), 'auxilio');
  });
  test('sin distribución del catálogo («Otra» o sin definir): solo se sabe que 1 y 2 son el eje delantero', () => {
    assert.equal(rolEjePosicion(null, 1), 'direccion');
    assert.equal(rolEjePosicion(undefined, 2), 'direccion');
    assert.equal(rolEjePosicion(OTRA_DISTRIBUCION, 2), 'direccion');
    assert.equal(rolEjePosicion(null, 3), null);
    assert.equal(rolEjePosicion(OTRA_DISTRIBUCION, 7), null);
  });
  test('posiciones que no existen en la distribución o no son válidas: null', () => {
    assert.equal(rolEjePosicion('6x2', 9), null); // la 6x2 tiene 8 ruedas
    assert.equal(rolEjePosicion('6x2', 0), null);
    assert.equal(rolEjePosicion('6x2', 100), null);
    assert.equal(rolEjePosicion('6x2', 1.5), null);
    assert.equal(rolEjePosicion('6x2', 'abc'), null);
  });
});

describe('ROLES_EJE', () => {
  test('etiquetas de los cuatro roles, en español', () => {
    assert.deepEqual({ ...ROLES_EJE }, { direccion: 'Dirección', traccion: 'Tracción', loco: 'Eje loco', auxilio: 'Auxilio' });
  });
  test('congelado: ninguna vista lo puede cambiar', () => {
    assert.equal(Object.isFrozen(ROLES_EJE), true);
  });
});
