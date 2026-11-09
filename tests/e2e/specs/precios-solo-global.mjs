// Precios y costos solo para admin y perfil global (migración 20261116500000), con la base y PostgREST reales.
//   * API: ningún rol (admin incluido) lee neumaticos.precio_unidad ni eventos_neumatico.costo por select, `select=*`, filtro,
//     orden o relación embebida: 403 con código 42501 (permiso de columna). El resto de las columnas se lee con la RLS de siempre.
//   * Admin y perfil global los reciben solo por neumaticos_precios() / eventos_costos(), con el alcance de la RLS; la sucursal,
//     el rol api, sin perfil y anon, nada; «Otra Empresa SA» solo lo suyo.
//   * Interfaz: el panel de sucursal no pide ni muestra precios; global y admin sí (Stock, Ciclo de vida, edición de neumáticos).
// Modifica la base temporalmente (precios y costos de prueba, una edición del admin) y lo restaura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, irA, texto, dormir } from '../lib/flujo.mjs';
import { ALCANCE, DEMO, json } from '../lib/verdad.mjs';
import { fmtPesos } from '../../../assets/js/domain/formato.js';

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
// Todas las filas de una función (PostgREST corta en 1.000 por respuesta).
async function todas(env, rol, fn, args = {}) {
  const filas = [];
  for (let off = 0; ; off += 1000) {
    const r = await pedir(env, rol, `rpc/${fn}?limit=1000&offset=${off}&order=id`, { metodo: 'POST', cuerpo: args });
    assert.equal(r.status, 200, `${rol} ${fn}: ${JSON.stringify(r.datos)}`);
    filas.push(...r.datos);
    if (r.datos.length < 1000) return filas;
  }
}
const cuenta = async (env, rol, tabla, col = 'id') => Number((await pedir(env, rol, `${tabla}?select=${col}&limit=1`, { cabeceras: { Prefer: 'count=exact' } })).rango.split('/')[1]);

