// Migración C2 (20261120500000, docs/17 §4.1): el equipo Neumet (admin) deja de escribir datos de clientes,
// con la base y PostgREST reales y el JWT de cada rol.
//   * precio_mensual no se lee ni se escribe por la tabla (solo por las RPC de C1, que usa el equipo Neumet).
//   * El admin recibe 42501 en las escrituras directas y en las RPC recortadas; conserva clientes.nombre y las lecturas.
//   * El cliente global conserva sus RPC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../lib/verdad.mjs';

async function pedir(env, rol, ruta, { metodo = 'GET', cuerpo, extra = {} } = {}) {
  const h = { apikey: 'x', Prefer: 'return=representation', ...extra };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${env.rest.base}/${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
}
const rpc = (env, rol, fn, args = {}) => pedir(env, rol, `rpc/${fn}`, { metodo: 'POST', cuerpo: args });
const denegado = (r, msg) => assert.ok([401, 403].includes(r.status) && r.datos && r.datos.code === '42501', `${msg}: ${r.status} ${JSON.stringify(r.datos).slice(0, 160)}`);

export function registrar(env) {
  test('C2 (API): precio_mensual cerrado en la tabla y el admin sin escrituras directas', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    // La columna no se puede seleccionar con ningún rol de la API, ni nombrándola ni con select=*
    for (const rol of ['admin', 'global', 'salto', 'montevideo', 'otra', 'api']) {
      denegado(await pedir(env, rol, 'clientes?select=precio_mensual'), `${rol}: select precio_mensual`);
      denegado(await pedir(env, rol, 'clientes?select=*'), `${rol}: select=* incluye precio_mensual`);
      denegado(await pedir(env, rol, `clientes?id=eq.${demo}`, { metodo: 'PATCH', cuerpo: { precio_mensual: 1 } }), `${rol}: escribir precio_mensual`);
    }
    // El resto de columnas sí se lee (la sesión del panel depende de esto)
    const l = await pedir(env, 'global', 'clientes?select=id,nombre');
    assert.equal(l.status, 200, JSON.stringify(l.datos));
    assert.ok(l.datos.some((c) => c.id === demo));
    assert.equal((await pedir(env, 'admin', 'clientes?select=id,nombre')).status, 200);

    // Escrituras directas del admin: 42501 en cada tabla cerrada
    denegado(await pedir(env, 'admin', 'vehiculos', { metodo: 'POST', cuerpo: { cliente_id: demo, nombre: 'C2', patente: 'C2C2C2', numero: 'C2', tipo_ruedas: 4 } }), 'admin: insertar vehículo');
    denegado(await pedir(env, 'admin', `vehiculos?cliente_id=eq.${demo}`, { metodo: 'PATCH', cuerpo: { nombre: 'x' } }), 'admin: actualizar vehículos');
    denegado(await pedir(env, 'admin', `neumaticos?idneumatico=eq.T-1-1`, { metodo: 'PATCH', cuerpo: { posicion: 9 } }), 'admin: actualizar neumáticos');
    denegado(await pedir(env, 'admin', `sucursales?cliente_id=eq.${demo}`, { metodo: 'DELETE' }), 'admin: borrar sucursales');
    denegado(await pedir(env, 'admin', 'perfiles?rol=eq.api', { metodo: 'PATCH', cuerpo: { rol: 'admin' } }), 'admin: tocar perfiles');
    denegado(await pedir(env, 'admin', 'eventos_neumatico', { metodo: 'DELETE' }), 'admin: borrar eventos');
    denegado(await pedir(env, 'admin', 'stock_neumaticos', { metodo: 'DELETE' }), 'admin: borrar stock');
    denegado(await pedir(env, 'admin', `clientes?id=eq.${demo}`, { metodo: 'PATCH', cuerpo: { umbral_bajo_mm: 1 } }), 'admin: umbrales por la tabla');
    denegado(await pedir(env, 'admin', 'clientes', { metodo: 'POST', cuerpo: { nombre: 'Pirata' } }), 'admin: insertar cliente');
    assert.equal(Number(env.sql(`select count(*) from public.clientes where nombre = 'Pirata'`)), 0);

    // RPC recortadas: el admin recibe 42501; el cliente global conserva las suyas
    denegado(await rpc(env, 'admin', 'neumatico_rotar', { p_vehiculo_id: 1, p_pos_a: 1, p_pos_b: 2 }), 'admin: rotar');
    denegado(await rpc(env, 'admin', 'sucursal_crear', { p_cliente_id: demo, p_nombre: 'C2 Admin' }), 'admin: crear sucursal');
    denegado(await rpc(env, 'admin', 'alerta_configurar', { p_cliente_id: demo, p_huella_absurda_mm: 25 }), 'admin: configurar alertas');
    const s = await rpc(env, 'global', 'sucursal_crear', { p_nombre: 'C2 Global' });
    assert.equal(s.status, 200, JSON.stringify(s.datos));
    env.sql(`delete from public.sucursales where nombre = 'C2 Global'`);

    // Lo que el admin conserva: nombre del cliente y las RPC de plataforma
    const nombre = env.sql(`select nombre from public.clientes where id = ${demo}`).trim();
    // Forma exacta de clientes.js:151: PATCH con return=representation y `select` de columnas explícitas (SEL, sin
    // precio_mensual). Lo que da 42501 es pedir `*` o precio_mensual, no la representación en sí.
    const SEL = 'id,nombre,created_at,auth_user_id,deleted_at,dispositivos(id,mac_address,activo),vehiculos(id)';
    const n = await pedir(env, 'admin', `clientes?id=eq.${demo}&select=${encodeURIComponent(SEL)}`, { metodo: 'PATCH', cuerpo: { nombre } });
    assert.equal(n.status, 200, JSON.stringify(n.datos));
    assert.equal(n.datos[0].nombre, nombre);
    denegado(await pedir(env, 'admin', `clientes?id=eq.${demo}&select=*`, { metodo: 'PATCH', cuerpo: { nombre } }), 'admin: PATCH con select=* (incluye precio_mensual)');
    denegado(await pedir(env, 'admin', `clientes?id=eq.${demo}`, { metodo: 'PATCH', cuerpo: { auth_user_id: null }, extra: { Prefer: 'return=minimal' } }), 'admin: reasignar auth_user_id');
    assert.equal((await rpc(env, 'admin', 'cliente_precios_mensuales')).status, 200);
  });
}
