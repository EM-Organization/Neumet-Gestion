import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soloObservadas, contarObservadas, textoObservaciones, detalleObservaciones, textoAvisoInicio, valoresTexto,
  agruparPorNeumatico, validarMotivo, traducirErrorCalidad, etiquetaCalidad, simboloCalidad, MOTIVO_MAX,
  esCorregida, esCaidaBrusca, validarCorreccion, sinCambios, traducirErrorCorreccion,
} from '../../assets/js/domain/calidad.js';
import { fmtNum } from '../../assets/js/domain/formato.js';

const r = (id, calidad, extra = {}) => ({ id, calidad, posicion: 1, mm1: 9, mm2: 9, mm3: 9, idneumatico: null, ...extra });

test('soloObservadas / contarObservadas: ignoran válidas, nulos y filas vacías', () => {
  const rows = [r(1, 'valida'), r(2, 'sospechosa'), r(3, 'invalidada'), r(4, 'sospechosa'), null, undefined, r(5, undefined)];
  assert.deepEqual(soloObservadas(rows).map(x => x.id), [2, 3, 4]);
  assert.deepEqual(contarObservadas(rows), { total: 3, sospechosas: 2, invalidadas: 1 });
  assert.deepEqual(contarObservadas([]), { total: 0, sospechosas: 0, invalidadas: 0 });
  assert.deepEqual(contarObservadas(null), { total: 0, sospechosas: 0, invalidadas: 0 });
});

test('textos: singular, plural y detalle sin segunda persona', () => {
  assert.equal(textoObservaciones(1), '1 medición con observaciones');
  assert.equal(textoObservaciones(3), '3 mediciones con observaciones');
  assert.equal(detalleObservaciones([r(1, 'sospechosa'), r(2, 'sospechosa'), r(3, 'invalidada')]), '2 en revisión · 1 invalidada');
  assert.equal(detalleObservaciones([r(1, 'invalidada'), r(2, 'invalidada')]), '2 invalidadas');
  assert.equal(detalleObservaciones([]), '');
  assert.equal(etiquetaCalidad('sospechosa'), 'En revisión');
  assert.equal(etiquetaCalidad('invalidada'), 'Invalidada');
  assert.equal(simboloCalidad('invalidada'), '✕');
});

test('textoAvisoInicio: vacío sin mediciones por revisar; singular y plural', () => {
  for (const n of [0, null, undefined, -2, 'x']) assert.equal(textoAvisoInicio(n), '', String(n));
  assert.equal(textoAvisoInicio(1), '1 medición requiere revisión');
  assert.equal(textoAvisoInicio(2), '2 mediciones requieren revisión');
  assert.equal(textoAvisoInicio(1200), `${fmtNum(1200)} mediciones requieren revisión`);
});

test('valoresTexto: dato no medido se muestra «—», nunca 0', () => {
  assert.equal(valoresTexto({ mm1: 9.5, mm2: 9, mm3: 8.75 }), `${fmtNum(9.5, 1)} · ${fmtNum(9, 1)} · ${fmtNum(8.75, 1)} mm`);
  assert.equal(valoresTexto({ mm1: 9, mm2: null, mm3: undefined }), `${fmtNum(9, 1)} · — · — mm`);
  assert.equal(valoresTexto({ mm1: 0, mm2: 0, mm3: 0 }), `${fmtNum(0, 1)} · ${fmtNum(0, 1)} · ${fmtNum(0, 1)} mm`);
});

test('agruparPorNeumatico: por idneumatico (esté donde esté) o por posición si no lo tiene', () => {
  const filas = [{ posicion: 1, idneumatico: 'A' }, { posicion: 2, idneumatico: 'B' }, { posicion: 3, idneumatico: null }];
  const obs = [
    r(1, 'sospechosa', { idneumatico: 'A', posicion: 2 }),   // A se midió en P2 y hoy está en P1 (rotación)
    r(2, 'invalidada', { idneumatico: 'B', posicion: 2 }),
    r(3, 'sospechosa', { idneumatico: null, posicion: 3 }),  // sin idneumatico: el montado en P3
    r(4, 'sospechosa', { idneumatico: 'Z', posicion: 1 }),   // neumático que ya no está montado
    r(5, 'sospechosa', { idneumatico: null, posicion: 9 }),  // posición sin neumático
    r(6, 'valida', { idneumatico: 'A', posicion: 1 }),       // las válidas no se agrupan
  ];
  const { porPosicion, otras } = agruparPorNeumatico(obs, filas);
  assert.deepEqual(porPosicion.get(1).map(x => x.id), [1]);
  assert.deepEqual(porPosicion.get(2).map(x => x.id), [2]);
  assert.deepEqual(porPosicion.get(3).map(x => x.id), [3]);
  assert.deepEqual(otras.map(x => x.id), [4, 5]);
  assert.equal(agruparPorNeumatico(null, null).porPosicion.size, 0);
});

