// Uso mensual por cliente (migración 20261119500000, docs/17 §5) con la base y PostgREST reales y el JWT de cada rol.
//   * uso_clientes_listar: solo el equipo Neumet; el administrador de empresa, sucursal, api, sin perfil y anon reciben 42501.
//   * uso_cerrar_mes: ningún JWT la ejecuta (solo servicio / dueño); la tabla no se lee ni se escribe por la API.
// Siembra ingesta_log de un mes cerrado y lo borra al terminar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../lib/verdad.mjs';

const ROLES = ['global', 'salto', 'montevideo', 'otra', 'sinperfil', 'api'];

async function pedir(env, rol, ruta, { metodo = 'GET', cuerpo } = {}) {
  const h = { apikey: 'x' };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${env.rest.base}/${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
}
const rpc = (env, rol, fn, args = {}) => pedir(env, rol, `rpc/${fn}`, { metodo: 'POST', cuerpo: args });
const denegado = (r, msg) => assert.ok([401, 403].includes(r.status) && r.datos && r.datos.code === '42501', `${msg}: ${r.status} ${JSON.stringify(r.datos).slice(0, 160)}`);

export function registrar(env) {
  test('Uso mensual (API): solo el equipo Neumet lee; nadie cierra por la API; la tabla no es accesible', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    // El cierre solo incluye clientes ya existentes en el mes: se adelanta created_at y se restaura al terminar.
    const creado = env.sql(`select created_at from public.clientes where id = ${demo}`).trim();
    try {
      env.sql(`insert into public.ingesta_log (recibido_at, endpoint, status, cliente_id) values
        ('2026-03-03 12:00+00', 'guardar_montaje_mm', 'ok', ${demo}),
        ('2026-03-04 12:00+00', 'login', 'ok', ${demo})`);
      env.sql(`update public.clientes set created_at = '2026-01-01+00' where id = ${demo}`);
      assert.ok(Number(env.sql(`select public.uso_cerrar_mes('2026-03-15')`)) >= 1, 'cierre como dueño de la base (pg_cron)');

      const r = await rpc(env, 'admin', 'uso_clientes_listar', { p_desde: '2026-03-01', p_hasta: '2026-03-31', p_cliente_id: demo });
      assert.equal(r.status, 200, JSON.stringify(r.datos));
      assert.equal(r.datos.length, 1);
      assert.equal(r.datos[0].api_llamadas, 1, 'el login no cuenta como llamada');
      assert.equal(r.datos[0].logins, 1);
      assert.deepEqual(r.datos[0].api_por_endpoint, { guardar_montaje_mm: { ok: 1 } });

      for (const rol of [...ROLES, null]) {
        denegado(await rpc(env, rol, 'uso_clientes_listar'), `listar como ${rol}`);
        denegado(await rpc(env, rol, 'uso_cerrar_mes', { p_mes: '2026-03-01' }), `cerrar como ${rol}`);
      }
      denegado(await rpc(env, 'admin', 'uso_cerrar_mes', { p_mes: '2026-03-01' }), 'cerrar como equipo Neumet');
      for (const rol of ['admin', ...ROLES, null]) {
        const g = await pedir(env, rol, 'uso_cliente_mensual?select=*');
        assert.ok([401, 403].includes(g.status), `leer la tabla como ${rol}: ${g.status}`);
        const w = await pedir(env, rol, 'uso_cliente_mensual', { metodo: 'POST', cuerpo: { cliente_id: demo, mes: '2026-01-01' } });
        assert.ok([401, 403].includes(w.status), `escribir la tabla como ${rol}: ${w.status}`);
      }
    } finally {
      env.sql(`update public.clientes set created_at = '${creado}' where id = ${demo}`);
      env.sql(`delete from public.uso_cliente_mensual where mes = '2026-03-01'`);
      env.sql(`delete from public.ingesta_log where recibido_at >= '2026-03-01+00' and recibido_at < '2026-04-01+00'`);
    }
  });
}
