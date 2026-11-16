// Tests de domain/balance.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unirPrecios, precioDeEntrada, mensajeErrorPrecio } from '../../assets/js/domain/balance.js';

describe('unirPrecios', () => {
  test('une por cliente_id y conserva el resto de los campos', () => {
    const r = unirPrecios([{ id: 1, nombre: 'A' }, { id: 2, nombre: 'B' }], [{ cliente_id: 2, precio_mensual: '75000.50' }, { cliente_id: 1, precio_mensual: 50000 }]);
    assert.deepEqual(r, [{ id: 1, nombre: 'A', precio_mensual: 50000 }, { id: 2, nombre: 'B', precio_mensual: 75000.5 }]);
  });
  test('cliente sin fila o con null queda en 0', () => {
    const r = unirPrecios([{ id: 1 }, { id: 2 }], [{ cliente_id: 2, precio_mensual: null }]);
    assert.deepEqual(r.map(c => c.precio_mensual), [0, 0]);
  });
  test('vacío y null no fallan', () => {
    assert.deepEqual(unirPrecios([], []), []);
    assert.deepEqual(unirPrecios(null, null), []);
    assert.deepEqual(unirPrecios([{ id: 1 }], null), [{ id: 1, precio_mensual: 0 }]);
  });
  test('no muta los clientes recibidos', () => {
    const c = [{ id: 1 }];
    unirPrecios(c, [{ cliente_id: 1, precio_mensual: 5 }]);
    assert.deepEqual(c, [{ id: 1 }]);
  });
});

describe('precioDeEntrada', () => {
  test('número válido', () => { assert.equal(precioDeEntrada('1500'), 1500); assert.equal(precioDeEntrada('12.5'), 12.5); });
  test('vacío, texto y null dan 0', () => { for (const v of ['', 'abc', null, undefined]) assert.equal(precioDeEntrada(v), 0); });
  test('negativo da 0', () => assert.equal(precioDeEntrada('-20'), 0));
});

describe('mensajeErrorPrecio', () => {
  test('42501, 22023 y P0002 tienen aviso propio, en infinitivo y sin signos de exclamación', () => {
    const m = ['42501', '22023', 'P0002'].map(code => mensajeErrorPrecio({ code }));
    assert.equal(new Set(m).size, 3);
    assert.match(m[0], /^Sin permiso/);
    assert.match(m[1], /^Precio inválido\. Ingresar/);
    assert.match(m[2], /ya no existe\. Recargar/);
    for (const t of m) assert.doesNotMatch(t, /[!¡]/);
  });
  test('al cargar, 42501 habla de ver y no de cambiar', () => {
    assert.equal(mensajeErrorPrecio({ code: '42501' }, 'cargar'), 'Sin permiso para ver los precios');
  });
  test('código desconocido o sin error: aviso genérico', () => {
    assert.match(mensajeErrorPrecio({ code: '57014' }), /No se pudo guardar el precio/);
    assert.match(mensajeErrorPrecio(null), /No se pudo guardar el precio/);
    assert.match(mensajeErrorPrecio({}, 'cargar'), /No se pudieron cargar los precios/);
  });
});
