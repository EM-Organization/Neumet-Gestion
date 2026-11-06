import { assert, assertEquals } from 'jsr:@std/assert@1';
import { type ClienteRow, type Deps, handle } from './handler.ts';

const ORIGIN = 'https://panel.example.com';

function mk(over: Partial<Deps> = {}) {
  const calls = { created: [] as string[], invited: [] as string[], deleted: [] as string[], logs: [] as string[] };
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    getUser: (t) => Promise.resolve(t === 'admin-jwt' ? { id: 'admin-1' } : t === 'user-jwt' ? { id: 'u-2' } : null),
    isAdmin: (id) => Promise.resolve(id === 'admin-1'),
    createUser: (e) => (calls.created.push(e), Promise.resolve({ id: 'new-1' })),
    inviteUser: (e) => (calls.invited.push(e), Promise.resolve({ id: 'new-2' })),
    deleteUser: (id) => (calls.deleted.push(id), Promise.resolve(true)),
    insertCliente: (nombre, auth) =>
      Promise.resolve<ClienteRow>({ id: 7, nombre, created_at: '2026-01-01T00:00:00Z', auth_user_id: auth }),
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
  return new Request('http://x/crear-cliente', {
    method,
    headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const ok = { nombre: 'Transportes SA', email: 'a@b.cl' };
const none = (c: { created: string[]; invited: string[] }) => c.created.length + c.invited.length;

Deno.test('sin token => 401', async () => {
  const { deps } = mk();
  assertEquals((await handle(req(ok, { token: null }), deps)).status, 401);
});
Deno.test('token inválido => 401', async () => {
  const { deps } = mk();
  assertEquals((await handle(req(ok, { token: 'basura' }), deps)).status, 401);
});
Deno.test('no admin => 403 sin detalles', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok, { token: 'user-jwt' }), deps);
  assertEquals(r.status, 403);
  assertEquals((await r.json()).error, 'Acceso denegado');
  assertEquals(none(calls), 0);
});

const invalid: Array<[string, Record<string, unknown>]> = [
  ['nombre vacío', { ...ok, nombre: '  ' }],
  ['nombre largo', { ...ok, nombre: 'x'.repeat(101) }],
  ['email inválido', { ...ok, email: 'no-es-email' }],
  ['email con salto de línea', { ...ok, email: 'a@b.cl\nbcc:x@y.cl' }],
  ['email largo', { ...ok, email: 'a'.repeat(250) + '@b.cl' }],
  ['password corto', { ...ok, password: '12345678901' }],
  ['password no string', { ...ok, password: 123456789012 }],
];
for (const [name, body] of invalid) {
  Deno.test(`validación: ${name} => 400`, async () => {
    const { deps, calls } = mk();
    const r = await handle(req(body), deps);
    assertEquals(r.status, 400);
    assertEquals((await r.json()).ok, false);
    assertEquals(none(calls), 0);
  });
}
Deno.test('JSON inválido => 400 y cuerpo grande => 413', async () => {
  const { deps } = mk();
  assertEquals((await handle(req('{no'), deps)).status, 400);
  assertEquals((await handle(req({ ...ok, pad: 'y'.repeat(11000) }), deps)).status, 413);
});

Deno.test('alta con password: createUser y forma de respuesta del panel', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 201);
  assertEquals(await r.json(), {
    ok: true,
    cliente: {
      id: 7,
      nombre: 'Transportes SA',
      created_at: '2026-01-01T00:00:00Z',
      auth_user_id: 'new-1',
      dispositivos: [],
      vehiculos: [],
    },
  });
  assertEquals(calls.created, ['a@b.cl']);
  assertEquals(calls.invited.length, 0);
});
Deno.test('alta sin password: invitación', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok), deps);
  assertEquals(r.status, 201);
  assertEquals((await r.json()).cliente.auth_user_id, 'new-2');
  assertEquals(calls.invited, ['a@b.cl']);
  assertEquals(calls.created.length, 0);
});
Deno.test('compensación: fallo al insertar cliente elimina el usuario Auth', async () => {
  const { deps, calls } = mk({ insertCliente: () => Promise.reject(new Error('db')) });
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 500);
  assertEquals(calls.deleted, ['new-1']);
  assertEquals((await r.json()).ok, false);
});
Deno.test('compensación cuando insert devuelve null (invitación)', async () => {
  const { deps, calls } = mk({ insertCliente: () => Promise.resolve(null) });
  assertEquals((await handle(req(ok), deps)).status, 500);
  assertEquals(calls.deleted, ['new-2']);
});
Deno.test('email duplicado => 409 y no inserta', async () => {
  let inserted = false;
  const { deps } = mk({
    createUser: () => Promise.resolve({ error: 'exists' }),
    insertCliente: () => (inserted = true, Promise.resolve(null)),
  });
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 409);
  assertEquals(inserted, false);
});
Deno.test('fallo genérico de Auth => 500', async () => {
  const { deps } = mk({ inviteUser: () => Promise.resolve({ error: 'other' }) });
  assertEquals((await handle(req(ok), deps)).status, 500);
});

Deno.test('CORS: origen permitido se refleja con Vary', async () => {
  const { deps } = mk();
  const r = await handle(req(ok, { origin: ORIGIN }), deps);
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEquals(r.headers.get('Vary'), 'Origin');
});
Deno.test('CORS: origen no permitido => 403', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok, { origin: 'https://evil.com' }), deps);
  assertEquals(r.status, 403);
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), null);
  assertEquals(none(calls), 0);
});
Deno.test('CORS: sin ALLOWED_ORIGINS se deniega cualquier origen (nunca *)', async () => {
  const { deps } = mk({ allowedOrigins: [] });
  const r = await handle(req(ok, { origin: ORIGIN }), deps);
  assertEquals(r.status, 403);
  assert(r.headers.get('Access-Control-Allow-Origin') !== '*');
});
Deno.test('CORS: preflight OPTIONS', async () => {
  const { deps } = mk();
  const r = await handle(req(null, { method: 'OPTIONS', token: null, origin: ORIGIN }), deps);
  assertEquals(r.status, 204);
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const allow = r.headers.get('Access-Control-Allow-Headers')!;
  assert(allow.includes('Authorization') && allow.includes('Content-Type'));
});
Deno.test('logs: JSON con request_id y sin datos sensibles', async () => {
  const { deps, calls } = mk();
  await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  const all = calls.logs.join('\n');
  assert(all.includes('"request_id":"rid"'));
  for (const s of ['a@b.cl', 'una-clave-larga-1', 'admin-jwt']) assert(!all.includes(s));
});
