import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarOdometro, planEvento, planRotacion, ordenarEventos, parseEnteroNoNeg, parseMontoNoNeg } from '../../assets/js/domain/ciclo-vida.js';

test('parseEnteroNoNeg y parseMontoNoNeg', () => {
  assert.equal(parseEnteroNoNeg('0'), 0);
  assert.equal(parseEnteroNoNeg(' 120500 '), 120500);
  for (const x of ['', '-1', '1.5', '1e3', 'abc', null, undefined]) assert.equal(parseEnteroNoNeg(x), null);
  assert.equal(parseMontoNoNeg('1234,5'), 1234.5);
  assert.equal(parseMontoNoNeg('0'), 0);
  for (const x of ['-1', '1.234', 'x', '']) assert.equal(parseMontoNoNeg(x), null);
});

test('validarOdometro: entero >= 0', () => {
  assert.equal(validarOdometro(null, '').ok, false);
  assert.equal(validarOdometro(null, '-5').ok, false);
  assert.equal(validarOdometro(null, '12.5').ok, false);
  assert.deepEqual(validarOdometro(null, '0'), { ok: true, valor: 0, baja: false });
  assert.deepEqual(validarOdometro(1000, '1000'), { ok: true, valor: 1000, baja: false });
  assert.equal(validarOdometro(1000, '1500').ok, true);
});

test('validarOdometro: bajar exige confirmación explícita', () => {
  const r = validarOdometro(5000, '4000');
  assert.equal(r.ok, false);
  assert.equal(r.requiereConfirmacion, true);
  assert.match(r.error, /menor al actual/);
  const c = validarOdometro(5000, '4000', true);
  assert.deepEqual(c, { ok: true, valor: 4000, baja: true });
  // un valor inválido no se salva con confirmación
  assert.equal(validarOdometro(5000, '-1', true).ok, false);
});

const N = { id: 7, vehiculo_id: 10, cliente_id: 1, posicion: 3, estado: 'montado', vida: 0, idneumatico: 'T-7' };

test('planEvento: montaje / desmontaje', () => {
  assert.equal(planEvento('montaje', N).ok, false);
  const m = planEvento('montaje', { ...N, estado: 'almacenado' }, { odometro: '1000', costo: '' });
  assert.equal(m.ok, true);
  assert.deepEqual(m.patch, { estado: 'montado' });
  assert.equal(m.evento.odometro_km, 1000);
  assert.equal(m.evento.costo, null);
  assert.equal(m.evento.neumatico_id, 7);
  const d = planEvento('desmontaje', N, { destinoEstado: 'reparacion' });
  assert.deepEqual(d.patch, { estado: 'reparacion' });
  assert.equal(planEvento('desmontaje', N, { destinoEstado: 'baja' }).ok, false);
  assert.equal(planEvento('desmontaje', { ...N, estado: 'almacenado' }).ok, false);
});

test('planEvento: reencauche respeta vida 0..3', () => {
  assert.deepEqual(planEvento('reencauche', N, { costo: '85000' }).patch, { vida: 1 });
  assert.equal(planEvento('reencauche', N, { costo: '85000' }).evento.costo, 85000);
  assert.deepEqual(planEvento('reencauche', { ...N, vida: 2, estado: 'reparacion' }).patch, { vida: 3, estado: 'almacenado' });
  assert.equal(planEvento('reencauche', { ...N, vida: 3 }).ok, false);
});

test('planEvento: baja exige motivo y fija fecha', () => {
  assert.equal(planEvento('baja', N, {}, '2026-11-06').ok, false);
  const b = planEvento('baja', N, { motivo: ' Pinchazo irreparable ' }, '2026-11-06');
  assert.deepEqual(b.patch, { estado: 'baja', fecha_baja: '2026-11-06', motivo_baja: 'Pinchazo irreparable' });
  assert.equal(planEvento('baja', N, { motivo: 'x', fecha: '06/11/2026' }).ok, false);
  assert.equal(planEvento('baja', { ...N, estado: 'baja' }, { motivo: 'x' }, '2026-11-06').ok, false);
});

test('planEvento: rotación, reparación, inspección y validación de odómetro/costo', () => {
  assert.equal(planEvento('rotacion', N, {}).ok, false);
  assert.equal(planEvento('rotacion', N, { posicionDestino: '3' }).ok, false);
  const r = planEvento('rotacion', N, { posicionDestino: '5', odometro: '2000' });
  assert.equal(r.ok, true);
  assert.equal(r.evento.posicion_origen, 3);
  assert.equal(r.evento.posicion_destino, 5);
  assert.deepEqual(planEvento('reparacion', N).patch, {});
  assert.deepEqual(planEvento('inspeccion', N).patch, {});
  assert.equal(planEvento('inspeccion', N, { odometro: '-1' }).ok, false);
  assert.equal(planEvento('inspeccion', N, { costo: '-3' }).ok, false);
  assert.equal(planEvento('xx', N).ok, false);
  assert.equal(planEvento('inspeccion', null).ok, false);
});

test('planRotacion: mover a posición libre o detectar intercambio', () => {
  const a = { id: 1, vehiculo_id: 10, posicion: 1, estado: 'montado' };
  const b = { id: 2, vehiculo_id: 10, posicion: 2, estado: 'montado' };
  const otroVeh = { id: 3, vehiculo_id: 11, posicion: 5, estado: 'montado' };
  assert.deepEqual(planRotacion([a, b, otroVeh], a, 5), { ok: true, intercambio: null });
  const sw = planRotacion([a, b], a, 2);
  assert.equal(sw.intercambio.id, 2);
  assert.equal(sw.ok, true);
  assert.equal(sw.pasos, undefined);
  assert.equal(planRotacion([a, { ...b, estado: 'baja' }], a, 2).ok, false);
});

test('ordenarEventos: por fecha y luego id, y en orden descendente', () => {
  const e = [
    { id: 1, created_at: '2026-01-01T00:00:00Z' }, { id: 2, created_at: '2026-01-02T00:00:00Z' }
  ];
  assert.deepEqual(ordenarEventos(e, true).map(x => x.id), [2, 1]);
});
