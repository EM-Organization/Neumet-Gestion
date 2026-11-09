import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoAlerta, etiquetaEstadoAlerta, contarPorEstadoAlerta, filtrarPorEstadoAlerta, sinReconocer, hastaSilencio,
  validarNota, validarUmbralCritico, validarHisteresis, traducirErrorAlerta,
} from '../../assets/js/domain/alertas.js';

const AHORA = Date.parse('2026-06-10T12:00:00Z');
const al = [
  { alerta_id: 1, estado: 'abierta', silenciada_hasta: null },
  { alerta_id: 2, estado: 'reconocida', silenciada_hasta: null },
  { alerta_id: 3, estado: 'abierta', silenciada_hasta: '2026-06-12T00:00:00Z' },
  { alerta_id: 4, estado: 'reconocida', silenciada_hasta: '2026-06-01T00:00:00Z' }, // silencio vencido
  { alerta_id: 5 },                                                              // sin estado: abierta
];

describe('estado de la alerta', () => {
  test('silenciada solo con silencio vigente; el vencido vuelve a su estado', () => {
    assert.deepEqual(al.map(a => estadoAlerta(a, AHORA)), ['abierta', 'reconocida', 'silenciada', 'reconocida', 'abierta']);
  });
  test('entradas nulas o inválidas: abierta', () => {
    assert.equal(estadoAlerta(null, AHORA), 'abierta');
    assert.equal(estadoAlerta({ silenciada_hasta: 'x' }, AHORA), 'abierta');
  });
  test('cuenta, filtra y sin reconocer', () => {
    assert.deepEqual(contarPorEstadoAlerta(al, AHORA), { abierta: 2, reconocida: 2, silenciada: 1 });
    assert.deepEqual(contarPorEstadoAlerta([], AHORA), { abierta: 0, reconocida: 0, silenciada: 0 });
    assert.deepEqual(filtrarPorEstadoAlerta(al, 'silenciada', AHORA).map(a => a.alerta_id), [3]);
    assert.equal(filtrarPorEstadoAlerta(al, '', AHORA).length, 5);
    assert.equal(sinReconocer(al, AHORA), 2);
  });
  test('etiquetas', () => {
    assert.equal(etiquetaEstadoAlerta('reconocida'), 'Reconocida');
    assert.equal(etiquetaEstadoAlerta('zz'), 'Abierta');
  });
  test('hastaSilencio suma días', () => assert.equal(hastaSilencio(7, AHORA), '2026-06-17T12:00:00.000Z'));
});

describe('validaciones', () => {
  test('nota obligatoria y de hasta 200', () => {
    assert.equal(validarNota('  ').ok, false);
    assert.equal(validarNota(null).ok, false);
    assert.equal(validarNota('x'.repeat(201)).ok, false);
    assert.deepEqual(validarNota(' Retirado '), { ok: true, nota: 'Retirado' });
  });
  const lim = { retiro: 3, bajo: 8 };
  test('nivel crítico entre retiro y bajo, un decimal, acepta coma', () => {
    assert.deepEqual(validarUmbralCritico('5,5', lim), { ok: true, valor: 5.5 });
    assert.equal(validarUmbralCritico('7', lim).ok, true);
    assert.equal(validarUmbralCritico('3', lim).ok, false);
    assert.equal(validarUmbralCritico('8.0', lim).ok, false);
    assert.equal(validarUmbralCritico('5.55', lim).ok, false);
    assert.equal(validarUmbralCritico('', lim).ok, false);
    assert.equal(validarUmbralCritico('abc', lim).ok, false);
    assert.match(validarUmbralCritico('9', lim).error, /entre 3 mm \(retiro\) y 8 mm/);
  });
  test('histéresis de 0 a 3', () => {
    assert.equal(validarHisteresis('0').ok, true);
    assert.deepEqual(validarHisteresis('0,5'), { ok: true, valor: 0.5 });
    assert.equal(validarHisteresis('3.5').ok, false);
    assert.equal(validarHisteresis('-1').ok, false);
  });
});

test('errores de la base traducidos sin filtrar el texto crudo', () => {
  assert.equal(traducirErrorAlerta({ code: '42501', message: 'permiso denegado' }), 'Sin permiso para esta alerta');
  assert.match(traducirErrorAlerta({ code: '55000' }), /ya estaba resuelta/);
  assert.match(traducirErrorAlerta({ code: '23514' }), /Datos inválidos/);
  assert.equal(traducirErrorAlerta(new Error('boom')), 'No se pudo completar la operación');
  assert.equal(traducirErrorAlerta(null), 'No se pudo completar la operación');
});
