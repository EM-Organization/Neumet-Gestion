import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  crearClienteModelo,
  elegirModelos,
  MODELO_PRINCIPAL_DEFECTO,
  MODELO_RESPALDO_DEFECTO,
  type PeticionModelo,
  URL_OPENROUTER,
} from './openrouter.ts';
import type { DefTool } from './contrato.ts';

const CLAVE = 'sk-prueba-XYZ-no-real';
const DEF: DefTool = {
  type: 'function',
  function: { name: 'estado_flota', description: 'd', parameters: { type: 'object' } },
};
const PETICION: PeticionModelo = { mensajes: [{ role: 'user', content: 'hola' }], tools: [DEF], forzarTexto: false };

interface Enviada {
  url: string;
  headers: Record<string, string>;
  cuerpo: Record<string, unknown>;
  senal: AbortSignal | undefined;
}

/** `fetch` simulado: registra cada petición y responde según `responder` (por número de petición, desde 1). */
function fetchFalso(responder: (e: Enviada, n: number) => Response | Promise<Response>) {
  const enviadas: Enviada[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const e: Enviada = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      cuerpo: JSON.parse(String(init?.body ?? '{}')),
      senal: init?.signal ?? undefined,
    };
    enviadas.push(e);
    return await responder(e, enviadas.length);
  }) as typeof fetch;
  return { f, enviadas };
}

