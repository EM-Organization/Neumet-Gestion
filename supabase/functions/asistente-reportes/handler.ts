// Handler de `asistente-reportes` (docs/24 §3, §4 y §9): valida la pregunta, reserva cupo, arma la conversación, ejecuta el
// bucle de tools con el JWT del usuario y cierra el registro de uso. Sin I/O propio: todo entra por `Deps`.
import { fail, posInt, preludio, respond } from '../_shared/acceso.ts';
import type { Catalogo, Contexto, DefTool, Fuente, Rest } from './contrato.ts';
import type { ClienteModelo, RespuestaModelo } from './openrouter.ts';

export interface Deps {
  allowedOrigins: string[];
  getUser(token: string): Promise<{ id: string } | null>;
  rest(token: string): Rest;
  /**
   * null = falta OPENROUTER_API_KEY (503). Es una fábrica porque el respaldo es pegajoso solo dentro de una pregunta
   * (docs/24 §7): cada pregunta obtiene su propio cliente.
   */
  modelo: (() => ClienteModelo) | null;
  catalogo: Catalogo;
  ahora?(): number;
  log?(line: Record<string, unknown>): void;
  newRequestId?(): string;
}

const MAX_BODY_BYTES = 24 * 1024;
const MAX_PREGUNTA = 500;
const MAX_HISTORIAL = 10;
const MAX_TEXTO_TURNO = 4000;
const PLAZO_MS = 55_000;
const MAX_LLAMADAS_TOOL = 6;
const MAX_VUELTAS = 8;

interface Turno {
  rol: 'usuario' | 'asistente';
  texto: string;
}

/** Lo que el bucle reúne para el cierre del registro y la respuesta. */
interface Conversacion {
  final: { ok: true; texto: string } | {
    ok: false;
    tipo: 'no_disponible' | 'fallo' | 'peticion' | 'tiempo' | 'interno';
  };
  tools: string[];
  fuentes: Fuente[];
  tokensEntrada: number;
  tokensSalida: number;
  costo: number;
  modelo: string | null;
  aviso: string | null;
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return (req) => atender(req, deps);
}

async function atender(req: Request, deps: Deps): Promise<Response> {
  const ahora = deps.ahora ?? (() => Date.now());
  const inicio = ahora();
  const requestId = deps.newRequestId?.() ?? crypto.randomUUID();
  // Nunca se registran la pregunta, el historial, el token, las respuestas ni el contenido de las tools.
  const log = (level: string, event: string, extra: Record<string, unknown> = {}) =>
    (deps.log ?? ((l) => console.log(JSON.stringify(l))))({ level, request_id: requestId, event, ...extra });

  const entrada = await preludio(req, deps.allowedOrigins, log, deps.getUser, MAX_BODY_BYTES);
  if (entrada instanceof Response) return entrada;
  const { cors, token, body } = entrada;

  const valida = validar(body);
  if (!valida.ok) return fail(valida.error, 400, cors);
  if (!deps.modelo) {
    log('error', 'modelo_no_configurado');
    return fail('no_disponible', 503, cors);
  }
  log('info', 'inicio', { cliente_id: valida.clienteId });

  const rest = deps.rest(token);
  const reserva = await reservar(rest, valida.clienteId, ahora(), log);
  if (!reserva.ok) return fail(reserva.error, reserva.status, cors, reserva.extra);
  const { ctx, cuota } = reserva;
  log('info', 'cuota', { usadas: cuota.usadas, limite: cuota.limite, rol: ctx.rol });

  const modelo = deps.modelo();
  const conv = await conversarSeguro({
    pregunta: valida.pregunta,
    historial: valida.historial,
    ctx,
    rest,
    modelo,
    catalogo: deps.catalogo,
    ahora,
    inicio,
    log,
  });

  const duracion = ahora() - inicio;
  await cerrarUso(rest, {
    usoId: ctx.usoId,
    conv,
    resultado: conv.final.ok ? 'ok' : 'error',
    duracion,
    promptVersion: deps.catalogo.promptVersion,
    log,
  });

  const respuesta = conv.final.ok
    ? {
      status: 200,
      cuerpo: {
        ok: true,
        bloques: deps.catalogo.aBloques(conv.final.texto),
        fuentes: conv.fuentes,
        modelo: conv.modelo,
        cuota: { usadas: cuota.usadas, limite: cuota.limite },
      },
    }
    : errorDelModelo(conv.final.tipo);
  log(conv.final.ok ? 'info' : 'error', 'fin', {
    resultado: conv.final.ok ? 'ok' : 'error',
    status: respuesta.status,
    ms: duracion,
    tools: conv.tools,
    costo: conv.costo,
  });
  return respond(respuesta.cuerpo, respuesta.status, cors);
}

type Validacion =
  | { ok: true; pregunta: string; historial: Turno[]; clienteId: number | null }
  | { ok: false; error: 'pregunta_invalida' | 'historial_invalido' | 'cliente_requerido' };

