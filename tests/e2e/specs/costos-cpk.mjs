// Costos y CPK con base real: la API (PostgREST + RLS) entrega costos solo al administrador y al perfil global de su
// cliente (el perfil de sucursal, otro cliente, sin perfil, rol api y anon no ven nada), el panel de la rueda muestra
// el costo de la vista y «Registrar costo» escribe por la RPC y se refleja. Crea un vehículo propio y lo borra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo, abrirDetallePorMatricula } from '../lib/flujo.mjs';
import { json } from '../lib/verdad.mjs';

const get = (p, tabla, query = '') => p.eval(`fetch('/rest/v1/${tabla}?${query}&limit=1000', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } })
  .then(async r => ({ status: r.status, filas: r.ok ? await r.json() : [] }))`);
const sinAuth = (p, tabla) => p.eval(`fetch('/rest/v1/${tabla}?select=neumatico_id', { headers: { apikey: 'x' } }).then(r => r.status)`);
const rpc = (p, nombre, args) => p.eval(`import('/assets/js/core/supabase.js').then(m => m.db.rpc('${nombre}', ${JSON.stringify(args)})).then(r => ({ data: r.data, code: r.error && r.error.code }))`);
const panel = p => p.eval(`document.querySelector('#vd-panel').innerText.replace(/\\s+/g, ' ')`);

