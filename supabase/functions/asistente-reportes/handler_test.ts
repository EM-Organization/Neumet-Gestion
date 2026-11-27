import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createHandler, type Deps } from './handler.ts';
import type { Catalogo, Contexto, DefTool, Fuente, Rest, ResultadoRest, SalidaTool } from './contrato.ts';
import type { ClienteModelo, PeticionModelo, RespuestaModelo } from './openrouter.ts';
import { modeloGuionado } from './servidor_e2e.ts';

const ORIGEN = 'https://panel.example.com';
const TOKEN = 'jwt-bueno-secreto';
const PREGUNTA_SECRETA = 'pregunta secreta XYZ';
const DATO_TOOL = 'DATO_TOOL_SECRETO_123';
const TEXTO_MODELO = 'RESPUESTA_MODELO_SECRETA';
const DEF: DefTool = {
  type: 'function',
  function: { name: 'estado_flota', description: 'd', parameters: { type: 'object' } },
};
const FUENTE: Fuente = { tool: 'estado_flota', desde: null, hasta: null, filas: 1, recortado: false };
const RESERVA = {
  id: 77,
  cliente_id: 5,
  cliente_nombre: 'Transportes Sur',
  rol: 'global',
  sucursal_id: null,
  sucursal_nombre: null,
  costos_visibles: true,
  moneda_default: 'UYU',
  permitido: true,
  usadas: 3,
  limite: 30,
};
const MOMENTO = Date.parse('2026-11-27T15:00:00Z');

type Llamada = { role: string; tool_call_id?: string; content?: string };

type Exito = Extract<RespuestaModelo, { ok: true }>;
const texto = (t: string): Exito => ({
  ok: true,
  contenido: t,
  llamadas: [],
  modelo: 'M1',
  tokensEntrada: 10,
  tokensSalida: 5,
  costo: 0,
  aviso: null,
});
const pide = (...llamadas: Array<{ id: string; nombre: string; argumentos: string }>): Exito => ({
  ok: true,
  contenido: null,
  llamadas,
  modelo: 'M1',
  tokensEntrada: 10,
  tokensSalida: 5,
  costo: 0,
  aviso: null,
});

interface Opciones {
  reserva?: Record<string, unknown>;
  reservaCodigo?: string;
  sinModelo?: boolean;
  /** Respuestas del modelo en orden; la última se repite. Una función recibe la petición y puede avanzar el reloj. */
  modelo?: Array<RespuestaModelo | ((p: PeticionModelo) => RespuestaModelo)>;
  herramientas?: Record<string, SalidaTool>;
  cerrarFalla?: boolean;
  ahora?: () => number;
}

function montar(o: Opciones = {}) {
  const c = {
    logs: [] as string[],
    rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    peticiones: [] as PeticionModelo[],
    ejecutadas: [] as string[],
    ctxTool: [] as Contexto[],
  };
  const guion = o.modelo ?? [texto('Listo')];
  let turno = 0;
  const modelo: ClienteModelo = {
    llamar(p) {
      c.peticiones.push(p);
      const r = guion[Math.min(turno++, guion.length - 1)];
      return Promise.resolve(typeof r === 'function' ? r(p) : r);
    },
  };
  const catalogo: Catalogo = {
    promptVersion: 'v-test',
    toolsParaRol: (): DefTool[] => [DEF],
    armarPrompt: () => 'PROMPT-SISTEMA',
    ejecutarTool(nombre, _argumentos, ctx) {
      c.ejecutadas.push(nombre);
      c.ctxTool.push(ctx);
      return Promise.resolve(o.herramientas?.[nombre] ?? { contenido: `{"datos":"${DATO_TOOL}"}`, fuente: FUENTE });
    },
    aBloques: (t) => [{ tipo: 'parrafo', texto: t }],
  };
  const rest: Rest = {
    select: () => Promise.resolve<ResultadoRest>({ ok: true, filas: [] }),
    rpc(fn, args) {
      c.rpc.push({ fn, args });
      if (fn === 'asistente_reservar') {
        if (o.reservaCodigo) return Promise.resolve<ResultadoRest>({ ok: false, status: 400, code: o.reservaCodigo });
        return Promise.resolve<ResultadoRest>({ ok: true, filas: [o.reserva ?? RESERVA] });
      }
      if (fn === 'asistente_cerrar') {
        return Promise.resolve<ResultadoRest>(
          o.cerrarFalla ? { ok: false, status: 500, code: 'P0001' } : { ok: true, filas: [true] },
        );
      }
      return Promise.resolve<ResultadoRest>({ ok: false, status: 404, code: '' });
    },
  };
  const deps: Deps = {
    allowedOrigins: [ORIGEN],
    getUser: (t) => Promise.resolve(t === TOKEN ? { id: 'u-1' } : null),
    rest: () => rest,
    modelo: o.sinModelo ? null : () => modelo,
    catalogo,
    ahora: o.ahora ?? (() => MOMENTO),
    log: (l) => c.logs.push(JSON.stringify(l)),
    newRequestId: () => 'rid-1',
  };
  return { handler: createHandler(deps), c };
}

