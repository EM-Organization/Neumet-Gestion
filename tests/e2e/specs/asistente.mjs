// Asistente de reportes de punta a punta con la base real: la Edge Function `asistente-reportes` corre con su handler y su
// `rest.ts` reales (servidor_e2e.ts, contrato C4) contra PostgREST y las migraciones reales, con un modelo guionado en lugar
// de OpenRouter. Lo que se prueba es lo que garantiza la base por rol: el asistente no trae otro cliente aunque el modelo lo
// pida, la sucursal no ve costos, la cuota de 30 corta con 429 y el uso queda registrado. Después, el panel en Reportes (C5).
// Contratos C2, C4 y C5 del plan de la oleada 2026-11-27-reportes-ia. Requiere `deno` en el PATH: en local se omite con motivo
// si falta; en CI (`CI` definido) falta y falla.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../lib/postgres.mjs';
import { USERS } from '../lib/config.mjs';
import { flujo, irA, texto, dormir } from '../lib/flujo.mjs';
import { json, vehiculosVisibles } from '../lib/verdad.mjs';

const RUTA = '/functions/v1/asistente-reportes';
const DIR_FUNCION = 'supabase/functions/asistente-reportes';
const CLAVE = 'clave-publica-de-prueba';
const hayDeno = (() => { const r = spawnSync('deno', ['--version']); return !r.error && r.status === 0; })();
const motivo = hayDeno || process.env.CI ? false : 'sin deno en el PATH: el asistente se prueba con su Edge Function (CI lo instala)';

let proceso = null;
let arranque = null;

// Levanta una sola vez el servidor de la función (C4) y lo enlaza al proxy del web. Usa un entorno limpio: el spec nunca pasa
// `OPENROUTER_API_KEY` ni otras claves del equipo al proceso.
function funcion(env) {
  if (!arranque) arranque = arrancar(env);
  return arranque;
}

async function arrancar(env) {
  if (!hayDeno) throw new Error('deno no está en el PATH: el asistente de reportes necesita su Edge Function para esta prueba');
  proceso = spawn('deno', ['run', '--allow-net', '--allow-env', '--allow-read', `${DIR_FUNCION}/servidor_e2e.ts`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.DENO_DIR ? { DENO_DIR: process.env.DENO_DIR } : {}),
      SUPABASE_URL: env.web.origin, SUPABASE_ANON_KEY: CLAVE, ALLOWED_ORIGINS: env.web.origin, PORT: '0'
    }
  });
  let salida = '';
  let errores = '';
  proceso.stderr.on('data', d => { errores += d; });
  const puerto = await new Promise((ok, ko) => {
    const tope = setTimeout(() => ko(new Error(`servidor_e2e no dijo LISTO en 20 s:\n${errores}`)), 20000);
    proceso.stdout.on('data', d => {
      salida += d;
      const m = salida.match(/LISTO (\d+)/);
      if (m) { clearTimeout(tope); ok(Number(m[1])); }
    });
    proceso.on('exit', código => { clearTimeout(tope); ko(new Error(`servidor_e2e salió con código ${código}:\n${errores}`)); });
  });
  env.web.fijarFunciones(`http://127.0.0.1:${puerto}`);
  return puerto;
}

// Una llamada HTTP a la función por el web (como la haría el panel): Bearer del rol, o ninguno si `sinBearer`.
async function preguntar(env, { rol, pregunta = '¿Qué vehículos hay?', clienteId = null, sinBearer = false, cuerpo }) {
  const token = sinBearer ? null : env.sesion(rol).jwt;
  const r = await fetch(env.web.origin + RUTA, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: CLAVE, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo ?? { pregunta, historial: [], cliente_id: clienteId })
  });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

const patentesDe = (env, condicion) => json(env, `select v.patente from public.vehiculos v where ${condicion} and v.activo and v.patente is not null`).map(f => f.patente);
const idCliente = (env, nombre) => Number(env.sql(`select id from public.clientes where nombre = '${nombre}'`));

// La fila de uso la cierra la función; si la respuesta llega antes que el cierre, se espera hasta 5 s.
async function ultimaFila(env, sub) {
  for (let i = 0; i < 50; i++) {
    const [f] = json(env, `select resultado, modelo, prompt_version from public.asistente_uso where user_id = '${sub}' order by id desc limit 1`);
    if (f && f.resultado !== 'en_curso') return f;
    await dormir(100);
  }
  throw new Error('la fila de uso no se cerró en 5 s');
}