export function registrar(env) {
  test('Precios (API): nadie lee precio_unidad ni costo por select; las demás columnas siguen con su RLS', async () => {
    const DENEGADAS = [
      'neumaticos?select=precio_unidad', 'neumaticos?select=*', 'neumaticos?select=id&precio_unidad=gt.0', 'neumaticos?select=id&order=precio_unidad',
      'vehiculos?select=id,neumaticos(precio_unidad)', 'vehiculos?select=id,neumaticos(*)',
      'eventos_neumatico?select=costo', 'eventos_neumatico?select=*', 'eventos_neumatico?select=id&costo=gt.0', 'eventos_neumatico?select=id&order=costo',
      'vehiculos?select=id,eventos_neumatico(costo)'
    ];
    for (const rol of [...ROLES, null]) {
      for (const ruta of DENEGADAS) {
        const r = await pedir(env, rol, ruta);
        assert.ok(r.status === 403 || (rol === null && r.status === 401), `${rol}: ${ruta} -> ${r.status} ${JSON.stringify(r.datos).slice(0, 120)}`);
        assert.equal(r.datos && r.datos.code, '42501', `${rol}: ${ruta} debe responder 42501`);
      }
    }
    // Lo demás se lee con la RLS de siempre
    const verdad = (cond) => Number(env.sql(`select count(*) from public.neumaticos n where ${cond}`));
    const esperado = {
      admin: verdad('true'),
      global: verdad(`n.cliente_id = ${DEMO}`),
      salto: Number(env.sql(`select count(*) from public.neumaticos n join public.vehiculos v on v.id = n.vehiculo_id where ${ALCANCE.salto.veh}`)),
      montevideo: Number(env.sql(`select count(*) from public.neumaticos n join public.vehiculos v on v.id = n.vehiculo_id where ${ALCANCE.montevideo.veh}`)),
      otra: verdad(`n.cliente_id = ${OTRA}`),
      sinperfil: 0, api: 0
    };
    for (const rol of ROLES) assert.equal(await cuenta(env, rol, 'neumaticos'), esperado[rol], `${rol}: neumaticos visibles`);
    assert.ok(esperado.salto > 0 && esperado.salto < esperado.global && esperado.global < esperado.admin, 'la base de prueba distingue los alcances');
    const ev = await pedir(env, 'salto', 'eventos_neumatico?select=id,tipo,odometro_km,notas&limit=1');
    assert.equal(ev.status, 200);
    const anon = await pedir(env, null, 'neumaticos?select=id');
    assert.ok([401, 403].includes(anon.status) && anon.datos.code === '42501', `anon: ${anon.status}`);
  });

  test('Precios (API): neumaticos_precios y eventos_costos devuelven solo lo que cada rol puede ver', async () => {
    // Datos de prueba: un precio y un costo en «Otra Empresa SA» y un precio en una cubierta de stock de Demo.
    const otraNeu = Number(env.sql(`select id from public.neumaticos where cliente_id = ${OTRA} and vehiculo_id is not null order by id limit 1`));
    const otraEv = Number(env.sql(`insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, tipo, costo, notas)
      select v.cliente_id, v.id, ${otraNeu}, 'reparacion', 66.60, 'precios-e2e' from public.vehiculos v join public.neumaticos n on n.vehiculo_id = v.id where n.id = ${otraNeu} returning id`));
    const stockDemo = Number(env.sql(`select id from public.neumaticos where vehiculo_id is null and cliente_id = ${DEMO} order by id limit 1`));
    const previoOtra = env.sql(`select coalesce(precio_unidad::text, '') from public.neumaticos where id = ${otraNeu}`);
    const previoStock = env.sql(`select coalesce(precio_unidad::text, '') from public.neumaticos where id = ${stockDemo}`);
    env.sql(`update public.neumaticos set precio_unidad = 555.55 where id = ${otraNeu}`);
    env.sql(`update public.neumaticos set precio_unidad = 321.50 where id = ${stockDemo}`);
    try {
      const verdadPrecios = cond => json(env, `select n.id, n.precio_unidad::float8 as precio_unidad from public.neumaticos n where n.precio_unidad is not null and ${cond} order by n.id`);
      const verdadCostos = cond => json(env, `select e.id, e.costo::float8 as costo from public.eventos_neumatico e where e.costo is not null and ${cond} order by e.id`);

      // Admin: todo; global: Demo; otra: lo suyo
      assert.deepEqual(await todas(env, 'admin', 'neumaticos_precios'), verdadPrecios('true'));
      assert.deepEqual(await todas(env, 'admin', 'eventos_costos'), verdadCostos('true'));
      const gp = await todas(env, 'global', 'neumaticos_precios'), gc = await todas(env, 'global', 'eventos_costos');
      assert.deepEqual(gp, verdadPrecios(`n.cliente_id = ${DEMO}`));
      assert.deepEqual(gc, verdadCostos(`e.cliente_id = ${DEMO}`));
      assert.ok(gp.length > 100 && gp.some(f => f.id === stockDemo && f.precio_unidad === 321.5), 'global: precios de vehículos y de stock');
      assert.ok(!gp.some(f => f.id === otraNeu) && !gc.some(f => f.id === otraEv), 'global: nada de otro cliente');
      assert.deepEqual(await todas(env, 'otra', 'neumaticos_precios'), verdadPrecios(`n.cliente_id = ${OTRA}`));
      assert.deepEqual(await todas(env, 'otra', 'eventos_costos'), verdadCostos(`e.cliente_id = ${OTRA}`));
      assert.ok((await todas(env, 'otra', 'neumaticos_precios')).some(f => f.id === otraNeu && f.precio_unidad === 555.55));
      assert.ok((await todas(env, 'otra', 'eventos_costos')).some(f => f.id === otraEv && f.costo === 66.6));

      // Sucursal, api, sin perfil: vacío (también si piden un vehículo de su propia sucursal)
      const vSalto = Number(env.sql(`select v.id from public.vehiculos v where ${ALCANCE.salto.veh} order by v.id limit 1`));
      for (const rol of ['salto', 'montevideo', 'sinperfil', 'api']) {
        assert.deepEqual(await todas(env, rol, 'neumaticos_precios'), [], `${rol}: precios`);
        assert.deepEqual(await todas(env, rol, 'eventos_costos'), [], `${rol}: costos`);
        assert.deepEqual(await todas(env, rol, 'neumaticos_precios', { p_vehiculo: vSalto }), [], `${rol}: precios de un vehículo`);
        assert.deepEqual(await todas(env, rol, 'eventos_costos', { p_vehiculo: vSalto }), [], `${rol}: costos de un vehículo`);
      }
      // Anon: sin permiso de ejecución
      for (const fn of ['neumaticos_precios', 'eventos_costos', 'precios_visibles']) {
        const r = await pedir(env, null, `rpc/${fn}`, { metodo: 'POST', cuerpo: {} });
        assert.ok([401, 403].includes(r.status), `anon ${fn}: ${r.status}`);
      }
      // Filtros: vehículo, solo stock, vehículo ajeno
      assert.deepEqual(await todas(env, 'global', 'neumaticos_precios', { p_vehiculo: vSalto }), verdadPrecios(`n.vehiculo_id = ${vSalto}`));
      assert.deepEqual((await todas(env, 'global', 'neumaticos_precios', { p_solo_stock: true })).map(f => f.id), verdadPrecios(`n.vehiculo_id is null and n.cliente_id = ${DEMO}`).map(f => f.id));
      assert.deepEqual(await todas(env, 'global', 'eventos_costos', { p_vehiculo: vSalto }), verdadCostos(`e.vehiculo_id = ${vSalto}`));
      const vOtra = Number(env.sql(`select vehiculo_id from public.neumaticos where id = ${otraNeu}`));
      assert.deepEqual(await todas(env, 'global', 'neumaticos_precios', { p_vehiculo: vOtra }), [], 'global: precios de un vehículo de otro cliente');
      assert.deepEqual(await todas(env, 'global', 'eventos_costos', { p_vehiculo: vOtra }), [], 'global: costos de un vehículo de otro cliente');
      // La regla de visibilidad
      const vis = Object.fromEntries(await Promise.all(ROLES.map(async r => [r, (await pedir(env, r, 'rpc/precios_visibles', { metodo: 'POST', cuerpo: {} })).datos])));
      assert.deepEqual(vis, { admin: true, global: true, salto: false, montevideo: false, otra: true, sinperfil: false, api: false });
      // Se puede filtrar y ordenar el resultado como una tabla
      const f = await pedir(env, 'global', `rpc/eventos_costos?costo=gte.0&order=costo.desc&limit=3`, { metodo: 'POST', cuerpo: {} });
      assert.equal(f.status, 200); assert.ok(f.datos.length > 0 && f.datos.every((x, i, a) => i === 0 || a[i - 1].costo >= x.costo));
    } finally {
      env.sql(`update public.neumaticos set precio_unidad = ${previoOtra === '' ? 'null' : previoOtra} where id = ${otraNeu}`);
      env.sql(`update public.neumaticos set precio_unidad = ${previoStock === '' ? 'null' : previoStock} where id = ${stockDemo}`);
      env.sql(`delete from public.eventos_neumatico where id = ${otraEv}`);
    }
  });

  test('Precios (API): las vistas y RPC existentes siguen funcionando para todos los roles', async () => {
    const VISTAS = ['v_estado_neumaticos', 'v_alertas', 'v_ultima_medicion', 'v_mediciones_neumatico', 'v_km_cubierta', 'v_resumen_flota_cliente'];
    for (const rol of ['admin', 'global', 'salto', 'montevideo', 'otra']) {
      for (const v of VISTAS) {
        const r = await pedir(env, rol, `${v}?select=*&limit=1`);
        assert.equal(r.status, 200, `${rol}: ${v} -> ${r.status} ${JSON.stringify(r.datos).slice(0, 120)}`);
      }
      for (const [fn, args] of [['ultimas_mediciones', {}], ['odometro_anomalias', { p_vehiculo: 1 }], ['km_tramos_cubierta', { p_neumatico: 1 }]]) {
        const r = await pedir(env, rol, `rpc/${fn}`, { metodo: 'POST', cuerpo: args });
        assert.equal(r.status, 200, `${rol}: ${fn} -> ${r.status} ${JSON.stringify(r.datos).slice(0, 120)}`);
      }
    }
    const filas = { global: await cuenta(env, 'global', 'v_estado_neumaticos', 'vehiculo_id'), salto: await cuenta(env, 'salto', 'v_estado_neumaticos', 'vehiculo_id') };
    assert.ok(filas.salto > 0 && filas.salto < filas.global);
    for (const rol of ['sinperfil', 'api']) assert.equal(await cuenta(env, rol, 'v_estado_neumaticos', 'vehiculo_id'), 0);
  });

  // ---- Interfaz ----------------------------------------------------------------------------------------------------
  for (const rol of ['salto', 'montevideo']) {
    test(`Precios (${rol}): el panel de sucursal no pide ni muestra precios ni costos`, async () => {
      const patente = env.sql(`select v.patente from public.vehiculos v where ${ALCANCE[rol].veh} and v.activo order by v.patente limit 1`);
      const desde = env.peticiones.length;
      await flujo(env, 'sin-precios', rol, async p => {
        await irA(p, 'vehiculos');
        await p.esperar(`document.querySelectorAll('#veh-lista .veh-fila').length > 0`, { que: 'lista de vehículos' });
        await p.escribir('#search-vehiculos', patente);
        await p.enter();
        await p.esperar(`document.querySelector('#view-vehiculo-detalle').classList.contains('active') && document.querySelectorAll('#vd-diagrama .vd-rueda').length > 0`, { que: 'detalle del vehículo' });
        await p.click('#vd-diagrama .vd-rueda');
        await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto')`, { que: 'panel de la rueda' });
        const panel = await texto(p, '#view-vehiculo-detalle');
        assert.doesNotMatch(panel, /\bcosto\b|\bprecio\b|\$\s?\d/i, 'el detalle no debe mostrar importes');
        await irA(p, 'inicio'); await irA(p, 'alertas'); await irA(p, 'reportes');
      });
      const mias = env.peticiones.slice(desde).filter(r => r.tag === `${rol}/sin-precios`);
      assert.ok(mias.length > 5);
      for (const r of mias) {
        assert.doesNotMatch(`${r.path}${r.search}`, /neumaticos_precios|eventos_costos|precio_unidad|costo/, `el panel de sucursal pidió ${r.path}${r.search}`);
        assert.ok(r.status < 400, `${r.status} ${r.path}`);
      }
    });
  }

  test('Precios (global): Stock muestra el precio de compra de las cubiertas, traído de neumaticos_precios', async () => {
    // Una cubierta de Demo cuya quema no la usa ningún otro cliente (el admin ve las de todos).
    const id = Number(env.sql(`select n.id from public.neumaticos n where n.vehiculo_id is null and n.cliente_id = ${DEMO}
      and not exists (select 1 from public.neumaticos o where o.cliente_id <> n.cliente_id and lower(o.numero_quema) = lower(n.numero_quema)) order by n.id limit 1`));
    const previo = env.sql(`select coalesce(precio_unidad::text, '') from public.neumaticos where id = ${id}`);
    const quema = env.sql(`select numero_quema from public.neumaticos where id = ${id}`);
    env.sql(`update public.neumaticos set precio_unidad = 4321.5 where id = ${id}`);
    try {
      const desde = env.peticiones.length;
      for (const rol of ['global', 'admin']) {
        await flujo(env, 'stock-precio', rol, async p => {
          await irA(p, 'stock');
          await p.esperar(`document.querySelectorAll('#stk-lista .stk-fila').length > 0`, { que: 'lista de Stock' });
          const fila = await p.eval(`(() => { const f = [...document.querySelectorAll('#stk-lista .stk-fila')].find(x => x.querySelector('.stk-quema').firstChild.textContent.trim() === ${JSON.stringify(quema)}); return f ? f.querySelector('.stk-compra').textContent : null; })()`);
          assert.ok(fila && fila.includes(fmtPesos(4321.5)), `${rol}: la fila de ${quema} debe mostrar ${fmtPesos(4321.5)}, muestra: ${fila}`);
        });
      }
      const reqs = env.peticiones.slice(desde);
      assert.ok(reqs.some(r => /rpc\/neumaticos_precios/.test(r.path)), 'pidió los precios por la función');
      assert.ok(reqs.every(r => !/precio_unidad/.test(decodeURIComponent(r.search)) || /stock_neumaticos/.test(r.path)), 'ningún select de neumaticos pide precio_unidad');
    } finally {
      env.sql(`update public.neumaticos set precio_unidad = ${previo === '' ? 'null' : previo} where id = ${id}`);
    }
  });

  test('Precios (admin): Ciclo de vida muestra el costo de cada evento y editar un neumático conserva y cambia los precios', async () => {
    // El vehículo de Demo con más eventos con costo (los del seed son los montajes de ciertos coches).
    const veh = json(env, `select v.id, v.patente from public.vehiculos v join public.eventos_neumatico e on e.vehiculo_id = v.id
      where v.cliente_id = ${DEMO} and e.costo is not null group by v.id, v.patente order by count(*) desc, v.id limit 1`)[0];
    assert.ok(veh, 'el demo trae eventos con costo');
    const costos = json(env, `select e.id, e.costo::float8 as costo from public.eventos_neumatico e where e.vehiculo_id = ${veh.id} and e.costo is not null order by e.id`);
    assert.ok(costos.length >= 1);
    const antes = json(env, `select id, posicion, marca, modelo, fecha_compra, precio_unidad::float8 as precio, numero_quema, km_previos, estado, vida, stock_id, notas from public.neumaticos where vehiculo_id = ${veh.id} order by id`);
    let pos = null;
    await flujo(env, 'ciclo-costos', 'admin', async p => {
      await irA(p, 'vehiculos');
      await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length > 0`, { que: 'tabla de vehículos' });
      await p.escribir('#search-vehiculos', veh.patente);
      await p.esperar(`document.querySelectorAll('#tbody-vehiculos tr .mono-cell').length === 1`, { que: 'una fila' });
      await p.click('#tbody-vehiculos [data-va="neum"]');
      await p.esperar(`document.querySelector('#modal-neumaticos').classList.contains('show') && document.querySelectorAll('#neum-assign-svg g[cursor="pointer"]').length > 0`, { que: 'modal de neumáticos' });

      // Ciclo de vida: costo de cada evento, como en la base
      await p.click('[data-action="cicloDesdeNeum"]');
      await p.esperar(`document.querySelector('#modal-ciclo').classList.contains('show') && document.querySelectorAll('#ciclo-timeline .ciclo-ev').length > 0`, { que: 'línea de tiempo' });
      const lineas = await p.eval(`[...document.querySelectorAll('#ciclo-timeline .ciclo-ev')].map(e => e.textContent)`);
      const conCosto = lineas.filter(t => / · costo /.test(t)).length;
      assert.equal(conCosto, costos.length, `eventos con costo en pantalla (${conCosto}) vs base (${costos.length})`);
      for (const c of costos) assert.ok(lineas.some(t => t.includes(`costo ${c.costo}`)), `falta «costo ${c.costo}»`);
      await p.click('[data-action="closeCicloVida"]');

      // Edición: se elige una rueda, el precio mostrado es el de la base y al guardar solo cambia esa rueda
      await p.eval(`document.querySelector('#neum-assign-svg g[cursor="pointer"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      await p.esperar(`document.querySelector('#ndp-precio')`, { que: 'panel de la posición' });
      pos = Number(await p.eval(`document.querySelector('.ndp-title strong').textContent.replace(/\\D/g, '')`));
      const esperado = antes.find(n => n.posicion === pos);
      assert.ok(esperado, `la posición ${pos} existe en la base`);
      assert.equal(await p.eval(`document.querySelector('#ndp-precio').value`), esperado.precio === null ? '' : String(esperado.precio), 'el precio mostrado es el de la base');
      await p.eval(`document.querySelector('#ndp-precio').value = '999.5'`);
      await p.click('[data-action="neumApplyPos"]');
      await p.click('#neum-save');
      await p.esperar(`/Neumáticos guardados/.test(document.querySelector('#toast-msg').textContent)`, { que: 'aviso de guardado' });
    });
    const despues = json(env, `select id, posicion, marca, modelo, fecha_compra, precio_unidad::float8 as precio, numero_quema, km_previos, estado, vida, stock_id, notas from public.neumaticos where vehiculo_id = ${veh.id} order by id`);
    assert.equal(despues.length, antes.length, 'no se crean ni se pierden neumáticos');
    const cambiados = despues.filter((d, i) => JSON.stringify(d) !== JSON.stringify(antes[i]));
    assert.equal(cambiados.length, 1, `solo debe cambiar la rueda editada: ${JSON.stringify(cambiados)}`);
    assert.equal(cambiados[0].precio, 999.5);
    assert.equal(cambiados[0].posicion, pos);
    // Restaura el precio original
    for (const a of antes) env.sql(`update public.neumaticos set precio_unidad = ${a.precio === null ? 'null' : a.precio} where id = ${a.id}`);
    await dormir(50);
  });
}
