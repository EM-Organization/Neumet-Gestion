// Administración de empresa (migración 20261119000000, docs/17 §4.1) con la base y PostgREST reales y el JWT de cada rol.
//   * usuarios_empresa_listar: el administrador de empresa (global) ve su empresa con email real; el equipo Neumet, solo con
//     empresa indicada; sucursal, api, sin perfil y anon, nada; la otra empresa no ve la ajena.
//   * Quitar y reponer acceso: borra el perfil (el JWT del quitado deja de ver datos), ningún otro rol lo hace, el rastro
//     (accesos_quitados) no se lee ni se escribe por la API y accesos_quitados_marcar_auth es solo del servicio.
//   * vehiculo_corregir_odometro y alerta_configurar ampliada: solo el administrador de empresa.
// Modifica la base temporalmente y la restaura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, json } from '../lib/verdad.mjs';

const OTRA = `(select id from public.clientes where nombre = 'Otra Empresa SA')`;
const ROLES = ['admin', 'global', 'salto', 'montevideo', 'otra', 'sinperfil', 'api'];

async function pedir(env, rol, ruta, { metodo = 'GET', cuerpo, cabeceras = {} } = {}) {
  const h = { apikey: 'x', ...cabeceras };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${env.rest.base}/${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos, rango: r.headers.get('content-range') };
}
const rpc = (env, rol, fn, args = {}) => pedir(env, rol, `rpc/${fn}`, { metodo: 'POST', cuerpo: args });
const denegado = (r, msg) => assert.ok([401, 403].includes(r.status) && r.datos && r.datos.code === '42501', `${msg}: ${r.status} ${JSON.stringify(r.datos).slice(0, 160)}`);
const visibles = async (env, rol) => Number((await pedir(env, rol, 'neumaticos?select=id&limit=1', { cabeceras: { Prefer: 'count=exact' } })).rango.split('/')[1]);

