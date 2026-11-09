// Tasa de desgaste (mm/semana) de v_estado_neumaticos, leída por PostgREST con RLS como llega al panel:
//   * solo existe con al menos 3 mediciones y 14 días entre la primera y la última de la ventana (reiniciada por
//     reencauche, reparación o montaje del neumático); nunca es negativa;
//   * dos mediciones a pocas horas que cruzan la medianoche UTC no dan una tasa;
//   * la ficha del vehículo y Inicio solo marcan «desgaste mayor al normal» con tasa válida.
// Comprueba contra un cálculo independiente en SQL (v_mediciones_neumatico + eventos_neumatico).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { json } from '../lib/verdad.mjs';

async function leerVista(env, rol, query) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${env.rest.base}/v_estado_neumaticos?${query}`, {
      headers: { Authorization: `Bearer ${env.sesion(rol).jwt}`, Range: `${desde}-${desde + 999}`, 'Range-Unit': 'items' },
    });
    assert.ok(r.ok, `v_estado_neumaticos como ${rol}: ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const ORACULO = `
  with h as (
    select m.vehiculo_id, m.posicion_actual as posicion, m.created_at, m.promedio,
           coalesce((select max(e.created_at) from public.eventos_neumatico e
                      where e.neumatico_id = m.neumatico_id and e.tipo in ('reencauche', 'reparacion', 'montaje')), '-infinity') as reinicio
      from public.v_mediciones_neumatico m
     where m.estado_montaje = 'montado' and m.created_at >= now() - interval '90 days')
  select vehiculo_id, posicion,
         case when count(*) filter (where created_at >= reinicio) >= 3
               and extract(epoch from max(created_at) filter (where created_at >= reinicio)
                                    - min(created_at) filter (where created_at >= reinicio)) >= 14 * 86400
               and regr_slope(promedio::float8, extract(epoch from created_at)) filter (where created_at >= reinicio) < 0
              then round((-regr_slope(promedio::float8, extract(epoch from created_at)) filter (where created_at >= reinicio) * 604800)::numeric, 3)
         end as tasa
    from h group by vehiculo_id, posicion`;

export function registrar(env) {
  test('Tasa de desgaste: la API entrega la tasa solo con ≥3 mediciones y ≥14 días, sin valores negativos', async () => {
    const esperado = new Map(json(env, ORACULO).map(r => [`${r.vehiculo_id}|${r.posicion}`, r.tasa]));
    for (const rol of ['admin', 'global']) {
      const filas = await leerVista(env, rol, 'select=vehiculo_id,posicion,tasa_mm_semana,semanas_hasta_critico,n_mediciones_90d');
      assert.ok(filas.length > 100, `${rol}: filas de la vista`);
      const conTasa = filas.filter(f => f.tasa_mm_semana !== null);
      assert.ok(conTasa.length > 50, `${rol}: el demo trae tasas`);
      assert.ok(filas.every(f => f.tasa_mm_semana === null || Number(f.tasa_mm_semana) >= 0), `${rol}: sin tasas negativas`);
      const malas = filas.filter(f => {
        const e = esperado.get(`${f.vehiculo_id}|${f.posicion}`);
        return (f.tasa_mm_semana === null ? null : Number(f.tasa_mm_semana)) !== (e === undefined || e === null ? null : Number(e));
      });
      assert.deepEqual(malas.slice(0, 5), [], `${rol}: tasa distinta del cálculo independiente`);
      assert.ok(filas.every(f => f.tasa_mm_semana !== null || f.semanas_hasta_critico === null), `${rol}: sin semanas hasta crítico sin tasa`);
    }
  });

  test('Tasa de desgaste: dos mediciones a 2 h que cruzan la medianoche UTC y dos a 24 h no dan tasa', async () => {
    const patente = 'TASA01';
    env.sql(`insert into public.vehiculos (cliente_id, nombre, patente, activo) values ((select id from public.clientes where nombre = 'Demo Transportes'), 'TASA01', '${patente}', true)`);
    try {
      const vid = Number(env.sql(`select id from public.vehiculos where patente = '${patente}'`));
      env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
               select ${vid}, cliente_id, p, 'TASA01-' || p, 'montado', 'T' from public.vehiculos, generate_series(1, 2) p where id = ${vid}`);
      env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
               select ${vid}, v.cliente_id, 1, 'TASA01-1', x.mm, x.mm, x.mm, x.ts
                 from public.vehiculos v,
                      (values (12.0, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '25 hours'),
                              (11.8, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '23 hours')) x(mm, ts)
                where v.id = ${vid}`);
      env.sql(`insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
               select ${vid}, v.cliente_id, 2, 'TASA01-2', x.mm, x.mm, x.mm, now() - x.h * interval '1 hour'
                 from public.vehiculos v, (values (12.0, 24), (11.7, 0)) x(mm, h) where v.id = ${vid}`);
      const filas = await leerVista(env, 'global', `select=posicion,tasa_mm_semana,semanas_hasta_critico,n_mediciones_90d&vehiculo_id=eq.${vid}&order=posicion`);
      assert.equal(filas.length, 2);
      for (const f of filas) {
        assert.equal(f.n_mediciones_90d, 2);
        assert.equal(f.tasa_mm_semana, null, `posición ${f.posicion}: sin tasa con 2 mediciones`);
        assert.equal(f.semanas_hasta_critico, null);
      }
      const alertas = await (await fetch(`${env.rest.base}/v_alertas?vehiculo_id=eq.${vid}`, { headers: { Authorization: `Bearer ${env.sesion('global').jwt}` } })).json();
      assert.deepEqual(alertas, [], 'sin alerta crítica: 12 mm con mediciones insuficientes');
    } finally {
      env.sql(`with v as (select id from public.vehiculos where patente = '${patente}'),
                    m as (delete from public.mediciones where vehiculo_id in (select id from v)),
                    n as (delete from public.neumaticos where vehiculo_id in (select id from v))
               delete from public.vehiculos where id in (select id from v)`);
    }
  });
}
