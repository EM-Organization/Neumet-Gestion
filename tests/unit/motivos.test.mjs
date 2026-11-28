import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  motivosDelTipo, validarMotivo, validarOdometroObligatorio, etiquetaMotivo, tipoMotivoCambio, tipoMotivoRetiro, MAX_MOTIVO_TEXTO, TIPO_MOTIVO
} from '../../assets/js/domain/motivos.js';
import { validarDatosRotacion } from '../../assets/js/domain/cambio-neumatico.js';

const CAT = [
  { tipo: 'baja', codigo: 'desgaste', etiqueta: 'Desgaste', orden: 1, activo: true },
  { tipo: 'baja', codigo: 'otro', etiqueta: 'Otro', orden: 9, activo: true },
  { tipo: 'baja', codigo: 'viejo', etiqueta: 'Viejo', orden: 2, activo: false },
  { tipo: 'cambio', codigo: 'otro', etiqueta: 'Otro', orden: 9, activo: true },
  { tipo: 'rotacion', codigo: 'swap_20000', etiqueta: 'Primera rotación', orden: 1, activo: true },
  { tipo: 'rotacion', codigo: 'otro', etiqueta: 'Otro', orden: 9, activo: true },
];

test('TIPO_MOTIVO.corregir es el catálogo de la corrección de mediciones', () => {
  assert.equal(TIPO_MOTIVO.corregir, 'correccion_medicion');
});

test('motivosDelTipo: solo activos del tipo, en orden', () => {
  assert.deepEqual(motivosDelTipo(CAT, 'baja').map(m => m.codigo), ['desgaste', 'otro']);
  assert.deepEqual(motivosDelTipo(CAT, 'desmontaje'), []);
  assert.deepEqual(motivosDelTipo(null, 'baja'), []);
});

test('validarMotivo: código obligatorio del catálogo del tipo (CA-14)', () => {
  assert.match(validarMotivo(CAT, 'baja', '', null).error, /Elegir el motivo/);
  assert.match(validarMotivo(CAT, 'baja', null, null).error, /Elegir el motivo/);
  assert.match(validarMotivo(CAT, 'baja', 'inventado', null).error, /lista/);
  assert.match(validarMotivo(CAT, 'baja', 'viejo', null).error, /lista/, 'inactivo');
  assert.match(validarMotivo(CAT, 'baja', 'swap_20000', null).error, /lista/, 'de otro tipo');
  assert.deepEqual(validarMotivo(CAT, 'baja', 'desgaste', 'ignorado'), { ok: true, codigo: 'desgaste', texto: null });
});

test('validarMotivo: «otro» exige texto de 1 a 300 caracteres', () => {
  assert.match(validarMotivo(CAT, 'baja', 'otro', '   ').error, /Escribir el motivo/);
  assert.match(validarMotivo(CAT, 'baja', 'otro', null).error, /Escribir el motivo/);
  assert.match(validarMotivo(CAT, 'baja', 'otro', 'x'.repeat(MAX_MOTIVO_TEXTO + 1)).error, /hasta 300/);
  assert.deepEqual(validarMotivo(CAT, 'baja', 'otro', ' Corte lateral '), { ok: true, codigo: 'otro', texto: 'Corte lateral' });
  assert.equal(validarMotivo(CAT, 'baja', 'otro', 'x'.repeat(MAX_MOTIVO_TEXTO)).ok, true);
});

test('validarOdometroObligatorio: con el flag exige lectura; sin flag es opcional (RN-12)', () => {
  assert.match(validarOdometroObligatorio('', 1000, true).error, /Indicar la lectura del odómetro/);
  assert.match(validarOdometroObligatorio('   ', null, true).error, /Indicar la lectura del odómetro/);
  assert.deepEqual(validarOdometroObligatorio('', 1000, false), { ok: true, valor: null });
  assert.equal(validarOdometroObligatorio('1200', 1000, true).valor, 1200);
  assert.match(validarOdometroObligatorio('999', 1000, true).error, /no puede ser menor al actual/);
  assert.match(validarOdometroObligatorio('12.5', null, false).error, /entero/);
  assert.match(validarOdometroObligatorio('-1', null, true).error, /entero/);
});

test('etiquetaMotivo: código y texto, sin inventar cuando no hay motivo (historia)', () => {
  assert.equal(etiquetaMotivo(CAT, 'desgaste', null), 'Desgaste');
  assert.equal(etiquetaMotivo(CAT, 'otro', 'Corte lateral'), 'Corte lateral');
  assert.equal(etiquetaMotivo(CAT, 'otro', null), 'Otro');
  assert.equal(etiquetaMotivo(CAT, 'retirado', null), 'retirado', 'código sin etiqueta: se muestra el código');
  assert.equal(etiquetaMotivo(CAT, null, null), '', 'historia sin motivo: nada');
});

test('tipo de motivo: baja usa el catálogo de baja; el resto, cambio o desmontaje', () => {
  assert.equal(tipoMotivoCambio('baja'), TIPO_MOTIVO.baja);
  assert.equal(tipoMotivoCambio('reparacion'), TIPO_MOTIVO.cambio);
  assert.equal(tipoMotivoRetiro('baja'), TIPO_MOTIVO.baja);
  assert.equal(tipoMotivoRetiro('almacenado'), TIPO_MOTIVO.desmontaje);
});

test('validarDatosRotacion: motivo de rotación y odómetro obligatorio (RN-12, RN-14)', () => {
  const base = { catalogo: CAT, motivoCodigo: 'swap_20000', motivoTexto: null, odometro: '', odometroActual: 1000, odometroObligatorio: false };
  assert.deepEqual(validarDatosRotacion(base).params, { p_odometro_km: null, p_motivo_codigo: 'swap_20000', p_motivo_texto: null });
  assert.match(validarDatosRotacion({ ...base, odometroObligatorio: true }).error, /Indicar la lectura/);
  assert.equal(validarDatosRotacion({ ...base, odometroObligatorio: true, odometro: '1000' }).params.p_odometro_km, 1000);
  assert.match(validarDatosRotacion({ ...base, odometro: '900' }).error, /no puede ser menor/);
  assert.match(validarDatosRotacion({ ...base, motivoCodigo: 'desgaste' }).error, /lista/, 'código de baja no sirve para rotar');
  assert.match(validarDatosRotacion({ ...base, motivoCodigo: 'otro' }).error, /Escribir el motivo/);
  assert.deepEqual(validarDatosRotacion({ ...base, motivoCodigo: 'otro', motivoTexto: 'Huellas' }).params.p_motivo_texto, 'Huellas');
});

test('TIPO_MOTIVO: rotación en disco y alineación usan sus catálogos propios', () => {
  assert.equal(TIPO_MOTIVO.rotarDisco, 'rotacion_disco');
  assert.equal(TIPO_MOTIVO.alinear, 'alineacion');
});

