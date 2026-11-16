import { assert, assertEquals } from 'jsr:@std/assert@1';
import { type Deps, handle, type PerfilLlamante } from './handler.ts';
import { crearLimite } from './limite.ts';

const ORIGIN = 'https://panel.example.com';

function mk(over: Partial<Deps> = {}) {
  const calls = {
    created: [] as string[],
    invited: [] as string[],
    deleted: [] as string[],
    perfiles: [] as Array<[string, number, number | null, string]>,
    logs: [] as string[],
  };
  const deps: Deps = {
    allowedOrigins: [ORIGIN],
    getUser: (t) =>
      Promise.resolve(
        t === 'admin-jwt'
          ? { id: 'admin-1' }
          : t === 'user-jwt'
          ? { id: 'u-2' }
          : t === 'emp-jwt'
          ? { id: 'emp-1' }
          : t === 'suc-jwt'
          ? { id: 'suc-1' }
          : t === 'emp8-jwt'
          ? { id: 'emp-8' }
          : null,
      ),
    getPerfil: (id) =>
      Promise.resolve(
        ({
          'admin-1': { rol: 'admin', cliente_id: null, sucursal_id: null },
          'emp-1': { rol: 'cliente', cliente_id: 7, sucursal_id: null },
          'emp-8': { rol: 'cliente', cliente_id: 8, sucursal_id: null },
          'suc-1': { rol: 'cliente', cliente_id: 7, sucursal_id: 70 },
          'api-1': { rol: 'api', cliente_id: 7, sucursal_id: null },
        } as Record<string, PerfilLlamante>)[id] ?? null,
      ),
    accesoQuitado: (e, c) => Promise.resolve(e === 'quitado@b.cl' && c === 7),
    permitirIntento: () => true,
    clienteExiste: (id) => Promise.resolve(id === 7 || id === 8),
    getSucursal: (id) =>
      Promise.resolve(id === 70 ? { id: 70, cliente_id: 7 } : id === 80 ? { id: 80, cliente_id: 8 } : null),
    createUser: (e) => (calls.created.push(e), Promise.resolve({ id: 'new-1' })),
    inviteUser: (e) => (calls.invited.push(e), Promise.resolve({ id: 'new-2' })),
    deleteUser: (id) => (calls.deleted.push(id), Promise.resolve(true)),
    insertPerfil: (u, c, s, e) => (calls.perfiles.push([u, c, s, e]), Promise.resolve(true)),
    log: (l) => calls.logs.push(JSON.stringify(l)),
    newRequestId: () => 'rid',
    ...over,
  };
  return { deps, calls };
}

function req(body: unknown, opts: { token?: string | null; origin?: string; method?: string } = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? 'emp-jwt' : opts.token;
  if (token) h.Authorization = `Bearer ${token}`;
  if (opts.origin) h.Origin = opts.origin;
  const method = opts.method ?? 'POST';
  return new Request('http://x/crear-usuario-seccional', {
    method,
    headers: h,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const ok = { cliente_id: 7, sucursal_id: 70, email: 'salto@b.cl' };
const none = (c: { created: string[]; invited: string[] }) => c.created.length + c.invited.length;

Deno.test('sin token => 401 y token inválido => 401', async () => {
  const { deps } = mk();
  assertEquals((await handle(req(ok, { token: null }), deps)).status, 401);
  assertEquals((await handle(req(ok, { token: 'basura' }), deps)).status, 401);
});
Deno.test('no admin => 403 sin crear nada', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok, { token: 'user-jwt' }), deps);
  assertEquals(r.status, 403);
  assertEquals(none(calls), 0);
  assertEquals(calls.perfiles.length, 0);
});

const invalid: Array<[string, Record<string, unknown>]> = [
  ['sucursal_id inválido', { ...ok, sucursal_id: 'x' }],
  ['email inválido', { ...ok, email: 'no-es-email' }],
  ['email con salto de línea', { ...ok, email: 'a@b.cl\nbcc:x@y.cl' }],
  ['password corto', { ...ok, password: '12345678901' }],
  ['password no string', { ...ok, password: 123456789012 }],
];
for (const [name, body] of invalid) {
  Deno.test(`validación: ${name} => 400`, async () => {
    const { deps, calls } = mk();
    const r = await handle(req(body), deps);
    assertEquals(r.status, 400);
    assertEquals(none(calls), 0);
  });
}
Deno.test('JSON inválido => 400 y cuerpo grande => 413', async () => {
  const { deps } = mk();
  assertEquals((await handle(req('{no'), deps)).status, 400);
  assertEquals((await handle(req({ ...ok, pad: 'y'.repeat(11000) }), deps)).status, 413);
});

Deno.test('sucursal inexistente => 404 (sin crear usuario)', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, sucursal_id: 99 }), deps);
  assertEquals(r.status, 404);
  assertEquals((await r.json()).error, 'Sucursal inexistente'); // el mensaje usa el término de la interfaz
  assertEquals(none(calls), 0);
});
Deno.test('sucursal de OTRO cliente => 400 (sin crear usuario)', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, sucursal_id: 80 }), deps);
  assertEquals(r.status, 400);
  assertEquals(none(calls), 0);
  assertEquals(calls.perfiles.length, 0);
});

