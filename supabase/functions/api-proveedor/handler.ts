// Handler de la API de proveedor. Sin efectos de módulo ni acceso a red directo:
// todo lo externo entra por `Deps` (ver types.ts) para poder probarlo con dobles.
import { leerDistribucion } from './distribuciones.ts';
import { aColumnasBd, aLecturaApi, CAMPOS_API, type LecturaApi } from './mapping.ts';
import { leerOdometro } from './odometro.ts';
import { type Deps, ErrorRpc, type GuardarArgs, type ItemRpc, type LogEntrada } from './types.ts';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_LOGIN_BYTES = 4 * 1024;
export const MAX_MONTAJES = 40;
export const MM_MAX = 40;
export const RATE_CUENTA_POR_MIN = 120;
export const RATE_LOGIN_IP_POR_MIN = 30;
const PATENTE_RE = /^[A-Z0-9-]{3,12}$/;
/** Motivos por posición que devuelve api_guardar_montaje (docs/07 §9). */
const MOTIVOS_POSICION = new Set([
  'vehiculo',
  'posicion',
  'sin_neumaticos',
  'sin_medicion',
  'incompleta',
  'distribucion',
  'rango',
  'duplicado_distinto',
  'error',
]);
const IDEM_KEY_RE = /^[\x21-\x7E]{1,128}$/;

class HttpError extends Error {
  constructor(public status: number, public motivo: string) {
    super(motivo);
  }
}

/** Misma regla que public.normalizar_patente: mayúsculas y sin espacios; vacío -> null. */
export function normalizarPatente(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const s = p.replace(/\s+/g, '').toUpperCase();
  return s === '' ? null : s;
}

function respuesta(body: unknown, status: number, requestId: string, extra: Record<string, string> = {}): Response {
  // Sin CORS a propósito: no es un cliente de navegador.
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      ...extra,
    },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lo que identifica el contenido de un guardado para la idempotencia. Distribución y odómetro entran solo si vienen:
 * sin ellos el hash es el de siempre (una request en vuelo durante el despliegue no cambia de identidad) y con ellos,
 * reutilizar una clave con otro valor es un conflicto (409). Son de tipos distintos (texto y número), no colisionan.
 */
function contenidoDelHash(
  clienteId: number,
  patente: string,
  normalizados: unknown[],
  distribucion: string | null,
  odometro: number | null,
): unknown[] {
  return [
    clienteId,
    patente,
    normalizados,
    ...(distribucion !== null ? [distribucion] : []),
    ...(odometro !== null ? [odometro] : []),
  ];
}

/** uuid determinista derivado de un texto (para limitar por IP en la misma tabla). */
export async function uuidDeTexto(s: string): Promise<string> {
  const h = await sha256Hex('neumet-ip:' + s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function leerCuerpo(req: Request, max: number): Promise<unknown> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > max) throw new HttpError(400, 'cuerpo_demasiado_grande');
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new HttpError(400, 'cuerpo_demasiado_grande');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'utf8_invalido');
  }
  try {
    const v = JSON.parse(texto);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'json_invalido');
  }
}