function pedir(cuerpo: unknown, o: { token?: string | null; origen?: string; metodo?: string; crudo?: string } = {}) {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = o.token === undefined ? TOKEN : o.token;
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  if (o.origen !== undefined) cabeceras.Origin = o.origen;
  return new Request('http://x/asistente-reportes', {
    method: o.metodo ?? 'POST',
    headers: cabeceras,
    body: o.crudo ?? (o.metodo === 'GET' || o.metodo === 'OPTIONS' ? undefined : JSON.stringify(cuerpo)),
  });
}
const CUERPO_OK = { pregunta: '¿Cómo va la flota?', cliente_id: 5 };

Deno.test('preludio: OPTIONS con origen permitido da 204, origen ajeno 403, GET 405', async () => {
  const { handler } = montar();
  assertEquals((await handler(pedir(null, { metodo: 'OPTIONS', origen: ORIGEN }))).status, 204);
  assertEquals((await handler(pedir(CUERPO_OK, { origen: 'https://malo.example' }))).status, 403);
  assertEquals((await handler(pedir(null, { metodo: 'GET' }))).status, 405);
});

Deno.test('preludio: sin Bearer o con token inválido da 401', async () => {
  const { handler } = montar();
  assertEquals((await handler(pedir(CUERPO_OK, { token: null }))).status, 401);
  assertEquals((await handler(pedir(CUERPO_OK, { token: 'jwt-malo' }))).status, 401);
});

Deno.test('cuerpo de 24 KB + 1 byte da 413', async () => {
  const { handler } = montar();
  const crudo = '{"pregunta":"' + 'a'.repeat(24 * 1024 + 1 - 15) + '"}';
  assertEquals((await handler(pedir(null, { crudo }))).status, 413);
});

Deno.test('validación de la pregunta, historial y cliente_id', async () => {
  const casos: Array<[unknown, string]> = [
    [{ pregunta: '   ', cliente_id: 5 }, 'pregunta_invalida'],
    [{ pregunta: 'a'.repeat(501), cliente_id: 5 }, 'pregunta_invalida'],
    [
      { pregunta: 'hola', historial: Array.from({ length: 11 }, () => ({ rol: 'usuario', texto: 'x' })) },
      'historial_invalido',
    ],
    [{ pregunta: 'hola', historial: [{ rol: 'sistema', texto: 'x' }] }, 'historial_invalido'],
    [{ pregunta: 'hola', cliente_id: -3 }, 'cliente_requerido'],
  ];
  for (const [cuerpo, error] of casos) {
    const r = await montar().handler(pedir(cuerpo));
    assertEquals(r.status, 400, error);
    assertEquals((await r.json()).error, error);
  }
});

Deno.test('pregunta de 500 caracteres pasa la validación', async () => {
  const r = await montar().handler(pedir({ pregunta: 'a'.repeat(500), cliente_id: 5 }));
  assertEquals(r.status, 200);
});

Deno.test('sin modelo: 503 no_disponible y no se reserva cupo', async () => {
  const { handler, c } = montar({ sinModelo: true });
  const r = await handler(pedir(CUERPO_OK));
  assertEquals([r.status, (await r.json()).error], [503, 'no_disponible']);
  assertEquals(c.rpc.some((x) => x.fn === 'asistente_reservar'), false);
});

Deno.test('reservar: 42501 da 403 sin_acceso; 22023 da 400 cliente_requerido', async () => {
  const sinAcceso = await montar({ reservaCodigo: '42501' }).handler(pedir(CUERPO_OK));
  assertEquals([sinAcceso.status, (await sinAcceso.json()).error], [403, 'sin_acceso']);
  const sinCliente = await montar({ reservaCodigo: '22023' }).handler(pedir(CUERPO_OK));
  assertEquals([sinCliente.status, (await sinCliente.json()).error], [400, 'cliente_requerido']);
});

