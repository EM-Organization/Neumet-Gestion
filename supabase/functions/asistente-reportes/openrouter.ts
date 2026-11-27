// Cliente de OpenRouter con respaldo (docs/24 §7). Un cliente vive lo que dura una pregunta: si el principal falla, las
// vueltas siguientes de esa pregunta van directo al respaldo. Nunca se registran mensajes ni la clave.
import type { DefTool } from './contrato.ts';

export const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
export const MODELO_PRINCIPAL_DEFECTO = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const MODELO_RESPALDO_DEFECTO = 'deepseek/deepseek-v4.1-flash';
// Variante de pago: nunca se usa, ni como principal ni como respaldo (docs/24 §7).
const MODELO_DE_PAGO = 'nvidia/nemotron-3-ultra-550b-a55b';

export interface PeticionModelo {
  mensajes: unknown[];
  tools: DefTool[];
  forzarTexto: boolean;
}

export type RespuestaModelo =
  | {
    ok: true;
    contenido: string | null;
    llamadas: Array<{ id: string; nombre: string; argumentos: string }>;
    modelo: string;
    tokensEntrada: number;
    tokensSalida: number;
    costo: number;
    aviso: string | null;
  }
  | { ok: false; tipo: 'no_disponible' | 'fallo' | 'peticion' | 'tiempo'; aviso: string };

export interface ClienteModelo {
  llamar(p: PeticionModelo, senal: AbortSignal): Promise<RespuestaModelo>;
}

export interface OpcionesCliente {
  apiKey: string;
  principal: string;
  respaldo: string;
  fetch?: typeof fetch;
  log?: (linea: Record<string, unknown>) => void;
}

type Exito = Extract<RespuestaModelo, { ok: true }>;
/** Por qué una petición no dio una respuesta usable: un código HTTP, falla de red, respuesta vacía o señal abortada. */
type Estado = number | 'red' | 'vacio' | 'tiempo';
type Intento = { ok: true; exito: Exito } | { ok: false; estado: Estado };

export function crearClienteModelo(o: OpcionesCliente): ClienteModelo {
  const pedir = o.fetch ?? fetch;
  const log = o.log ?? ((linea) => console.log(JSON.stringify(linea)));
  // null mientras responde el principal; con el motivo, las vueltas siguientes van directo al respaldo.
  let motivoRespaldo: string | null = null;

  async function llamar(p: PeticionModelo, senal: AbortSignal): Promise<RespuestaModelo> {
    if (motivoRespaldo === null) {
      const principal = await intentar(o.principal, p, senal, o.apiKey, pedir);
      if (principal.ok) return principal.exito;
      if (principal.estado === 'tiempo') return { ok: false, tipo: 'tiempo', aviso: 'tiempo' };
      if (principal.estado === 400) return { ok: false, tipo: 'peticion', aviso: 'openrouter_400' };
      if (esClaveOCuota(principal.estado)) {
        return { ok: false, tipo: 'no_disponible', aviso: `openrouter_${principal.estado}` };
      }
      motivoRespaldo = `principal_${principal.estado}`;
      log({ level: 'warn', event: 'modelo_respaldo', aviso: motivoRespaldo });
    }
    const respaldo = await intentar(o.respaldo, p, senal, o.apiKey, pedir);
    if (respaldo.ok) return { ...respaldo.exito, aviso: motivoRespaldo };
    if (respaldo.estado === 'tiempo') return { ok: false, tipo: 'tiempo', aviso: 'tiempo' };
    const tipo = esClaveOCuota(respaldo.estado) ? 'no_disponible' : 'fallo';
    return { ok: false, tipo, aviso: `${motivoRespaldo}; respaldo_${respaldo.estado}` };
  }

  return { llamar };
}

function esClaveOCuota(estado: Estado): boolean {
  return estado === 401 || estado === 402 || estado === 403;
}

async function intentar(
  modelo: string,
  p: PeticionModelo,
  senal: AbortSignal,
  apiKey: string,
  pedir: typeof fetch,
): Promise<Intento> {
  const cuerpo = {
    model: modelo,
    messages: p.mensajes,
    // Sin tools no se manda tool_choice: el proveedor lo rechaza.
    ...(p.tools.length > 0 ? { tools: p.tools, tool_choice: p.forzarTexto ? 'none' : 'auto' } : {}),
    temperature: 0.2,
    max_tokens: 1500,
    usage: { include: true },
  };
  let res: Response;
  try {
    res = await pedir(URL_OPENROUTER, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'NEUMET' },
      body: JSON.stringify(cuerpo),
      signal: senal,
    });
  } catch {
    return { ok: false, estado: senal.aborted ? 'tiempo' : 'red' };
  }
  if (!res.ok) {
    await res.text().catch(() => '');
    return { ok: false, estado: res.status };
  }
  return interpretar(res, modelo, senal);
}

// Un 200 puede traer un error en el cuerpo (`error.code` numérico): se trata como el código HTTP equivalente.
async function interpretar(res: Response, modeloPedido: string, senal: AbortSignal): Promise<Intento> {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, estado: senal.aborted ? 'tiempo' : 'vacio' };
  }
  const error = cuerpo?.error as { code?: unknown } | undefined;
  if (error) return { ok: false, estado: typeof error.code === 'number' ? error.code : 'vacio' };

  const choices = cuerpo?.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  const mensaje = choices?.[0]?.message;
  if (!mensaje || typeof mensaje !== 'object') return { ok: false, estado: 'vacio' };

  const usage = (cuerpo.usage ?? {}) as Record<string, unknown>;
  const llamadas = (Array.isArray(mensaje.tool_calls) ? mensaje.tool_calls : []) as Array<{
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  }>;
  return {
    ok: true,
    exito: {
      ok: true,
      contenido: typeof mensaje.content === 'string' ? mensaje.content : null,
      llamadas: llamadas.map((l) => ({
        id: String(l.id ?? ''),
        nombre: String(l.function?.name ?? ''),
        argumentos: String(l.function?.arguments ?? '{}'),
      })),
      modelo: typeof cuerpo.model === 'string' ? cuerpo.model : modeloPedido,
      tokensEntrada: numero(usage.prompt_tokens),
      tokensSalida: numero(usage.completion_tokens),
      costo: numero(usage.cost),
      aviso: null,
    },
  };
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Modelos a usar según el entorno. Un principal sin `:free` se ignora (se usa el de por defecto y se avisa): la variante
 * de pago no se usa nunca. Un respaldo que sea la variante de pago también cae al de por defecto.
 */
export function elegirModelos(env: (nombre: string) => string | undefined): {
  principal: string;
  respaldo: string;
  avisos: Array<Record<string, unknown>>;
} {
  const avisos: Array<Record<string, unknown>> = [];
  const pedidoPrincipal = env('ASISTENTE_MODELO')?.trim() ?? '';
  let principal = MODELO_PRINCIPAL_DEFECTO;
  if (pedidoPrincipal && pedidoPrincipal.endsWith(':free')) {
    principal = pedidoPrincipal;
  } else if (pedidoPrincipal) {
    avisos.push({ event: 'modelo_principal_sin_free', modelo: pedidoPrincipal });
  }
  const pedidoRespaldo = env('ASISTENTE_MODELO_RESPALDO')?.trim() ?? '';
  const respaldo = pedidoRespaldo && pedidoRespaldo !== MODELO_DE_PAGO ? pedidoRespaldo : MODELO_RESPALDO_DEFECTO;
  return { principal, respaldo, avisos };
}
