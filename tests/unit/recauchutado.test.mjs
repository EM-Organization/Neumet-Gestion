// Recauchutado por carcasa (domain/recauchutado.js): estados, acciones, validación y errores de las RPC.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  etiquetaEstado, estaAbierto, accionesDe, cubiertasEnviables, validarEnvio, validarDictamen, validarRechazo,
  validarAceptacion, traducirErrorRecauchutado, ERROR_GENERICO_RECAUCHUTADO,
} from '../../assets/js/domain/recauchutado.js';

const HOY = { hoy: '2026-11-10' };

describe('estados y acciones', () => {
  test('etiquetas y estado abierto', () => {
    assert.equal(etiquetaEstado('apto'), 'Apto');
    assert.equal(etiquetaEstado('xx'), 'xx');
    assert.equal(etiquetaEstado(null), '—');
    assert.deepEqual(['enviado', 'apto', 'recibido', 'rechazado'].map(estaAbierto), [true, true, false, false]);
  });
  test('acciones por estado', () => {
    assert.deepEqual(accionesDe('enviado').map(a => a.id), ['dictamen']);
    assert.deepEqual(accionesDe('apto').map(a => a.id), ['aceptar', 'rechazar']);
    assert.deepEqual(accionesDe('recibido'), []);
    assert.deepEqual(accionesDe('rechazado'), []);
    assert.deepEqual(accionesDe(undefined), []);
  });
  test('cubiertas enviables: sin vida máxima y sin proceso abierto', () => {
    const cub = [{ id: 1, vida: 0 }, { id: 2, vida: 3 }, { id: 3, vida: 1 }, { id: 4 }];
    const proc = [{ neumatico_id: 3, estado: 'apto' }, { neumatico_id: 1, estado: 'rechazado' }];
    assert.deepEqual(cubiertasEnviables(cub, proc).map(c => c.id), [1, 4]);
    assert.deepEqual(cubiertasEnviables(null, null), []);
  });
});

describe('validarEnvio', () => {
  test('camino feliz', () => {
    const r = validarEnvio({ neumaticoId: '5', proveedor: ' Sur ', fecha: '2026-11-01', notas: '' }, HOY);
    assert.deepEqual(r.args, { p_neumatico_id: 5, p_proveedor: 'Sur', p_fecha: '2026-11-01', p_notas: null });
  });
  test('rechazos', () => {
    assert.equal(validarEnvio({ proveedor: 'x' }, HOY).ok, false);
    assert.equal(validarEnvio({ neumaticoId: 1, proveedor: '  ' }, HOY).error, 'Falta el proveedor');
    assert.equal(validarEnvio({ neumaticoId: 1, proveedor: 'x'.repeat(81) }, HOY).ok, false);
    assert.equal(validarEnvio({ neumaticoId: 1, proveedor: 'x', fecha: '2027-01-01' }, HOY).error, 'La fecha no puede ser futura');
    assert.equal(validarEnvio({ neumaticoId: 1, proveedor: 'x', fecha: '31/12/2026' }, HOY).error, 'La fecha no es válida');
    assert.equal(validarEnvio({ neumaticoId: 1, proveedor: 'x', notas: 'n'.repeat(501) }, HOY).ok, false);
  });
});

describe('validarDictamen y validarRechazo', () => {
  test('apto no lleva sucursal; no apto exige motivo', () => {
    assert.deepEqual(validarDictamen({ id: 3, apto: true, sucursalId: '9' }, HOY).args,
      { p_id: 3, p_apto: true, p_motivo: null, p_fecha: null, p_sucursal_id: null });
    assert.equal(validarDictamen({ id: 3, apto: false }, HOY).error, 'Falta el motivo del rechazo');
    assert.equal(validarDictamen({ id: 3, apto: false, motivo: 'Corte', sucursalId: '9' }, HOY).args.p_sucursal_id, 9);
    assert.equal(validarDictamen({ id: 3 }, HOY).error, 'Elegir el dictamen');
    assert.equal(validarDictamen({ apto: true }, HOY).ok, false);
    assert.equal(validarDictamen({ id: 1, apto: false, motivo: 'm'.repeat(301) }, HOY).ok, false);
  });
  test('rechazo al recibir', () => {
    assert.equal(validarRechazo({ id: 1, motivo: '' }, HOY).ok, false);
    assert.deepEqual(validarRechazo({ id: 1, motivo: 'Despegada', sucursalId: '' }, HOY).args,
      { p_id: 1, p_motivo: 'Despegada', p_fecha: null, p_sucursal_id: null });
  });
});