export function registrar(env) {
  after(() => {
    env.web.fijarFunciones(null);
    if (proceso) proceso.kill('SIGTERM');
  });

  test('Asistente de reportes: sin sesión 401; sin perfil o rol api 403; admin sin cliente 400', { skip: motivo }, async () => {
    await funcion(env);
    assert.equal((await preguntar(env, { rol: 'global', sinBearer: true })).status, 401);
    for (const rol of ['sinperfil', 'api']) {
      const r = await preguntar(env, { rol });
      assert.equal(r.status, 403, rol);
      assert.equal(r.cuerpo.ok, false, rol);
    }
    const admin = await preguntar(env, { rol: 'admin', clienteId: null });
    assert.equal(admin.status, 400);
    assert.equal(admin.cuerpo.error, 'cliente_requerido');
  });

  test('Asistente de reportes: cada rol recibe de la base solo su alcance, aunque el modelo pida otro cliente', { skip: motivo }, async () => {
    await funcion(env);
    const demo = idCliente(env, 'Demo Transportes');
    const pDemo = patentesDe(env, `v.cliente_id = ${demo}`);
    const pOtra = patentesDe(env, `v.cliente_id = ${idCliente(env, 'Otra Empresa SA')}`);
    assert.ok(pDemo.length > 0 && pOtra.length > 0, 'hay flota en ambos clientes (si no, la prueba no distingue nada)');

    // Admin con el cliente Demo: ve la flota de Demo y ninguna patente de otra empresa
    const a = await preguntar(env, { rol: 'admin', clienteId: demo, pregunta: '[[tool:vehiculos_listar {"limite":200}]]' });
    assert.equal(a.status, 200);
    assert.equal(a.cuerpo.ok, true);
    const tA = JSON.stringify(a.cuerpo);
    assert.ok(pDemo.some(p => tA.includes(p)), 'el admin ve la flota del cliente elegido');
    assert.ok(!pOtra.some(p => tA.includes(p)), 'la respuesta del admin no trae la flota de otra empresa');

    // Global de Demo pide alertas de Otra Empresa: el cliente_id del modelo se ignora
    const g = await preguntar(env, { rol: 'global', pregunta: `[[tool:alertas_activas {"limite":200,"cliente_id":${idCliente(env, 'Otra Empresa SA')}}]]` });
    assert.equal(g.status, 200);
    assert.equal(g.cuerpo.fuentes[0].tool, 'alertas_activas');
    assert.ok(!pOtra.some(p => JSON.stringify(g.cuerpo).includes(p)), 'global no ve patentes de otra empresa');

    // Sucursal Salto: solo patentes de Salto, ninguna exclusiva de Montevideo
    const salto = vehiculosVisibles(env, 'salto').map(v => v.patente).filter(Boolean);
    const soloMvd = vehiculosVisibles(env, 'montevideo').map(v => v.patente).filter(p => !salto.includes(p));
    assert.ok(salto.length > 0 && soloMvd.length > 0, 'hay flota en Salto y en Montevideo');
    const s = await preguntar(env, { rol: 'salto', pregunta: '[[tool:estado_flota {"limite":200}]]' });
    assert.equal(s.status, 200);
    const tS = JSON.stringify(s.cuerpo);
    assert.ok(salto.some(p => tS.includes(p)), 'la sucursal ve su flota');
    assert.ok(!soloMvd.some(p => tS.includes(p)), 'la sucursal no ve la flota de Montevideo');

    // Costos: la sucursal recibe «sin_permiso» y ningún costo; el global, el costo total y la fuente
    const sc = await preguntar(env, { rol: 'salto', pregunta: '[[tool:cpk_por_grupo {"grupo":"marca"}]]' });
    assert.equal(sc.status, 200);
    assert.ok(JSON.stringify(sc.cuerpo).includes('sin_permiso'));
    assert.ok(!JSON.stringify(sc.cuerpo).includes('costo_total'), 'la sucursal no recibe costos');
    const gc = await preguntar(env, { rol: 'global', pregunta: '[[tool:cpk_por_grupo {"grupo":"marca"}]]' });
    assert.equal(gc.status, 200);
    assert.ok(JSON.stringify(gc.cuerpo).includes('costo_total'));
    assert.equal(gc.cuerpo.fuentes[0].tool, 'cpk_por_grupo');
  });

  test('Asistente de reportes: la cuota de 30 corta con 429 y la pregunta permitida queda registrada', { skip: motivo }, async () => {
    await funcion(env);
    const mvd = USERS.montevideo.sub;
    env.sql(`insert into public.asistente_uso (user_id, cliente_id, dia, resultado)
      select '${mvd}', ${idCliente(env, 'Demo Transportes')}, (now() at time zone 'America/Montevideo')::date, 'ok' from generate_series(1, 30)`);
    try {
      const r = await preguntar(env, { rol: 'montevideo' });
      assert.equal(r.status, 429);
      assert.equal(r.cuerpo.error, 'cuota');
      assert.deepEqual(r.cuerpo.cuota, { usadas: 30, limite: 30 });
    } finally {
      env.sql(`delete from public.asistente_uso where user_id = '${mvd}'`);
    }

    const g = await preguntar(env, { rol: 'global', pregunta: '[[tool:vehiculos_listar {"limite":5}]]' });
    assert.equal(g.status, 200);
    const fila = await ultimaFila(env, USERS.global.sub);
    assert.equal(fila.resultado, 'ok');
    assert.equal(fila.modelo, 'guion/e2e');
    assert.ok(fila.prompt_version, 'queda la versión del prompt');
  });

  test('Asistente de reportes: en Reportes el global pregunta y ve la respuesta; el admin sin cliente no puede preguntar', { skip: motivo }, async () => {
    await funcion(env);
    await flujo(env, 'asistente-global', 'global', async p => {
      await irA(p, 'reportes');
      await p.esperar(`document.querySelector('#asis-pregunta') && !document.querySelector('#asis-pregunta').disabled`, { que: 'campo de pregunta del asistente' });
      await p.escribir('#asis-pregunta', '[[tool:vehiculos_listar {"limite":5}]]');
      await p.enter();
      await p.esperar(`[...document.querySelectorAll('.asis-respuesta')].some(e => e.innerText.includes('Resultado:'))`, { que: 'respuesta del asistente', ms: 30000 });
    });
    await flujo(env, 'asistente-admin', 'admin', async p => {
      await irA(p, 'reportes');
      await p.esperar(`document.querySelector('#asis-pregunta') && document.querySelector('#asis-pregunta').disabled`, { que: 'pregunta deshabilitada sin cliente' });
      assert.match(await texto(p, '#rep-asistente'), /Elegir un cliente/);
    });
  });
}
