// Lógica de `crear-usuario-seccional` sin dependencias de red: todo el I/O entra por `Deps`.
// Crea un usuario Auth + su perfil 'cliente' de un cliente existente:
//   * con sucursal_id => perfil de SECCIONAL (solo ve los vehículos de esa seccional);
//   * sin sucursal_id => perfil GLOBAL adicional (ve todo el cliente).
// Solo admins. La coherencia sucursal/cliente la garantiza además una FK compuesta en la base.

export interface SucursalRow {
  id: number;
  cliente_id: number;
}

export type AuthResult = { id: string } | { error: 'exists' | 'other' };

export interface Deps {
  /** Orígenes permitidos (ALLOWED_ORIGINS). Vacío => se deniega todo origen de navegador. */
  allowedOrigins: string[];
  /** Valida el JWT (auth.getUser). null si inválido. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** ¿perfiles.rol = 'admin' para ese usuario? (service role) */
  isAdmin(userId: string): Promise<boolean>;
  /** ¿existe el cliente (no eliminado)? */
  clienteExiste(clienteId: number): Promise<boolean>;
  /** Seccional por id, o null si no existe. */
  getSucursal(sucursalId: number): Promise<SucursalRow | null>;
  createUser(email: string, password: string): Promise<AuthResult>;
  inviteUser(email: string): Promise<AuthResult>;
  deleteUser(userId: string): Promise<boolean>;
  /** Inserta el perfil rol='cliente'. true si se insertó. */
  insertPerfil(userId: string, clienteId: number, sucursalId: number | null, email: string): Promise<boolean>;
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
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

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
  const clienteId = posInt(body.cliente_id);
  if (clienteId === null) return fail('cliente_id inválido', 400, cors);
  let sucursalId: number | null = null;
  if (body.sucursal_id !== undefined && body.sucursal_id !== null && body.sucursal_id !== '') {
    sucursalId = posInt(body.sucursal_id);
    if (sucursalId === null) return fail('sucursal_id inválido', 400, cors);
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = body.password;
  if (email.length > 254 || /[\r\n]/.test(email) || !EMAIL_RE.test(email)) return fail('Email inválido', 400, cors);
  let pwd: string | null = null;
  if (password !== undefined && password !== null && password !== '') {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return fail(`La contraseña debe tener entre ${MIN_PASSWORD} y ${MAX_PASSWORD} caracteres`, 400, cors);
    }
    pwd = password;
  }

  // 3. El cliente y la seccional existen y son coherentes
  try {
    if (!(await deps.clienteExiste(clienteId))) return fail('Cliente inexistente', 404, cors);
    if (sucursalId !== null) {
      const s = await deps.getSucursal(sucursalId);
      if (!s) return fail('Seccional inexistente', 404, cors);
      if (s.cliente_id !== clienteId) {
        log('warn', 'sucursal_de_otro_cliente', { actor: user.id, cliente_id: clienteId, sucursal_id: sucursalId });
        return fail('La seccional no pertenece a ese cliente', 400, cors);
      }
    }
  } catch {
    log('error', 'lookup_failed');
    return fail('Error interno', 500, cors);
  }

  // 4. Alta: usuario Auth -> perfil, con compensación
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

  let inserted = false;
  try {
    inserted = await deps.insertPerfil(created.id, clienteId, sucursalId, email);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    const removed = await deps.deleteUser(created.id).catch(() => false);
    log('error', 'insert_perfil_failed', { mode, compensated: removed, auth_user_id: created.id });
    return fail('No se pudo crear el perfil', 500, cors);
  }

  log('info', 'usuario_created', { actor: user.id, cliente_id: clienteId, sucursal_id: sucursalId, mode });
  return respond(
    { ok: true, usuario: { user_id: created.id, cliente_id: clienteId, sucursal_id: sucursalId, email, modo: mode } },
    201,
    cors,
  );
}
