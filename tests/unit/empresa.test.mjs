import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoAlcance, ordenarUsuarios, accionesFila, cuerpoQuitar, cuerpoReponer, resultadoAcceso, mensajeCrearUsuarioEmpresa,
  argsAlertaConfigurar, mensajeErrorConfigurar
} from '../../assets/js/domain/empresa.js';

const vig = (email, alcance = 'empresa') => ({ user_id: email, email, alcance, estado: 'vigente', acceso_id: null });
const qui = (email) => ({ user_id: email, email, alcance: 'empresa', estado: 'quitado', acceso_id: 9 });

test('textoAlcance: toda la empresa o el nombre de la sucursal', () => {
  assert.equal(textoAlcance({ alcance: 'empresa' }), 'Toda la empresa');
  assert.equal(textoAlcance({ alcance: 'sucursal', sucursal_nombre: 'Norte' }), 'Norte');
  assert.equal(textoAlcance({ alcance: 'sucursal', sucursal_nombre: null }), 'Sucursal');
});

test('ordenarUsuarios: vigentes primero, empresa antes que sucursal, luego email', () => {
  const l = [qui('a@x'), vig('z@x', 'sucursal'), vig('m@x'), vig('b@x')];
  assert.deepEqual(ordenarUsuarios(l).map(u => u.email), ['b@x', 'm@x', 'z@x', 'a@x']);
  assert.deepEqual(ordenarUsuarios(null), []);
});

test('accionesFila: Quitar en toda fila quitada; el propio usuario no se quita', () => {
  assert.deepEqual(accionesFila(vig('a')), { reponer: false, quitar: true });
  assert.deepEqual(accionesFila(vig('a'), { propio: true }), { reponer: false, quitar: false });
  assert.deepEqual(accionesFila(qui('a')), { reponer: true, quitar: true });
  assert.deepEqual(accionesFila({ ...qui('a'), bloqueo_auth_pendiente: false }), { reponer: true, quitar: true });
});

test('cuerpos de quitar y reponer', () => {
  assert.deepEqual(cuerpoQuitar('u1'), { user_id: 'u1' });
  assert.deepEqual(cuerpoQuitar('u1', 9), { user_id: 'u1', acceso_id: 9 });
  assert.deepEqual(cuerpoReponer(9), { acceso_id: 9 });
  assert.deepEqual(cuerpoReponer('9', '3'), { acceso_id: 9, sucursal_id: 3 });
});

test('resultadoAcceso 200: hecho, ya hecho y carreras', () => {
  assert.equal(resultadoAcceso('quitar', 200, { ok: true, estado: 'quitado' }).ok, true);
  assert.equal(resultadoAcceso('quitar', 200, { ok: true, estado: 'ya_quitado' }).ok, true);
  const rep = resultadoAcceso('quitar', 200, { ok: true, estado: 'repuesto_durante_baja' });
  assert.equal(rep.ok, false); assert.match(rep.mensaje, /repuso/);
  assert.equal(resultadoAcceso('reponer', 200, { ok: true, estado: 'repuesto' }).ok, true);
  const q = resultadoAcceso('reponer', 200, { ok: true, estado: 'quitado_durante_reposicion' });
  assert.equal(q.ok, false); assert.match(q.mensaje, /quitó/);
});

test('resultadoAcceso 502: bloqueo_auth_pendiente al quitar ofrece Quitar con el acceso_id', () => {
  const r = resultadoAcceso('quitar', 502, { codigo: 'bloqueo_auth_pendiente', acceso_cortado: true, acceso_id: 9, error: 'Falta Auth' });
  assert.equal(r.ok, false);
  assert.equal(r.ofrecer, 'quitar'); assert.equal(r.accesoId, 9); assert.equal(r.mensaje, 'Falta Auth'); assert.equal(r.recargar, true);
});

test('resultadoAcceso 502: desbloqueo_auth_pendiente ofrece Reponer, nunca Quitar', () => {
  for (const op of ['quitar', 'reponer']) {
    const r = resultadoAcceso(op, 502, { codigo: 'desbloqueo_auth_pendiente', acceso_repuesto: true, acceso_cortado: false, acceso_id: 4, error: 'Auth' });
    assert.equal(r.ofrecer, 'reponer'); assert.equal(r.accesoId, 4);
  }
});

test('resultadoAcceso 502: bloqueo pendiente al reponer (otra persona quitó) no ofrece Reponer', () => {
  const r = resultadoAcceso('reponer', 502, { codigo: 'bloqueo_auth_pendiente', acceso_cortado: true, acceso_repuesto: false, error: 'x' });
  assert.equal(r.ofrecer, 'actualizar'); assert.equal(r.accesoId, null);
});

test('resultadoAcceso 502: estado_no_confirmado no afirma ningún estado', () => {
  const r = resultadoAcceso('quitar', 502, { codigo: 'estado_no_confirmado', acceso_id: 9, error: 'No se pudo leer' });
  assert.equal(r.ofrecer, 'actualizar'); assert.equal(r.accesoId, null); assert.match(r.mensaje, /^No se pudo leer/);
  assert.equal(resultadoAcceso('reponer', 502, null).ofrecer, 'actualizar');
});

