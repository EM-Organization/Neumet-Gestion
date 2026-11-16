// RPC del precio mensual (migración C1 20261120000000, docs/17) con la base y PostgREST reales y el JWT de cada rol.
//   * cliente_precios_mensuales / cliente_precio_mensual_fijar: solo el equipo Neumet; el resto recibe 42501.
//   * Balance (PR 9b): el panel lee y fija el precio solo por esas RPC y nunca toca clientes.precio_mensual directo (lo cierra la migración C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, dormir } from '../lib/flujo.mjs';
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
  test('Precio mensual (API): solo el equipo Neumet lee y fija por RPC', async () => {
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
    } finally {
      env.sql(`update public.clientes set precio_mensual = ${original} where id = ${demo}`);
    }
  });

  // Peticiones del flujo que tocan clientes.precio_mensual fuera de las RPC: por nombre (ruta, filtro o cuerpo), con select '*' o sin
  // select sobre clientes, o cualquier escritura directa sobre clientes (C2 le quita ese privilegio a authenticated).
  const directas = (env, desde, tag) => env.peticiones.slice(desde).filter(r => {
    if (r.tag !== tag || /\/rpc\//.test(r.path)) return false;
    const q = decodeURIComponent(r.search);
    const sobreClientes = /^\/clientes(\?|$)/.test(r.path);
    return /precio_mensual/.test(`${r.path}${q}${r.body || ''}`) || (sobreClientes && (r.method !== 'GET' || !/select=/.test(q) || /select=[^&]*\*/.test(q)));
  });

  test('Balance (panel): lee los precios por RPC, fija con Enter, muestra los errores y nunca toca clientes.precio_mensual', async () => {
    const demo = Number(env.sql(`select ${DEMO}`));
    const original = env.sql(`select precio_mensual from public.clientes where id = ${demo}`).trim();
    const desde = env.peticiones.length;
    try {
      env.sql(`update public.clientes set precio_mensual = 1234 where id = ${demo}`);
      await flujo(env, 'balance', 'admin', async p => {
        await irA(p, 'balance');
        const total = Number(env.sql('select count(*) from public.clientes'));
        await p.esperar(`document.querySelectorAll('.precio-input').length === ${total}`, { que: 'campos de precio' });
        assert.equal(await p.eval(`document.querySelector('.precio-input[data-cid="${demo}"]').value`), '1234', 'el precio viene de la RPC');

        // Fijar: escribir y Enter (sin más clics)
        await p.escribir(`.precio-input[data-cid="${demo}"]`, '4567');
        await p.enter();
        await p.esperar(`document.querySelector('#toast-msg').textContent === 'Precio actualizado'`, { que: 'aviso de guardado' });
        assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 4567, 'la base guardó el precio');

        // Se relee desde la base al volver a entrar
        await irA(p, 'inicio');
        await irA(p, 'balance');
        await p.esperar(`document.querySelector('.precio-input[data-cid="${demo}"]') && document.querySelector('.precio-input[data-cid="${demo}"]').value === '4567'`, { que: 'precio releído' });
        // La vista conserva el estado de la visita anterior y vuelve a pedir los datos: se espera esa segunda lectura para que su
        // render no pise lo que se escribe a continuación (bajo carga llegaba después de escribir).
        for (let i = 0; i < 100 && env.peticiones.slice(desde).filter(r => r.tag === 'admin/balance' && /rpc\/cliente_precios_mensuales$/.test(r.path) && r.status === 200).length < 2; i++) await dormir(100);
        await dormir(400);

        // Valor fuera de rango: 22023, aviso y el campo vuelve al valor vigente
        await p.escribir(`.precio-input[data-cid="${demo}"]`, '99999999999');
        await p.enter();
        await p.esperar(`/^Precio inválido/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de precio inválido' });
        assert.equal(Number(env.sql(`select precio_mensual from public.clientes where id = ${demo}`)), 4567, 'el rechazo no cambia nada');
        await p.esperar(`document.querySelector('.precio-input[data-cid="${demo}"]').value === '4567'`, { que: 'campo restaurado' });
      }, { http: [{ ruta: /rpc\/cliente_precio_mensual_fijar/, status: 400 }] });
      const mias = env.peticiones.slice(desde).filter(r => r.tag === 'admin/balance');
      assert.ok(mias.some(r => r.method === 'POST' && /rpc\/cliente_precios_mensuales$/.test(r.path)), 'la lectura sale de cliente_precios_mensuales');
      assert.ok(mias.filter(r => /rpc\/cliente_precio_mensual_fijar$/.test(r.path)).length >= 2, 'el guardado sale de cliente_precio_mensual_fijar');
      assert.deepEqual(directas(env, desde, 'admin/balance').map(r => `${r.method} ${r.path}${r.search}`), [], 'ninguna petición directa a clientes con precio_mensual ni escritura sobre clientes');
    } finally {
      env.sql(`update public.clientes set precio_mensual = ${original} where id = ${demo}`);
    }
  });

  test('Balance (panel): el administrador de empresa no ve la pantalla ni entra forzándola, y no pide precios', async () => {
    const desde = env.peticiones.length;
    await flujo(env, 'balance-bloqueada', 'global', async p => {
      assert.equal(await p.eval(`(() => { const b = document.querySelector('.nav-item[data-view="balance"]'); return !b || b.getClientRects().length === 0; })()`), true, 'el menú muestra Balance');
      await p.eval(`(() => { const b = document.querySelector('.nav-item[data-view="balance"]'); if (b) b.click(); })()`);
      await dormir(300);
      assert.equal(await p.eval(`document.querySelector('#view-balance').classList.contains('active')`), false, 'entró a Balance');
      await irA(p, 'inicio');
    });
    const mias = env.peticiones.slice(desde).filter(r => r.tag === 'global/balance-bloqueada');
    assert.ok(mias.every(r => !/cliente_precio/.test(r.path)), 'no debe llamar a las RPC del precio mensual');
    assert.deepEqual(directas(env, desde, 'global/balance-bloqueada').map(r => `${r.method} ${r.path}${r.search}`), [], 'sin consultas directas del precio');
  });
}
