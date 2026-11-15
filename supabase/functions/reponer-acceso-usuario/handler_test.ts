import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ADMIN_JWT, compuerta, llamadasAuth, Mundo, USUARIO } from '../_shared/simulado.ts';
import {
  type Deps,
  handle,
  MSG_ESTADO_DESCONOCIDO,
  MSG_PENDIENTE,
  MSG_QUITADO_PENDIENTE,
  MSG_RECARGAR,
  MSG_SUCURSAL,
} from './handler.ts';

const ORIGIN = 'https://panel.example.com';
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Mundo con el usuario ya quitado (fila 1, perfil ausente, Auth bloqueado). */
function quitado(): Mundo {
  const m = new Mundo();
  m.tienePerfil = false;
  m.baneado = true;
  m.filas.push({ id: 1, repuesta: false, aplicado: true, levantado: false });
  m.ultimoAcceso = 1;
  return m;
}

function mk(over: Partial<Deps> = {}, m = quitado()) {
  const logs: string[] = [];
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    getUser: (t) => Promise.resolve(t === ADMIN_JWT ? { id: 'admin-1' } : t === 'otro-jwt' ? { id: 'u-2' } : null),
    estado: m.estado,
    fijarBloqueo: m.fijarBloqueo,
    reponer: m.reponer,
    log: (l) => logs.push(JSON.stringify(l)),
    newRequestId: () => 'rid',
    ...over,
  };
  return { deps, m, logs };
}

function req(body: unknown, opts: { token?: string | null; origin?: string; method?: string } = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? ADMIN_JWT : opts.token;
  if (token) h.Authorization = `Bearer ${token}`;
  if (opts.origin) h.Origin = opts.origin;
  const method = opts.method ?? 'POST';
  return new Request('http://x/reponer-acceso-usuario', {
    method,
    headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const rep = { acceso_id: 1 };
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<any> => await r.json();

Deno.test('sin token => 401, token inválido => 401, método => 405', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(rep, { token: null }), deps)).status, 401);
  assertEquals((await handle(req(rep, { token: 'basura' }), deps)).status, 401);
  assertEquals((await handle(req(null, { method: 'GET' }), deps)).status, 405);
  assertEquals(m.log, []);
});

const invalidos: Array<[string, unknown]> = [
  ['sin acceso_id', {}],
  ['acceso_id cero', { acceso_id: 0 }],
  ['acceso_id string', { acceso_id: '1' }],
  ['sucursal_id inválido', { ...rep, sucursal_id: 'x' }],
  ['JSON inválido', '{no'],
];
for (const [nombre, cuerpo] of invalidos) {
  Deno.test(`validación: ${nombre} => 400 sin tocar la RPC`, async () => {
    const { deps, m } = mk();
    assertEquals((await handle(req(cuerpo), deps)).status, 400);
    assertEquals(m.log, []);
  });
}

Deno.test('reposición: RPC con el JWT del llamante, desbloqueo en Auth y marca levantada', async () => {
  const { deps, m } = mk();
  const r = await handle(req(rep), deps);
  assertEquals(r.status, 200);
  assertEquals(await json(r), { ok: true, estado: 'repuesto', user_id: USUARIO, acceso_id: 1, bloqueo_auth: false });
  assertEquals(m.log, ['rpc:reponer:1', 'unban', 'marca:levantado:1']);
  assert(!m.baneado && m.tienePerfil && m.coherente());
});

Deno.test('llamante sin permiso: 42501 => 403 y Auth sigue bloqueado', async () => {
  const { deps, m } = mk();
  const r = await handle(req(rep, { token: 'otro-jwt' }), deps);
  assertEquals(r.status, 403);
  assertEquals((await json(r)).error, MSG_RECARGAR);
  assertEquals(llamadasAuth(m.log), []);
  assert(m.baneado);
});

Deno.test('la RPC falla (sucursal borrada, 22023): el bloqueo NO se levanta', async () => {
  const { deps, m } = mk({ reponer: () => Promise.resolve({ error: { code: '22023', message: 'x' } }) });
  const r = await handle(req(rep), deps);
  const b = await json(r);
  assertEquals(r.status, 400);
  assertEquals(b.codigo, 'elegir_sucursal');
  assertEquals(b.error, MSG_SUCURSAL);
  assertEquals(llamadasAuth(m.log), []);
  assert(m.baneado);
});