test('resultadoAcceso suprime la acción que el contrato prohíbe según el pendiente', () => {
  assert.equal(resultadoAcceso('reponer', 502, { codigo: 'bloqueo_auth_pendiente', error: 'x' }).suprimir, 'reponer');
  assert.equal(resultadoAcceso('quitar', 502, { codigo: 'desbloqueo_auth_pendiente', acceso_id: 4, error: 'x' }).suprimir, 'quitar');
  assert.equal(resultadoAcceso('reponer', 502, { codigo: 'desbloqueo_auth_pendiente', acceso_id: 4, error: 'x' }).suprimir, 'quitar');
  // Sin estado afirmado (estado_no_confirmado, recargar_lista): la lista recargada decide, no se suprime nada.
  assert.equal(resultadoAcceso('quitar', 502, { codigo: 'estado_no_confirmado' }).suprimir, null);
  assert.equal(resultadoAcceso('quitar', 403, { codigo: 'recargar_lista' }).suprimir, null);
});

test('accionesFila con pendiente: quita de la fila lo que el contrato prohíbe', () => {
  const quitado = { estado: 'quitado' }, vigente = { estado: 'vigente' };
  assert.deepEqual(accionesFila(quitado, { suprimir: 'reponer' }), { reponer: false, quitar: true });
  assert.deepEqual(accionesFila(vigente, { suprimir: 'quitar' }), { reponer: false, quitar: false });
  assert.deepEqual(accionesFila(quitado, {}), { reponer: true, quitar: true });
});

test('resultadoAcceso 0 y 500 recargan la lista (la RPC pudo haber cambiado el estado); un 400 genérico no', () => {
  assert.equal(resultadoAcceso('quitar', 0, null).recargar, true);
  assert.equal(resultadoAcceso('reponer', 500, { error: 'Error interno' }).recargar, true);
  assert.equal(resultadoAcceso('quitar', 400, { error: 'Parámetros obligatorios' }).recargar, false);
});

test('resultadoAcceso 4xx: recargar_lista, no_converge, elegir_sucursal, último admin, propio, sin sesión', () => {
  assert.equal(resultadoAcceso('quitar', 403, { codigo: 'recargar_lista' }).ofrecer, 'actualizar');
  assert.equal(resultadoAcceso('quitar', 409, { codigo: 'no_converge' }).ofrecer, 'actualizar');
  const s = resultadoAcceso('reponer', 400, { codigo: 'elegir_sucursal' });
  assert.equal(s.ofrecer, 'sucursal'); assert.equal(s.recargar, false);
  assert.match(resultadoAcceso('quitar', 409, { codigo: 'ultimo_admin' }).mensaje, /último administrador/);
  assert.match(resultadoAcceso('quitar', 400, { codigo: 'acceso_propio' }).mensaje, /propio/);
  assert.match(resultadoAcceso('quitar', 401, {}).mensaje, /sesión/);
  assert.equal(resultadoAcceso('quitar', 0, null).ok, false);
});

test('mensajeCrearUsuarioEmpresa: 409 acceso_quitado remite a Reponer acceso', () => {
  assert.match(mensajeCrearUsuarioEmpresa(409, { codigo: 'acceso_quitado' }), /Reponer acceso/);
  assert.match(mensajeCrearUsuarioEmpresa(429, {}), /Demasiados/);
  assert.ok(mensajeCrearUsuarioEmpresa(500, { error: 'x' }).length > 0);
});

test('argsAlertaConfigurar: mapea los cinco umbrales a los parámetros de la RPC', () => {
  const a = argsAlertaConfigurar('7', { umbral_bajo_mm: 4, umbral_critico_mm: 3, umbral_retiro_mm: 1.6, dias_sin_medir_alerta: 30, irregularidad_mm: 2 });
  assert.deepEqual(a, { p_cliente_id: 7, p_umbral_bajo_mm: 4, p_umbral_critico_mm: 3, p_umbral_retiro_mm: 1.6, p_dias_sin_medir: 30, p_irregularidad_mm: 2 });
});

test('mensajeErrorConfigurar', () => {
  assert.match(mensajeErrorConfigurar({ code: '42501' }), /Sin permiso/);
  assert.match(mensajeErrorConfigurar({ code: '23514', message: 'retiro' }), /no son válidos/);
  assert.match(mensajeErrorConfigurar({ message: 'boom' }), /boom/);
  assert.ok(mensajeErrorConfigurar(null));
});

// Defensa en profundidad: el filtro de rol de los loaders de empresa vive en registerView (nav.js) y las vistas registran
// como acción el loader FILTRADO que devuelve. Si alguien lo quita o vuelve a asignar el loader crudo, esta prueba falla.
test('los loaders de empresa pasan por el filtro soloEmpresa de registerView', async () => {
  const { readFileSync } = await import('node:fs');
  const nav = readFileSync(new URL('../../assets/js/core/nav.js', import.meta.url), 'utf8');
  assert.match(nav, /soloEmpresa\s*\?\s*esAdminEmpresa/);
  assert.match(nav, /return LOADERS\[name\]/);
  for (const [vista, n] of [['usuarios', 'Usuarios'], ['umbrales', 'Umbrales'], ['dispositivos', 'Dispositivos']]) {
    const src = readFileSync(new URL(`../../assets/js/views/empresa-${vista}.js`, import.meta.url), 'utf8');
    assert.ok(src.includes(`ACTIONS.loadEmpresa${n} = registerView('empresa-${vista}'`), `empresa-${vista}: la acción debe ser el loader filtrado`);
    assert.ok(!new RegExp(`ACTIONS\\.loadEmpresa${n} = loadEmpresa${n}`).test(src), `empresa-${vista}: acción sin filtro`);
  }
});
