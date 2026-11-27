// Piezas comunes de `quitar-acceso-usuario` y `reponer-acceso-usuario` (docs/17 §4.1): respuesta, CORS, token y el bucle
// de convergencia con Auth. Sin I/O propio: todo entra por dependencias, para probar con Auth y RPC simulados.

export function respond(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
export const fail = (error: string, status: number, h: Record<string, string>, extra: Record<string, unknown> = {}) =>
  respond({ ok: false, error, ...extra }, status, h);
export const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BODY_BYTES = 4 * 1024;

/** Estado vigente que devuelve `accesos_quitados_marcar_auth` (la RPC no rechaza: informa). */
export interface EstadoVigente {
  existe: boolean;
  tiene_perfil: boolean | null;
}
export type Marca = 'aplicado' | 'levantado' | null;

export interface ConvergenciaDeps {
  /** `accesos_quitados_marcar_auth(p_id, p_marca)` con la clave de servicio. Lanza si la RPC falla. */
  estado(accesoId: number, marca: Marca): Promise<EstadoVigente>;
  /** Bloquea (`ban_duration`) o desbloquea (`'none'`) al usuario de Auth. true si Auth respondió bien. */
  fijarBloqueo(userId: string, bloquear: boolean): Promise<boolean>;
}

export const MAX_INTENTOS = 3;

export type Convergencia =
  | { ok: true; tienePerfil: boolean }
  // `tienePerfil`: último estado de perfil OBSERVADO en la base antes de fallar (null si no se pudo leer o la fila ya no
  // existe). Los handlers arman el 502 desde ese estado, no desde la operación pedida: otra operación pudo cambiarlo.
  | { ok: false; motivo: 'auth' | 'no_converge' | 'estado'; tienePerfil: boolean | null };

/**
 * Invariante (docs/17 §4.1): el estado final de Auth es el del último estado de BD observado tras la última llamada a
 * Auth. Perfil presente = desbloqueado; ausente = bloqueado. Cada llamada a Auth va seguida de una relectura; si el
 * estado cambió (otra operación quitó o repuso mientras tanto) se vuelve a aplicar, hasta MAX_INTENTOS. Ninguna marca
 * condiciona la decisión: son informativas y las escribe la RPC solo si son ciertas.
 */
export async function converger(deps: ConvergenciaDeps, userId: string, accesoId: number): Promise<Convergencia> {
  let s: EstadoVigente;
  try {
    s = await deps.estado(accesoId, null);
  } catch {
    return { ok: false, motivo: 'estado', tienePerfil: null };
  }
  for (let i = 0; i < MAX_INTENTOS; i++) {
    if (!s.existe || s.tiene_perfil === null) return { ok: false, motivo: 'estado', tienePerfil: null };
    const conPerfil = s.tiene_perfil;
    let aplicado = false;
    try {
      aplicado = await deps.fijarBloqueo(userId, !conPerfil);
    } catch {
      aplicado = false;
    }
    if (!aplicado) return { ok: false, motivo: 'auth', tienePerfil: conPerfil };
    let despues: EstadoVigente;
    try {
      despues = await deps.estado(accesoId, conPerfil ? 'levantado' : 'aplicado');
    } catch {
      return { ok: false, motivo: 'estado', tienePerfil: null };
    }
    if (despues.existe && despues.tiene_perfil === conPerfil) return { ok: true, tienePerfil: conPerfil };
    s = despues;
  }
  return { ok: false, motivo: 'no_converge', tienePerfil: s.existe ? s.tiene_perfil : null };
}

export interface Entrada {
  cors: Record<string, string>;
  token: string;
  body: Record<string, unknown>;
  actor: string;
}

/** CORS, método, token y cuerpo JSON. Devuelve la respuesta de error o los datos ya validados. */
export async function preludio(
  req: Request,
  allowedOrigins: string[],
  log: (level: string, event: string, extra?: Record<string, unknown>) => void,
  getUser: (token: string) => Promise<{ id: string } | null>,
  maxBytes = MAX_BODY_BYTES,
): Promise<Response | Entrada> {
  const origin = req.headers.get('origin');
  const cors: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      log('warn', 'origin_not_allowed');
      return fail('Origen no permitido', 403, cors);
    }
    cors['Access-Control-Allow-Origin'] = origin;
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('Método no permitido', 405, cors);

  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return fail('No autenticado', 401, cors);
  const user = await getUser(m[1]).catch(() => null);
  if (!user) {
    log('warn', 'invalid_token');
    return fail('No autenticado', 401, cors);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > maxBytes) return fail('Solicitud demasiado grande', 413, cors);
  let body: Record<string, unknown>;
  try {
    const p = JSON.parse(raw);
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new Error();
    body = p;
  } catch {
    return fail('JSON inválido', 400, cors);
  }
  return { cors, token: m[1], body, actor: user.id };
}

/** Error de una RPC invocada con el JWT del llamante (PostgREST: `code` de Postgres). */
export interface RpcError {
  code: string;
  message: string;
}
export type RpcResult = { data: Record<string, unknown> } | { error: RpcError };

/** Cliente de la RPC con el JWT del llamante y de Auth con la clave de servicio, común a las dos funciones. */
export interface DepsBase extends ConvergenciaDeps {
  allowedOrigins: string[];
  /** Valida el JWT (auth.getUser). null si inválido. */
  getUser(token: string): Promise<{ id: string } | null>;
  log?(line: Record<string, unknown>): void;
  newRequestId?(): string;
}

export function crearLog(deps: DepsBase) {
  const request_id = deps.newRequestId?.() ?? crypto.randomUUID();
  // Nunca se registran emails ni tokens.
  const log = (level: string, event: string, extra: Record<string, unknown> = {}) =>
    (deps.log ?? ((l) => console.log(JSON.stringify(l))))({ level, request_id, event, ...extra });
  return log;
}