Deno.test('reservar sin cupo da 429 con cuota', async () => {
  const r = await montar({ reserva: { ...RESERVA, permitido: false, usadas: 30, limite: 30 } }).handler(
    pedir(CUERPO_OK),
  );
  assertEquals(r.status, 429);
  assertEquals(await r.json(), { ok: false, error: 'cuota', cuota: { usadas: 30, limite: 30 } });
});

Deno.test('camino feliz: tool, texto, fuentes y cierre con los valores sumados', async () => {
  const { handler, c } = montar({
    modelo: [
      (p) => {
        assertEquals(p.forzarTexto, false);
        return {
          ...pide({ id: 'c1', nombre: 'estado_flota', argumentos: '{"limite":5}' }),
          tokensEntrada: 10,
          tokensSalida: 5,
          costo: 0.5,
        };
      },
      { ...texto('Listo'), tokensEntrada: 20, tokensSalida: 8, costo: 0.25, modelo: 'M2' },
    ],
  });
  const r = await handler(pedir(CUERPO_OK));
  assertEquals(r.status, 200);
  const cuerpo = await r.json();
  assertEquals(cuerpo.ok, true);
  assertEquals(cuerpo.fuentes, [FUENTE]);
  assertEquals(cuerpo.modelo, 'M2');
  assertEquals(cuerpo.cuota, { usadas: 3, limite: 30 });
  assertEquals(cuerpo.bloques, [{ tipo: 'parrafo', texto: 'Listo' }]);
  const cierre = c.rpc.find((x) => x.fn === 'asistente_cerrar')!.args;
  assertEquals(cierre.p_resultado, 'ok');
  assertEquals(cierre.p_tools, ['estado_flota']);
  assertEquals(cierre.p_tokens_entrada, 30);
  assertEquals(cierre.p_tokens_salida, 13);
  assertEquals(cierre.p_costo, 0.75);
  assertEquals(cierre.p_prompt_version, 'v-test');
  assertEquals(cierre.p_id, 77);
});

Deno.test('el modelo pide 7 tools: se ejecutan 6, la 7.ª recibe limite_de_consultas y la vuelta siguiente va forzada', async () => {
  const siete = Array.from({ length: 7 }, (_, i) => ({ id: `c${i + 1}`, nombre: 'estado_flota', argumentos: '{}' }));
  const { handler, c } = montar({ modelo: [pide(...siete), texto('Fin')] });
  const r = await handler(pedir(CUERPO_OK));
  assertEquals(r.status, 200);
  assertEquals(c.ejecutadas.length, 6);
  assertEquals(c.peticiones[0].forzarTexto, false);
  assertEquals(c.peticiones[1].forzarTexto, true);
  const tool7 = (c.peticiones[1].mensajes as Llamada[]).find((m) => m.tool_call_id === 'c7');
  assertEquals(tool7?.content, '{"error":"limite_de_consultas"}');
});

Deno.test('el cliente_id del cuerpo llega a reservar; ningún argumento del modelo cambia el contexto', async () => {
  const { handler, c } = montar({
    modelo: [pide({ id: 'c1', nombre: 'estado_flota', argumentos: '{"cliente_id":99}' }), texto('Listo')],
  });
  await handler(pedir({ pregunta: 'hola', cliente_id: 5 }));
  const reserva = c.rpc.find((x) => x.fn === 'asistente_reservar')!;
  assertEquals(reserva.args, { p_cliente_id: 5 });
  assertEquals(c.ctxTool[0].clienteId, 5);
});

Deno.test('errores del modelo: tiempo 504, no_disponible 503, fallo 502; el cierre queda en error', async () => {
  const casos: Array<[RespuestaModelo, number, string]> = [
    [{ ok: false, tipo: 'tiempo', aviso: 'tiempo' }, 504, 'tiempo'],
    [{ ok: false, tipo: 'no_disponible', aviso: 'openrouter_402' }, 503, 'no_disponible'],
    [{ ok: false, tipo: 'fallo', aviso: 'principal_429; respaldo_500' }, 502, 'fallo_modelo'],
  ];
  for (const [err, status, error] of casos) {
    const { handler, c } = montar({ modelo: [err] });
    const r = await handler(pedir(CUERPO_OK));
    assertEquals([r.status, (await r.json()).error], [status, error]);
    assertEquals(c.rpc.find((x) => x.fn === 'asistente_cerrar')!.args.p_resultado, 'error');
  }
});