test('validarMotivo: obligatorio, recortado, de 3 a 300 caracteres', () => {
  assert.deepEqual(validarMotivo('  Medidor descalibrado  '), { ok: true, motivo: 'Medidor descalibrado' });
  for (const t of ['', '  ', null, undefined, 'ab', ' a ']) assert.equal(validarMotivo(t).ok, false, String(t));
  assert.match(validarMotivo('').error, /motivo/);
  assert.equal(validarMotivo('abc').ok, true);
  assert.equal(validarMotivo('x'.repeat(MOTIVO_MAX)).ok, true);
  assert.equal(validarMotivo('x'.repeat(MOTIVO_MAX + 1)).ok, false);
});

test('traducirErrorCalidad: mensajes cortos, sin segunda persona ni detalles de la base', () => {
  assert.equal(traducirErrorCalidad({ code: '42501', message: 'permiso denegado' }), 'Sin permiso para modificar esta medición');
  assert.equal(traducirErrorCalidad({ code: 'P0002' }), 'La medición ya no existe');
  assert.equal(traducirErrorCalidad({ code: '22023' }), 'Indicar el motivo de la invalidación');
  assert.equal(traducirErrorCalidad({ code: 'XX000', message: 'relation "x" does not exist' }), 'No se pudo guardar el cambio. Reintentar');
  assert.equal(traducirErrorCalidad(null), 'No se pudo guardar el cambio. Reintentar');
});

// ---- Corrección de mediciones, «Corregida» y caída brusca ----

const CAT_CORR = [
  { tipo: 'correccion_medicion', codigo: 'error_calibre', etiqueta: 'Error de calibre', orden: 1, activo: true },
  { tipo: 'correccion_medicion', codigo: 'huella_mal_tomada', etiqueta: 'Huella mal tomada', orden: 2, activo: true },
  { tipo: 'correccion_medicion', codigo: 'otro', etiqueta: 'Otro', orden: 9, activo: true },
  { tipo: 'alineacion', codigo: 'desgaste_lateral', etiqueta: 'Desgaste lateral', orden: 1, activo: true },
];
const corr = (o = {}) => ({ medicionId: 7, mm1: '9', mm2: '9,5', mm3: '9.5', motivoCodigo: 'error_calibre', motivoTexto: '', ...o });
const errCorr = (o) => { const r = validarCorreccion(corr(o), CAT_CORR); assert.equal(r.ok, false, JSON.stringify(o)); return r; };

test('validarCorreccion: caso válido con coma y punto; arma los argumentos de la RPC', () => {
  const r = validarCorreccion(corr(), CAT_CORR);
  assert.deepEqual(r, {
    ok: true,
    args: { p_medicion_id: 7, p_mm1: 9, p_mm2: 9.5, p_mm3: 9.5, p_motivo_codigo: 'error_calibre', p_motivo_texto: null },
  });
});

test('validarCorreccion: huellas de 0 a 30, con un decimal como máximo', () => {
  assert.equal(validarCorreccion(corr({ mm1: '30' }), CAT_CORR).ok, true);
  assert.equal(validarCorreccion(corr({ mm1: '0' }), CAT_CORR).ok, true);
  assert.equal(validarCorreccion(corr({ mm1: '30,0' }), CAT_CORR).ok, true);
  assert.equal(validarCorreccion(corr({ mm1: '30,1' }), CAT_CORR).error, 'La huella debe estar entre 0 y 30 mm');
  assert.equal(validarCorreccion(corr({ mm1: '-0,1' }), CAT_CORR).error, 'La huella debe estar entre 0 y 30 mm');
  assert.equal(validarCorreccion(corr({ mm2: '8,25' }), CAT_CORR).error, 'Máximo un decimal');
  assert.equal(validarCorreccion(corr({ mm3: 'abc' }), CAT_CORR).error, 'La huella 3 debe ser un número');
});

test('validarCorreccion: una huella vacía indica su campo', () => {
  const r = errCorr({ mm1: '' });
  assert.equal(r.campo, 'mm1');
  assert.equal(r.error, 'Indicar la huella 1');
  assert.equal(errCorr({ mm3: null }).campo, 'mm3');
});

