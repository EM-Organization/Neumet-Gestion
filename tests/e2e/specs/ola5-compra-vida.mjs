// Ola 5 de F8 con base real (T1): el alta de compra por lote lo hace el perfil global (la sucursal y el administrador
// de Neumet reciben 42501 por API), repetir la misma quema devuelve 409 sin filas nuevas, dos envíos simultáneos con la
// misma quema dejan una sola fila, la sucursal lee el DOT y la medida pero no el precio, y una cubierta de vida 3 se envía
// a recauchutar. Las cubiertas de prueba se crean en la base de prueba (se borran al salir del arnés con la base).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO } from '../lib/verdad.mjs';

const rpcApi = async (env, rol, nombre, cuerpo) => {
  const r = await fetch(`${env.rest.base}/rpc/${nombre}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.sesion(rol).jwt}`, apikey: 'x', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo)
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const leerApi = async (env, rol, ruta) => {
  const r = await fetch(`${env.rest.base}/${ruta}`, { headers: { Authorization: `Bearer ${env.sesion(rol).jwt}`, apikey: 'x' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const contar = (env, quemas) => Number(env.sql(`select count(*) from public.neumaticos where cliente_id = ${DEMO} and vehiculo_id is null and numero_quema in (${quemas.map(q => `'${q}'`).join(',')})`));
const COMUN = { marca: 'Michelin', modelo: 'X Multi Z', medida: '295/80R22.5', profundidad_inicial_mm: 16, precio: 450000, proveedor: 'Gomería Sur', factura: 'A-0001-00012345', soporte: 'OC 77' };

export function registrar(env) {
  test('ola 5: el alta por lote es solo del perfil global (la sucursal y el administrador reciben 403 por API)', async () => {
    for (const rol of ['montevideo', 'admin']) {
      const r = await rpcApi(env, rol, 'stock_cubiertas_agregar_lote', { p_comun: COMUN, p_cubiertas: [{ numero_quema: 'E5-NO-' + rol }] });
      assert.equal(r.status, 403, `${rol}: ${JSON.stringify(r.body)}`);
    }
    assert.equal(contar(env, ['E5-NO-montevideo', 'E5-NO-admin']), 0);
  });

  test('ola 5: el perfil global da de alta un lote de dos cubiertas con DOT y la base lo guarda', async () => {
    const r = await rpcApi(env, 'global', 'stock_cubiertas_agregar_lote', { p_comun: COMUN, p_cubiertas: [{ numero_quema: 'E5-1', dot: '0825' }, { numero_quema: 'E5-2' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cantidad, 2);
    assert.equal(r.body.ids.length, 2);
    assert.equal(contar(env, ['E5-1', 'E5-2']), 2);
    assert.equal(env.sql(`select dot || '|' || estado || '|' || vida from public.neumaticos where cliente_id = ${DEMO} and numero_quema = 'E5-1'`), '0825|almacenado|0');
  });

  test('ola 5: la sucursal lee dot y medida de una cubierta montada, pero no precio_unidad (privilegio por columna)', async () => {
    const ok = await leerApi(env, 'montevideo', 'neumaticos?select=dot,medida&dot=not.is.null&limit=1');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(Array.isArray(ok.body));
    const precio = await leerApi(env, 'montevideo', 'neumaticos?select=precio_unidad&limit=1');
    assert.notEqual(precio.status, 200, 'la sucursal no debe leer precio_unidad');
  });

  test('ola 5: repetir una quema ya dada de alta devuelve 409 y no añade filas', async () => {
    const antes = contar(env, ['E5-1', 'E5-2']);
    const r = await rpcApi(env, 'global', 'stock_cubiertas_agregar_lote', { p_comun: COMUN, p_cubiertas: [{ numero_quema: 'E5-1' }] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(contar(env, ['E5-1', 'E5-2']), antes);
  });

  test('ola 5: dos envíos simultáneos con la misma quema dejan una sola fila (un 200 y un 409)', async () => {
    const [a, b] = await Promise.all([
      rpcApi(env, 'global', 'stock_cubiertas_agregar_lote', { p_comun: COMUN, p_cubiertas: [{ numero_quema: 'E5-3' }] }),
      rpcApi(env, 'global', 'stock_cubiertas_agregar_lote', { p_comun: COMUN, p_cubiertas: [{ numero_quema: 'E5-3' }] })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(contar(env, ['E5-3']), 1);
  });

  test('ola 5: una cubierta de vida 3 se envía a recauchutar (la vida ya no tiene tope)', async () => {
    env.sql(`insert into public.neumaticos (cliente_id, vehiculo_id, marca, idneumatico, numero_quema, estado, condicion, vida)
      values (${DEMO}, null, 'Michelin', 'E5-V3', 'E5-V3', 'almacenado', 'nuevo', 3)`);
    const id = Number(env.sql(`select id from public.neumaticos where numero_quema = 'E5-V3' and cliente_id = ${DEMO}`));
    const r = await rpcApi(env, 'global', 'recauchutado_enviar', { p_neumatico_id: id, p_proveedor: 'Prov E5' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.estado, 'enviado');
  });
}