describe('validarAceptacion', () => {
  const base = { id: 4, profundidad: '16,5' };
  test('camino feliz con coma decimal y valores por defecto', () => {
    const r = validarAceptacion({ ...base, bandaMarca: ' Vipal ', costo: '400,50', moneda: 'usd', sucursalId: '2' }, HOY);
    assert.deepEqual(r.args, { p_id: 4, p_profundidad_mm: 16.5, p_banda_marca: 'Vipal', p_banda_modelo: null, p_costo: 400.5,
      p_moneda: 'USD', p_fecha: null, p_sucursal_id: 2, p_notas: null });
    assert.equal(validarAceptacion(base, HOY).args.p_moneda, 'UYU');
    assert.equal(validarAceptacion(base, HOY).args.p_costo, null);
  });
  test('profundidad: obligatoria y entre 0 y 30', () => {
    assert.equal(validarAceptacion({ id: 4 }, HOY).error, 'Falta la profundidad inicial de la banda');
    for (const p of ['0', '-1', '31', 'abc']) assert.equal(validarAceptacion({ id: 4, profundidad: p }, HOY).ok, false, p);
    assert.equal(validarAceptacion({ id: 4, profundidad: '30' }, HOY).ok, true);
  });
  test('costo, moneda, fecha y banda inválidos', () => {
    for (const c of ['-1', '1.234', 'x', '1e3']) assert.equal(validarAceptacion({ ...base, costo: c }, HOY).ok, false, c);
    assert.equal(validarAceptacion({ ...base, costo: '0' }, HOY).args.p_costo, 0);
    assert.equal(validarAceptacion({ ...base, moneda: 'U$D' }, HOY).ok, false);
    assert.equal(validarAceptacion({ ...base, fecha: '2027-01-01' }, HOY).ok, false);
    assert.equal(validarAceptacion({ ...base, bandaModelo: 'm'.repeat(61) }, HOY).ok, false);
    assert.equal(validarAceptacion({ profundidad: 10 }, HOY).ok, false);
  });
});

describe('traducirErrorRecauchutado', () => {
  test('mensajes', () => {
    assert.match(traducirErrorRecauchutado({ code: '42501' }), /Sin permiso/);
    assert.match(traducirErrorRecauchutado({ code: 'P0002' }), /ya no existe/);
    assert.match(traducirErrorRecauchutado({ code: '55000', message: 'la cubierta está montada: retirarla' }), /montada/);
    assert.match(traducirErrorRecauchutado({ code: '55000', message: 'la cubierta ya está en recauchutado' }), /ya está en recauchutado/);
    assert.match(traducirErrorRecauchutado({ code: '55000', message: 'el recauchutado ya tiene dictamen' }), /cambió de estado/);
    assert.match(traducirErrorRecauchutado({ code: '23514', message: 'la carcasa ya alcanzó la vida máxima' }), /vida máxima/);
    assert.match(traducirErrorRecauchutado({ code: '23514', message: 'fecha inválida' }), /fecha/);
    assert.match(traducirErrorRecauchutado({ code: '22023', message: 'x' }), /inválidos/);
    assert.equal(traducirErrorRecauchutado({ message: 'boom' }), ERROR_GENERICO_RECAUCHUTADO);
    assert.equal(traducirErrorRecauchutado(null), ERROR_GENERICO_RECAUCHUTADO);
  });
});