Deno.test('la RPC lanza => 500 y Auth intacto', async () => {
  const { deps, m } = mk({ reponer: () => Promise.reject(new Error('red')) });
  assertEquals((await handle(req(rep), deps)).status, 500);
  assertEquals(llamadasAuth(m.log), []);
});

Deno.test('(c) ya_repuesto con Auth bloqueado (bloqueo huérfano): desbloquea', async () => {
  const m = quitado();
  m.tienePerfil = true; // repuesto antes, p. ej. por una llamada cuyo unban no llegó
  m.filas[0].repuesta = true;
  const { deps } = mk({}, m);
  const r = await handle(req(rep), deps);
  assertEquals(r.status, 200);
  assertEquals((await json(r)).estado, 'ya_repuesto');
  assert(!m.baneado && m.coherente());
});

Deno.test('Auth falla al desbloquear: informa desbloqueo pendiente y repetir (ya_repuesto) converge', async () => {
  const { deps, m } = mk();
  m.fallosAuth.push(true);
  const r = await handle(req(rep), deps);
  const b = await json(r);
  assertEquals(r.status, 502);
  assertEquals(b.codigo, 'desbloqueo_auth_pendiente');
  assertEquals(b.error, MSG_PENDIENTE);
  assertEquals(b.acceso_repuesto, true);
  assert(m.tienePerfil && m.baneado && !m.filas[0].levantado, 'perfil repuesto, Auth aún bloqueado, marca nula');

  const r2 = await handle(req(rep), deps);
  assertEquals(r2.status, 200);
  assertEquals((await json(r2)).estado, 'ya_repuesto');
  assert(!m.baneado && m.coherente());
});

Deno.test('(e) un ban que llega antes que el unban de reponer termina sin bloqueo', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'unban', compuerta: g.esperar });
  const r = handle(req(rep), deps);
  await tick();
  await m.fijarBloqueo(USUARIO, true); // ban atrasado de una baja anterior, llega ahora
  g.liberar();
  const r1 = await r; // resultado de la PRIMERA llamada, antes de cualquier otra
  assertEquals(r1.status, 200);
  assertEquals((await json(r1)).estado, 'repuesto');
  assert(!m.baneado && m.tienePerfil && m.coherente(), 'termina sin bloqueo solo por la primera llamada');
  assertEquals((await handle(req(rep), deps)).status, 200); // y repetir sigue siendo inocuo
});

Deno.test('(f, escenario A) unban de R retenido, Q2 quita de nuevo: R relee, vuelve a bloquear y responde quitado_durante_reposicion', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'unban', compuerta: g.esperar });
  const r = handle(req(rep), deps);
  await tick();
  assert(m.tienePerfil, 'R repuso: la RPC confirmó');
  // Q2: baja nueva de la fila 2 con su ban y su marca
  assertEquals((await m.quitar(ADMIN_JWT, USUARIO, null) as { data: { acceso_id: number } }).data.acceso_id, 2);
  await m.fijarBloqueo(USUARIO, true);
  await m.estado(2, 'aplicado');
  g.liberar(); // llega el unban de R
  const res = await r;
  assertEquals(res.status, 200);
  assertEquals((await json(res)).estado, 'quitado_durante_reposicion');
  assert(m.baneado && !m.tienePerfil && m.coherente(), 'Auth bloqueado, usuario sin perfil');
  assert(m.filas[1].aplicado, 'la fila 2 conserva su marca');
  assertEquals(m.filas[0].levantado, false, 'ninguna marca falsa sobre la fila 1');
});

