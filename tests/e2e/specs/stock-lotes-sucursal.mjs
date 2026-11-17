// «Lotes anteriores» de Stock (stock_neumaticos, solo lectura) y el perfil de sucursal, con la base y PostgREST reales.
// La auditoría de UX vio `Precio/ud` con rol sucursal, pero era el stub (sin RLS). Aquí se comprueba la verdad: la política
// stock_cliente_select exige perfil global, así que la sucursal no recibe NI UNA fila de lotes (ni precio_unidad por select,
// por `*`, por filtro, por orden ni embebida desde neumaticos.stock_id). Si esta prueba falla, es un hallazgo de seguridad:
// reportarlo al director (no se arregla desde el front).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, ALCANCE } from '../lib/verdad.mjs';

async function pedir(env, rol, ruta) {
  const h = { apikey: 'x' };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  const r = await fetch(`${env.rest.base}/${ruta}`, { headers: h });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
}

export function registrar(env) {
  test('Lotes anteriores: la sucursal no lee precio_unidad de stock_neumaticos (RLS por fila), el perfil global sí', async () => {
    const lote = Number(env.sql(`insert into public.stock_neumaticos (cliente_id, marca, modelo, cantidad, precio_unidad, notas)
      values (${DEMO}, 'E2ELote', 'X', 4, 777.77, 'lote-sucursal-e2e') returning id`).split('\n')[0]);
    const neu = Number(env.sql(`select n.id from public.neumaticos n join public.vehiculos v on v.id = n.vehiculo_id where ${ALCANCE.salto.veh} order by n.id limit 1`));
    const previo = env.sql(`select coalesce(stock_id::text, '') from public.neumaticos where id = ${neu}`);
    env.sql(`update public.neumaticos set stock_id = ${lote} where id = ${neu}`);
    try {
      const rutas = [
        'stock_neumaticos?select=id', 'stock_neumaticos?select=precio_unidad', 'stock_neumaticos?select=*',
        'stock_neumaticos?select=id&precio_unidad=gt.0', 'stock_neumaticos?select=id&order=precio_unidad',
        `stock_neumaticos?select=id,precio_unidad&id=eq.${lote}`,
      ];
      for (const rol of ['salto', 'montevideo']) {
        for (const ruta of rutas) {
          const r = await pedir(env, rol, ruta);
          // 200 con 0 filas (RLS) o 403/42501 (permiso de columna): ambas niegan el precio. Lo inaceptable es recibir una fila.
          assert.ok(r.status === 200 || r.status === 403, `${rol}: ${ruta} -> ${r.status}`);
          if (r.status === 200) assert.deepEqual(r.datos, [], `${rol}: ${ruta} no debe devolver lotes`);
        }
        // Embebida desde un neumático propio que apunta al lote: el lote llega null, sin precio.
        const emb = await pedir(env, rol, `neumaticos?select=id,stock_neumaticos(precio_unidad)&id=eq.${neu}`);
        if (emb.status === 200) for (const f of emb.datos) assert.ok(!f.stock_neumaticos, `${rol}: lote embebido sin RLS: ${JSON.stringify(f)}`);
        else assert.equal(emb.status, 403);
      }
      // El perfil global sí lee su lote con precio (es quien ve «Lotes anteriores»).
      const g = await pedir(env, 'global', `stock_neumaticos?select=id,precio_unidad&id=eq.${lote}`);
      assert.equal(g.status, 200);
      assert.equal(Number(g.datos[0].precio_unidad), 777.77);
    } finally {
      env.sql(`update public.neumaticos set stock_id = ${previo === '' ? 'null' : previo} where id = ${neu}`);
      env.sql(`delete from public.stock_neumaticos where id = ${lote}`);
    }
  });
}
