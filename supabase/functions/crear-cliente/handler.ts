// Lógica de `crear-cliente` sin dependencias de red: todo el I/O entra por `Deps`.

export interface ClienteRow {
  id: number;
  nombre: string;
  created_at: string;
  auth_user_id: string | null;
}

export type AuthResult = { id: string } | { error: 'exists' | 'other' };

export interface Deps {
  /** Orígenes permitidos (ALLOWED_ORIGINS). Vacío => se deniega todo origen de navegador. */
  allowedOrigins: string[];
  /** Valida el JWT (auth.getUser). null si inválido. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** ¿perfiles.rol = 'admin' para ese usuario? (service role) */
  isAdmin(userId: string): Promise<boolean>;
  createUser(email: string, password: string): Promise<AuthResult>;
  inviteUser(email: string): Promise<AuthResult>;
  deleteUser(userId: string): Promise<boolean>;
  /** Inserta en `clientes`; el trigger crea el perfil 'cliente'. */
  insertCliente(nombre: string, authUserId: string): Promise<ClienteRow | null>;
  log?(line: Record<string, unknown>): void;
  newRequestId?(): string;
}

export const MAX_BODY_BYTES = 10 * 1024;
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;
const EMAIL_RE = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[^\s@<>"',;:]{2,}$/;

function respond(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
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

  // 1. Autenticación y autorización
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

  // 2. Cuerpo y validación
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
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = body.password;
  if (nombre.length < 1 || nombre.length > 100) return fail('Nombre inválido (1 a 100 caracteres)', 400, cors);
  if (email.length > 254 || /[\r\n]/.test(email) || !EMAIL_RE.test(email)) return fail('Email inválido', 400, cors);
  let pwd: string | null = null;
  if (password !== undefined && password !== null && password !== '') {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return fail(`La contraseña debe tener entre ${MIN_PASSWORD} y ${MAX_PASSWORD} caracteres`, 400, cors);
    }
    pwd = password;
  }

  // 3. Alta: usuario Auth -> cliente (el trigger crea el perfil) con compensación
  const mode = pwd ? 'password' : 'invite';
  const created = pwd ? await deps.createUser(email, pwd) : await deps.inviteUser(email);
  if ('error' in created) {
    if (created.error === 'exists') {
      log('info', 'email_exists', { actor: user.id });
      return fail('Ya existe un usuario con ese email', 409, cors);
    }
    log('error', 'auth_create_failed', { mode });
    return fail('No se pudo crear el usuario', 500, cors);
  }

  let row: ClienteRow | null = null;
  try {
    row = await deps.insertCliente(nombre, created.id);
  } catch {
    row = null;
  }
  if (!row) {
    const removed = await deps.deleteUser(created.id).catch(() => false);
    log('error', 'insert_cliente_failed', { mode, compensated: removed, auth_user_id: created.id });
    return fail('No se pudo crear el cliente', 500, cors);
  }

  log('info', 'cliente_created', { actor: user.id, cliente_id: row.id, mode });
  return respond(
    {
      ok: true,
      cliente: {
        id: row.id,
        nombre: row.nombre,
        created_at: row.created_at,
        auth_user_id: row.auth_user_id,
        dispositivos: [],
        vehiculos: [],
      },
    },
    201,
    cors,
  );
}
