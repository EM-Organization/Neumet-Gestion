// Km por cubierta (v_km_cubierta) con base real: cada rol ve solo lo suyo en la API, anon y los perfiles sin acceso no
// ven nada, y el panel del detalle muestra los mismos km que la vista (tramo actual, «Sin dato» y notas de confiabilidad).
// Crea un vehículo propio de Demo y lo borra al terminar (no altera las cifras de las demás pruebas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const OTRA = `(select id from public.clientes where nombre = 'Otra Empresa SA')`;
const SUC = n => `(select s.id from public.sucursales s where s.cliente_id = ${DEMO} and lower(s.nombre) = '${n}')`;
const COLS = 'neumatico_id,cliente_id,vehiculo_id,km_previos,km_en_vehiculos,km_tramo_actual,km_totales,km_confiable';
const leerKm = (p, filtro = '') => p.eval(`fetch('/rest/v1/v_km_cubierta?select=${COLS}${filtro}&limit=1000', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } })
  .then(async r => ({ status: r.status, filas: r.ok ? await r.json() : [] }))`);
const sinAuth = p => p.eval(`fetch('/rest/v1/v_km_cubierta?select=neumatico_id', { headers: { apikey: 'x' } }).then(r => r.status)`);

// ids de neumáticos que debe ver cada rol (referencia independiente: SQL con privilegios de dueño)
const visibles = {
  admin: 'true',
  global: `n.cliente_id = ${DEMO}`,
  salto: `n.vehiculo_id in (select v.id from public.vehiculos v where v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('salto')})`,
  montevideo: `n.vehiculo_id in (select v.id from public.vehiculos v where v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('montevideo')})`,
  otra: `n.cliente_id = ${OTRA}`
};
const idsEsperados = (env, rol) => json(env, `select n.id from public.neumaticos n where ${visibles[rol]} order by n.id`).map(x => x.id);