Deno.test('(d) unban de R retenido, Q2 quita, llega el unban y falla el bloqueo de convergencia: el 502 sale del estado real (quitado), no de la reposición pedida', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'unban', compuerta: g.esperar });
  const rp = handle(req(rep), deps);
  await tick();
  await m.quitar(ADMIN_JWT, USUARIO, null); // Q2: fila 2
  await m.fijarBloqueo(USUARIO, true);
  await m.estado(2, 'aplicado');
  m.fallosAuth.push(false, true); // llega el unban de R (ok); su ban de convergencia falla
  g.liberar();
  const r = await rp;
  const b = await json(r);
  assertEquals(r.status, 502);
  assertEquals(b.codigo, 'bloqueo_auth_pendiente');
  assertEquals(b.error, MSG_QUITADO_PENDIENTE);
  assertEquals(b.acceso_cortado, true);
  assertEquals(b.acceso_repuesto, false);
  assertEquals(b.acceso_id, undefined, 'el acceso_id de R es de la baja anterior: no se ofrece para repetir');
  assert(!m.tienePerfil && !m.baneado && m.filas[1].aplicado, 'estado real: sin perfil, Auth desbloqueado, fila 2 vigente');
  assert(!JSON.stringify(b).includes('Repetir «Reponer'), 'no manda a repetir Reponer');
});

Deno.test('la lectura del estado falla tras la RPC => 502 sin afirmar quitado ni repuesto', async () => {
  const { deps } = mk({ estado: () => Promise.reject(new Error('db')) });
  const r = await handle(req(rep), deps);
  const b = await json(r);
  assertEquals(r.status, 502);
  assertEquals(b.codigo, 'estado_no_confirmado');
  assertEquals(b.error, MSG_ESTADO_DESCONOCIDO);
  assertEquals(b.acceso_repuesto, undefined);
  assertEquals(b.acceso_cortado, undefined);
});

Deno.test('RPC reponer simulada: 42501 si el acceso_id no existe o no es de este cliente', async () => {
  const m = quitado();
  // deno-lint-ignore no-explicit-any
  const r: any = await m.reponer(ADMIN_JWT, 99, null);
  assertEquals(r.error?.code, '42501');
  assert(!m.tienePerfil, 'no repuso nada');
  m.tienePerfil = true; // con perfil presente tampoco hay ya_repuesto para un acceso que no existe
  // deno-lint-ignore no-explicit-any
  assertEquals(((await m.reponer(ADMIN_JWT, 99, null)) as any).error?.code, '42501');
  m.tienePerfil = false;
  const { deps } = mk({}, m);
  assertEquals((await handle(req({ acceso_id: 99 }), deps)).status, 403);
  assertEquals(llamadasAuth(m.log), []);
});

Deno.test('(h) convergencia agotada => no_converge y repetir con el estado estable converge', async () => {
  const { deps, m } = mk();
  m.alternarEnCadaLectura = true;
  const r = await handle(req(rep), deps);
  const b = await json(r);
  assertEquals(r.status, 409);
  assertEquals(b.codigo, 'no_converge');
  m.alternarEnCadaLectura = false;
  m.tienePerfil = true;
  assertEquals((await handle(req(rep), deps)).status, 200);
  assert(!m.baneado && m.coherente());
});

Deno.test('«Reponer» repetido sobre un usuario con perfil desbloquea siempre, aunque la marca ya esté puesta', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(rep), deps)).status, 200);
  assert(m.filas[0].levantado);
  m.baneado = true; // la marca dice levantado pero Auth quedó bloqueado
  const r = await handle(req(rep), deps);
  assertEquals((await json(r)).estado, 'ya_repuesto');
  assert(!m.baneado);
});

Deno.test('CORS: origen permitido, no permitido, vacío y preflight', async () => {
  const { deps } = mk();
  const a = await handle(req(rep, { origin: ORIGIN }), deps);
  assertEquals(a.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEquals((await handle(req(rep, { origin: 'https://evil.com' }), deps)).status, 403);
  const vacio = await handle(req(rep, { origin: ORIGIN }), mk({ allowedOrigins: [] }).deps);
  assertEquals(vacio.status, 403);
  assert(vacio.headers.get('Access-Control-Allow-Origin') !== '*');
  assertEquals((await handle(req(null, { method: 'OPTIONS', token: null, origin: ORIGIN }), deps)).status, 204);
});
