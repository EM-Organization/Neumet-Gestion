// getPerfil de producción con fetch simulado: pide el deleted_at del cliente y falla cerrado.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { crearDeps } from './supabase_deps.ts';
import { ErrorRpc, type GuardarArgs } from './types.ts';

const cfg = { url: 'https://x.supabase.co', anonKey: 'a', serviceKey: 's' };

function depsCon(respuesta: () => Response, urls: string[] = []) {
  return crearDeps(
    cfg,
    ((u: string | URL | Request) => {
      urls.push(String(u));
      return Promise.resolve(respuesta());
    }) as typeof fetch,
  );
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

Deno.test('getPerfil: la consulta trae clientes(deleted_at,odometro_obligatorio_api)', async () => {
  const urls: string[] = [];
  await depsCon(() => json([]), urls).db.getPerfil('u1');
  assert(urls[0].includes('select=rol,cliente_id,clientes(deleted_at,odometro_obligatorio_api)'), urls[0]);
});

Deno.test('getPerfil: cliente vigente -> activo; con deleted_at -> no activo', async () => {
  const vigente = await depsCon(() =>
    json([{ rol: 'api', cliente_id: 1, clientes: { deleted_at: null, odometro_obligatorio_api: false } }])
  ).db.getPerfil('u1');
  assertEquals(vigente, { rol: 'api', cliente_id: 1, cliente_activo: true, odometro_obligatorio_api: false });
  const baja = await depsCon(() =>
    json([{ rol: 'api', cliente_id: 1, clientes: { deleted_at: '2026-11-01T00:00:00Z' } }])
  ).db.getPerfil('u1');
  assertEquals(baja?.cliente_activo, false);
});

Deno.test('getPerfil: embed ausente, nulo o con otra forma -> no activo (falla cerrado)', async () => {
  for (const clientes of [undefined, null, [], {}, [{ deleted_at: null }]]) {
    const p = await depsCon(() => json([{ rol: 'api', cliente_id: 1, clientes }])).db.getPerfil('u1');
    assertEquals(p?.cliente_activo, false, JSON.stringify(clientes));
  }
});

Deno.test('getPerfil: sin fila -> null; error de PostgREST -> lanza', async () => {
  assertEquals(await depsCon(() => json([])).db.getPerfil('u1'), null);
  let lanzo = false;
  try {
    await depsCon(() => json({}, 500)).db.getPerfil('u1');
  } catch {
    lanzo = true;
  }
  assert(lanzo);
});

Deno.test('getPerfil: odometro_obligatorio_api se lee del cliente; solo true exige (default false)', async () => {
  const flag = async (clientes: unknown) =>
    (await depsCon(() => json([{ rol: 'api', cliente_id: 1, clientes }])).db.getPerfil('u1'))?.odometro_obligatorio_api;
  assertEquals(await flag({ deleted_at: null, odometro_obligatorio_api: true }), true);
  assertEquals(await flag({ deleted_at: null, odometro_obligatorio_api: false }), false);
  assertEquals(await flag({ deleted_at: null }), false);
  assertEquals(await flag({ deleted_at: null, odometro_obligatorio_api: 'true' }), false);
  // Sin embed el cliente no está activo: la cuenta se rechaza antes de mirar el flag.
  const sinEmbed = await depsCon(() => json([{ rol: 'api', cliente_id: 1, clientes: null }])).db.getPerfil('u1');
  assertEquals([sinEmbed?.cliente_activo, sinEmbed?.odometro_obligatorio_api], [false, false]);
});

const cuerpoGuardar = (a: Partial<GuardarArgs>): GuardarArgs => ({
  cliente_id: 1,
  cuenta: 'c',
  patente: 'ABCD12',
  montajes: [],
  sesion_id: 's',
  clave: 'h:x',
  hash: 'x',
  distribucion: null,
  odometro_km: null,
  ...a,
});

Deno.test('guardar: p_odometro_km va a la RPC solo si hay odómetro; sin él la llamada es la de antes', async () => {
  const enviados: Record<string, unknown>[] = [];
  const db = crearDeps(cfg, ((_u: string | URL | Request, init?: RequestInit) => {
    enviados.push(JSON.parse(String(init?.body)));
    return Promise.resolve(json({ estado: 'ok', replay: false, resultados: [] }));
  }) as typeof fetch).db;
  await db.guardar(cuerpoGuardar({ odometro_km: 123456 }));
  await db.guardar(cuerpoGuardar({ odometro_km: null }));
  assertEquals(enviados[0].p_odometro_km, 123456);
  assertFalse('p_odometro_km' in enviados[1]);
});

Deno.test('guardar: un error de la RPC conserva el SQLSTATE y el detalle; sin cuerpo JSON, SQLSTATE nulo', async () => {
  const args: GuardarArgs = {
    cliente_id: 1, cuenta: 'c', patente: 'ABCD12', montajes: [], sesion_id: 's', clave: 'k', hash: 'h',
    distribucion: null, odometro_km: null,
  };
  const error = async (resp: Response) => {
    try {
      await depsCon(() => resp).db.guardar(args);
    } catch (e) {
      return e;
    }
    return null;
  };
  const conCodigo = await error(json({ code: '22023', message: 'odometro obligatorio: indicar la lectura' }, 400));
  assert(conCodigo instanceof ErrorRpc);
  assertEquals([conCodigo.sqlstate, conCodigo.detalle.includes('odometro')], ['22023', true]);
  const sinCuerpo = await error(new Response('<html>', { status: 503 }));
  assert(sinCuerpo instanceof ErrorRpc);
  assertEquals(sinCuerpo.sqlstate, null);
});