function validar(body: Record<string, unknown>): Validacion {
  const pregunta = typeof body.pregunta === 'string' ? body.pregunta.trim() : '';
  if (largo(pregunta) < 1 || largo(pregunta) > MAX_PREGUNTA) return { ok: false, error: 'pregunta_invalida' };

  const historial = validarHistorial(body.historial);
  if (historial === null) return { ok: false, error: 'historial_invalido' };

  let clienteId: number | null = null;
  if (body.cliente_id !== undefined && body.cliente_id !== null) {
    clienteId = posInt(body.cliente_id);
    if (clienteId === null) return { ok: false, error: 'cliente_requerido' };
  }
  return { ok: true, pregunta, historial, clienteId };
}

function validarHistorial(valor: unknown): Turno[] | null {
  if (valor === undefined) return [];
  if (!Array.isArray(valor) || valor.length > MAX_HISTORIAL) return null;
  const turnos: Turno[] = [];
  for (const t of valor as unknown[]) {
    if (t === null || typeof t !== 'object') return null;
    const { rol, texto } = t as Record<string, unknown>;
    if ((rol !== 'usuario' && rol !== 'asistente') || typeof texto !== 'string' || largo(texto) > MAX_TEXTO_TURNO) {
      return null;
    }
    turnos.push({ rol, texto });
  }
  return turnos;
}

/** Caracteres (puntos de código), no unidades UTF-16: una letra acentuada o un emoji cuentan como uno. */
function largo(texto: string): number {
  return [...texto].length;
}

type Reserva =
  | { ok: true; ctx: Contexto; cuota: { usadas: number; limite: number } }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> };

async function reservar(
  rest: Rest,
  clienteId: number | null,
  instante: number,
  log: (level: string, event: string, extra?: Record<string, unknown>) => void,
): Promise<Reserva> {
  const r = await rest.rpc('asistente_reservar', { p_cliente_id: clienteId });
  if (!r.ok) {
    if (r.code === '42501') return { ok: false, status: 403, error: 'sin_acceso' };
    if (r.code === '22023') return { ok: false, status: 400, error: 'cliente_requerido' };
    log('error', 'reserva_fallo', { status: r.status, code: r.code });
    return { ok: false, status: 500, error: 'error_interno' };
  }
  const datos = (r.filas[0] ?? {}) as Record<string, unknown>;
  const usadas = numeroDe(datos.usadas);
  const limite = numeroDe(datos.limite);
  if (datos.permitido === false) {
    return { ok: false, status: 429, error: 'cuota', extra: { cuota: { usadas, limite } } };
  }
  const ctx = leerContexto(datos, hoyEnMontevideo(instante));
  if (datos.permitido !== true || ctx === null || usadas === null || limite === null) {
    log('error', 'reserva_invalida');
    return { ok: false, status: 500, error: 'error_interno' };
  }
  return { ok: true, ctx, cuota: { usadas, limite } };
}

