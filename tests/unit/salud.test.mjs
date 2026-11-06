// Tests de domain/salud.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarSalud, contarPorEstado, textoDias, infoEstado } from '../../assets/js/domain/salud.js';

const R = [
  { dispositivo_id: 1, cliente_id: 1, mac_address: 'AA:01', nombre: 'Sensor A', estado: 'activo', dias_sin_actividad: 1, total_mediciones: 50 },
  { dispositivo_id: 2, cliente_id: 1, mac_address: 'AA:02', nombre: null, estado: 'caido', dias_sin_actividad: 45, total_mediciones: 9 },
  { dispositivo_id: 3, cliente_id: 2, mac_address: 'BB:03', nombre: 'Taller', estado: 'sin_actividad', dias_sin_actividad: 12, total_mediciones: 3 },
  { dispositivo_id: 4, cliente_id: 2, mac_address: 'BB:04', nombre: null, estado: 'nunca', dias_sin_actividad: null, total_mediciones: 0 },
  { dispositivo_id: 5, cliente_id: 2, mac_address: 'BB:05', nombre: null, estado: 'caido', dias_sin_actividad: 90, total_mediciones: 2 }
];

describe('filtrarSalud', () => {
  test('sin filtros ordena por gravedad y días', () => {
    assert.deepEqual(filtrarSalud(R).map(r => r.dispositivo_id), [5, 2, 3, 4, 1]);
  });
  test('por estado', () => assert.deepEqual(filtrarSalud(R, { estado: 'caido' }).map(r => r.dispositivo_id), [5, 2]));
  test('por cliente (acepta número o texto)', () => {
    assert.equal(filtrarSalud(R, { clienteId: 2 }).length, 3);
    assert.equal(filtrarSalud(R, { clienteId: '1' }).length, 2);
  });
  test('estado y cliente combinados', () => assert.deepEqual(filtrarSalud(R, { estado: 'caido', clienteId: '1' }).map(r => r.dispositivo_id), [2]));
  test('búsqueda por MAC o nombre, sin distinguir mayúsculas', () => {
    assert.deepEqual(filtrarSalud(R, { query: ' taller ' }).map(r => r.dispositivo_id), [3]);
    assert.deepEqual(filtrarSalud(R, { query: 'aa:0' }).map(r => r.dispositivo_id), [2, 1]);
  });
  test('no muta la entrada y tolera null', () => {
    const copia = R.map(r => r.dispositivo_id);
    filtrarSalud(R);
    assert.deepEqual(R.map(r => r.dispositivo_id), copia);
    assert.deepEqual(filtrarSalud(null), []);
  });
});

describe('contarPorEstado', () => {
  test('total y por estado', () => assert.deepEqual(contarPorEstado(R), { total: 5, activo: 1, sin_actividad: 1, caido: 2, nunca: 1 }));
  test('respeta el cliente', () => assert.deepEqual(contarPorEstado(R, 1), { total: 2, activo: 1, sin_actividad: 0, caido: 1, nunca: 0 }));
  test('vacío', () => assert.equal(contarPorEstado(undefined).total, 0));
});

describe('textoDias / infoEstado', () => {
  test('textos', () => {
    assert.equal(textoDias({ estado: 'activo', dias_sin_actividad: 0 }), 'hoy');
    assert.equal(textoDias({ estado: 'activo', dias_sin_actividad: 1 }), '1 día');
    assert.equal(textoDias({ estado: 'caido', dias_sin_actividad: 45 }), '45 días');
    assert.equal(textoDias({ estado: 'nunca', dias_sin_actividad: null }), '—');
    assert.equal(textoDias(null), '—');
  });
  test('estado desconocido no rompe', () => assert.deepEqual(infoEstado('raro'), { cls: 'gray', lbl: 'raro' }));
  test('estados conocidos', () => {
    assert.equal(infoEstado('caido').cls, 'red');
    assert.equal(infoEstado('activo').lbl, 'Activo');
  });
});