test('validarCorreccion: el motivo se valida contra el catálogo de correccion_medicion', () => {
  assert.deepEqual(errCorr({ motivoCodigo: '' }), { ok: false, campo: 'motivoCodigo', error: 'Elegir el motivo' });
  assert.equal(errCorr({ motivoCodigo: 'desgaste_lateral' }).error, 'Elegir un motivo de la lista');
  assert.equal(errCorr({ motivoCodigo: 'desgaste_lateral' }).campo, 'motivoCodigo');
});

test('validarCorreccion: «otro» exige texto de hasta 300 caracteres; otro código no lleva texto', () => {
  const sinTexto = errCorr({ motivoCodigo: 'otro', motivoTexto: ' ' });
  assert.equal(sinTexto.error, 'Escribir el motivo');
  assert.equal(sinTexto.campo, 'motivoTexto');
  assert.equal(errCorr({ motivoCodigo: 'otro', motivoTexto: 'x'.repeat(301) }).campo, 'motivoTexto');
  const ok = validarCorreccion(corr({ motivoCodigo: 'otro', motivoTexto: 'Cinta mal puesta' }), CAT_CORR);
  assert.equal(ok.args.p_motivo_texto, 'Cinta mal puesta');
  assert.equal(validarCorreccion(corr({ motivoTexto: 'sobra' }), CAT_CORR).args.p_motivo_texto, null);
});

test('validarCorreccion: sin medición no se llama a la RPC', () => {
  assert.equal(validarCorreccion(corr({ medicionId: null }), CAT_CORR).campo, 'medicionId');
});

test('sinCambios: compara numéricamente con los valores guardados', () => {
  const args = { p_mm1: 9, p_mm2: 9.5, p_mm3: 9 };
  assert.equal(sinCambios({ mm1: 9, mm2: 9.5, mm3: 9 }, args), true);
  assert.equal(sinCambios({ mm1: 9, mm2: 9.5, mm3: 9.1 }, args), false);
  assert.equal(sinCambios({ mm1: '9.0', mm2: '9.5', mm3: '9.0' }, args), true);
  assert.equal(sinCambios({ mm1: null, mm2: 9.5, mm3: 9 }, args), false);
});

test('traducirErrorCorreccion: un mensaje por rama, sin detalles de la base', () => {
  assert.equal(traducirErrorCorreccion({ code: '42501' }), 'Sin permiso para corregir esta medición');
  assert.equal(traducirErrorCorreccion({ code: 'P0002' }), 'La medición ya no existe');
  assert.equal(traducirErrorCorreccion({ code: '22023', message: 'Hay que revalidar la medición antes de corregirla' }), 'Marcar la medición como válida antes de corregirla');
  assert.equal(traducirErrorCorreccion({ code: '22023', message: 'motivo inválido' }), 'Elegir un motivo de la lista');
  assert.equal(traducirErrorCorreccion({ code: '22004' }), 'Revisar los valores de las huellas');
  assert.equal(traducirErrorCorreccion({ code: '23514' }), 'Revisar los valores de las huellas');
  assert.equal(traducirErrorCorreccion({ code: '22023', message: 'mm fuera de rango' }), 'Revisar los valores de las huellas');
  assert.equal(traducirErrorCorreccion({ code: 'XX000' }), 'No se pudo guardar la corrección. Reintentar');
  assert.equal(traducirErrorCorreccion(null), 'No se pudo guardar la corrección. Reintentar');
});

test('etiquetaCalidad: una medición válida corregida es «Corregida»; el resto no cambia', () => {
  assert.equal(etiquetaCalidad('valida', true), 'Corregida');
  assert.equal(etiquetaCalidad('valida'), 'Válida');
  assert.equal(etiquetaCalidad('valida', false), 'Válida');
  assert.equal(etiquetaCalidad('sospechosa'), 'En revisión');
  assert.equal(etiquetaCalidad('sospechosa', true), 'En revisión');
});

test('esCorregida: válida con corregida_at no nula', () => {
  assert.equal(esCorregida({ calidad: 'valida', corregida_at: '2026-11-20T10:00:00Z' }), true);
  assert.equal(esCorregida({ calidad: 'valida', corregida_at: null }), false);
  assert.equal(esCorregida({ calidad: 'valida' }), false);
  assert.equal(esCorregida({ calidad: 'sospechosa', corregida_at: '2026-11-20T10:00:00Z' }), false);
  assert.equal(esCorregida(null), false);
});

test('esCaidaBrusca: reconoce el motivo que escribe la base', () => {
  assert.equal(esCaidaBrusca('Caída brusca de 5,0 mm desde la medición anterior; huella 9,0 mm'), true);
  assert.equal(esCaidaBrusca('Aumento de huella de 2,0 mm desde la medición anterior'), false);
  assert.equal(esCaidaBrusca(null), false);
  assert.equal(esCaidaBrusca(undefined), false);
});
