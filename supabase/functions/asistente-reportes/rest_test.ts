import { assertEquals } from 'jsr:@std/assert@1';
import { crearRest, getUser } from './rest.ts';

const BASE = 'https://proyecto.example';

function fetchFalso(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const registro: Array<{ url: string; init: RequestInit }> = [];
  const f = ((url: string | URL | Request, init?: RequestInit) => {
    registro.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(responder(String(url), init ?? {}));
  }) as typeof fetch;
  return { f, registro };
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.test('select: URL exacta con filtros, orden y límite codificados por URLSearchParams', async () => {
  const { f, registro } = fetchFalso(() => json([]));
  const rest = crearRest({ url: BASE, anonKey: 'anon-prueba', token: 'jwt-prueba', fetch: f });
  await rest.select({
    recurso: 'vehiculos',
    columnas: 'id,nombre',
    filtros: [['cliente_id', 'eq.5'], ['or', '(nombre.ilike.*a b*,patente.ilike.*a b*)']],
    orden: 'nombre.asc',
    limite: 50,
  });
  assertEquals(
    registro[0].url,
    `${BASE}/rest/v1/vehiculos?select=id%2Cnombre&cliente_id=eq.5&or=%28nombre.ilike.*a+b*%2Cpatente.ilike.*a+b*%29&order=nombre.asc&limit=50`,
  );
});

Deno.test('select: lleva la clave anon y el JWT del usuario, nunca otra credencial', async () => {
  const { f, registro } = fetchFalso(() => json([]));
  const rest = crearRest({ url: BASE, anonKey: 'anon-prueba', token: 'jwt-prueba', fetch: f });
  await rest.select({ recurso: 'vehiculos', columnas: 'id', filtros: [], limite: 1 });
  const cabeceras = registro[0].init.headers as Record<string, string>;
  assertEquals(cabeceras.apikey, 'anon-prueba');
  assertEquals(cabeceras.Authorization, 'Bearer jwt-prueba');
  assertEquals(cabeceras.Accept, 'application/json');
});

Deno.test('select: un 403 con code de PostgREST se devuelve con status y code', async () => {
  const { f } = fetchFalso(() => json({ code: '42501', message: 'permiso denegado' }, 403));
  const rest = crearRest({ url: BASE, anonKey: 'a', token: 't', fetch: f });
  const r = await rest.select({ recurso: 'clientes', columnas: 'id', filtros: [], limite: 1 });
  assertEquals(r, { ok: false, status: 403, code: '42501' });
});

Deno.test('select: un error de red se devuelve como status 0 sin lanzar', async () => {
  const f = (() => Promise.reject(new TypeError('red caída'))) as typeof fetch;
  const rest = crearRest({ url: BASE, anonKey: 'a', token: 't', fetch: f });
  const r = await rest.select({ recurso: 'clientes', columnas: 'id', filtros: [], limite: 1 });
  assertEquals(r, { ok: false, status: 0, code: '' });
});

Deno.test('select: un cuerpo array se devuelve como filas tal cual', async () => {
  const { f } = fetchFalso(() => json([{ id: 1 }, { id: 2 }]));
  const rest = crearRest({ url: BASE, anonKey: 'a', token: 't', fetch: f });
  const r = await rest.select({ recurso: 'clientes', columnas: 'id', filtros: [], limite: 2 });
  assertEquals(r, { ok: true, filas: [{ id: 1 }, { id: 2 }] });
});

Deno.test('rpc: POST a /rest/v1/rpc/{fn} con el cuerpo JSON', async () => {
  const { f, registro } = fetchFalso(() => json(true));
  const rest = crearRest({ url: BASE, anonKey: 'a', token: 'jwt-prueba', fetch: f });
  await rest.rpc('asistente_cerrar', { p_id: 9, p_resultado: 'ok' });
  assertEquals(registro[0].url, `${BASE}/rest/v1/rpc/asistente_cerrar`);
  assertEquals(registro[0].init.method, 'POST');
  assertEquals((registro[0].init.headers as Record<string, string>)['Content-Type'], 'application/json');
  assertEquals(registro[0].init.body, '{"p_id":9,"p_resultado":"ok"}');
});

Deno.test('rpc: un objeto que no es array se devuelve como [objeto]', async () => {
  const { f } = fetchFalso(() => json({ permitido: true, usadas: 1, limite: 30 }));
  const rest = crearRest({ url: BASE, anonKey: 'a', token: 't', fetch: f });
  const r = await rest.rpc('asistente_reservar', { p_cliente_id: null });
  assertEquals(r, { ok: true, filas: [{ permitido: true, usadas: 1, limite: 30 }] });
});

Deno.test('getUser: 200 con id devuelve el usuario', async () => {
  const { f, registro } = fetchFalso(() => json({ id: 'u-123', email: 'x' }));
  const u = await getUser(BASE, 'anon-prueba', 'jwt-prueba', f);
  assertEquals(u, { id: 'u-123' });
  assertEquals(registro[0].url, `${BASE}/auth/v1/user`);
  const cabeceras = registro[0].init.headers as Record<string, string>;
  assertEquals(cabeceras.apikey, 'anon-prueba');
  assertEquals(cabeceras.Authorization, 'Bearer jwt-prueba');
});

Deno.test('getUser: 401 devuelve null', async () => {
  const { f } = fetchFalso(() => json({ message: 'JWT inválido' }, 401));
  assertEquals(await getUser(BASE, 'anon', 'jwt-malo', f), null);
});
