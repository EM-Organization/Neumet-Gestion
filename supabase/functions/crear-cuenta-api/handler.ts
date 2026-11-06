// Lógica de `crear-cuenta-api` sin dependencias de red: todo el I/O entra por `Deps`.
// Crea un usuario Auth + perfil rol 'api' ligado a un cliente. La contraseña generada se devuelve UNA vez.

export type AuthResult = { id: string } | { error: 'exists' | 'other' };

export interface Deps {
  /** Orígenes permitidos (ALLOWED_ORIGINS). Vacío => se deniega todo origen de navegador. */
  allowedOrigins: string[];
  getUser(token: string): Promise<{ id: string } | null>;
  isAdmin(userId: string): Promise<boolean>;
  /** ¿existe el cliente y deleted_at es null? */
  clienteActivo(clienteId: number): Promise<boolean>;
  /** Nº de perfiles rol 'api' del cliente. */
  contarCuentasApi(clienteId: number): Promise<number>;
  createUser(email: string, password: string): Promise<AuthResult>;
  deleteUser(userId: string): Promise<boolean>;
  /** Inserta/upserta perfiles (rol 'api', cliente_id). */
  upsertPerfilApi(userId: string, clienteId: number): Promise<boolean>;
  log?(line: Record<string, unknown>): void;
  newRequestId?(): string;
}

export const MAX_BODY_BYTES = 10 * 1024;
export const MIN_PASSWORD = 16;
export const MAX_PASSWORD = 128;
export const GENERATED_LENGTH = 28;
export const MAX_CUENTAS_API = 5;
const EMAIL_RE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;
// 64 símbolos: 256 % 64 == 0, así que no hay sesgo al mapear bytes aleatorios.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function generarPassword(length = GENERATED_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % 64]).join('');
}

function respond(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (error: string, status: number, h: Record<string, string>) => respond({ ok: false, error }, status, h);

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const request_id = deps.newRequestId?.() ?? crypto.randomUUID();
  // Nunca se registran emails, contraseñas ni tokens.
  const log = (level: string, event: string, extra: Record<string, unknown> = {}) =>
    (deps.log ?? ((l) => console.log(JSON.stringify(l))))({ level, request_id, event, ...extra });

  const origin = req.headers.get('origin');
  const cors: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (origin) {
    if (!deps.allowedOrigins.includes(origin)) {
      log('warn', 'origin_not_allowed');
      return fail('Origen no permitido', 403, cors);
    }
    cors['Access-Control-Allow-Origin'] = origin;
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('Método no permitido', 405, cors);

  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return fail('No autenticado', 401, cors);
  const user = await deps.getUser(m[1]).catch(() => null);
  if (!user) {
    log('warn', 'invalid_token');
    return fail('No autenticado', 401, cors);
  }
  let admin = false;
  try {
    admin = await deps.isAdmin(user.id);
  } catch {
    log('error', 'role_check_failed');
    return fail('Error interno', 500, cors);
  }
  if (!admin) {
    log('warn', 'forbidden', { actor: user.id });
    return fail('Acceso denegado', 403, cors);
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail('Solicitud demasiado grande', 413, cors);
  let body: Record<string, unknown>;
  try {
    const p = JSON.parse(raw);
    if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new Error();
    body = p;
  } catch {
    return fail('JSON inválido', 400, cors);
  }
  const clienteId = body.cliente_id;
  if (typeof clienteId !== 'number' || !Number.isSafeInteger(clienteId) || clienteId < 1) {
    return fail('cliente_id inválido', 400, cors);
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email.length > 254 || /[\r\n]/.test(email) || !EMAIL_RE.test(email)) return fail('Email inválido', 400, cors);
  let pwd: string | null = null;
  const password = body.password;
  if (password !== undefined && password !== null && password !== '') {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return fail(`La contraseña debe tener entre ${MIN_PASSWORD} y ${MAX_PASSWORD} caracteres`, 400, cors);
    }
    pwd = password;
  }

  try {
    if (!(await deps.clienteActivo(clienteId))) return fail('Cliente no encontrado', 404, cors);
    if ((await deps.contarCuentasApi(clienteId)) >= MAX_CUENTAS_API) {
      log('info', 'limit_reached', { actor: user.id, cliente_id: clienteId });
      return fail(`Máximo ${MAX_CUENTAS_API} cuentas de API por cliente`, 409, cors);
    }
  } catch {
    log('error', 'precheck_failed', { cliente_id: clienteId });
    return fail('Error interno', 500, cors);
  }

  const generated = pwd === null;
  const finalPwd = pwd ?? generarPassword();
  const created = await deps.createUser(email, finalPwd);
  if ('error' in created) {
    if (created.error === 'exists') {
      log('info', 'email_exists', { actor: user.id });
      return fail('Ya existe un usuario con ese email', 409, cors);
    }
    log('error', 'auth_create_failed');
    return fail('No se pudo crear el usuario', 500, cors);
  }

  let okPerfil = false;
  try {
    okPerfil = await deps.upsertPerfilApi(created.id, clienteId);
  } catch {
    okPerfil = false;
  }
  if (!okPerfil) {
    const removed = await deps.deleteUser(created.id).catch(() => false);
    log('error', 'insert_perfil_failed', { compensated: removed, auth_user_id: created.id, cliente_id: clienteId });
    return fail('No se pudo crear la cuenta de API', 500, cors);
  }

  log('info', 'cuenta_api_created', { actor: user.id, cliente_id: clienteId, auth_user_id: created.id, generated });
  return respond(
    {
      ok: true,
      cuenta: { user_id: created.id, email, cliente_id: clienteId },
      // Solo se devuelve si la generó el servidor; se muestra una única vez.
      ...(generated ? { password: finalPwd } : {}),
    },
    201,
    cors,
  );
}
