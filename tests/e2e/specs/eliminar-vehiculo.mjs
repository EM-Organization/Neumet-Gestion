// Eliminar vehículo (vehiculo_eliminar, apéndice U de docs/08) con la base y PostgREST reales y el JWT de cada rol.
//   * Solo el administrador de empresa (global): equipo Neumet, sucursal, otra empresa, sin perfil, api y anónimo reciben 42501.
//   * Con neumáticos: «stock» los devuelve al stock (con evento) y «baja» los da de baja; sin elegir destino no hace nada.
//   * El vehículo eliminado desaparece de la API para todos, sus datos históricos se conservan y la patente se puede reutilizar.
// Modifica la base de prueba: usa vehículos y cubiertas propios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, json } from '../lib/verdad.mjs';

async function pedir(env, rol, ruta, { metodo = 'GET', cuerpo } = {}) {
  const h = { apikey: 'x', Prefer: 'return=representation' };
  if (rol) h.Authorization = `Bearer ${env.sesion(rol).jwt}`;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(`${env.rest.base}/${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  let datos = null; try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
}
const eliminar = (env, rol, vid, destino) => pedir(env, rol, 'rpc/vehiculo_eliminar', { metodo: 'POST', cuerpo: { p_vehiculo_id: vid, p_destino_neumaticos: destino } });
const denegado = (r, msg) => assert.ok([401, 403].includes(r.status) && r.datos && r.datos.code === '42501', `${msg}: ${r.status} ${JSON.stringify(r.datos).slice(0, 160)}`);

const nuevoVehiculo = (env, patente) => Number(env.sql(`insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, activo)
  values (${DEMO}, '${patente}', '${patente}', '${patente}', 10, true) returning id`).split('\n')[0]);
const nuevoNeumatico = (env, vid, pos) => Number(env.sql(`insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema, marca, modelo, precio_unidad)
  values (${vid}, ${DEMO}, ${pos}, 'E2EV-${vid}-${pos}', 'montado', 'nuevo', 'E2EV-${vid}-${pos}', 'E2E', 'Mod', 100) returning id`).split('\n')[0]);

export function registrar(env) {
  test('Eliminar vehículo (API): solo el administrador de empresa; stock y baja; desaparece y libera la patente', async () => {
    const v1 = nuevoVehiculo(env, 'E2EEL01');
    for (const p of [1, 2]) nuevoNeumatico(env, v1, p);
    const foto = () => env.sql(`select json_build_object('v', (select count(*) from public.vehiculos where id = ${v1} and deleted_at is null),
      'n', (select count(*) from public.neumaticos where vehiculo_id = ${v1} and estado = 'montado'))`);
    const antes = foto();

    // Todos los demás roles: 42501 y nada cambia
    for (const rol of ['admin', 'salto', 'montevideo', 'otra', 'sinperfil', 'api', null]) {
      denegado(await eliminar(env, rol, v1, 'stock'), `${rol ?? 'anónimo'}: eliminar`);
    }
    assert.equal(foto(), antes, 'los rechazos no cambian nada');

    // Con neumáticos y sin destino: 22023, tampoco cambia nada
    const sinDestino = await eliminar(env, 'global', v1, null);
    assert.equal(sinDestino.datos && sinDestino.datos.code, '22023', JSON.stringify(sinDestino.datos));
    assert.equal(foto(), antes);

    // Stock: los neumáticos vuelven al stock sin vehículo ni posición
    const ok = await eliminar(env, 'global', v1, 'stock');
    assert.equal(ok.status, 200, JSON.stringify(ok.datos));
    assert.deepEqual(ok.datos, { vehiculo_id: v1, neumaticos: 2, destino: 'stock' });
    const tras = json(env, `select estado, vehiculo_id, posicion from public.neumaticos where numero_quema like 'E2EV-${v1}-%'`);
    assert.equal(tras.length, 2);
    for (const n of tras) assert.deepEqual(n, { estado: 'almacenado', vehiculo_id: null, posicion: null });

    // Desaparece de la API para todos, incluido el equipo Neumet; reintentar da «ya eliminado»
    for (const rol of ['global', 'admin']) {
      const r = await pedir(env, rol, `vehiculos?id=eq.${v1}&select=id`);
      assert.deepEqual(r.datos, [], `${rol}: no debe ver el vehículo eliminado`);
    }
    assert.equal((await eliminar(env, 'global', v1, 'stock')).datos.code, 'P0002');

    // La patente se puede reutilizar
    const v2 = nuevoVehiculo(env, 'E2EEL01');
    assert.ok(v2 > v1);

    // Baja: los neumáticos quedan en baja y el vehículo sin neumáticos se elimina directo
    const v3 = nuevoVehiculo(env, 'E2EEL03');
    nuevoNeumatico(env, v3, 1);
    const baja = await eliminar(env, 'global', v3, 'baja');
    assert.deepEqual(baja.datos, { vehiculo_id: v3, neumaticos: 1, destino: 'baja' });
    assert.equal(env.sql(`select estado from public.neumaticos where numero_quema = 'E2EV-${v3}-1'`), 'baja');
    const vacio = await eliminar(env, 'global', v2, null);
    assert.equal(vacio.status, 200, JSON.stringify(vacio.datos));
    assert.equal(vacio.datos.neumaticos, 0);
  });
}