const okBody = (modelo: string, contenido = 'Hola') =>
  new Response(
    JSON.stringify({
      model: modelo,
      choices: [{ message: { role: 'assistant', content: contenido } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.001 },
    }),
    { status: 200 },
  );
const estado = (status: number) => new Response(JSON.stringify({ error: { code: status, message: 'x' } }), { status });

function cliente(f: typeof fetch, log?: (l: Record<string, unknown>) => void) {
  return crearClienteModelo({ apiKey: CLAVE, principal: 'PRIN', respaldo: 'RESP', fetch: f, log });
}

Deno.test('200 normal: usa el principal y lee modelo y usage', async () => {
  const { f, enviadas } = fetchFalso(() => okBody('PRIN', 'Respuesta'));
  const r = await cliente(f).llamar(PETICION, new AbortController().signal);
  assert(r.ok);
  assertEquals(r.contenido, 'Respuesta');
  assertEquals([r.modelo, r.tokensEntrada, r.tokensSalida, r.costo, r.aviso], ['PRIN', 12, 3, 0.001, null]);
  assertEquals(enviadas.length, 1);
  const e = enviadas[0];
  assertEquals(e.url, URL_OPENROUTER);
  assertEquals(e.headers.Authorization, `Bearer ${CLAVE}`);
  assertEquals(e.headers['X-Title'], 'NEUMET');
  assertEquals(e.cuerpo.model, 'PRIN');
  assertEquals(e.cuerpo.temperature, 0.2);
  assertEquals(e.cuerpo.tool_choice, 'auto');
  assertEquals(e.cuerpo.usage, { include: true });
  assertEquals(e.cuerpo.max_tokens, 1500);
});

Deno.test('429 del principal: respaldo con aviso principal_429; la vuelta siguiente va directo al respaldo', async () => {
  const { f, enviadas } = fetchFalso((e) => (e.cuerpo.model === 'PRIN' ? estado(429) : okBody('RESP')));
  const c = cliente(f);
  const primera = await c.llamar(PETICION, new AbortController().signal);
  assert(primera.ok);
  assertEquals([primera.modelo, primera.aviso], ['RESP', 'principal_429']);
  assertEquals(enviadas.map((e) => e.cuerpo.model), ['PRIN', 'RESP']);

  const segunda = await c.llamar(PETICION, new AbortController().signal);
  assert(segunda.ok);
  assertEquals(enviadas.length, 3, 'la segunda vuelta hace una sola petición, y al respaldo');
  assertEquals(enviadas[2].cuerpo.model, 'RESP');
});

Deno.test('404, 502, 503 y error de red del principal pasan al respaldo con su aviso', async () => {
  const casos: Array<[string, (e: Enviada, n: number) => Response | Promise<Response>, string]> = [
    ['404', (e) => (e.cuerpo.model === 'PRIN' ? estado(404) : okBody('RESP')), 'principal_404'],
    ['502', (e) => (e.cuerpo.model === 'PRIN' ? estado(502) : okBody('RESP')), 'principal_502'],
    ['503', (e) => (e.cuerpo.model === 'PRIN' ? estado(503) : okBody('RESP')), 'principal_503'],
    [
      'red',
      (e) => {
        if (e.cuerpo.model === 'PRIN') return Promise.reject(new TypeError('red caída'));
        return okBody('RESP');
      },
      'principal_red',
    ],
  ];
  for (const [nombre, responder, aviso] of casos) {
    const { f, enviadas } = fetchFalso(responder);
    const r = await cliente(f).llamar(PETICION, new AbortController().signal);
    assert(r.ok, nombre);
    assertEquals(r.aviso, aviso, nombre);
    assertEquals(enviadas.length, 2, nombre);
  }
});

Deno.test('400 del principal: peticion sin reintento', async () => {
  const { f, enviadas } = fetchFalso(() => estado(400));
  const r = await cliente(f).llamar(PETICION, new AbortController().signal);
  assertEquals(r, { ok: false, tipo: 'peticion', aviso: 'openrouter_400' });
  assertEquals(enviadas.length, 1);
});

Deno.test('401, 402 y 403 del principal: no_disponible sin reintento', async () => {
  for (const status of [401, 402, 403]) {
    const { f, enviadas } = fetchFalso(() => estado(status));
    const r = await cliente(f).llamar(PETICION, new AbortController().signal);
    assertEquals(r, { ok: false, tipo: 'no_disponible', aviso: `openrouter_${status}` });
    assertEquals(enviadas.length, 1, `status ${status}`);
  }
});

Deno.test('principal 429 y respaldo 500: fallo; respaldo 402: no_disponible', async () => {
  const dos = fetchFalso((e) => (e.cuerpo.model === 'PRIN' ? estado(429) : estado(500)));
  const r1 = await cliente(dos.f).llamar(PETICION, new AbortController().signal);
  assertEquals(r1, { ok: false, tipo: 'fallo', aviso: 'principal_429; respaldo_500' });

  const tres = fetchFalso((e) => (e.cuerpo.model === 'PRIN' ? estado(429) : estado(402)));
  const r2 = await cliente(tres.f).llamar(PETICION, new AbortController().signal);
  assertEquals(r2, { ok: false, tipo: 'no_disponible', aviso: 'principal_429; respaldo_402' });
});

Deno.test('200 con error.code 429 en el cuerpo se trata como 429 (pasa al respaldo)', async () => {
  const { f, enviadas } = fetchFalso((e) =>
    e.cuerpo.model === 'PRIN'
      ? new Response(JSON.stringify({ error: { code: 429, message: 'límite' } }), { status: 200 })
      : okBody('RESP')
  );
  const r = await cliente(f).llamar(PETICION, new AbortController().signal);
  assert(r.ok);
  assertEquals(r.aviso, 'principal_429');
  assertEquals(enviadas.length, 2);
});

Deno.test('200 sin choices[0].message: respaldo con aviso principal_vacio', async () => {
  const { f } = fetchFalso((e) =>
    e.cuerpo.model === 'PRIN' ? new Response(JSON.stringify({ choices: [] }), { status: 200 }) : okBody('RESP')
  );
  const r = await cliente(f).llamar(PETICION, new AbortController().signal);
  assert(r.ok);
  assertEquals(r.aviso, 'principal_vacio');
});

Deno.test('señal abortada: tiempo', async () => {
  const { f } = fetchFalso((e) => {
    if (e.senal?.aborted) return Promise.reject(new DOMException('abortada', 'AbortError'));
    return okBody('PRIN');
  });
  const controlador = new AbortController();
  controlador.abort();
  const r = await cliente(f).llamar(PETICION, controlador.signal);
  assertEquals(r, { ok: false, tipo: 'tiempo', aviso: 'tiempo' });
});

Deno.test('forzarTexto pone tool_choice none; sin tools no va el campo tools ni tool_choice', async () => {
  const { f, enviadas } = fetchFalso(() => okBody('PRIN'));
  const c = cliente(f);
  await c.llamar({ ...PETICION, forzarTexto: true }, new AbortController().signal);
  await c.llamar({ ...PETICION, tools: [] }, new AbortController().signal);
  assertEquals(enviadas[0].cuerpo.tool_choice, 'none');
  assertEquals(enviadas[0].cuerpo.tools, [DEF]);
  assertEquals('tools' in enviadas[1].cuerpo, false);
  assertEquals('tool_choice' in enviadas[1].cuerpo, false);
});

Deno.test('las tool_calls se devuelven con id, nombre y argumentos', async () => {
  const { f } = fetchFalso(() =>
    new Response(JSON.stringify({
      model: 'PRIN',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'estado_flota', arguments: '{"limite":5}' },
          }],
        },
      }],
    }))
  );
  const r = await cliente(f).llamar(PETICION, new AbortController().signal);
  assert(r.ok);
  assertEquals(r.llamadas, [{ id: 'call_1', nombre: 'estado_flota', argumentos: '{"limite":5}' }]);
  assertEquals(r.contenido, null);
});

