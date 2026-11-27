// Juego de evaluación del asistente de reportes (docs/24 §8.4). A pedido, nunca en CI: gasta cuota de OpenRouter y no es
// determinista. Usar solo el demo de NEUMET; nunca un usuario de un cliente real.
//
// Variables: OPENROUTER_API_KEY, ASISTENTE_MODELO, SUPABASE_URL, SUPABASE_ANON_KEY, EVAL_JWT (perfil global del demo),
// EVAL_CLIENTE_ID, EVAL_CLIENTE_NOMBRE, y opcionales EVAL_JWT_SUCURSAL, EVAL_SUCURSAL_ID, EVAL_SUCURSAL_NOMBRE (sin
// ellas se omiten los casos de sucursal).
// Uso: deno run --allow-net --allow-env --allow-read supabase/functions/asistente-reportes/evaluacion/evaluar.ts
//
// Cada caso de preguntas.json se corre con el catálogo real, el prompt real y un bucle mínimo contra OpenRouter. Un caso
// falla si: no llama a `tool_esperada`, sus argumentos no coinciden con `argumentos_esperados`, la respuesta no tiene
// `debe_contener` ni alguno de `debe_contener_alguno`, o tiene algo de `no_debe_contener`.

import { catalogo } from '../catalogo.ts';
import type { ConsultaSelect, Contexto, Rest, ResultadoRest } from '../contrato.ts';
import { aBloques } from '../formato.ts';

interface Caso {
  id: string;
  pregunta: string;
  rol: 'global' | 'sucursal';
  tool_esperada: string | null;
  argumentos_esperados?: Record<string, unknown>;
  debe_contener?: string[];
  debe_contener_alguno?: string[];
  no_debe_contener?: string[];
}

interface Mensaje {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface Llamada {
  nombre: string;
  argumentos: string;
}

const VUELTAS_MAXIMAS = 6;
const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

function env(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) throw new Error(`Falta la variable ${nombre}`);
  return valor;
}

function hoyEnMontevideo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date());
}

async function respuestaRest(respuesta: Response): Promise<ResultadoRest> {
  if (respuesta.ok) return { ok: true, filas: await respuesta.json() };
  const cuerpo = (await respuesta.json().catch(() => ({}))) as { code?: string };
  return { ok: false, status: respuesta.status, code: cuerpo.code ?? '' };
}