Deno.test('alta de sucursal con password: createUser + perfil con sucursal', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 201);
  assertEquals(await r.json(), {
    ok: true,
    usuario: { user_id: 'new-1', cliente_id: 7, sucursal_id: 70, email: 'salto@b.cl', modo: 'password' },
  });
  assertEquals(calls.created, ['salto@b.cl']);
  assertEquals(calls.perfiles, [['new-1', 7, 70, 'salto@b.cl']]);
});
Deno.test('alta sin password: invitación', async () => {
  const { deps, calls } = mk();
  const r = await handle(req(ok), deps);
  assertEquals(r.status, 201);
  assertEquals(calls.invited, ['salto@b.cl']);
  assertEquals(calls.created.length, 0);
});
Deno.test('sin sucursal_id: usuario GLOBAL adicional del cliente', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ cliente_id: 7, email: 'global@b.cl' }), deps);
  assertEquals(r.status, 201);
  assertEquals(calls.perfiles, [['new-2', 7, null, 'global@b.cl']]);
});
Deno.test('compensación: fallo al insertar el perfil elimina el usuario Auth', async () => {
  const { deps, calls } = mk({ insertPerfil: () => Promise.resolve(false) });
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 500);
  assertEquals(calls.deleted, ['new-1']);
});
Deno.test('compensación cuando insertPerfil lanza (invitación)', async () => {
  const { deps, calls } = mk({ insertPerfil: () => Promise.reject(new Error('db')) });
  assertEquals((await handle(req(ok), deps)).status, 500);
  assertEquals(calls.deleted, ['new-2']);
});
Deno.test('email duplicado => 409 y no inserta perfil', async () => {
  const { deps, calls } = mk({ createUser: () => Promise.resolve({ error: 'exists' }) });
  const r = await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  assertEquals(r.status, 409);
  assertEquals(calls.perfiles.length, 0);
});
Deno.test('fallo de consulta => 500 sin crear usuario', async () => {
  const { deps, calls } = mk({ clienteExiste: () => Promise.reject(new Error('db')) });
  assertEquals((await handle(req(ok), deps)).status, 500);
  assertEquals(none(calls), 0);
});

Deno.test('CORS: origen permitido, no permitido, vacío y preflight', async () => {
  const { deps } = mk();
  const a = await handle(req(ok, { origin: ORIGIN }), deps);
  assertEquals(a.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEquals((await handle(req(ok, { origin: 'https://evil.com' }), deps)).status, 403);
  const vacio = await handle(req(ok, { origin: ORIGIN }), mk({ allowedOrigins: [] }).deps);
  assertEquals(vacio.status, 403);
  assert(vacio.headers.get('Access-Control-Allow-Origin') !== '*');
  const p = await handle(req(null, { method: 'OPTIONS', token: null, origin: ORIGIN }), deps);
  assertEquals(p.status, 204);
});
Deno.test('logs: JSON con request_id y sin datos sensibles', async () => {
  const { deps, calls } = mk();
  await handle(req({ ...ok, password: 'una-clave-larga-1' }), deps);
  const all = calls.logs.join('\n');
  assert(all.includes('"request_id":"rid"'));
  for (const s of ['salto@b.cl', 'una-clave-larga-1', 'admin-jwt']) assert(!all.includes(s));
});

// --- Administrador de empresa (docs/17 §4.2) ---
const emp = { token: 'emp-jwt' };
Deno.test('administrador de empresa: crea en SU empresa y el cliente_id sale del perfil, no del cuerpo', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ sucursal_id: 70, email: 'nuevo@b.cl' }, emp), deps);
  assertEquals(r.status, 201);
  assertEquals(calls.perfiles, [['new-2', 7, 70, 'nuevo@b.cl']]);
  // con cliente_id propio explícito también vale
  assertEquals((await handle(req({ ...ok, email: 'otro@b.cl' }, emp), deps)).status, 201);
});
Deno.test('administrador de empresa: puede crear otro administrador de empresa (sin sucursal)', async () => {
  const { deps, calls } = mk();
  assertEquals((await handle(req({ email: 'adm2@b.cl' }, emp), deps)).status, 201);
  assertEquals(calls.perfiles, [['new-2', 7, null, 'adm2@b.cl']]);
});
Deno.test('administrador de empresa con cliente_id de OTRA empresa => 403, nada se crea', async () => {
  const { deps, calls } = mk();
  const r = await handle(req({ ...ok, cliente_id: 8, sucursal_id: 80 }, emp), deps);
  assertEquals(r.status, 403);
  assertEquals(none(calls), 0);
  assertEquals(calls.perfiles.length, 0);
});
Deno.test('administrador de empresa con sucursal de otra empresa => 400', async () => {
  const { deps, calls } = mk();
  assertEquals((await handle(req({ email: 'x@b.cl', sucursal_id: 80 }, emp), deps)).status, 400);
  assertEquals(none(calls), 0);
});
Deno.test('usuario de sucursal, perfil api y sin perfil: 403, nada se crea', async () => {
  const { deps, calls } = mk();
  assertEquals((await handle(req(ok, { token: 'suc-jwt' }), deps)).status, 403);
  const api = mk({ getUser: () => Promise.resolve({ id: 'api-1' }) });
  assertEquals((await handle(req(ok), api.deps)).status, 403);
  assertEquals((await handle(req(ok, { token: 'user-jwt' }), deps)).status, 403); // sin perfil
  assertEquals(none(calls) + none(api.calls), 0);
});
Deno.test('empresa dada de baja: su administrador recibe 403 y no crea nada', async () => {
  const { deps, calls } = mk({ clienteExiste: () => Promise.resolve(false) });
  assertEquals((await handle(req({ email: 'x@b.cl' }, emp), deps)).status, 403);
  assertEquals(none(calls), 0);
});
Deno.test('el equipo Neumet (admin) recibe 403 en cualquier cliente y no crea nada (PR 10)', async () => {
  const { deps, calls } = mk();
  const admin = { token: 'admin-jwt' };
  for (const body of [ok, { ...ok, cliente_id: 8, sucursal_id: 80 }, { email: 'x@b.cl' }, { ...ok, cliente_id: 99 }]) {
    assertEquals((await handle(req(body, admin), deps)).status, 403);
  }
  assertEquals(none(calls), 0);
  assertEquals(calls.perfiles.length, 0);
});
Deno.test('el 403 del equipo Neumet llega antes que el tope de intentos y que la lectura del cuerpo', async () => {
  const { deps } = mk({ permitirIntento: () => false });
  assertEquals((await handle(req(ok, { token: 'admin-jwt' }), deps)).status, 403);
});
Deno.test('administrador de empresa: cliente_id inválido en el cuerpo => 403 (no es el suyo)', async () => {
  const { deps, calls } = mk();
  for (const cliente_id of [-1, '7', 99]) assertEquals((await handle(req({ ...ok, cliente_id }), deps)).status, 403);
  assertEquals(none(calls), 0);
});
Deno.test('administrador de empresa: sin cliente_id usa el de su perfil', async () => {
  const { deps, calls } = mk();
  assertEquals((await handle(req({ sucursal_id: 70, email: 'a@b.cl' }), deps)).status, 201);
  assertEquals(calls.perfiles[0][1], 7);
});

