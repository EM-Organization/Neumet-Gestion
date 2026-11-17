// guardar_montaje_mm crea el vehículo y sus neumáticos (migración 20261121000000) contra Postgres + PostgREST reales.
// La RPC se llama por la API REST con el JWT de cada rol: solo service_role puede; el cliente A no crea ni toca el B.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { signJwt } from '../lib/jwt.mjs';
import { JWT_SECRET, USERS } from '../lib/config.mjs';

export function registrar(env) {
  test('API proveedor: patente nueva crea vehículo + neumáticos + mediciones; replay no duplica; roles y clientes aislados', async () => {
    const A = Number(env.sql(`select id from public.clientes where nombre = 'Demo Transportes'`));
    const B = Number(env.sql(`insert into public.clientes (nombre) values ('E2E Alta API B') returning id`).split('\n')[0]);
    const cuenta = randomUUID();
    const servicio = signJwt({ sub: USERS.api.sub, role: 'service_role' }, JWT_SECRET);
    const llamar = async (jwt, args) => {
      const r = await fetch(`${env.rest.base}/rpc/api_guardar_montaje`, {
        method: 'POST',
        headers: { apikey: 'x', Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify(args)
      });
      return { status: r.status, cuerpo: await r.json().catch(() => null) };
    };
    const args = (cli, pat, items, clave) => ({
      p_cliente_id: cli, p_cuenta: cuenta, p_patente: pat, p_montajes: items,
      p_sesion: randomUUID(), p_clave: clave, p_hash: 'h-' + clave
    });
    const n = (sql) => Number(env.sql(sql));
    const vehA = `(select id from public.vehiculos where patente_norm = 'E2ECREA1' and cliente_id = ${A})`;
    try {
      // Roles sin service_role no ejecutan la RPC (ni crean nada).
      for (const rol of ['admin', 'global', 'api', 'sinperfil']) {
        const jwt = signJwt({ sub: USERS[rol].sub, role: 'authenticated' }, JWT_SECRET);
        const r = await llamar(jwt, args(A, 'E2ECREA1', [{ posicion: 1, mm1: 9, mm2: 9, mm3: 9 }], 'x-' + rol));
        assert.ok([401, 403, 404].includes(r.status), `rol ${rol}: sin permiso (status ${r.status})`);
      }
      assert.equal(n(`select count(*) from public.vehiculos where patente_norm = 'E2ECREA1'`), 0);

      // Alta con service_role (como la Edge Function).
      const items = [
        { posicion: 1, mm1: 9, mm2: 8, mm3: 8 }, { posicion: 12, mm1: 7, mm2: 7, mm3: 7 },
        { posicion: 99, mm1: 6, mm2: 6, mm3: 6 }, { posicion: 2, mm1: 50, mm2: 8, mm3: 8 }
      ];
      const r1 = await llamar(servicio, args(A, ' e2e crea1 ', items, 'crea-1'));
      assert.equal(r1.status, 200);
      assert.equal(r1.cuerpo.estado, 'ok');
      assert.equal(r1.cuerpo.creado, true);
      assert.equal(r1.cuerpo.neumaticos_creados, 3);
      assert.deepEqual(r1.cuerpo.resultados.map(x => `${x.posicion}:${x.guardado}`), ['1:true', '12:true', '99:true', '2:false']);
      assert.equal(env.sql(`select cliente_id || '|' || tipo_ruedas || '|' || coalesce(sucursal_id::text,'-') || '|' || coalesce(patente,'?')
        from public.vehiculos where patente_norm = 'E2ECREA1'`), `${A}|16|-|E2ECREA1`,
        'cliente de la cuenta, tipo 16 por la posición 12, sin sucursal');
      assert.equal(env.sql(`select string_agg(posicion || ':' || auxilio || ':' || coalesce(marca,'-') || ':' || coalesce(precio_unidad::text,'-'), ',' order by posicion)
        from public.neumaticos where vehiculo_id = ${vehA}`), '1:false:-:-,12:false:-:-,99:true:-:-');
      assert.equal(n(`select count(*) from public.mediciones where vehiculo_id = ${vehA}`), 3);

      // Replay con la misma clave: misma respuesta, sin duplicar.
      const r2 = await llamar(servicio, args(A, ' e2e crea1 ', items, 'crea-1'));
      assert.equal(r2.cuerpo.replay, true);
      assert.equal(n(`select count(*) from public.vehiculos where patente_norm = 'E2ECREA1'`), 1);
      assert.equal(n(`select count(*) from public.mediciones where vehiculo_id = ${vehA}`), 3);

      // El cliente B con la misma patente crea el suyo; el de A queda intacto.
      const r3 = await llamar(servicio, args(B, 'E2ECREA1', [{ posicion: 1, mm1: 5, mm2: 5, mm3: 5 }], 'crea-b'));
      assert.equal(r3.cuerpo.creado, true);
      assert.equal(n(`select count(*) from public.vehiculos where patente_norm = 'E2ECREA1'`), 2);
      assert.equal(n(`select count(*) from public.mediciones where vehiculo_id = ${vehA}`), 3);

      // Ninguna posición válida: no crea nada.
      const r4 = await llamar(servicio, args(A, 'E2ECREA2', [{ posicion: 1, mm1: 50, mm2: 8, mm3: 8 }, { posicion: 99 }], 'crea-nada'));
      assert.equal(r4.cuerpo.estado, 'no_encontrado');
      assert.equal(n(`select count(*) from public.vehiculos where patente_norm = 'E2ECREA2'`), 0);
    } finally {
      env.sql(`delete from public.api_idempotencia where cuenta = '${cuenta}'`);
      env.sql(`delete from public.mediciones where vehiculo_id in (select id from public.vehiculos where patente_norm = 'E2ECREA1')`);
      env.sql(`delete from public.neumaticos where vehiculo_id in (select id from public.vehiculos where patente_norm = 'E2ECREA1')`);
      env.sql(`delete from public.vehiculos where patente_norm = 'E2ECREA1'`);
      env.sql(`delete from public.clientes where id = ${B}`);
    }
  });
}
