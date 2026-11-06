// Tests de domain/umbrales.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validarUmbrales, mensajeErrorUmbrales, resumenFlota, aNumero } from '../../assets/js/domain/umbrales.js';

const OK = { umbral_bajo_mm: '8', umbral_critico_mm: '5', umbral_retiro_mm: '3', dias_sin_medir_alerta: '30', irregularidad_mm: '2' };

describe('aNumero', () => {
  test('coma o punto', () => { assert.equal(aNumero('7,5'), 7.5); assert.equal(aNumero(' 7.5 '), 7.5); });
  test('vacío o texto => NaN', () => { assert.ok(Number.isNaN(aNumero(''))); assert.ok(Number.isNaN(aNumero('x'))); assert.ok(Number.isNaN(aNumero(null))); });
});

describe('validarUmbrales', () => {
  test('valores por defecto válidos', () => {
    const v = validarUmbrales(OK);
    assert.equal(v.ok, true);
    assert.deepEqual(v.valores, { umbral_bajo_mm: 8, umbral_critico_mm: 5, umbral_retiro_mm: 3, dias_sin_medir_alerta: 30, irregularidad_mm: 2 });
  });
  test('acepta coma decimal', () => assert.equal(validarUmbrales({ ...OK, umbral_bajo_mm: '8,5' }).valores.umbral_bajo_mm, 8.5));
  test('exige retiro < crítico < bajo (estricto)', () => {
    for (const o of [{ umbral_critico_mm: '8' }, { umbral_retiro_mm: '5' }, { umbral_bajo_mm: '4' }, { umbral_retiro_mm: '6' }]) {
      const v = validarUmbrales({ ...OK, ...o });
      assert.equal(v.ok, false, JSON.stringify(o));
      assert.match(v.error, /retiro < crítico < bajo/);
    }
  });
  test('campo vacío o no numérico', () => {
    const v = validarUmbrales({ ...OK, umbral_bajo_mm: '' });
    assert.equal(v.ok, false); assert.equal(v.campo, 'umbral_bajo_mm'); assert.match(v.error, /número/);
    assert.equal(validarUmbrales({}).ok, false);
  });
  test('rangos y decimales', () => {
    assert.equal(validarUmbrales({ ...OK, umbral_retiro_mm: '0' }).ok, false);
    assert.equal(validarUmbrales({ ...OK, umbral_bajo_mm: '100' }).ok, false);
    assert.match(validarUmbrales({ ...OK, irregularidad_mm: '2,25' }).error, /un decimal/);
    assert.equal(validarUmbrales({ ...OK, irregularidad_mm: '0,5' }).ok, true);
  });
  test('días: entero >= 1', () => {
    assert.equal(validarUmbrales({ ...OK, dias_sin_medir_alerta: '0' }).ok, false);
    assert.equal(validarUmbrales({ ...OK, dias_sin_medir_alerta: '7,5' }).ok, false);
    assert.equal(validarUmbrales({ ...OK, dias_sin_medir_alerta: '7' }).ok, true);
  });
});

describe('mensajeErrorUmbrales', () => {
  test('check_violation muestra el detalle de la BD', () => {
    const m = mensajeErrorUmbrales({ code: '23514', message: 'new row for relation "clientes" violates check constraint "clientes_umbrales_orden"' });
    assert.match(m, /rechazó/); assert.match(m, /clientes_umbrales_orden/);
  });
  test('permisos', () => assert.match(mensajeErrorUmbrales({ code: '42501', message: 'permission denied' }), /permiso/));
  test('otro error conserva el mensaje', () => assert.match(mensajeErrorUmbrales({ message: 'timeout' }), /timeout/));
  test('sin mensaje', () => assert.equal(mensajeErrorUmbrales(null), 'No se pudieron guardar los umbrales'));
});

describe('resumenFlota', () => {
  test('porcentajes sobre neumáticos con datos', () => {
    const r = resumenFlota({ n_ok: 6, n_bajo: 3, n_critico: 1, n_sin_datos: 4, n_alertas_sev1: 1, n_alertas_sev2: 2, n_alertas_sev3: 1 });
    assert.deepEqual(r, { ok: 6, bajo: 3, critico: 1, sinDatos: 4, alertas: 4, conDatos: 10, pctOk: 60, pctBajo: 30, pctCritico: 10 });
  });
  test('sin fila o sin datos no divide por cero', () => {
    assert.equal(resumenFlota(null).pctOk, 0);
    assert.equal(resumenFlota({ n_sin_datos: 2 }).conDatos, 0);
  });
});
