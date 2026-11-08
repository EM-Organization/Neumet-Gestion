// Contrato de consultas: lo que el front pide a PostgREST existe en la base.
//  A) Todas las peticiones reales capturadas durante los E2E (deben correr ANTES: este spec va al final).
//  B) Todas las consultas `.from('t').select('cols')` y `.rpc('f')` escritas en assets/js (análisis estático),
//     repetidas contra PostgREST aunque ningún flujo las haya ejercitado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/postgres.mjs';

// Códigos que significan "la consulta no encaja con el esquema": nunca son aceptables, ni siquiera como rechazo esperado.
const ERRORES_DE_ESQUEMA = new Set(['PGRST100', 'PGRST102', 'PGRST108', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST203', 'PGRST204', 'PGRST205', '42703', '42P01', '42883', '42601', '42P10']);

const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

export function consultasDelFront() {
  const selects = new Map(), rpcs = new Set();
  for (const f of walk(join(ROOT, 'assets/js')).filter(x => x.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    // Se omiten los select concatenados con una constante ('id,nombre,'+COLS): no son literales completos.
    for (const m of src.matchAll(/\.from\('([a-z_]+)'\)\s*\.select\('([^']*)'(?!\s*\+)/g)) selects.set(`${m[1]}?select=${m[2]}`, { tabla: m[1], cols: m[2], archivo: f.replace(`${ROOT}/`, '') });
    for (const m of src.matchAll(/\.rpc\('([a-z_]+)'/g)) rpcs.add(m[1]);
  }
  return { selects, rpcs };
}

export function registrar(env) {
  test('Contrato (A): ninguna petición real del panel falló por columna, relación o función inexistente', () => {
    const reqs = env.peticiones;
    assert.ok(reqs.length > 300, `se esperaban cientos de peticiones capturadas, hay ${reqs.length}`);
    const de_esquema = reqs.filter(r => r.error && ERRORES_DE_ESQUEMA.has(String(r.error.code)));
    assert.deepEqual(de_esquema.map(r => `${r.status} ${r.method} ${r.path}${r.search} ${JSON.stringify(r.error)}`), [], 'errores de esquema');
    const sinDeclarar = reqs.filter(r => r.status >= 400 && !r.esperada);
    assert.deepEqual(sinDeclarar.map(r => `[${r.tag}] ${r.status} ${r.method} ${r.path}`), [], '4xx/5xx que ningún flujo declaró como esperados');
    const recursos = new Set(reqs.map(r => r.path.split('?')[0]));
    for (const r of ['/vehiculos', '/neumaticos', '/mediciones', '/eventos_neumatico', '/stock_neumaticos', '/perfiles', '/clientes', '/sucursales', '/dispositivos', '/gastos',
      '/v_estado_neumaticos', '/v_alertas', '/v_salud_dispositivos', '/v_resumen_flota_cliente',
      '/rpc/neumatico_rotar', '/rpc/neumatico_cambiar', '/rpc/vehiculo_registrar_odometro', '/rpc/get_unregistered_devices',
      '/rpc/stock_cubierta_agregar', '/rpc/stock_cubierta_editar', '/rpc/stock_cubierta_mover', '/rpc/stock_cubierta_eliminar']) {
      assert.ok(recursos.has(r), `los E2E no ejercitaron ${r}`);
    }
    console.log(`# contrato (A): ${reqs.length} peticiones, ${recursos.size} recursos distintos, ${reqs.filter(r => r.status >= 400).length} rechazos esperados`);
  });

  test('Contrato (B): cada select() y rpc() escrito en assets/js existe en la base', async () => {
    const { selects, rpcs } = consultasDelFront();
    assert.ok(selects.size > 25, `análisis estático: ${selects.size} selects`);
    const auth = { Authorization: `Bearer ${env.sesion('admin').jwt}` };
    const malas = [];
    for (const [clave, q] of selects) {
      const r = await fetch(`${env.rest.base}/${q.tabla}?select=${encodeURIComponent(q.cols)}&limit=1`, { headers: auth });
      if (!r.ok) malas.push(`${q.archivo}: ${clave} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
    }
    assert.deepEqual(malas, [], 'consultas del front que PostgREST rechaza');
    const api = await (await fetch(`${env.rest.base}/`, { headers: { ...auth, Accept: 'application/openapi+json' } })).json();
    const faltan = [...rpcs].filter(f => !(api.paths && api.paths[`/rpc/${f}`]));
    assert.deepEqual(faltan, [], 'funciones rpc() del front que no existen en la API');
    console.log(`# contrato (B): ${selects.size} selects y ${rpcs.size} rpc() verificados contra PostgREST`);
  });
}
