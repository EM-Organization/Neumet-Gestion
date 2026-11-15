import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ADMIN_JWT, compuerta, llamadasAuth, Mundo, USUARIO } from '../_shared/simulado.ts';
import { type Deps, handle, MSG_ESTADO_DESCONOCIDO, MSG_PENDIENTE, MSG_RECARGAR, MSG_REPUESTO_PENDIENTE } from './handler.ts';

const ORIGIN = 'https://panel.example.com';
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function mk(over: Partial<Deps> = {}, m = new Mundo()) {
  const logs: string[] = [];
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    getUser: (t) => Promise.resolve(t === ADMIN_JWT ? { id: 'admin-1' } : t === 'otro-jwt' ? { id: 'u-2' } : null),
    estado: m.estado,
    fijarBloqueo: m.fijarBloqueo,
    quitar: m.quitar,
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
  return new Request('http://x/quitar-acceso-usuario', {
    method,
    headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const baja = { user_id: USUARIO };
// deno-lint-ignore no-explicit-any
const json = async (r: Response): Promise<any> => await r.json();

Deno.test('sin token => 401, token inválido => 401, método => 405; nada llega a la RPC ni a Auth', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(baja, { token: null }), deps)).status, 401);
  assertEquals((await handle(req(baja, { token: 'basura' }), deps)).status, 401);
  assertEquals((await handle(req(null, { method: 'GET' }), deps)).status, 405);
  assertEquals(m.log, []);
});

const invalidos: Array<[string, unknown]> = [
  ['sin user_id', {}],
  ['user_id no uuid', { user_id: 'abc' }],
  ['acceso_id negativo', { ...baja, acceso_id: -1 }],
  ['acceso_id string', { ...baja, acceso_id: '3' }],
  ['JSON inválido', '{no'],
  ['cuerpo grande', { ...baja, pad: 'y'.repeat(5000) }],
];
for (const [nombre, cuerpo] of invalidos) {
  Deno.test(`validación: ${nombre} => 4xx sin tocar la RPC`, async () => {
    const { deps, m } = mk();
    const r = await handle(req(cuerpo), deps);
    assert(r.status >= 400 && r.status < 500);
    assertEquals(m.log, []);
  });
}

Deno.test('baja nueva: RPC con el JWT del llamante, bloqueo en Auth y marca aplicada', async () => {
  const { deps, m } = mk();
  const r = await handle(req(baja), deps);
  assertEquals(r.status, 200);
  assertEquals(await json(r), { ok: true, estado: 'quitado', user_id: USUARIO, acceso_id: 1, bloqueo_auth: true });
  assertEquals(m.log, ['rpc:quitar:nuevo', 'ban', 'marca:aplicado:1']);
  assert(m.coherente() && m.baneado);
});

Deno.test('llamante sin permiso: la RPC niega (42501) y no se toca Auth', async () => {
  const { deps, m } = mk();
  const r = await handle(req(baja, { token: 'otro-jwt' }), deps);
  assertEquals(r.status, 403);
  assertEquals(llamadasAuth(m.log), []);
  assert(m.tienePerfil);
});

Deno.test('reintento ciego sin acceso_id sobre un usuario ya quitado: 42501 NO es éxito, error claro, Auth intacto', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(baja), deps)).status, 200);
  m.baneado = false; // el bloqueo no quedó aplicado
  m.log.length = 0;
  const r = await handle(req(baja), deps); // sin acceso_id
  const b = await json(r);
  assertEquals(r.status, 403);
  assertEquals(b.ok, false);
  assertEquals(b.codigo, 'recargar_lista');
  assertEquals(b.error, MSG_RECARGAR);
  assert(!('estado' in b), 'no se presenta como quitado ni ya_quitado');
  assertEquals(llamadasAuth(m.log), [], 'ante 42501 no se toca Auth');
  assertEquals(m.baneado, false);
});

Deno.test('reintento con acceso_id: ya_quitado y converge con Auth aunque la marca esté puesta y Auth desbloqueado', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(baja), deps)).status, 200);
  assert(m.filas[0].aplicado);
  m.baneado = false; // marca puesta, pero Auth quedó desbloqueado
  const r = await handle(req({ ...baja, acceso_id: 1 }), deps);
  assertEquals(r.status, 200);
  assertEquals((await json(r)).estado, 'ya_quitado');
  assert(m.baneado && m.coherente());
});

