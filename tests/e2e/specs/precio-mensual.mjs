// RPC del precio mensual (migración C1 20261120000000, docs/17) con la base y PostgREST reales y el JWT de cada rol.
//   * cliente_precios_mensuales / cliente_precio_mensual_fijar: solo el equipo Neumet; el resto recibe 42501.
//   * Retrocompatible: el camino directo de Balance (select/update de clientes.precio_mensual) sigue funcionando para el admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../lib/verdad.mjs';

const ROLES = ['global', 'salto', 'montevideo', 'otra', 'sinperfil', 'api'];

async function pedir(env, rol, ruta, { metodo = 'GET', cuerpo, extra = {} } = {}) {
  const h = { apikey: 'x', ...extra };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${env.rest.base}/${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
}
const rpc = (env, rol, fn, args = {}) => pedir(env, rol, `rpc/${fn}`, { metodo: 'POST', cuerpo: args });
const denegado = (r, msg) => assert.ok([401, 403].includes(r.status) && r.datos && r.datos.code === '42501', `${msg}: ${r.status} ${JSON.stringify(r.datos).slice(0, 160)}`);

export function registrar(env) {
  test('Precio mensual (API): solo el equipo Neumet lee y fija por RPC; el camino directo de Balance sigue vigente', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    const original = env.sql(`select precio_mensual from public.clientes where id = ${demo}`).trim();
    try {
      env.sql(`update public.clientes set precio_mensual = 321.50 where id = ${demo}`);

      const l = await rpc(env, 'admin', 'cliente_precios_mensuales');
      assert.equal(l.status, 200, JSON.stringify(l.datos));
      assert.equal(Number(l.datos.find((f) => f.cliente_id === demo).precio_mensual), 321.5);
      assert.equal(l.datos.length, Number(env.sql('select count(*) from public.clientes')));

      const f = await rpc(env, 'admin', 'cliente_precio_mensual_fijar', { p_cliente_id: demo, p_precio: 450 });
      assert.equal(f.status, 200, JSON.stringify(f.datos));
      assert.equal(Number(f.datos), 450);
      assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 450);

      const malo = await rpc(env, 'admin', 'cliente_precio_mensual_fijar', { p_cliente_id: demo, p_precio: -5 });
      assert.equal(malo.status, 400, 'precio negativo');
      assert.equal(malo.datos.code, '22023');
      const nada = await rpc(env, 'admin', 'cliente_precio_mensual_fijar', { p_cliente_id: 999999, p_precio: 5 });
      assert.equal(nada.datos.code, 'P0002', 'cliente inexistente');
      assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 450, 'los rechazos no cambian nada');

      for (const rol of [...ROLES, null]) {
        denegado(await rpc(env, rol, 'cliente_precios_mensuales'), `leer como ${rol}`);
        denegado(await rpc(env, rol, 'cliente_precio_mensual_fijar', { p_cliente_id: demo, p_precio: 1 }), `fijar como ${rol}`);
      }
      assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 450, 'las denegadas no cambian nada');

      // Retrocompatibilidad: lo que hace balance.js hoy (select y update directos como admin) sigue andando; C2 lo cerrará.
      const d = await pedir(env, 'admin', `clientes?select=id,precio_mensual&id=eq.${demo}`);
      assert.equal(d.status, 200);
      assert.equal(Number(d.datos[0].precio_mensual), 450);
      const u = await pedir(env, 'admin', `clientes?id=eq.${demo}`, { metodo: 'PATCH', cuerpo: { precio_mensual: 460 }, extra: { Prefer: 'return=representation' } });
      assert.equal(u.status, 200, JSON.stringify(u.datos));
      assert.equal(u.datos.length, 1);
      assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 460);
    } finally {
      env.sql(`update public.clientes set precio_mensual = ${original} where id = ${demo}`);
    }
  });
}
