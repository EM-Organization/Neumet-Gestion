// Tests de domain/umbrales.js (puro). Ejecutar: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_UMBRAL, camposBasicos, camposAvanzados, validarUmbrales, validarHisteresis, resumenFlota, aNumero } from '../../assets/js/domain/umbrales.js';

const OK = { umbral_bajo_mm: '8', umbral_critico_mm: '5', alerta_histeresis_mm: '0,5', umbral_retiro_mm: '3', dias_sin_medir_alerta: '30', irregularidad_mm: '2', direccion_aviso_mm: '8', direccion_limite_mm: '6', caida_brusca_mm: '5', swap_km: '20000' };

describe('aNumero', () => {
  test('coma o punto', () => { assert.equal(aNumero('7,5'), 7.5); assert.equal(aNumero(' 7.5 '), 7.5); });
  test('vacío o texto => NaN', () => { assert.ok(Number.isNaN(aNumero(''))); assert.ok(Number.isNaN(aNumero('x'))); assert.ok(Number.isNaN(aNumero(null))); });
});

describe('validarUmbrales', () => {
  test('valores por defecto válidos', () => {
    const v = validarUmbrales(OK);
    assert.equal(v.ok, true);
    assert.deepEqual(v.valores, { umbral_bajo_mm: 8, umbral_critico_mm: 5, alerta_histeresis_mm: 0.5, umbral_retiro_mm: 3, dias_sin_medir_alerta: 30, irregularidad_mm: 2, direccion_aviso_mm: 8, direccion_limite_mm: 6, caida_brusca_mm: 5, swap_km: 20000 });
  });
  test('acepta coma decimal', () => assert.equal(validarUmbrales({ ...OK, umbral_bajo_mm: '8,5' }).valores.umbral_bajo_mm, 8.5));
  test('exige descenso estricto: mayor desgaste < poco desgaste < nuevo', () => {
    for (const o of [{ umbral_critico_mm: '8' }, { umbral_retiro_mm: '5' }, { umbral_bajo_mm: '4' }, { umbral_retiro_mm: '6' }]) {
      const v = validarUmbrales({ ...OK, ...o });
      assert.equal(v.ok, false, JSON.stringify(o));
      assert.match(v.error, /mayor desgaste, poco desgaste, buen estado/);
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
  test('los mensajes de rango escriben 99,9 con coma, no 99.9', () => {
    for (const raw of [{ direccion_aviso_mm: '100' }, { umbral_bajo_mm: '100' }]) {
      const e = validarUmbrales({ ...OK, ...raw }).error;
      assert.match(e, /99,9/);
      assert.doesNotMatch(e, /99\.9/);
    }
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
  test('el error nombra el margen con la etiqueta nueva (la regex de smoke y e2e la sigue)', () => {
    const v = validarUmbrales({ ...OK, alerta_histeresis_mm: '4' });
    assert.equal(v.ok, false); assert.equal(v.campo, 'alerta_histeresis_mm');
    assert.ok(v.error.startsWith('Margen para cerrar la alerta (mm)'), v.error);
    assert.equal(validarHisteresis('4').error, 'Margen para cerrar la alerta (mm): va de 0 a 3 mm, con un decimal');
  });
  test('validarUmbrales la incluye: 0 vale; fuera de rango o vacía se rechaza con el campo', () => {
    assert.equal(validarUmbrales({ ...OK, alerta_histeresis_mm: '0' }).valores.alerta_histeresis_mm, 0);
    for (const h of ['3,1', '-0,5', '', 'x']) {
      const v = validarUmbrales({ ...OK, alerta_histeresis_mm: h });
      assert.equal(v.ok, false, h); assert.equal(v.campo, 'alerta_histeresis_mm');
    }
  });
});

describe('caída brusca (caida_brusca_mm, RN-09)', () => {
  test('mayor que 0 y hasta 30, con un decimal (coma o punto)', () => {
    assert.equal(validarUmbrales({ ...OK, caida_brusca_mm: '5' }).ok, true);
    assert.equal(validarUmbrales({ ...OK, caida_brusca_mm: '30' }).ok, true);
    assert.equal(validarUmbrales({ ...OK, caida_brusca_mm: '4,5' }).valores.caida_brusca_mm, 4.5);
  });
  test('0, 30,1, 4,25 y vacío se rechazan con el nombre del campo', () => {
    for (const raw of ['0', '30,1', '4,25', '']) {
      const v = validarUmbrales({ ...OK, caida_brusca_mm: raw });
      assert.equal(v.ok, false, raw); assert.equal(v.campo, 'caida_brusca_mm', raw);
    }
    assert.match(validarUmbrales({ ...OK, caida_brusca_mm: '30,1' }).error, /Caída brusca desde \(mm\): debe ser mayor que 0 y hasta 30/);
    assert.match(validarUmbrales({ ...OK, caida_brusca_mm: '4,25' }).error, /máximo un decimal/);
  });
  test('rótulo y ayuda de docs/14', () => {
    const c = CAMPOS_UMBRAL.find(x => x.key === 'caida_brusca_mm');
    assert.equal(c.lbl, 'Caída brusca desde (mm)');
    assert.equal(c.ayuda, 'Baja de la huella mínima entre dos mediciones que deja la nueva como sospechosa');
  });
});

describe('pasar atrás y swap (direccion_aviso_mm, direccion_limite_mm, swap_km)', () => {
  test('valores válidos y en el objeto de valores', () => {
    const v = validarUmbrales(OK);
    assert.equal(v.valores.direccion_aviso_mm, 8);
    assert.equal(v.valores.direccion_limite_mm, 6);
    assert.equal(v.valores.swap_km, 20000);
  });
  test('pasar atrás ya bajo debe ser menor que pasar atrás desde', () => {
    const igual = validarUmbrales({ ...OK, direccion_aviso_mm: '6', direccion_limite_mm: '6' });
    assert.equal(igual.ok, false); assert.equal(igual.campo, 'direccion_limite_mm');
    assert.match(igual.error, /debe ser menor que Pasar atrás desde/);
    assert.equal(validarUmbrales({ ...OK, direccion_aviso_mm: '5', direccion_limite_mm: '6' }).ok, false);
  });
  test('pasar atrás es mayor que 0 y hasta 99,9 con un decimal, como el check de la base', () => {
    const cero = validarUmbrales({ ...OK, direccion_limite_mm: '0' });
    assert.equal(cero.ok, false); assert.equal(cero.campo, 'direccion_limite_mm'); assert.match(cero.error, /mayor que 0/);
    assert.equal(validarUmbrales({ ...OK, direccion_limite_mm: '0,1' }).ok, true);
    const aviso0 = validarUmbrales({ ...OK, direccion_aviso_mm: '0' });
    assert.equal(aviso0.ok, false); assert.equal(aviso0.campo, 'direccion_aviso_mm');
    assert.equal(validarUmbrales({ ...OK, direccion_aviso_mm: '99,9' }).ok, true);
    assert.equal(validarUmbrales({ ...OK, direccion_aviso_mm: '100' }).ok, false);
    assert.equal(validarUmbrales({ ...OK, direccion_aviso_mm: '-1' }).ok, false);
    const dec = validarUmbrales({ ...OK, direccion_aviso_mm: '8,25' });
    assert.equal(dec.ok, false); assert.equal(dec.campo, 'direccion_aviso_mm'); assert.match(dec.error, /máximo un decimal/);
  });
  test('swap_km es entero entre 1000 y 200000', () => {
    for (const s of ['999', '200001', '20000,5']) {
      const v = validarUmbrales({ ...OK, swap_km: s });
      assert.equal(v.ok, false, s); assert.equal(v.campo, 'swap_km');
    }
    assert.match(validarUmbrales({ ...OK, swap_km: '999' }).error, /entero entre 1000 y 200000/);
    assert.ok(validarUmbrales({ ...OK, swap_km: '999' }).error.startsWith('Primera rotación a los (km): entero entre 1000 y 200000'));
    assert.equal(validarUmbrales({ ...OK, swap_km: '1000' }).ok, true);
    assert.equal(validarUmbrales({ ...OK, swap_km: '200000' }).ok, true);
    assert.equal(validarUmbrales({ ...OK, swap_km: '' }).campo, 'swap_km');
  });
  test('rótulos y ayudas de los tres campos; km_por_mm_revision no se muestra', () => {
    const c = key => CAMPOS_UMBRAL.find(x => x.key === key);
    assert.equal(c('direccion_aviso_mm').lbl, 'Pasar atrás desde (mm)');
    assert.equal(c('direccion_aviso_mm').ayuda, 'Cubiertas de dirección con esta huella mínima o menos');
    assert.equal(c('direccion_limite_mm').lbl, 'Pasar atrás ya bajo (mm)');
    assert.equal(c('direccion_limite_mm').ayuda, 'Cubiertas de dirección por debajo de esta huella mínima: pasarlas atrás ya');
    assert.equal(c('swap_km').lbl, 'Primera rotación a los (km)');
    assert.equal(c('swap_km').ayuda, 'Kilómetros desde el montaje de una cubierta nueva');
    assert.equal(CAMPOS_UMBRAL.some(x => x.key === 'km_por_mm_revision'), false);
  });
});

describe('textos y orden de los campos (docs/14)', () => {
  test('de mayor a menor: bajo, crítico, retiro; luego los demás ajustes', () => {
    assert.deepEqual(CAMPOS_UMBRAL.map(c => c.key).slice(0, 3), ['umbral_bajo_mm', 'umbral_critico_mm', 'umbral_retiro_mm']);
  });
  test('sin colores entre paréntesis, sin comillas rectas, sin «<» en lo que ve el operario', () => {
    const textos = CAMPOS_UMBRAL.flatMap(c => [c.lbl, c.ayuda])
      .concat([validarUmbrales({ ...OK, umbral_critico_mm: '9' }).error, validarHisteresis('9').error,
        validarUmbrales({ ...OK, direccion_limite_mm: '9' }).error, validarUmbrales({ ...OK, swap_km: '999' }).error]);
    for (const t of textos) {
      assert.doesNotMatch(t, /\((naranja|rojo|amarillo|verde)\)/i, t);
      assert.doesNotMatch(t, /"/, t);
      assert.doesNotMatch(t, /[<>]/, t);
    }
    assert.equal(CAMPOS_UMBRAL.find(c => c.key === 'alerta_histeresis_mm').lbl, 'Margen para cerrar la alerta (mm)');
  });
  test('la ayuda del margen dice lo que hace la base: huella mínima que llega (>=) al umbral de «Mayor desgaste desde» más el margen', () => {
    const ayuda = CAMPOS_UMBRAL.find(c => c.key === 'alerta_histeresis_mm').ayuda;
    assert.match(ayuda, /huella mínima llega a «Mayor desgaste desde» más este margen/, ayuda);
    assert.doesNotMatch(ayuda, /supera|promedio/i, ayuda);
  });
  test('ni etiqueta ni ayuda usan la jerga técnica (histéresis, swap)', () => {
    for (const c of CAMPOS_UMBRAL) {
      assert.doesNotMatch(c.lbl, /hist[eé]resis|swap/i, c.lbl);
      assert.doesNotMatch(c.ayuda, /hist[eé]resis|swap/i, c.ayuda);
    }
  });
  test('días sin medir es indicador, no alerta', () => {
    const c = CAMPOS_UMBRAL.find(c => c.key === 'dias_sin_medir_alerta');
    assert.doesNotMatch(c.lbl, /alerta/i);
    assert.doesNotMatch(c.ayuda, /alerta/i);
    assert.match(c.ayuda, /Indicador/);
  });
  test('rótulos de umbrales orientados a categorías, sin nombres técnicos viejos', () => {
    // Solo los umbrales en mm: los de dirección y swap no entran (su rótulo «Pasar atrás ya bajo» contiene «bajo»; se prueba aparte).
    const labels = CAMPOS_UMBRAL.filter(c => c.mm).map(c => c.lbl);
    for (const t of labels) {
      assert.doesNotMatch(t, /\b(bajo|crítico|critico|retiro)\b/i, t);
    }
    assert.ok(labels.some(t => /Buen estado desde/.test(t)));
    assert.ok(labels.some(t => /Poco desgaste/.test(t)));
    assert.ok(labels.some(t => /Mayor desgaste/.test(t)));
  });
});

describe('a la vista y ajustes avanzados (T5)', () => {
  test('a la vista solo los tres umbrales de desgaste, en orden de mayor a menor', () => {
    assert.deepEqual(camposBasicos().map(c => c.key), ['umbral_bajo_mm', 'umbral_critico_mm', 'umbral_retiro_mm']);
  });
  test('los demás campos van en avanzados, y el conjunto suma todos los campos', () => {
    assert.equal(camposAvanzados().length, 7);
    assert.deepEqual(camposAvanzados().map(c => c.key), ['alerta_histeresis_mm', 'dias_sin_medir_alerta', 'irregularidad_mm', 'direccion_aviso_mm', 'direccion_limite_mm', 'caida_brusca_mm', 'swap_km']);
    assert.equal(camposBasicos().length + camposAvanzados().length, CAMPOS_UMBRAL.length);
  });
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