async function seleccionarRueda(p, pos) {
  await p.click(`#vd-diagrama .vd-rueda[data-pos="${pos}"]`);
  await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('#vd-rotar-btn') && document.querySelector('#vd-rotar-btn').dataset.posicion === '${pos}'`, { que: `panel de la rueda ${pos}` });
}
const panel = p => p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);
const fmt = n => Number(n).toLocaleString('es-AR');

export function registrar(env) {
  test('Km por cubierta: cada rol ve en la API solo sus neumáticos; anon, sin perfil y rol api ven nada', async () => {
    for (const rol of Object.keys(visibles)) {
      const esperados = idsEsperados(env, rol);
      assert.ok(esperados.length > 0, `la base de prueba tiene neumáticos para ${rol}`);
      await flujo(env, 'km-api', rol, async p => {
        const r = await leerKm(p);
        assert.equal(r.status, 200);
        assert.deepEqual(r.filas.map(f => f.neumatico_id).sort((a, b) => a - b), esperados, `ids visibles para ${rol}`);
        if (rol === 'salto') assert.ok(r.filas.every(f => f.cliente_id !== null && f.vehiculo_id !== null), 'sucursal: sin cubiertas de stock');
        if (rol === 'otra') assert.ok(!r.filas.some(f => esperados.indexOf(f.neumatico_id) === -1));
        // Cada fila es coherente: los km nunca son negativos y el total no es menor a los km previos
        for (const f of r.filas) {
          assert.ok(f.km_totales === null || f.km_totales >= f.km_previos, `neumático ${f.neumatico_id}: total >= previos`);
          assert.ok(f.km_tramo_actual === null || f.km_tramo_actual >= 0);
          assert.equal(typeof f.km_confiable, 'boolean');
        }
      });
    }
    for (const rol of ['sinperfil', 'api']) {
      await flujo(env, 'km-api', rol, async p => {
        const r = await leerKm(p);
        assert.deepEqual(r.filas, [], `${rol} no ve ningún neumático`);
      }, { sinAcceso: true });
    }
    await flujo(env, 'km-anon', 'global', async p => {
      assert.ok([401, 403].includes(await sinAuth(p)), 'sin sesión la vista no responde datos');
    }, { http: [{ ruta: /v_km_cubierta/, status: [401, 403] }] });
  });

  test('Km por cubierta: el panel de la rueda muestra lo que calcula la vista (tramo actual, «Sin dato» y notas)', async () => {
    const cli = Number(env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`));
    const veh = Number(env.sql(`insert into public.vehiculos (cliente_id, nombre, patente, numero, odometro_km, odometro_actualizado_at)
      values (${cli}, '991', 'E2EKM01', '991', 50000, now()) returning id`).split('\n')[0]);
    try {
      env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, km_previos) values
        (${veh}, ${cli}, 1, 'E2E-KM-1', 'montado', 'Michelin', 2000), (${veh}, ${cli}, 2, 'E2E-KM-2', 'montado', 'Michelin', 0),
        (${veh}, ${cli}, 3, 'E2E-KM-3', 'montado', 'Michelin', 0)`);
      env.sql(`insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, created_at)
        select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, e.tipo, e.odo, now() - e.dias * interval '1 day'
          from (values ('E2E-KM-1', 'montaje', 40000, 30), ('E2E-KM-2', 'montaje', null::int, 30), ('E2E-KM-3', 'montaje', 48000, 30), ('E2E-KM-3', 'rotacion', 47000, 10)) e(idn, tipo, odo, dias)
          join public.neumaticos n on n.idneumatico = e.idn`);
      const kv = idn => json(env, `select km_previos, km_en_vehiculos, km_tramo_actual, km_totales, km_confiable, odometro_anomalo from public.v_km_cubierta where idneumatico = '${idn}'`)[0];
      // Referencia en la base (el cálculo independiente de la interfaz)
      assert.deepEqual(kv('E2E-KM-1'), { km_previos: 2000, km_en_vehiculos: 0, km_tramo_actual: 10000, km_totales: 12000, km_confiable: true, odometro_anomalo: false });
      assert.deepEqual(kv('E2E-KM-2'), { km_previos: 0, km_en_vehiculos: 0, km_tramo_actual: null, km_totales: null, km_confiable: false, odometro_anomalo: false });
      assert.equal(kv('E2E-KM-3').odometro_anomalo, true);

      await flujo(env, 'km-panel', 'global', async p => {
        await abrirDetallePorMatricula(p, 'E2EKM01');
        await seleccionarRueda(p, 1);
        const t1 = await panel(p);
        for (const s of ['Km que ya traía 2.000 km', 'Km recorridos 10.000 km', 'En el tramo actual 10.000 km', 'Km totales 12.000 km']) assert.ok(t1.includes(s), `rueda 1: «${s}» en «${t1}»`);
        assert.doesNotMatch(t1, /Estimado|\bSin dato\b/);
        await seleccionarRueda(p, 2);
        const t2 = await panel(p);
        assert.ok(t2.includes('Km recorridos Sin dato') && t2.includes('Km totales Sin dato'), `rueda 2: sin km inventados en «${t2}»`);
        assert.ok(t2.includes('Sin dato: faltan lecturas de odómetro'));
        assert.doesNotMatch(t2, /Km totales 0 km|Km recorridos 0 km/);
        await seleccionarRueda(p, 3);
        const t3 = await panel(p);
        assert.ok(t3.includes(`En el tramo actual ${fmt(2000)} km`), `rueda 3: tramo actual 50.000 - 48.000 en «${t3}»`);
        assert.ok(t3.includes('Estimado: hay lecturas de odómetro decrecientes'), `rueda 3: odómetro decreciente señalado en «${t3}»`);
      });

      // Un perfil de otra sucursal / otro cliente no ve estas filas ni por la API
      const ids = json(env, `select id from public.neumaticos where idneumatico like 'E2E-KM-%'`).map(x => x.id);
      for (const rol of ['salto', 'montevideo', 'otra']) {
        await flujo(env, 'km-ajeno', rol, async p => {
          const r = await leerKm(p, `&neumatico_id=in.(${ids.join(',')})`);
          assert.deepEqual(r.filas, [], `${rol} no ve el vehículo recién creado`);
        });
      }
      // El diagnóstico de odómetro (RPC invoker): el global ve las anomalías de su vehículo; otro cliente, ninguna
      const anom = (p, v) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc('odometro_anomalias', { p_vehiculo: ${v} })).then(r => ({ n: (r.data || []).length, tipos: (r.data || []).map(x => x.anomalia), error: r.error && r.error.code }))`);
      await flujo(env, 'km-anomalias', 'global', async p => {
        const r = await anom(p, veh);
        assert.deepEqual(r, { n: 1, tipos: ['decreciente'], error: null });
      });
      await flujo(env, 'km-anomalias', 'otra', async p => {
        assert.deepEqual(await anom(p, veh), { n: 0, tipos: [], error: null });
      });
    } finally {
      env.sql(`delete from public.eventos_neumatico where vehiculo_id = ${veh}`);
      env.sql(`delete from public.neumaticos where vehiculo_id = ${veh}`);
      env.sql(`delete from public.vehiculos where id = ${veh}`);
    }
  });
}
