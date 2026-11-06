import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { type Deps, generarPassword, handle } from './handler.ts';

const ORIGIN = 'https://panel.example.com';

function mk(over: Partial<Deps> = {}) {
  const calls = {
    created: [] as string[],
    pwds: [] as string[],
    deleted: [] as string[],
    perfiles: [] as string[],
    logs: [] as string[],
  };
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    getUser: (t) => Promise.resolve(t === 'admin-jwt' ? { id: 'admin-1' } : t === 'user-jwt' ? { id: 'u-2' } : null),
    isAdmin: (id) => Promise.resolve(id === 'admin-1'),
    clienteActivo: (id) => Promise.resolve(id === 7),
    contarCuentasApi: () => Promise.resolve(0),
    createUser: (e, p) => (calls.created.push(e), calls.pwds.push(p), Promise.resolve({ id: 'new-1' })),
    deleteUser: (id) => (calls.deleted.push(id), Promise.resolve(true)),
    upsertPerfilApi: (u, c) => (calls.perfiles.push(`${u}:${c}`), Promise.resolve(true)),
    log: (l) => calls.logs.push(JSON.stringify(l)),
    newRequestId: () => 'rid',
    ...over,
  };
  return { deps, calls };
}

function req(body: unknown, opts: { token?: string | null; origin?: string; method?: string } = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? 'admin-jwt' : opts.token;
  if (token) h.Authorization = `Bearer ${token}`;
  if (opts.origin) h.Origin = opts.origin;
  const method = opts.method ?? 'POST';
  return new Request('http://x/crear-cuenta-api', {
    method,
    headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const ok = { cliente_id: 7, email: 'api@b.cl' };

Deno.test('generarPassword: >= 24 caracteres y distinta cada vez', () => {
  const a = generarPassword();
  assert(a.length >= 24);
  assertNotEquals(a, generarPassword());
});
Deno.test('sin token => 401; token inválido => 401', async () => {
  const { deps } = mk();
  assertEquals((await handle(req(ok, { token: null }), deps)).status, 401);
  assertEquals((await handle(req(ok, { token: 'x' }), deps)).status, 401);
});
Deno.test('no admin => 403 y no crea nada', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok, { token: 'user-jwt' }), deps);
  assertEquals(r.status, 403);
  assertEquals(calls.created.length, 0);
});
Deno.test('solo POST', async () => {
  const { deps } = mk();
  assertEquals((await handle(req(null, { method: 'GET' }), deps)).status, 405);
});

const invalid: Array<[string, Record<string, unknown>]> = [
  ['cliente_id ausente', { email: 'a@b.cl' }],
  ['cliente_id string', { ...ok, cliente_id: '7' }],
  ['cliente_id decimal', { ...ok, cliente_id: 7.5 }],
  ['cliente_id 0', { ...ok, cliente_id: 0 }],
  ['email inválido', { ...ok, email: 'nope' }],
  ['email con salto de línea', { ...ok, email: 'a@b.cl\nbcc:x@y.cl' }],
  ['password de 15', { ...ok, password: 'a'.repeat(15) }],
  ['password no string', { ...ok, password: 1234567890123456 }],
];
for (const [name, body] of invalid) {
  Deno.test(`validación: ${name} => 400`, async () => {
    const { deps, calls } = mk();
    assertEquals((await handle(req(body), deps)).status, 400);
    assertEquals(calls.created.length, 0);
  });
}
Deno.test('JSON inválido => 400; cuerpo grande => 413', async () => {
  const { deps } = mk();
  assertEquals((await handle(req('{no'), deps)).status, 400);
  assertEquals((await handle(req({ ...ok, pad: 'y'.repeat(11000) }), deps)).status, 413);
});

Deno.test('cliente inexistente o eliminado => 404 sin crear usuario', async () => {
  const { deps, calls } = mk();
  assertEquals((await handle(req({ ...ok, cliente_id: 99 }), deps)).status, 404);
  assertEquals(calls.created.length, 0);
});
Deno.test('límite de 5 cuentas => 409', async () => {
  const { deps, calls } = mk({ contarCuentasApi: () => Promise.resolve(5) });
  const r = await handle(req(ok), deps);
  assertEquals(r.status, 409);
  assertEquals(calls.created.length, 0);
});
Deno.test('con 4 cuentas aún se puede crear', async () => {
  const { deps } = mk({ contarCuentasApi: () => Promise.resolve(4) });
  assertEquals((await handle(req(ok), deps)).status, 201);
});

Deno.test('alta sin password: genera, devuelve una vez y no-store', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok), deps);
  assertEquals(r.status, 201);
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  const j = await r.json();
  assertEquals(j.cuenta, { user_id: 'new-1', email: 'api@b.cl', cliente_id: 7 });
  assert(j.password.length >= 24);
  assertEquals(j.password, calls.pwds[0]);
  assertEquals(calls.perfiles, ['new-1:7']);
});
Deno.test('alta con password propia: no se devuelve de vuelta', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, password: 'clave-propia-muy-larga' }), deps);
  assertEquals(r.status, 201);
  assertEquals('password' in (await r.json()), false);
  assertEquals(calls.pwds, ['clave-propia-muy-larga']);
});
Deno.test('compensación: fallo del perfil borra el usuario Auth', async () => {
  const { deps, calls } = mk({ upsertPerfilApi: () => Promise.reject(new Error('db')) });
  const r = await handle(req(ok), deps);
  assertEquals(r.status, 500);
  assertEquals(calls.deleted, ['new-1']);
  assert(!('password' in await r.json()));
});
Deno.test('compensación cuando el upsert devuelve false', async () => {
  const { deps, calls } = mk({ upsertPerfilApi: () => Promise.resolve(false) });
  assertEquals((await handle(req(ok), deps)).status, 500);
  assertEquals(calls.deleted, ['new-1']);
});
Deno.test('email duplicado => 409 y no inserta perfil', async () => {
  const { deps, calls } = mk({ createUser: () => Promise.resolve({ error: 'exists' }) });
  assertEquals((await handle(req(ok), deps)).status, 409);
  assertEquals(calls.perfiles.length, 0);
});
Deno.test('fallo genérico de Auth => 500', async () => {
  const { deps } = mk({ createUser: () => Promise.resolve({ error: 'other' }) });
  assertEquals((await handle(req(ok), deps)).status, 500);
});

Deno.test('CORS: permitido, no permitido, vacío y preflight', async () => {
  const { deps } = mk();
  const r = await handle(req(ok, { origin: ORIGIN }), deps);
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEquals((await handle(req(ok, { origin: 'https://evil.com' }), deps)).status, 403);
  const { deps: d2 } = mk({ allowedOrigins: [] });
  const r2 = await handle(req(ok, { origin: ORIGIN }), d2);
  assertEquals(r2.status, 403);
  assert(r2.headers.get('Access-Control-Allow-Origin') !== '*');
  const pf = await handle(req(null, { method: 'OPTIONS', token: null, origin: ORIGIN }), deps);
  assertEquals(pf.status, 204);
});
Deno.test('logs: sin email, contraseña ni token', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok), deps);
  const pwd = (await r.json()).password;
  const all = calls.logs.join('\n');
  assert(all.includes('"request_id":"rid"'));
  for (const s of ['api@b.cl', pwd, 'admin-jwt']) assert(!all.includes(s));
});