export function registrar(env) {
  test('Costos y CPK: cada rol ve en la API solo lo permitido; sucursal, otro cliente, sin perfil, api y anon, nada', async () => {
    const cli = Number(env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`));
    const veh = Number(env.sql(`insert into public.vehiculos (cliente_id, nombre, patente, numero, odometro_km, odometro_actualizado_at)
      values (${cli}, '992', 'E2ECP01', '992', 50000, now()) returning id`).split('\n')[0]);
    try {
      env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, precio_unidad) values
        (${veh}, ${cli}, 1, 'E2E-CP-1', 'montado', 'Michelin', 'X', 1000)`);
      env.sql(`insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
        select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, 'montaje', 40000, 1000, now() - interval '30 days' from public.neumaticos n where n.idneumatico = 'E2E-CP-1'`);
      env.sql(`insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda)
        select n.cliente_id, n.id, 'reparacion', 200, 'UYU' from public.neumaticos n where n.idneumatico = 'E2E-CP-1'`);
      const nid = json(env, `select id from public.neumaticos where idneumatico = 'E2E-CP-1'`)[0].id;
      // Referencia independiente: compra una sola vez (precio y evento de montaje) + reparación = 1.200; 10.000 km
      const ref = json(env, `select costo_total, km_totales, km_confiable, cpk from public.v_costo_cubierta where neumatico_id = ${nid}`)[0];
      assert.deepEqual(ref, { costo_total: 1200, km_totales: 10000, km_confiable: true, cpk: 0.12 });

      for (const rol of ['admin', 'global']) {
        await flujo(env, 'costos-api', rol, async p => {
          const r = await get(p, 'v_costo_cubierta', `select=neumatico_id,costo_total,cpk&neumatico_id=eq.${nid}`);
          assert.equal(r.status, 200);
          assert.deepEqual(r.filas.map(f => [f.neumatico_id, Number(f.costo_total), Number(f.cpk)]), [[nid, 1200, 0.12]], rol);
          const t = await get(p, 'costos_neumatico', `select=id&neumatico_id=eq.${nid}`);
          assert.equal(t.filas.length, 1, `${rol} ve la entrada de costo`);
        });
      }
      for (const rol of ['salto', 'montevideo', 'otra']) {
        await flujo(env, 'costos-api', rol, async p => {
          const v = await get(p, 'v_costo_cubierta', `select=neumatico_id&neumatico_id=eq.${nid}`);
          assert.deepEqual(v.filas, [], `${rol}: la vista no devuelve el neumático`);
          assert.equal((await get(p, 'costos_neumatico', `select=id&neumatico_id=eq.${nid}`)).filas.length, 0, `${rol}: sin costos`);
        });
      }
      // El perfil de sucursal no recibe ninguna fila de costos, ni de sus propios neumáticos
      for (const rol of ['salto', 'montevideo']) {
        await flujo(env, 'costos-suc', rol, async p => {
          assert.deepEqual((await get(p, 'v_costo_cubierta', 'select=neumatico_id')).filas, []);
          assert.deepEqual((await rpc(p, 'cpk_por_grupo', { p_grupo: 'marca' })).data, []);
          assert.equal((await rpc(p, 'costo_registrar', { p_neumatico_id: nid, p_concepto: 'otro', p_monto: 1 })).code, '42501');
        }, { http: [{ ruta: /rpc\/costo_registrar/, status: [403] }] });
      }
      for (const rol of ['sinperfil', 'api']) {
        await flujo(env, 'costos-api', rol, async p => {
          assert.deepEqual((await get(p, 'v_costo_cubierta', 'select=neumatico_id')).filas, []);
          assert.deepEqual((await get(p, 'costos_neumatico', 'select=id')).filas, []);
        }, { sinAcceso: true });
      }
      await flujo(env, 'costos-anon', 'global', async p => {
        assert.ok([401, 403].includes(await sinAuth(p, 'v_costo_cubierta')));
        assert.ok([401, 403].includes(await sinAuth(p, 'costos_neumatico')));
      }, { http: [{ ruta: /v_costo_cubierta|costos_neumatico/, status: [401, 403] }] });
      // Otro cliente no registra costos sobre un neumático ajeno (42501 uniforme) y la base queda intacta
      await flujo(env, 'costos-otra', 'otra', async p => {
        assert.equal((await rpc(p, 'costo_registrar', { p_neumatico_id: nid, p_concepto: 'otro', p_monto: 1 })).code, '42501');
        assert.equal((await rpc(p, 'costo_registrar', { p_neumatico_id: 99999999, p_concepto: 'otro', p_monto: 1 })).code, '42501');
      }, { http: [{ ruta: /rpc\/costo_registrar/, status: [403] }] });
      assert.equal(json(env, `select count(*)::int n from public.costos_neumatico where neumatico_id = ${nid}`)[0].n, 1);

      // Panel: el costo y el CPK de la vista, y «Registrar costo» por la interfaz
      await flujo(env, 'costos-panel', 'global', async p => {
        await abrirDetallePorMatricula(p, 'E2ECP01');
        await p.click('#vd-diagrama .vd-rueda[data-pos="1"]');
        await p.esperar(`document.querySelector('#vd-panel').classList.contains('abierto') && document.querySelector('[data-action="detalleRegistrarCosto"]')`, { que: 'panel con costo' });
        let t = await panel(p);
        assert.ok(t.includes('Costo UYU 1.200,00') && t.includes('Costo por km UYU 0,120 por km'), t);
        await p.click('[data-action="detalleRegistrarCosto"]');
        await p.esperar(`document.querySelector('#modal-costo').classList.contains('show')`, { que: 'formulario de costo' });
        await p.eval(`document.querySelector('#costo-concepto').value = 'recauchutado'; document.querySelector('#costo-monto').value = '300'; true`);
        await p.click('#costo-guardar');
        await p.esperar(`!document.querySelector('#modal-costo').classList.contains('show') && document.querySelector('#vd-panel').innerText.includes('1.500,00')`, { que: 'costo registrado y panel recargado' });
        t = await panel(p);
        assert.ok(t.includes('Costo UYU 1.500,00') && t.includes('UYU 0,150 por km'), t);
      });
      assert.equal(json(env, `select count(*)::int n from public.audit_log where entidad = 'costos_neumatico' and accion = 'INSERT' and despues->>'neumatico_id' = '${nid}' and despues->>'concepto' = 'recauchutado'`)[0].n, 1);
      // Agregado: muestra baja (menos de 5 neumáticos)
      await flujo(env, 'costos-grupo', 'global', async p => {
        const r = await rpc(p, 'cpk_por_grupo', { p_grupo: 'marca' });
        const m = (r.data || []).find(x => x.clave === 'Michelin');
        assert.ok(m, 'hay grupo Michelin');
      });
    } finally {
      env.sql(`delete from public.eventos_neumatico where vehiculo_id = ${veh}`);
      env.sql(`delete from public.neumaticos where vehiculo_id = ${veh}`);
      env.sql(`delete from public.vehiculos where id = ${veh}`);
    }
  });
}