Deno.test('Auth falla: la respuesta informa bloqueo pendiente con acceso_id y repetir con él converge', async () => {
  const { deps, m } = mk();
  m.fallosAuth.push(true);
  const r = await handle(req(baja), deps);
  const b = await json(r);
  assertEquals(r.status, 502);
  assertEquals(b.codigo, 'bloqueo_auth_pendiente');
  assertEquals(b.error, MSG_PENDIENTE);
  assertEquals(b.acceso_cortado, true);
  assertEquals(b.acceso_id, 1, 'el cliente puede reintentar con el acceso_id');
  assertEquals(m.filas[0].aplicado, false, 'la marca queda nula');
  assertEquals(m.tienePerfil, false, 'el acceso a datos ya está cortado');

  const r2 = await handle(req({ ...baja, acceso_id: b.acceso_id }), deps);
  assertEquals(r2.status, 200);
  assertEquals((await json(r2)).estado, 'ya_quitado');
  assert(m.baneado && m.filas[0].aplicado && m.coherente());
});

Deno.test('reintento que perdió frente a «reponer»: 42501, Auth sin tocar y el usuario queda desbloqueado', async () => {
  const { deps, m } = mk();
  assertEquals((await handle(req(baja), deps)).status, 200);
  await m.reponer(ADMIN_JWT, 1, null);
  await m.fijarBloqueo(USUARIO, false);
  m.log.length = 0;
  const r = await handle(req({ ...baja, acceso_id: 1 }), deps);
  assertEquals(r.status, 403);
  assertEquals(llamadasAuth(m.log), []);
  assert(!m.baneado && m.tienePerfil);
});

Deno.test('último administrador (23514) y acceso propio (22023): errores propios, Auth intacto', async () => {
  for (const [code, status, codigo] of [['23514', 409, 'ultimo_admin'], ['22023', 400, 'acceso_propio']] as const) {
    const { deps, m } = mk({ quitar: () => Promise.resolve({ error: { code, message: 'x' } }) });
    const r = await handle(req(baja), deps);
    assertEquals(r.status, status);
    assertEquals((await json(r)).codigo, codigo);
    assertEquals(llamadasAuth(m.log), []);
  }
});

Deno.test('la RPC lanza o devuelve un código desconocido => 500 y Auth intacto', async () => {
  const a = mk({ quitar: () => Promise.reject(new Error('red')) });
  assertEquals((await handle(req(baja), a.deps)).status, 500);
  const b = mk({ quitar: () => Promise.resolve({ error: { code: 'XX000', message: 'x' } }) });
  assertEquals((await handle(req(baja), b.deps)).status, 500);
  assertEquals(llamadasAuth(a.m.log).concat(llamadasAuth(b.m.log)), []);
});

Deno.test('carrera (a): el ban de la baja llega tarde tras «reponer»: relee, ve perfil y desbloquea', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'ban', compuerta: g.esperar });
  const q = handle(req(baja), deps);
  await tick();
  assertEquals(m.log, ['rpc:quitar:nuevo']); // la RPC confirmó y el ban está en vuelo
  await m.reponer(ADMIN_JWT, 1, null);
  await m.fijarBloqueo(USUARIO, false); // el unban de reponer llega primero
  g.liberar(); // llega el ban tardío
  const r = await q;
  assertEquals(r.status, 200);
  assertEquals((await json(r)).estado, 'repuesto_durante_baja');
  assert(!m.baneado && m.tienePerfil && m.coherente(), 'Auth termina sin bloqueo');
});

Deno.test('carrera (g, escenario B): ban de Q1 retenido, reponer y Q2; llega el ban de Q1 y no compensa', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'ban', compuerta: g.esperar });
  const q1 = handle(req(baja), deps);
  await tick();
  await m.reponer(ADMIN_JWT, 1, null);
  await m.fijarBloqueo(USUARIO, false);
  assertEquals((await handle(req(baja), deps)).status, 200); // Q2: fila 2, ban, marca
  assert(m.baneado && m.filas[1].aplicado);
  m.log.length = 0;
  g.liberar();
  const r = await q1;
  assertEquals(r.status, 200);
  assertEquals((await json(r)).estado, 'quitado');
  assert(!m.log.includes('unban'), 'no compensa desbloqueando a un usuario que Q2 ya quitó');
  assert(m.baneado && !m.tienePerfil && m.coherente());
  assertEquals(m.filas[0].aplicado, false, 'la marca de la fila 1 no se escribe tras repuesta');
  assert(m.filas[1].aplicado, 'la fila 2 conserva su marca');
});