Deno.test('plazo de 55 s: si la vuelta siguiente empieza pasado el plazo, 504', async () => {
  let reloj = MOMENTO;
  const { handler, c } = montar({
    ahora: () => reloj,
    modelo: [
      () => {
        reloj += 56_000;
        return pide({ id: 'c1', nombre: 'estado_flota', argumentos: '{}' });
      },
      texto('no debería llegar'),
    ],
  });
  const r = await handler(pedir(CUERPO_OK));
  assertEquals([r.status, (await r.json()).error], [504, 'tiempo']);
  assertEquals(c.peticiones.length, 1);
  assertEquals(c.rpc.find((x) => x.fn === 'asistente_cerrar')!.args.p_resultado, 'error');
});

Deno.test('asistente_cerrar que falla no cambia la respuesta y queda en el log', async () => {
  const { handler, c } = montar({ cerrarFalla: true });
  const r = await handler(pedir(CUERPO_OK));
  assertEquals(r.status, 200);
  assert(c.logs.some((l) => JSON.parse(l).event === 'cerrar_fallo'));
});

Deno.test('ningún log contiene la pregunta, el token ni el texto de las tools o del modelo', async () => {
  const { handler, c } = montar({
    modelo: [pide({ id: 'c1', nombre: 'estado_flota', argumentos: '{}' }), texto(TEXTO_MODELO)],
  });
  await handler(pedir({ pregunta: PREGUNTA_SECRETA, cliente_id: 5 }));
  const todo = c.logs.join('\n');
  assert(todo.length > 0, 'hay logs');
  for (const secreto of [PREGUNTA_SECRETA, TOKEN, DATO_TOOL, TEXTO_MODELO]) {
    assert(!todo.includes(secreto), `el log no debe contener ${secreto}`);
  }
  assertEquals(c.logs.some((l) => JSON.parse(l).event === 'fin'), true);
});

Deno.test('ningún .ts de la carpeta (sin _test) menciona la clave de servicio', async () => {
  const dir = new URL('.', import.meta.url);
  let revisados = 0;
  for await (const entrada of Deno.readDir(dir)) {
    if (!entrada.isFile || !entrada.name.endsWith('.ts') || entrada.name.endsWith('_test.ts')) continue;
    revisados++;
    const codigo = await Deno.readTextFile(new URL(entrada.name, dir));
    assert(!codigo.includes('SERVICE_ROLE'), `${entrada.name} no debe usar la clave de servicio`);
  }
  assert(revisados >= 4);
});

Deno.test('modelo guionado: sin marcas no pide tools; con marcas pide la tool con sus argumentos', async () => {
  const sinMarca = await modeloGuionado.llamar({
    mensajes: [{ role: 'user', content: 'hola' }],
    tools: [],
    forzarTexto: false,
  }, new AbortController().signal);
  assert(sinMarca.ok);
  assertEquals([sinMarca.contenido, sinMarca.llamadas], ['Sin consulta.', []]);

  const conMarca = await modeloGuionado.llamar(
    { mensajes: [{ role: 'user', content: '[[tool:estado_flota {"limite":5}]]' }], tools: [], forzarTexto: false },
    new AbortController().signal,
  );
  assert(conMarca.ok);
  assertEquals(conMarca.llamadas, [{ id: 'c1', nombre: 'estado_flota', argumentos: '{"limite":5}' }]);
});

Deno.test('modelo guionado: con resultados de tools responde con una línea por resultado', async () => {
  const r = await modeloGuionado.llamar(
    {
      mensajes: [
        { role: 'user', content: '[[tool:estado_flota {"limite":5}]]' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'estado_flota', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"n":2}' },
      ],
      tools: [],
      forzarTexto: false,
    },
    new AbortController().signal,
  );
  assert(r.ok);
  assertEquals(r.contenido, 'Resultado:\nestado_flota: {"n":2}');
  assertEquals([r.modelo, r.tokensEntrada, r.tokensSalida, r.costo, r.aviso], ['guion/e2e', 10, 5, 0, null]);
});