export function registrar(env) {
  test('Administración de empresa (API): listar usuarios por rol', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    const r = await rpc(env, 'global', 'usuarios_empresa_listar');
    assert.equal(r.status, 200, JSON.stringify(r.datos));
    const esperados = json(env, `select p.user_id from public.perfiles p where p.cliente_id = ${DEMO} and p.rol = 'cliente'`).map(f => f.user_id).sort();
    assert.deepEqual(r.datos.map(f => f.user_id).sort(), esperados);
    assert.ok(esperados.length >= 3, 'la base de prueba tiene administrador y dos usuarios de sucursal');
    for (const f of r.datos) assert.equal(f.estado, 'vigente');
    const yo = r.datos.find(f => f.user_id === env.sesion('global').sub);
    assert.equal(yo.alcance, 'empresa');
    assert.equal(yo.email, env.sesion('global').email, 'email real tomado de auth.users');
    const suc = r.datos.find(f => f.user_id === env.sesion('salto').sub);
    assert.equal(suc.alcance, 'sucursal');
    assert.ok(suc.sucursal_nombre, 'la sucursal viene con su nombre');

    assert.equal((await rpc(env, 'global', 'usuarios_empresa_listar', { p_cliente_id: demo })).status, 200);
    denegado(await rpc(env, 'global', 'usuarios_empresa_listar', { p_cliente_id: Number(env.sql(`select ${OTRA}`)) }), 'global pide otra empresa');
    const otra = await rpc(env, 'otra', 'usuarios_empresa_listar');
    assert.equal(otra.status, 200);
    assert.ok(otra.datos.every(f => !esperados.includes(f.user_id)), 'la otra empresa no ve usuarios de Demo');
    assert.equal((await rpc(env, 'admin', 'usuarios_empresa_listar', { p_cliente_id: demo })).datos.length, esperados.length);
    assert.equal((await rpc(env, 'admin', 'usuarios_empresa_listar')).status, 400, 'el equipo Neumet debe indicar la empresa');
    for (const rol of ['salto', 'montevideo', 'api', 'sinperfil', null]) denegado(await rpc(env, rol, 'usuarios_empresa_listar'), `listar como ${rol}`);
  });

  test('Administración de empresa (API): quitar y reponer acceso con el JWT de cada rol', async () => {
    const quitado = env.sesion('montevideo').sub;
    const antes = json(env, `select sucursal_id from public.perfiles where user_id = '${quitado}'`)[0].sucursal_id;
    const vistos = await visibles(env, 'montevideo');
    assert.ok(vistos > 0, 'la sucursal ve cubiertas antes de la baja');
    try {
      // Roles sin facultad: nadie quita ni repone, y el perfil sigue ahí
      for (const rol of ['admin', 'salto', 'montevideo', 'otra', 'api', 'sinperfil', null]) {
        denegado(await rpc(env, rol, 'usuario_empresa_quitar_acceso', { p_user_id: quitado }), `quitar como ${rol}`);
      }
      assert.equal(Number(env.sql(`select count(*) from public.perfiles where user_id = '${quitado}'`)), 1);
      denegado(await rpc(env, 'global', 'usuario_empresa_quitar_acceso', { p_user_id: env.sesion('otra').sub }), 'quitar a un usuario de otra empresa');
      assert.equal((await rpc(env, 'global', 'usuario_empresa_quitar_acceso', { p_user_id: env.sesion('global').sub })).status, 400, 'no se quita a sí mismo');

      const q = await rpc(env, 'global', 'usuario_empresa_quitar_acceso', { p_user_id: quitado });
      assert.equal(q.status, 200, JSON.stringify(q.datos));
      assert.equal(q.datos.estado, 'quitado');
      assert.equal(Number(env.sql(`select count(*) from public.perfiles where user_id = '${quitado}'`)), 0);
      // El JWT del quitado sigue vigente pero la base ya no le da nada
      assert.equal(await visibles(env, 'montevideo'), 0);
      denegado(await rpc(env, 'montevideo', 'usuarios_empresa_listar'), 'quitado lista');
      const lista = (await rpc(env, 'global', 'usuarios_empresa_listar')).datos;
      const fila = lista.find(f => f.user_id === quitado);
      assert.equal(fila.estado, 'quitado');
      assert.equal(fila.bloqueo_auth_pendiente, true);
      assert.equal((await rpc(env, 'global', 'usuario_empresa_quitar_acceso', { p_user_id: quitado })).datos.estado, 'ya_quitado');
      denegado(await rpc(env, 'otra', 'usuario_empresa_quitar_acceso', { p_user_id: quitado }), 'otra empresa reintenta la baja ajena');

      for (const rol of ['admin', 'salto', 'otra', 'api', 'sinperfil', null]) {
        denegado(await rpc(env, rol, 'usuario_empresa_reponer_acceso', { p_acceso_id: fila.acceso_id }), `reponer como ${rol}`);
      }
      const rep = await rpc(env, 'global', 'usuario_empresa_reponer_acceso', { p_acceso_id: fila.acceso_id });
      assert.equal(rep.status, 200, JSON.stringify(rep.datos));
      assert.equal(rep.datos.estado, 'repuesto');
      assert.equal(json(env, `select sucursal_id from public.perfiles where user_id = '${quitado}'`)[0].sucursal_id, antes);
      assert.equal(await visibles(env, 'montevideo'), vistos, 'recupera lo que veía');
    } finally {
      env.sql(`delete from public.accesos_quitados where user_id = '${quitado}'`);
      env.sql(`insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values ('${quitado}', 'cliente', ${DEMO}, ${antes}) on conflict (user_id) do nothing`);
    }
  });

  test('Administración de empresa (API): el rastro de bajas no se lee ni se escribe y marcar_auth es solo del servicio', async () => {
    for (const rol of [...ROLES, null]) {
      denegado(await pedir(env, rol, 'accesos_quitados?select=*'), `leer accesos_quitados como ${rol}`);
      denegado(await pedir(env, rol, 'accesos_quitados', { metodo: 'POST', cuerpo: { cliente_id: 1, user_id: env.sesion('api').sub, rol: 'cliente', quitado_por: env.sesion('api').sub } }), `escribir como ${rol}`);
      denegado(await rpc(env, rol, 'accesos_quitados_marcar_auth', { p_id: 1, p_marca: 'aplicado' }), `marcar como ${rol}`);
    }
  });

  test('Administración de empresa (API): corregir kilometraje solo el administrador de empresa, con auditoría', async () => {
    const v = json(env, `select id, odometro_km from public.vehiculos where cliente_id = ${DEMO} and odometro_km > 10 order by id limit 1`)[0];
    assert.ok(v, 'hay un vehículo con kilometraje');
    try {
      for (const rol of ['admin', 'salto', 'montevideo', 'otra', 'api', 'sinperfil', null]) {
        denegado(await rpc(env, rol, 'vehiculo_corregir_odometro', { p_vehiculo_id: v.id, p_odometro_km: 5 }), `corregir como ${rol}`);
      }
      assert.equal(Number(env.sql(`select odometro_km from public.vehiculos where id = ${v.id}`)), v.odometro_km, 'los rechazos no cambiaron nada');
      assert.equal((await rpc(env, 'global', 'vehiculo_corregir_odometro', { p_vehiculo_id: v.id, p_odometro_km: v.odometro_km + 1 })).status, 400, 'subir no va por aquí');
      const r = await rpc(env, 'global', 'vehiculo_corregir_odometro', { p_vehiculo_id: v.id, p_odometro_km: v.odometro_km - 1 });
      assert.equal(r.status, 200, JSON.stringify(r.datos));
      assert.deepEqual([r.datos.anterior, r.datos.odometro_km], [v.odometro_km, v.odometro_km - 1]);
      const aud = json(env, `select actor_rol, antes->>'odometro_km' a, despues->>'odometro_km' d from public.audit_log where entidad = 'vehiculos' and entidad_id = '${v.id}' and accion = 'UPDATE' order by id desc limit 1`)[0];
      assert.deepEqual(aud, { actor_rol: 'admin_empresa', a: String(v.odometro_km), d: String(v.odometro_km - 1) });
    } finally {
      env.sql(`update public.vehiculos set odometro_km = ${v.odometro_km} where id = ${v.id}`);
    }
  });

  test('Administración de empresa (API): alerta_configurar con todos los umbrales y la huella absurda', async () => {
    const previo = json(env, `select umbral_bajo_mm, umbral_critico_mm, umbral_retiro_mm, dias_sin_medir_alerta, irregularidad_mm, alerta_histeresis_mm, huella_absurda_mm from public.clientes where id = ${DEMO}`)[0];
    try {
      for (const rol of ['salto', 'api', 'sinperfil', null]) {
        denegado(await rpc(env, rol, 'alerta_configurar', { p_cliente_id: null, p_huella_absurda_mm: 20 }), `configurar como ${rol}`);
      }
      const r = await rpc(env, 'global', 'alerta_configurar', { p_cliente_id: null, p_umbral_bajo_mm: 9, p_umbral_critico_mm: 5, p_umbral_retiro_mm: 3, p_dias_sin_medir: 21, p_irregularidad_mm: 1.5, p_histeresis_mm: 0.4, p_huella_absurda_mm: 25 });
      assert.equal(r.status, 200, JSON.stringify(r.datos));
      assert.deepEqual([r.datos.umbral_bajo_mm, r.datos.umbral_critico_mm, r.datos.umbral_retiro_mm, r.datos.dias_sin_medir_alerta, r.datos.irregularidad_mm, r.datos.huella_absurda_mm], [9, 5, 3, 21, 1.5, 25]);
      const fila = json(env, `select huella_absurda_mm, dias_sin_medir_alerta from public.clientes where id = ${DEMO}`)[0];
      assert.deepEqual([Number(fila.huella_absurda_mm), fila.dias_sin_medir_alerta], [25, 21]);
      assert.equal((await rpc(env, 'global', 'alerta_configurar', { p_cliente_id: null, p_huella_absurda_mm: 41 })).status, 400);
      assert.equal((await rpc(env, 'global', 'alerta_configurar', { p_cliente_id: null, p_umbral_retiro_mm: 6 })).status, 400, 'retiro sobre el crítico');
      denegado(await rpc(env, 'global', 'alerta_configurar', { p_cliente_id: Number(env.sql(`select ${OTRA}`)), p_umbral_critico_mm: 5 }), 'otra empresa por parámetro');
      // La rama del equipo Neumet sigue hasta la migración C2
      assert.equal((await rpc(env, 'admin', 'alerta_configurar', { p_cliente_id: Number(env.sql(`select ${DEMO}`)), p_huella_absurda_mm: 25 })).status, 200);
    } finally {
      env.sql(`update public.clientes set umbral_bajo_mm = ${previo.umbral_bajo_mm}, umbral_critico_mm = ${previo.umbral_critico_mm}, umbral_retiro_mm = ${previo.umbral_retiro_mm}, dias_sin_medir_alerta = ${previo.dias_sin_medir_alerta}, irregularidad_mm = ${previo.irregularidad_mm}, alerta_histeresis_mm = ${previo.alerta_histeresis_mm}, huella_absurda_mm = ${previo.huella_absurda_mm} where id = ${DEMO}`);
    }
  });
}
