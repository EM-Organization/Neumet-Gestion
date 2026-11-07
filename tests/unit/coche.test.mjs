// Número de coche: vehiculos.nombre se muestra como "Coche 106". Funciones puras de domain/coche.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaCoche, validarNumeroCoche, numeroDesdeNombre, MAX_NOMBRE_COCHE } from '../../assets/js/domain/coche.js';

describe('etiquetaCoche', () => {
  test('solo dígitos -> "Coche N"', () => {
    assert.equal(etiquetaCoche('106'), 'Coche 106');
    assert.equal(etiquetaCoche(' 201 '), 'Coche 201');
    assert.equal(etiquetaCoche('007'), 'Coche 007');
    assert.equal(etiquetaCoche(5), 'Coche 5');
  });
  test('nombres anteriores con texto se muestran tal cual', () => {
    assert.equal(etiquetaCoche('Unidad Sur'), 'Unidad Sur');
    assert.equal(etiquetaCoche('Camión 01'), 'Camión 01');
    assert.equal(etiquetaCoche('12A'), '12A');
  });
  test('vacío, nulo e indefinido -> cadena vacía', () => {
    assert.equal(etiquetaCoche(''), '');
    assert.equal(etiquetaCoche('   '), '');
    assert.equal(etiquetaCoche(null), '');
    assert.equal(etiquetaCoche(undefined), '');
  });
  test('no interpreta HTML: devuelve texto (el escape lo hace html``)', () => {
    assert.equal(etiquetaCoche('<b>1</b>'), '<b>1</b>');
  });
});

describe('validarNumeroCoche', () => {
  test('requerido y recortado', () => {
    assert.deepEqual(validarNumeroCoche(' 106 '), { ok: true, valor: '106' });
    assert.equal(validarNumeroCoche('').ok, false);
    assert.equal(validarNumeroCoche('   ').ok, false);
    assert.equal(validarNumeroCoche(null).ok, false);
    assert.match(validarNumeroCoche('').error, /número de coche/);
  });
  test('máximo de caracteres', () => {
    assert.equal(validarNumeroCoche('9'.repeat(MAX_NOMBRE_COCHE)).ok, true);
    assert.equal(validarNumeroCoche('9'.repeat(MAX_NOMBRE_COCHE + 1)).ok, false);
  });
});

describe('numeroDesdeNombre (vehiculos.numero acompaña a nombre)', () => {
  test('alta: el número es el nombre si cabe en 10 caracteres', () => {
    assert.equal(numeroDesdeNombre('106'), '106');
    assert.equal(numeroDesdeNombre('1234567890'), '1234567890');
    assert.equal(numeroDesdeNombre('12345678901'), null);
  });
  test('edición sin cambiar el nombre conserva el número guardado', () => {
    assert.equal(numeroDesdeNombre('Camión 01', { nombreAnterior: 'Camión 01', numeroAnterior: '07' }), '07');
    assert.equal(numeroDesdeNombre(' 106 ', { nombreAnterior: '106', numeroAnterior: '106' }), '106');
    assert.equal(numeroDesdeNombre('Unidad', { nombreAnterior: 'Unidad', numeroAnterior: null }), null);
  });
  test('edición con otro nombre: sigue al nombre; si no cabe, conserva el número anterior', () => {
    assert.equal(numeroDesdeNombre('107', { nombreAnterior: '106', numeroAnterior: '106' }), '107');
    assert.equal(numeroDesdeNombre('Nombre demasiado largo para numero', { nombreAnterior: '106', numeroAnterior: '106' }), '106');
  });
});