Deno.test('convergencia agotada: 3 intentos con el estado cambiando => no_converge y repetir converge', async () => {
  const { deps, m } = mk();
  m.alternarEnCadaLectura = true;
  const r = await handle(req(baja), deps);
  const b = await json(r);
  assertEquals(r.status, 409);
  assertEquals(b.codigo, 'no_converge');
  assertEquals(b.acceso_id, 1);
  assertEquals(llamadasAuth(m.log).length, 3);

  m.alternarEnCadaLectura = false;
  m.tienePerfil = false;
  const r2 = await handle(req({ ...baja, acceso_id: b.acceso_id }), deps);
  assertEquals(r2.status, 200);
  assert(m.baneado && m.coherente());
});

Deno.test('la lectura del estado falla => error con acceso cortado, sin inventar un resultado', async () => {
  const { deps } = mk({ estado: () => Promise.reject(new Error('db')) });
  const r = await handle(req(baja), deps);
  assertEquals(r.status, 502);
  const b = await json(r);
  // No se afirma «acceso cortado» sin haberlo comprobado: la lectura falló.
  assertEquals(b.codigo, 'estado_no_confirmado');
  assertEquals(b.error, MSG_ESTADO_DESCONOCIDO);
  assertEquals(b.acceso_cortado, undefined);
});

Deno.test('(b) reintento de baja (ya_quitado) cuyo ban llega tras «reponer»: relee, ve perfil y desbloquea', async () => {
  const m = new Mundo();
  m.tienePerfil = false;
  m.filas.push({ id: 1, repuesta: false, aplicado: false, levantado: false });
  m.ultimoAcceso = 1;
  const { deps } = mk({}, m);
  const g = compuerta();
  m.retener.push({ cuando: 'ban', compuerta: g.esperar });
  const q = handle(req({ ...baja, acceso_id: 1 }), deps);
  await tick();
  assertEquals(m.log, ['rpc:quitar:1']); // ya_quitado confirmado, ban en vuelo
  await m.reponer(ADMIN_JWT, 1, null);
  await m.fijarBloqueo(USUARIO, false);
  g.liberar();
  const r = await q;
  assertEquals(r.status, 200);
  assertEquals((await json(r)).estado, 'repuesto_durante_baja');
  assert(!m.baneado && m.tienePerfil && m.coherente());
});

Deno.test('(d) ban tardío tras «reponer» y falla el desbloqueo de convergencia: el 502 sale del estado real (repuesto), no de la baja pedida', async () => {
  const { deps, m } = mk();
  const g = compuerta();
  m.retener.push({ cuando: 'ban', compuerta: g.esperar });
  const q = handle(req(baja), deps);
  await tick();
  await m.reponer(ADMIN_JWT, 1, null); // R repone y desbloquea
  await m.fijarBloqueo(USUARIO, false);
  m.fallosAuth.push(false, true); // llega el ban de Q (ok); su unban de convergencia falla
  g.liberar();
  const r = await q;
  const b = await json(r);
  assertEquals(r.status, 502);
  assertEquals(b.codigo, 'desbloqueo_auth_pendiente');
  assertEquals(b.error, MSG_REPUESTO_PENDIENTE);
  assertEquals(b.acceso_repuesto, true);
  assertEquals(b.acceso_cortado, false);
  assertEquals(b.acceso_id, 1);
  assert(m.tienePerfil && m.baneado, 'estado real: con perfil y Auth bloqueado; no hay baja nueva que repetir');
  assert(!JSON.stringify(b).includes('«quitado»'), 'no manda a repetir Quitar');
});

Deno.test('CORS: origen permitido, no permitido, vacío y preflight', async () => {
  const { deps } = mk();
  const a = await handle(req(baja, { origin: ORIGIN }), deps);
  assertEquals(a.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEquals((await handle(req(baja, { origin: 'https://evil.com' }), deps)).status, 403);
  const vacio = await handle(req(baja, { origin: ORIGIN }), mk({ allowedOrigins: [] }).deps);
  assertEquals(vacio.status, 403);
  assert(vacio.headers.get('Access-Control-Allow-Origin') !== '*');
  assertEquals((await handle(req(null, { method: 'OPTIONS', token: null, origin: ORIGIN }), deps)).status, 204);
});

Deno.test('logs: JSON con request_id y sin tokens ni emails', async () => {
  const { deps, logs } = mk();
  await handle(req(baja), deps);
  const all = logs.join('\n');
  assert(all.includes('"request_id":"rid"'));
  assert(!all.includes(ADMIN_JWT));
});
