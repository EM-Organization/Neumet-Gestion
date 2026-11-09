// Calidad de datos con base real (RLS + PostgREST): medicion_invalidar / medicion_revalidar y la lectura de la calidad
// respetan el alcance de cada rol. Crea una medición sospechosa en un vehículo de Salto y otra en Otra Empresa SA, y
// las borra al terminar (no altera las cifras de las demás pruebas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flujo } from '../lib/flujo.mjs';
import { DEMO, json } from '../lib/verdad.mjs';

const OTRA = `(select id from public.clientes where nombre = 'Otra Empresa SA')`;
const SUC = n => `(select s.id from public.sucursales s where s.cliente_id = ${DEMO} and lower(s.nombre) = '${n}')`;
const rpc = (p, fn, args) => p.eval(`fetch('/rest/v1/rpc/${fn}', { method: 'POST', headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x', 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify(args)}) })
  .then(async r => ({ status: r.status, cuerpo: await r.json().catch(() => null) }))`);
const HTTP = [{ ruta: /rpc\/medicion_(invalidar|revalidar)/, status: [400, 403] }];
const leer = p => p.eval(`fetch('/rest/v1/mediciones?select=id,calidad&calidad=neq.valida&limit=1000', { headers: { Authorization: 'Bearer ' + window.__E2E.jwt, apikey: 'x' } })
  .then(async r => ({ status: r.status, filas: r.ok ? await r.json() : [] }))`);

export function registrar(env) {
  test('Calidad de datos: invalidar y leer respetan el aislamiento por cliente y por sucursal', async () => {
    const salto = json(env, `select id from public.vehiculos v where v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('salto')} order by id limit 1`)[0].id;
    const mont = json(env, `select id from public.vehiculos v where v.cliente_id = ${DEMO} and v.sucursal_id = ${SUC('montevideo')} order by id limit 1`)[0].id;
    const otro = json(env, `select id from public.vehiculos v where v.cliente_id = ${OTRA} order by id limit 1`)[0].id;
    const ins = (veh, cli) => {
      env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, calidad, calidad_motivo, calidad_por, calidad_at)
        values (${veh}, ${cli}, 1, 9, 9, 9, 'sospechosa', 'Prueba e2e', 'sistema', now())`);
      return json(env, `select max(id) as id from public.mediciones where calidad_motivo = 'Prueba e2e' and vehiculo_id = ${veh}`)[0].id;
    };
    const mS = ins(salto, DEMO), mM = ins(mont, DEMO), mO = ins(otro, OTRA);
    try {
      // Lectura: cada rol ve solo observaciones de su alcance
      await flujo(env, 'cal-lectura-salto', 'salto', async p => {
        const r = await leer(p);
        const ids = r.filas.map(f => f.id);
        assert.ok(ids.includes(mS) && !ids.includes(mM) && !ids.includes(mO), `salto ve ${ids}`);
      });
      await flujo(env, 'cal-lectura-global', 'global', async p => {
        const ids = (await leer(p)).filas.map(f => f.id);
        assert.ok(ids.includes(mS) && ids.includes(mM) && !ids.includes(mO), `global ve ${ids}`);
      });
      // Acciones: otra sucursal y otro cliente reciben 403/42501 uniforme y no cambian nada
      await flujo(env, 'cal-salto', 'salto', async p => {
        for (const id of [mM, mO, 999999999]) {
          const r = await rpc(p, 'medicion_invalidar', { p_medicion_id: id, p_motivo: 'Intento ajeno' });
          assert.equal(r.status, 403, `salto sobre ${id}`);
          assert.equal(r.cuerpo.code, '42501');
        }
        const sin = await rpc(p, 'medicion_invalidar', { p_medicion_id: mS, p_motivo: ' ' });
        assert.equal(sin.status >= 400 && sin.status < 500, true, 'sin motivo se rechaza');
        const ok = await rpc(p, 'medicion_invalidar', { p_medicion_id: mS, p_motivo: 'Medidor descalibrado' });
        assert.equal(ok.status, 200);
        assert.equal(ok.cuerpo.calidad, 'invalidada');
      }, { http: HTTP });
      const est = id => json(env, `select calidad from public.mediciones where id = ${id}`)[0].calidad;
      assert.equal(est(mS), 'invalidada');
      assert.equal(est(mM), 'sospechosa');
      assert.equal(est(mO), 'sospechosa');
      await flujo(env, 'cal-otra', 'otra', async p => {
        const r = await rpc(p, 'medicion_revalidar', { p_medicion_id: mS });
        assert.equal(r.status, 403);
      }, { http: HTTP });
      assert.equal(est(mS), 'invalidada');
      await flujo(env, 'cal-global', 'global', async p => {
        const r = await rpc(p, 'medicion_revalidar', { p_medicion_id: mS });
        assert.equal(r.status, 200);
        const aj = await rpc(p, 'medicion_invalidar', { p_medicion_id: mO, p_motivo: 'Intento ajeno' });
        assert.equal(aj.status, 403);
      }, { http: HTTP });
      assert.equal(est(mS), 'valida');
      const aud = Number(env.sql(`select count(*) from public.audit_log where entidad = 'mediciones' and accion in ('INVALIDAR_MEDICION','REVALIDAR_MEDICION') and entidad_id = '${mS}'`));
      assert.equal(aud, 2, 'invalidar y revalidar quedan auditados');
    } finally {
      env.sql(`delete from public.mediciones where id in (${mS}, ${mM}, ${mO})`);
    }
  });
}
