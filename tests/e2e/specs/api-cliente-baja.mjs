// api-proveedor y la baja de un cliente (F10 PR 5, docs/17 §8): la consulta que hace getPerfil
// (supabase_deps.ts) contra PostgREST real, con el rol de servicio, trae el deleted_at del cliente
// mediante el embed `clientes(deleted_at)`. Con el cliente vigente es nulo; con deleted_at marcado
// (lo que hace cliente_eliminar_suave, sin tocar perfiles) trae la fecha, que es lo que hace rechazar la cuenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt } from '../lib/jwt.mjs';
import { JWT_SECRET, USERS } from '../lib/config.mjs';

export function registrar(env) {
  test('API proveedor: el perfil api trae clientes.deleted_at (vigente nulo; dado de baja con fecha)', async () => {
    const servicio = signJwt({ sub: USERS.api.sub, role: 'service_role' }, JWT_SECRET);
    const getPerfil = async () => {
      const r = await fetch(`${env.rest.base}/perfiles?user_id=eq.${USERS.api.sub}&select=rol,cliente_id,clientes(deleted_at)&limit=1`,
        { headers: { apikey: 'x', Authorization: `Bearer ${servicio}` } });
      assert.equal(r.status, 200);
      return (await r.json())[0];
    };
    const original = env.sql(`select cliente_id from public.perfiles where user_id = '${USERS.api.sub}'`);
    const nuevo = env.sql(`insert into public.clientes (nombre) values ('E2E Baja API') returning id`).split('\n')[0];
    try {
      const vigente = await getPerfil();
      assert.equal(vigente.rol, 'api');
      assert.equal(Number(vigente.cliente_id), Number(original));
      assert.deepEqual(vigente.clientes, { deleted_at: null });

      env.sql(`update public.perfiles set cliente_id = ${nuevo} where user_id = '${USERS.api.sub}'`);
      env.sql(`update public.clientes set deleted_at = now() where id = ${nuevo}`);
      const baja = await getPerfil();
      assert.equal(baja.rol, 'api', 'la baja no toca el perfil');
      assert.equal(Number(baja.cliente_id), Number(nuevo));
      assert.ok(typeof baja.clientes.deleted_at === 'string', 'trae la fecha de baja');
    } finally {
      env.sql(`update public.perfiles set cliente_id = ${original} where user_id = '${USERS.api.sub}'`);
      env.sql(`delete from public.clientes where id = ${nuevo}`);
    }
  });
}