Deno.test('409 con acceso quitado de la misma empresa: orienta a «Reponer acceso»', async () => {
  const { deps, calls } = mk({ createUser: () => Promise.resolve({ error: 'exists' }) });
  const r = await handle(req({ email: 'quitado@b.cl', password: 'una-clave-larga-1' }, emp), deps);
  const b = await r.json();
  assertEquals(r.status, 409);
  assertEquals(b.codigo, 'acceso_quitado');
  assert(b.error.includes('Reponer acceso'));
  assertEquals(calls.perfiles.length, 0);
});
Deno.test('409 de email ajeno o sin rastro: mensaje genérico, sin pista de quién es la cuenta', async () => {
  const { deps } = mk({ createUser: () => Promise.resolve({ error: 'exists' }) });
  const r = await handle(req({ email: 'ajeno@b.cl', password: 'una-clave-larga-1' }, emp), deps);
  const b = await r.json();
  assertEquals(r.status, 409);
  assertEquals(b.error, 'Ya existe un usuario con ese email');
  assert(!('codigo' in b));
  // el mismo email quitado, pero consultado desde otra empresa (cliente 8), no orienta a reponer
  const otra = await handle(req({ email: 'quitado@b.cl', password: 'una-clave-larga-1' }, { token: 'emp8-jwt' }), deps);
  assertEquals((await otra.json()).error, 'Ya existe un usuario con ese email');
});
Deno.test('409: si la consulta de accesos_quitados falla, cae al mensaje genérico', async () => {
  const { deps } = mk({
    createUser: () => Promise.resolve({ error: 'exists' }),
    accesoQuitado: () => Promise.reject(new Error('db')),
  });
  const r = await handle(req({ email: 'quitado@b.cl', password: 'una-clave-larga-1' }, emp), deps);
  assertEquals(r.status, 409);
  assertEquals((await r.json()).error, 'Ya existe un usuario con ese email');
});

Deno.test('límite de intentos: el administrador de empresa excedido recibe 429 sin crear', async () => {
  const { deps, calls } = mk({ permitirIntento: () => false });
  assertEquals((await handle(req(ok, emp), deps)).status, 429);
  assertEquals(none(calls), 0);
});
Deno.test('crearLimite: tope por usuario en ventana deslizante', () => {
  let t = 0;
  const permitir = crearLimite(3, 1000, () => t);
  assert(permitir('a') && permitir('a') && permitir('a'));
  assert(!permitir('a'), 'el cuarto intento en la ventana se rechaza');
  assert(permitir('b'), 'otro usuario no se ve afectado');
  t = 1001;
  assert(permitir('a'), 'pasada la ventana vuelve a permitir');
});
