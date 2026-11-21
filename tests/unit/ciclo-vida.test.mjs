import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarOdometro, rutaOdometro, AVISO_ODOMETRO_SUCURSAL, ordenarEventos, parseEnteroNoNeg, parseMontoNoNeg } from '../../assets/js/domain/ciclo-vida.js';

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

test('ordenarEventos: por fecha y luego id, y en orden descendente', () => {
  const e = [
    { id: 1, created_at: '2026-01-01T00:00:00Z' }, { id: 2, created_at: '2026-01-02T00:00:00Z' }
  ];
  assert.deepEqual(ordenarEventos(e, true).map(x => x.id), [2, 1]);
});

test('rutaOdometro: quién puede bajar el kilometraje (docs/17 §4.1)', () => {
  // Administrador de empresa: confirma y usa la RPC de corrección (antes: solo veía el aviso).
  assert.deepEqual(rutaOdometro({ cliente: true, adminEmpresa: true, baja: true }), { accion: 'corregir', rpc: 'vehiculo_corregir_odometro' });
  // Usuario de sucursal: no baja, ve el aviso y no se llama a ninguna RPC.
  assert.deepEqual(rutaOdometro({ cliente: true, adminEmpresa: false, baja: true }), { accion: 'avisar', rpc: null });
  // Sin baja el cliente sigue con la RPC que rechaza bajar; el equipo Neumet ya no escribe: nunca hay ruta directa ni RPC (docs/17 PR 9).
  assert.equal(rutaOdometro({ cliente: true, adminEmpresa: true, baja: false }).rpc, 'vehiculo_registrar_odometro');
  assert.equal(rutaOdometro({ cliente: true, adminEmpresa: false, baja: false }).rpc, 'vehiculo_registrar_odometro');
  assert.deepEqual(rutaOdometro({ cliente: false, baja: true }), { accion: 'solo_lectura', rpc: null });
  assert.deepEqual(rutaOdometro({ cliente: false, baja: false }), { accion: 'solo_lectura', rpc: null });
  assert.match(AVISO_ODOMETRO_SUCURSAL(1200), /1200 km.*administrador de empresa/);
});