Deno.test('ni la clave ni el contenido de los mensajes llegan a los logs', async () => {
  const lineas: Array<Record<string, unknown>> = [];
  const { f } = fetchFalso((e) => (e.cuerpo.model === 'PRIN' ? estado(429) : okBody('RESP')));
  const peticion: PeticionModelo = { ...PETICION, mensajes: [{ role: 'user', content: 'pregunta secreta XYZ' }] };
  await cliente(f, (l) => lineas.push(l)).llamar(peticion, new AbortController().signal);
  const todo = JSON.stringify(lineas);
  assert(!todo.includes(CLAVE));
  assert(!todo.includes('pregunta secreta XYZ'));
  assertEquals(lineas.map((l) => l.event), ['modelo_respaldo']);
});

Deno.test('elegirModelos: sin variables usa los dos por defecto', () => {
  const r = elegirModelos(() => undefined);
  assertEquals(r, { principal: MODELO_PRINCIPAL_DEFECTO, respaldo: MODELO_RESPALDO_DEFECTO, avisos: [] });
  assertEquals(r.principal, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assertEquals(r.respaldo, 'deepseek/deepseek-v4.1-flash');
});

Deno.test('elegirModelos: el principal sin :free (la variante de pago) cae al de por defecto con aviso', () => {
  const env = (n: string) => (n === 'ASISTENTE_MODELO' ? 'nvidia/nemotron-3-ultra-550b-a55b' : undefined);
  const r = elegirModelos(env);
  assertEquals(r.principal, MODELO_PRINCIPAL_DEFECTO);
  assertEquals(r.avisos, [{ event: 'modelo_principal_sin_free', modelo: 'nvidia/nemotron-3-ultra-550b-a55b' }]);
});

Deno.test('elegirModelos: un principal con :free se respeta', () => {
  const env = (n: string) => (n === 'ASISTENTE_MODELO' ? 'otro/modelo:free' : undefined);
  const r = elegirModelos(env);
  assertEquals([r.principal, r.avisos], ['otro/modelo:free', []]);
});

Deno.test('elegirModelos: un respaldo de pago cae al de por defecto', () => {
  const env = (n: string) => (n === 'ASISTENTE_MODELO_RESPALDO' ? 'nvidia/nemotron-3-ultra-550b-a55b' : undefined);
  assertEquals(elegirModelos(env).respaldo, MODELO_RESPALDO_DEFECTO);
});
