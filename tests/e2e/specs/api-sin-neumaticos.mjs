// API de proveedor contra la base real (todas las migraciones + seed demo): motivo 'sin_neumaticos'.
// Llama a las RPC que usa la Edge Function (api_guardar_montaje / api_obtener_montaje) y comprueba que en
// ninguno de los casos rechazados se escribe en `mediciones`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function registrar(env) {
  test('API proveedor: coche sin neumáticos -> sin_neumaticos; con neumáticos -> posicion; ajeno -> vehiculo; sin escribir mediciones', () => {
    const cli = Number(env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`));
    const otro = Number(env.sql(`insert into public.clientes (nombre) values ('E2E Otro API') returning id`).split('\n')[0]);
    env.sql(`insert into public.vehiculos (cliente_id, nombre, patente) values (${cli}, 'E2E sin neumaticos', 'E2ESIN1'), (${otro}, 'E2E ajeno', 'E2EAJE1')`);
    env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado)
      select id, cliente_id, 1, 'E2E-AJE-1', 'montado' from public.vehiculos where patente = 'E2EAJE1'`);
    const cuenta = randomUUID();
    const med = () => Number(env.sql('select count(*) from public.mediciones'));
    const guardar = (pat, items, clave) => JSON.parse(env.sql(
      `select public.api_guardar_montaje(${cli}, '${cuenta}', '${pat}', '${JSON.stringify(items)}'::jsonb, '${randomUUID()}', '${clave}', 'h-${clave}')`));
    const motivos = r => r.resultados.map(x => `${x.posicion}:${x.guardado}:${x.motivo}`).join(',');
    const items = [{ posicion: 1, mm1: 9, mm2: 9, mm3: 9 }, { posicion: 2, mm1: 9, mm2: 9, mm3: 9 }];

    const m0 = med();
    const sin = guardar('E2ESIN1', items, 'e2e-sin');
    assert.equal(sin.estado, 'ok');
    assert.equal(motivos(sin), '1:false:sin_neumaticos,2:false:sin_neumaticos');
    const ajeno = guardar('E2EAJE1', items, 'e2e-aje');
    assert.equal(ajeno.estado, 'no_encontrado');
    assert.equal(motivos(ajeno), '1:false:vehiculo,2:false:vehiculo');
    assert.equal(med(), m0, 'no se escribió ninguna medición');

    // Replay idempotente: misma respuesta con replay:true y sin escribir
    const rep = guardar('E2ESIN1', items, 'e2e-sin');
    assert.equal(rep.replay, true);
    assert.equal(motivos(rep), motivos(sin));
    assert.equal(med(), m0);

    // obtener_montaje conserva el contrato
    const obt = JSON.parse(env.sql(`select public.api_obtener_montaje(${cli}, 'E2ESIN1', null)`));
    assert.equal(obt.encontrado, true);
    assert.deepEqual(obt.data, []);

    // Un coche del demo con neumáticos montados con idneumatico: posición inexistente -> posicion
    const demo = env.sql(`select v.patente from public.vehiculos v where v.cliente_id = ${cli}
      and exists (select 1 from public.neumaticos n where n.vehiculo_id = v.id and n.estado = 'montado' and n.idneumatico is not null)
      and v.patente is not null order by v.id limit 1`);
    assert.ok(demo, 'el demo trae un vehículo con neumáticos');
    const con = guardar(demo, [{ posicion: 98, mm1: 9, mm2: 9, mm3: 9 }], 'e2e-con');
    assert.equal(motivos(con), '98:false:posicion');
    assert.equal(med(), m0, 'posición inexistente: tampoco se escribe');
  });
}
