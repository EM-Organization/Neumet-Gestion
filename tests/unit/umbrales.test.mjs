// Tests de domain/umbrales.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_UMBRAL, validarUmbrales, validarHisteresis, mensajeErrorUmbrales, resumenFlota, aNumero } from '../../assets/js/domain/umbrales.js';

const OK = { umbral_bajo_mm: '8', umbral_critico_mm: '5', alerta_histeresis_mm: '0,5', umbral_retiro_mm: '3', dias_sin_medir_alerta: '30', irregularidad_mm: '2' };

describe('aNumero', () => {
  test('coma o punto', () => { assert.equal(aNumero('7,5'), 7.5); assert.equal(aNumero(' 7.5 '), 7.5); });
  test('vacío o texto => NaN', () => { assert.ok(Number.isNaN(aNumero(''))); assert.ok(Number.isNaN(aNumero('x'))); assert.ok(Number.isNaN(aNumero(null))); });
});

describe('validarUmbrales', () => {
  test('valores por defecto válidos', () => {
    const v = validarUmbrales(OK);
    assert.equal(v.ok, true);
    assert.deepEqual(v.valores, { umbral_bajo_mm: 8, umbral_critico_mm: 5, alerta_histeresis_mm: 0.5, umbral_retiro_mm: 3, dias_sin_medir_alerta: 30, irregularidad_mm: 2 });
  });
  test('acepta coma decimal', () => assert.equal(validarUmbrales({ ...OK, umbral_bajo_mm: '8,5' }).valores.umbral_bajo_mm, 8.5));
  test('exige descenso estricto: mayor desgaste < poco desgaste < nuevo', () => {
    for (const o of [{ umbral_critico_mm: '8' }, { umbral_retiro_mm: '5' }, { umbral_bajo_mm: '4' }, { umbral_retiro_mm: '6' }]) {
      const v = validarUmbrales({ ...OK, ...o });
      assert.equal(v.ok, false, JSON.stringify(o));
      assert.match(v.error, /mayor desgaste, poco desgaste, nuevo/);
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

describe('histéresis', () => {
  test('de 0 a 3 con un decimal, acepta coma', () => {
    assert.equal(validarHisteresis('0').ok, true);
    assert.deepEqual(validarHisteresis('0,5'), { ok: true, valor: 0.5 });
    assert.equal(validarHisteresis('3.5').ok, false);
    assert.equal(validarHisteresis('-1').ok, false);
    assert.equal(validarHisteresis('0,55').ok, false);
    assert.equal(validarHisteresis('').ok, false);
  });
  test('validarUmbrales la incluye: 0 vale; fuera de rango o vacía se rechaza con el campo', () => {
    assert.equal(validarUmbrales({ ...OK, alerta_histeresis_mm: '0' }).valores.alerta_histeresis_mm, 0);
    for (const h of ['3,1', '-0,5', '', 'x']) {
      const v = validarUmbrales({ ...OK, alerta_histeresis_mm: h });
      assert.equal(v.ok, false, h); assert.equal(v.campo, 'alerta_histeresis_mm');
    }
  });
});

describe('textos y orden de los campos (docs/14)', () => {
  test('de mayor a menor: bajo, crítico, retiro; luego los demás ajustes', () => {
    assert.deepEqual(CAMPOS_UMBRAL.map(c => c.key).slice(0, 3), ['umbral_bajo_mm', 'umbral_critico_mm', 'umbral_retiro_mm']);
  });
  test('sin colores entre paréntesis, sin comillas rectas, sin «<» en lo que ve el operario', () => {
    const textos = CAMPOS_UMBRAL.flatMap(c => [c.lbl, c.ayuda])
      .concat([validarUmbrales({ ...OK, umbral_critico_mm: '9' }).error, validarHisteresis('9').error]);
    for (const t of textos) {
      assert.doesNotMatch(t, /\((naranja|rojo|amarillo|verde)\)/i, t);
      assert.doesNotMatch(t, /"/, t);
      assert.doesNotMatch(t, /[<>]/, t);
    }
    assert.equal(CAMPOS_UMBRAL.find(c => c.key === 'alerta_histeresis_mm').lbl, 'Histéresis de alerta (mm)');
  });
  test('días sin medir es indicador, no alerta', () => {
    const c = CAMPOS_UMBRAL.find(c => c.key === 'dias_sin_medir_alerta');
    assert.doesNotMatch(c.lbl, /alerta/i);
    assert.doesNotMatch(c.ayuda, /alerta/i);
    assert.match(c.ayuda, /Indicador/);
  });
  test('rótulos de umbrales orientados a categorías, sin nombres técnicos viejos', () => {
    const labels = CAMPOS_UMBRAL.filter(c => c.mm).map(c => c.lbl);
    for (const t of labels) {
      assert.doesNotMatch(t, /\b(bajo|crítico|critico|retiro)\b/i, t);
    }
    assert.ok(labels.some(t => /Nuevo desde/.test(t)));
    assert.ok(labels.some(t => /Poco desgaste/.test(t)));
    assert.ok(labels.some(t => /Mayor desgaste/.test(t)));
  });
});

describe('mensajeErrorUmbrales', () => {
  test('check_violation muestra el detalle de la BD', () => {
    const m = mensajeErrorUmbrales({ code: '23514', message: 'new row for relation "clientes" violates check constraint "clientes_umbrales_orden"' });
    assert.match(m, /no son válidos/); assert.match(m, /clientes_umbrales_orden/); assert.doesNotMatch(m, /</);
  });
  test('permisos', () => assert.match(mensajeErrorUmbrales({ code: '42501', message: 'permission denied' }), /permiso/));
  test('otro error conserva el mensaje', () => assert.match(mensajeErrorUmbrales({ message: 'timeout' }), /timeout/));
  test('sin mensaje', () => assert.equal(mensajeErrorUmbrales(null), 'No se pudieron guardar los umbrales'));
});

describe('resumenFlota', () => {
  test('porcentajes sobre neumáticos con datos', () => {
    const r = resumenFlota({ n_ok: 6, n_bajo: 3, n_mayor_desgaste: 1, n_critico: 1, n_sin_datos: 4, n_alertas_sev1: 1, n_alertas_sev2: 2, n_alertas_sev3: 1 });
    assert.deepEqual(r, {
      nuevo: 6, pocoDesgaste: 3, mayorDesgaste: 1, limite: 1, desconocido: 4, alertas: 4, conDatos: 11,
      pctNuevo: 55, pctPocoDesgaste: 27, pctMayorDesgaste: 9, pctLimite: 9
    });
  });
  test('sin fila o sin datos no divide por cero', () => {
    assert.equal(resumenFlota(null).pctNuevo, 0);
    assert.equal(resumenFlota({ n_sin_datos: 2 }).conDatos, 0);
  });
});