function ruta(req: Request): string {
  let p = new URL(req.url).pathname;
  // Acepta las rutas del contrato con y sin el prefijo de la función.
  for (const pre of ['/functions/v1', '/api-proveedor']) {
    if (p === pre || p.startsWith(pre + '/')) p = p.slice(pre.length);
  }
  p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

interface Contexto {
  deps: Deps;
  requestId: string;
  inicio: number;
}

export function createHandler(deps: Deps, opciones: { newId?: () => string; ahora?: () => number } = {}) {
  const newId = opciones.newId ?? (() => crypto.randomUUID());
  const ahora = opciones.ahora ?? (() => Date.now());

  return async function handler(req: Request): Promise<Response> {
    const ctx: Contexto = { deps, requestId: newId(), inicio: ahora() };
    try {
      const path = ruta(req);
      const conocida = path === '/auth/login' || path === '/emenube/neumaticos/obtener_montaje' ||
        path === '/emenube/neumaticos/guardar_montaje_mm';
      if (!conocida) return respuesta({ code: 404, message: 'No encontrado' }, 404, ctx.requestId);
      if (req.method !== 'POST') {
        return respuesta({ code: 405, message: 'Método no permitido' }, 405, ctx.requestId, { Allow: 'POST' });
      }
      if (path === '/auth/login') return await login(req, ctx, ahora);
      return await autenticado(req, ctx, path, ahora);
    } catch (e) {
      if (e instanceof HttpError) {
        return respuesta({ code: e.status, message: 'Solicitud inválida' }, e.status, ctx.requestId);
      }
      console.error(JSON.stringify({ level: 'error', request_id: ctx.requestId, event: 'unhandled' }));
      return respuesta({ code: 500, message: 'Error interno' }, 500, ctx.requestId);
    }
  };

  // ---------------------------------------------------------------- login
  async function login(req: Request, c: Contexto, ahora: () => number): Promise<Response> {
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconocida';
    // x-forwarded-for solo como pista: el cliente puede falsearla (docs/07 §4.5).
    if (!(await c.deps.db.rateLimit(await uuidDeTexto(ip), RATE_LOGIN_IP_POR_MIN))) {
      return respuesta({ code: 429, message: 'Demasiadas solicitudes' }, 429, c.requestId, { 'Retry-After': '60' });
    }
    const b = await leerCuerpo(req, MAX_LOGIN_BYTES) as Record<string, unknown>;
    if (typeof b.email !== 'string' || typeof b.clave !== 'string' || b.email === '' || b.clave === '') {
      throw new HttpError(400, 'campos_login');
    }
    const invalido = () => respuesta({ code: 401, message: 'Credenciales inválidas' }, 401, c.requestId);
    if (b.tipoLogin !== 2) return invalido();
    const sesion = await c.deps.auth.login(b.email, b.clave);
    if (!sesion) return invalido();
    // La cuenta debe ser de tipo 'api' con cliente; si no, misma respuesta (sin revelar el motivo).
    const perfil = await c.deps.db.getPerfil(sesion.user_id);
    // Un cliente dado de baja (deleted_at) corta la cuenta: mismo 401, sin revelar el motivo.
    if (!perfil || perfil.rol !== 'api' || perfil.cliente_id == null || perfil.cliente_activo !== true) {
      return invalido();
    }
    // Login exitoso -> una fila en ingesta_log (cuenta el uso mensual de logins). No bloquea
    // el login si falla el registro (docs/07 §4.5: un fallo al escribir el log no rompe la respuesta).
    try {
      await c.deps.db.log({
        request_id: c.requestId,
        endpoint: 'login',
        device_id: 'api:' + sesion.user_id,
        cuenta: sesion.user_id,
        cliente_id: perfil.cliente_id,
        vehiculo_id: null,
        status: 'ok',
        http_code: 200,
        motivo: null,
        payload_resumen: {},
        n_guardados: null,
        n_fallidos: null,
        duracion_ms: ahora() - c.inicio,
      });
    } catch {
      console.warn(JSON.stringify({ level: 'warn', request_id: c.requestId, event: 'log_login_fallido' }));
    }
    return respuesta({ code: 200, access_token: sesion.access_token }, 200, c.requestId);
  }

  // ------------------------------------------------- endpoints autenticados
  async function autenticado(req: Request, c: Contexto, path: string, ahora: () => number): Promise<Response> {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
    const no401 = () => respuesta({ code: 401, message: 'No autorizado' }, 401, c.requestId);
    if (!m) return no401();
    const user = await c.deps.auth.getUser(m[1]);
    if (!user) return no401();
    const perfil = await c.deps.db.getPerfil(user.id);
    // cliente_id SOLO del perfil, nunca del cuerpo.
    // cliente_activo: el cliente dado de baja también corta los tokens ya emitidos.
    if (!perfil || perfil.rol !== 'api' || perfil.cliente_id == null || perfil.cliente_activo !== true) {
      return no401();
    }
    const cuenta = user.id;
    const clienteId = perfil.cliente_id;
    const endpoint = path.endsWith('obtener_montaje') ? 'obtener_montaje' : 'guardar_montaje_mm';

    const log: Omit<LogEntrada, 'status' | 'http_code' | 'duracion_ms'> & Partial<LogEntrada> = {
      request_id: c.requestId,
      endpoint,
      device_id: 'api:' + cuenta,
      cuenta,
      cliente_id: clienteId,
      vehiculo_id: null,
      motivo: null,
      payload_resumen: {},
      n_guardados: null,
      n_fallidos: null,
    };
    const cerrar = async (res: Response, motivo: string | null): Promise<Response> => {
      const http = res.status;
      const entrada: LogEntrada = {
        ...log,
        motivo: motivo ?? log.motivo ?? null,
        status: http >= 500
          ? 'error'
          : http === 200 && (!motivo || motivo === 'fallo_parcial' || motivo === 'vehiculo_creado')
          ? 'ok'
          : 'rechazado',
        http_code: http,
        duracion_ms: ahora() - c.inicio,
      } as LogEntrada;
      try {
        await c.deps.db.log(entrada);
      } catch {
        console.error(JSON.stringify({ level: 'error', request_id: c.requestId, event: 'log_fallido' }));
      }
      return res;
    };

    try {
      if (!(await c.deps.db.rateLimit(cuenta, RATE_CUENTA_POR_MIN))) {
        return await cerrar(
          respuesta({ code: 429, message: 'Demasiadas solicitudes' }, 429, c.requestId, { 'Retry-After': '60' }),
          'rate_limit',
        );
      }
      const body = await leerCuerpo(req, MAX_BODY_BYTES) as Record<string, unknown>;
      const res = endpoint === 'obtener_montaje'
        ? await obtener(body, c, clienteId, log)
        : await guardar(body, req, c, clienteId, cuenta, perfil.odometro_obligatorio_api === true, log);
      return await cerrar(res.response, res.motivo);
    } catch (e) {
      if (e instanceof HttpError) {
        return await cerrar(
          respuesta({ code: e.status, message: 'Solicitud inválida' }, e.status, c.requestId),
          e.motivo,
        );
      }
      console.error(JSON.stringify({ level: 'error', request_id: c.requestId, event: 'fallo_interno', endpoint }));
      return await cerrar(respuesta({ code: 500, message: 'Error interno' }, 500, c.requestId), 'error_interno');
    }
  }

  // ----------------------------------------------------- obtener_montaje
  async function obtener(
    b: Record<string, unknown>,
    c: Contexto,
    clienteId: number,
    log: { vehiculo_id: number | null; payload_resumen: Record<string, unknown> },
  ): Promise<{ response: Response; motivo: string | null }> {
    if (typeof b.matricula !== 'string' || typeof b.numero !== 'string') throw new HttpError(400, 'campos');
    const matricula = b.matricula.trim();
    const numero = b.numero.trim();
    if (matricula.length > 64 || numero.length > 64) throw new HttpError(400, 'longitud');
    if (matricula === '' && numero === '') throw new HttpError(400, 'sin_criterio');
    log.payload_resumen = { por: matricula !== '' ? 'matricula' : 'numero' };

    // Vehículo ajeno e inexistente comparten camino: la RPC filtra por cliente_id del perfil.
    const r = await c.deps.db.obtener(clienteId, matricula, numero);
    if (!r.encontrado) {
      return {
        response: respuesta({ code: 404, matricula: '', numero: '', data: [] }, 200, c.requestId),
        motivo: 'no_encontrado',
      };
    }
    log.vehiculo_id = r.vehiculo_id ?? null;
    const data = r.data
      .filter((n) => typeof n.idneumatico === 'string' && n.idneumatico !== '')
      .map((n) => ({
        idneumatico: n.idneumatico as string,
        codigo: n.codigo ?? '',
        posicion: n.posicion,
        auxilio: n.auxilio ? 'si' : 'no',
        ...aLecturaApi(n),
      }));
    return {
      response: respuesta(
        // `distribucion` ('' si el vehículo no la tiene definida) es aditiva: quien no la conoce la ignora.
        { code: 200, matricula: r.matricula ?? '', numero: r.numero ?? '', distribucion: r.distribucion ?? '', data },
        200,
        c.requestId,
      ),
      // Respuesta idéntica al contrato (code 200, data []); el motivo solo queda en ingesta_log.
      motivo: data.length === 0 ? 'sin_neumaticos' : null,
    };
  }

  // ------------------------------------------------------- guardar_mm
  async function guardar(
    b: Record<string, unknown>,
    req: Request,
    c: Contexto,
    clienteId: number,
    cuenta: string,
    odometroObligatorio: boolean,
    log: {
      vehiculo_id: number | null;
      payload_resumen: Record<string, unknown>;
      n_guardados: number | null;
      n_fallidos: number | null;
    },
  ): Promise<{ response: Response; motivo: string | null }> {
    const patente = normalizarPatente(b.patente);
    if (patente === null || !PATENTE_RE.test(patente)) throw new HttpError(400, 'patente');
    if (b.numero !== '') throw new HttpError(400, 'numero_no_vacio');
    if (!Array.isArray(b.montajes) || b.montajes.length < 1 || b.montajes.length > MAX_MONTAJES) {
      throw new HttpError(400, 'montajes');
    }
    const idem = req.headers.get('idempotency-key');
    if (idem !== null && !IDEM_KEY_RE.test(idem)) throw new HttpError(400, 'idempotency_key');
    // Opcional: qué distribución de ejes tiene el vehículo (define qué neumático es cada posición). Un valor que no
    // es del catálogo es un error del cliente (400), no algo que se ignore: la numeración de las posiciones dependería de él.
    const dist = leerDistribucion(b.distribucion);
    if (!dist.ok) throw new HttpError(400, 'distribucion');
    const distribucion = dist.valor;
    // RN-12: un valor inválido es error del cliente (400) siempre. Ausente solo se rechaza si el cliente exige el
    // odómetro (422, sin llamar a la RPC). La RPC lo defiende también (22023): ver la llamada más abajo.
    // Un odómetro menor que el del vehículo no es error aquí: la base lo guarda como sospechoso.
    const od = leerOdometro(b.odometro_km);
    if (!od.ok) throw new HttpError(400, 'odometro');
    if (od.valor === null && odometroObligatorio) throw new HttpError(422, 'odometro');
    const odometro = od.valor;

    const vistas = new Set<number>();
    const items: ItemRpc[] = [];
    const normalizados: unknown[] = [];
    for (const raw of b.montajes) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'montaje');
      const it = raw as Record<string, unknown>;
      const pos = it.posicion;
      if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 1 || pos > 99) {
        throw new HttpError(400, 'posicion');
      }
      if (vistas.has(pos)) throw new HttpError(400, 'posicion_duplicada');
      vistas.add(pos);

      const v = {} as LecturaApi;
      let fueraDeRango = false;
      for (const campo of CAMPOS_API) {
        const x = it[campo];
        if (x === undefined || x === null) v[campo] = null;
        else if (typeof x !== 'number') throw new HttpError(400, 'tipo_mm');
        else {
          v[campo] = x;
          if (!Number.isFinite(x) || x < 0 || x > MM_MAX) fueraDeRango = true;
        }
      }
      normalizados.push([pos, v.mm1, v.mm2, v.mm3, v.mm4]);

      const nulos = CAMPOS_API.filter((k) => v[k] === null).length;
      const sinMedir = nulos === CAMPOS_API.length;
      let item: ItemRpc;
      if (sinMedir) {
        // Auxilio sin medir: la RPC lo informa guardado:true si la posición es auxilio (no se persiste).
        item = { posicion: pos, mm1: null, mm2: null, mm3: null };
      } else if (nulos > 0) {
        item = { posicion: pos, mm1: null, mm2: null, mm3: null, rechazar: 'incompleta' };
      } else if (fueraDeRango) {
        item = { posicion: pos, mm1: null, mm2: null, mm3: null, rechazar: 'rango' };
      } else {
        const w = aColumnasBd(v);
        item = w.ok
          ? { posicion: pos, mm1: w.cols.mm1, mm2: w.cols.mm2, mm3: w.cols.mm3 }
          : { posicion: pos, mm1: null, mm2: null, mm3: null, rechazar: w.motivo };
      }
      items.push(item);
    }

    // Hash independiente del orden de los montajes.
    normalizados.sort((a, z) => (a as number[])[0] - (z as number[])[0]);
    const contenido = contenidoDelHash(clienteId, patente, normalizados, distribucion, odometro);
    const hash = await sha256Hex(JSON.stringify(contenido));
    const args: GuardarArgs = {
      cliente_id: clienteId,
      cuenta,
      patente,
      montajes: items,
      sesion_id: crypto.randomUUID(),
      clave: idem !== null ? 'k:' + idem : 'h:' + hash,
      hash,
      distribucion,
      odometro_km: odometro,
    };
    log.payload_resumen = {
      n_montajes: items.length,
      idempotency_key: idem !== null,
      ...(distribucion !== null ? { distribucion } : {}),
    };

    // El flag puede cambiar entre la lectura del perfil y esta llamada: la RPC lo vuelve a exigir (22023 por el
    // odómetro). Es el mismo 422 que el de arriba, no un fallo interno.
    const r = await c.deps.db.guardar(args).catch((e: unknown) => {
      if (e instanceof ErrorRpc && e.sqlstate === '22023' && e.detalle.includes('odometro')) {
        throw new HttpError(422, 'odometro');
      }
      throw e;
    });
    if (r.estado === 'conflicto') {
      return {
        response: respuesta({ code: 409, message: 'Idempotency-Key reutilizada con otro contenido' }, 409, c.requestId),
        motivo: 'idempotencia_conflicto',
      };
    }
    if (r.resultados.length !== items.length) throw new Error('resultado_inconsistente');
    log.vehiculo_id = r.vehiculo_id ?? null;
    const guardados = items.map((it, i) => ({ posicion: it.posicion, guardado: r.resultados[i].guardado === true }));
    log.n_guardados = guardados.filter((g) => g.guardado).length;
    log.n_fallidos = guardados.length - log.n_guardados;
    // Recuento de motivos por posición (solo vocabulario cerrado de la RPC; nunca texto del cliente).
    const motivos: Record<string, number> = {};
    for (const x of r.resultados) {
      if (x.guardado !== true && typeof x.motivo === 'string' && MOTIVOS_POSICION.has(x.motivo)) {
        motivos[x.motivo] = (motivos[x.motivo] ?? 0) + 1;
      }
    }
    // Alta de vehículo: solo la request que lo creó (un replay repite la respuesta pero no crea nada).
    const alta = r.creado === true && r.replay !== true;
    log.payload_resumen = {
      ...log.payload_resumen,
      replay: r.replay === true,
      ...(alta ? { vehiculo_creado: true, neumaticos_creados: r.neumaticos_creados ?? 0 } : {}),
      ...(Object.keys(motivos).length > 0 ? { motivos } : {}),
    };
    // Motivo agregado para el admin. La respuesta a DAC no lo lleva: conserva {posicion, guardado}.
    const todasSinNeumaticos = r.resultados.length > 0 && r.resultados.every((x) => x.motivo === 'sin_neumaticos');
    return {
      response: respuesta({ code: 200, data: { guardados } }, 200, c.requestId),
      motivo: r.estado === 'no_encontrado'
        ? 'no_encontrado'
        : todasSinNeumaticos
        ? 'sin_neumaticos'
        : log.n_fallidos > 0
        ? 'fallo_parcial'
        : alta
        ? 'vehiculo_creado'
        : null,
    };
  }
}
