import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soloObservadas, contarObservadas, textoObservaciones, detalleObservaciones, textoAvisoInicio, valoresTexto,
  agruparPorNeumatico, validarMotivo, traducirErrorCalidad, etiquetaCalidad, simboloCalidad, MOTIVO_MAX,
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