function numeroDe(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function leerContexto(d: Record<string, unknown>, hoy: string): Contexto | null {
  const rol = d.rol;
  if (rol !== 'admin' && rol !== 'global' && rol !== 'sucursal') return null;
  if (typeof d.id !== 'number' || typeof d.cliente_id !== 'number') return null;
  if (typeof d.cliente_nombre !== 'string' || typeof d.moneda_default !== 'string') return null;
  return {
    usoId: d.id,
    rol,
    clienteId: d.cliente_id,
    clienteNombre: d.cliente_nombre,
    sucursalId: typeof d.sucursal_id === 'number' ? d.sucursal_id : null,
    sucursalNombre: typeof d.sucursal_nombre === 'string' ? d.sucursal_nombre : null,
    costosVisibles: d.costos_visibles === true,
    monedaDefault: d.moneda_default,
    hoy,
  };
}

/** Fecha de hoy en Montevideo, `YYYY-MM-DD` (el formato en-CA de Intl es ISO). */
function hoyEnMontevideo(instante: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(new Date(instante));
}

function errorDelModelo(tipo: 'no_disponible' | 'fallo' | 'peticion' | 'tiempo' | 'interno') {
  switch (tipo) {
    case 'no_disponible':
      return { status: 503, cuerpo: { ok: false, error: 'no_disponible' } };
    case 'tiempo':
      return { status: 504, cuerpo: { ok: false, error: 'tiempo' } };
    case 'interno':
      return { status: 500, cuerpo: { ok: false, error: 'error_interno' } };
    default:
      return { status: 502, cuerpo: { ok: false, error: 'fallo_modelo' } };
  }
}

interface ParamsConversar {
  pregunta: string;
  historial: Turno[];
  ctx: Contexto;
  rest: Rest;
  modelo: ClienteModelo;
  catalogo: Catalogo;
  ahora: () => number;
  inicio: number;
  log: (level: string, event: string, extra?: Record<string, unknown>) => void;
}

// Un error inesperado (una tool que lanza, por ejemplo) cierra la pregunta como error interno, no como 500 sin registro.
async function conversarSeguro(p: ParamsConversar): Promise<Conversacion> {
  try {
    return await conversar(p);
  } catch (e) {
    p.log('error', 'error_interno', { tipo: e instanceof Error ? e.name : 'desconocido' });
    return vacia({ ok: false, tipo: 'interno' });
  }
}

function vacia(final: Conversacion['final']): Conversacion {
  return { final, tools: [], fuentes: [], tokensEntrada: 0, tokensSalida: 0, costo: 0, modelo: null, aviso: null };
}

async function conversar(p: ParamsConversar): Promise<Conversacion> {
  const conv = vacia({ ok: false, tipo: 'fallo' });
  const tools: DefTool[] = p.catalogo.toolsParaRol(p.ctx);
  const mensajes: unknown[] = [
    { role: 'system', content: p.catalogo.armarPrompt(p.ctx, tools) },
    ...p.historial.map((t) => ({ role: t.rol === 'usuario' ? 'user' : 'assistant', content: t.texto })),
    { role: 'user', content: p.pregunta },
  ];

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), PLAZO_MS);
  let llamadasTool = 0;
  let forzarTexto = false;
  try {
    for (let vuelta = 1; vuelta <= MAX_VUELTAS; vuelta++) {
      const r = p.ahora() - p.inicio >= PLAZO_MS
        ? { ok: false as const, tipo: 'tiempo' as const, aviso: 'plazo' }
        : await llamarRegistrando(p, { mensajes, tools, forzarTexto }, controlador.signal);
      conv.aviso ??= r.aviso;
      if (!r.ok) return { ...conv, final: { ok: false, tipo: r.tipo } };

      conv.tokensEntrada += r.tokensEntrada;
      conv.tokensSalida += r.tokensSalida;
      conv.costo += r.costo;
      conv.modelo = r.modelo;
      if (r.llamadas.length === 0) return { ...conv, final: { ok: true, texto: r.contenido ?? '' } };

      mensajes.push({
        role: 'assistant',
        content: r.contenido,
        tool_calls: r.llamadas.map((l) => ({
          id: l.id,
          type: 'function',
          function: { name: l.nombre, arguments: l.argumentos },
        })),
      });
      for (const llamada of r.llamadas) {
        if (llamadasTool >= MAX_LLAMADAS_TOOL) {
          mensajes.push({
            role: 'tool',
            tool_call_id: llamada.id,
            content: JSON.stringify({ error: 'limite_de_consultas' }),
          });
          continue;
        }
        llamadasTool++;
        const t0 = p.ahora();
        const salida = await p.catalogo.ejecutarTool(llamada.nombre, llamada.argumentos, p.ctx, p.rest);
        if (salida.fuente) conv.fuentes.push(salida.fuente);
        if (!conv.tools.includes(llamada.nombre)) conv.tools.push(llamada.nombre);
        p.log('info', 'tool', {
          nombre: llamada.nombre,
          filas: salida.fuente?.filas ?? 0,
          recortado: salida.fuente?.recortado ?? false,
          ms: p.ahora() - t0,
        });
        mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: salida.contenido });
      }
      if (llamadasTool >= MAX_LLAMADAS_TOOL) forzarTexto = true;
    }
    // Ocho vueltas sin texto: el modelo no obedece `tool_choice: 'none'`; se trata como falla del modelo.
    return { ...conv, final: { ok: false, tipo: 'fallo' } };
  } finally {
    clearTimeout(temporizador);
  }
}

async function llamarRegistrando(
  p: ParamsConversar,
  peticion: { mensajes: unknown[]; tools: DefTool[]; forzarTexto: boolean },
  senal: AbortSignal,
): Promise<RespuestaModelo> {
  const t0 = p.ahora();
  const r = await p.modelo.llamar(peticion, senal);
  p.log('info', 'modelo', { modelo: r.ok ? r.modelo : null, ok: r.ok, aviso: r.aviso, ms: p.ahora() - t0 });
  return r;
}

async function cerrarUso(
  rest: Rest,
  c: {
    usoId: number;
    conv: Conversacion;
    resultado: 'ok' | 'error';
    duracion: number;
    promptVersion: string;
    log: (level: string, event: string, extra?: Record<string, unknown>) => void;
  },
): Promise<void> {
  try {
    const r = await rest.rpc('asistente_cerrar', {
      p_id: c.usoId,
      p_resultado: c.resultado,
      p_modelo: c.conv.modelo,
      p_tools: c.conv.tools,
      p_tokens_entrada: c.conv.tokensEntrada,
      p_tokens_salida: c.conv.tokensSalida,
      p_costo: c.conv.costo,
      p_duracion_ms: c.duracion,
      p_prompt_version: c.promptVersion,
      p_aviso: c.conv.aviso,
    });
    // Un fallo del cierre no cambia la respuesta al panel: queda solo en el log.
    if (!r.ok || r.filas[0] !== true) c.log('warn', 'cerrar_fallo', r.ok ? {} : { status: r.status, code: r.code });
  } catch {
    c.log('warn', 'cerrar_fallo');
  }
}