/** `Rest` real contra PostgREST con el JWT del perfil de prueba. Mismo filtrado que el handler: solo lectura. */
function restDe(jwt: string, base: string, anon: string): Rest {
  const cabeceras = { apikey: anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
  return {
    async select(consulta: ConsultaSelect): Promise<ResultadoRest> {
      const url = new URL(`${base}/rest/v1/${consulta.recurso}`);
      url.searchParams.set('select', consulta.columnas);
      for (const [columna, expresion] of consulta.filtros) url.searchParams.append(columna, expresion);
      if (consulta.orden) url.searchParams.set('order', consulta.orden);
      url.searchParams.set('limit', String(consulta.limite));
      return respuestaRest(await fetch(url, { headers: cabeceras }));
    },
    async rpc(fn: string, args: Record<string, unknown>): Promise<ResultadoRest> {
      const url = `${base}/rest/v1/rpc/${fn}`;
      return respuestaRest(await fetch(url, { method: 'POST', headers: cabeceras, body: JSON.stringify(args) }));
    },
  };
}

async function chat(modelo: string, mensajes: Mensaje[], tools: unknown[]): Promise<Mensaje> {
  const respuesta = await fetch(URL_OPENROUTER, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, messages: mensajes, tools, temperature: 0 }),
  });
  if (!respuesta.ok) throw new Error(`OpenRouter respondió ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { choices: Array<{ message: Mensaje }> };
  return cuerpo.choices[0].message;
}

/** Bucle mínimo: el modelo pide tools, se ejecutan con el catálogo y se devuelve el resultado al modelo. */
async function correr(
  caso: Caso,
  ctx: Contexto,
  rest: Rest,
  modelo: string,
): Promise<{ texto: string; llamadas: Llamada[] }> {
  const tools = catalogo.toolsParaRol(ctx);
  const mensajes: Mensaje[] = [
    { role: 'system', content: catalogo.armarPrompt(ctx, tools) },
    { role: 'user', content: caso.pregunta },
  ];
  const llamadas: Llamada[] = [];
  for (let vuelta = 0; vuelta < VUELTAS_MAXIMAS; vuelta++) {
    const mensaje = await chat(modelo, mensajes, tools);
    if (!mensaje.tool_calls?.length) return { texto: mensaje.content ?? '', llamadas };
    mensajes.push(mensaje);
    for (const llamada of mensaje.tool_calls) {
      const salida = await catalogo.ejecutarTool(llamada.function.name, llamada.function.arguments, ctx, rest);
      llamadas.push({ nombre: llamada.function.name, argumentos: llamada.function.arguments });
      mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: salida.contenido });
    }
  }
  return { texto: '', llamadas };
}

const normalizar = (texto: string): string => texto.toLowerCase();

/** Motivo de la falla, o null si el caso pasa. */
function evaluar(caso: Caso, resultado: { texto: string; llamadas: Llamada[] }): string | null {
  if (caso.tool_esperada !== null) {
    const llamada = resultado.llamadas.find((l) => l.nombre === caso.tool_esperada);
    if (!llamada) return `no llamó a ${caso.tool_esperada}`;
    if (caso.argumentos_esperados) {
      const recibidos = JSON.parse(llamada.argumentos) as Record<string, unknown>;
      for (const [clave, valor] of Object.entries(caso.argumentos_esperados)) {
        if (JSON.stringify(recibidos[clave]) !== JSON.stringify(valor)) return `argumento ${clave} distinto`;
      }
    }
  }
  const plano = normalizar(
    aBloques(resultado.texto)
      .map((
        bloque,
      ) => (bloque.tipo === 'parrafo' ? bloque.texto : [...bloque.columnas, ...bloque.filas.flat()].join(' ')))
      .join(' '),
  );
  for (const fragmento of caso.debe_contener ?? []) {
    if (!plano.includes(normalizar(fragmento))) return `falta «${fragmento}»`;
  }
  const alguno = caso.debe_contener_alguno;
  if (alguno && !alguno.some((fragmento) => plano.includes(normalizar(fragmento)))) {
    return `no aparece ninguna de: ${alguno.join(', ')}`;
  }
  for (const fragmento of caso.no_debe_contener ?? []) {
    if (plano.includes(normalizar(fragmento))) return `aparece «${fragmento}»`;
  }
  return null;
}

function contextoDe(rol: 'global' | 'sucursal', hoy: string): Contexto {
  const base = {
    usoId: 0,
    clienteId: Number(env('EVAL_CLIENTE_ID')),
    clienteNombre: env('EVAL_CLIENTE_NOMBRE'),
    monedaDefault: 'USD',
    hoy,
  };
  if (rol === 'sucursal') {
    return {
      ...base,
      rol,
      sucursalId: Number(env('EVAL_SUCURSAL_ID')),
      sucursalNombre: env('EVAL_SUCURSAL_NOMBRE'),
      costosVisibles: false,
    };
  }
  return { ...base, rol, sucursalId: null, sucursalNombre: null, costosVisibles: true };
}

async function main(): Promise<void> {
  const base = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  const modelo = env('ASISTENTE_MODELO');
  const casos = JSON.parse(await Deno.readTextFile(new URL('./preguntas.json', import.meta.url))) as Caso[];
  const hoy = hoyEnMontevideo();
  const jwtSucursal = Deno.env.get('EVAL_JWT_SUCURSAL');

  let fallas = 0;
  for (const caso of casos) {
    const jwt = caso.rol === 'global' ? env('EVAL_JWT') : jwtSucursal;
    if (!jwt) {
      console.log(`OMITIDA ${caso.id} · falta EVAL_JWT_SUCURSAL`);
      continue;
    }
    const ctx = contextoDe(caso.rol, hoy);
    try {
      const resultado = await correr(caso, ctx, restDe(jwt, base, anon), modelo);
      const motivo = evaluar(caso, resultado);
      if (motivo) fallas++;
      console.log(`${motivo ? 'FALLA' : 'OK'} ${caso.id}${motivo ? ` · ${motivo}` : ''}`);
    } catch (error) {
      fallas++;
      console.log(`FALLA ${caso.id} · ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
  }
  console.log(`${casos.length - fallas} de ${casos.length} casos OK`);
  if (fallas > 0) Deno.exit(1);
}

if (import.meta.main) await main();
