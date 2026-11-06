// Reglas puras de clientes (sin DOM ni supabase): validación de alta, mensajes de error de crear-cliente,
// filtro de eliminados y estado del cliente. Tests: tests/unit/clientes.test.mjs
export const PASSWORD_MIN = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Alta: contraseña opcional (vacía => la función envía invitación por email). Devuelve {ok, error?, nombre, email, password}.
export function validarAlta({ nombre, email, password } = {}) {
  const n = String(nombre ?? '').trim(), e = String(email ?? '').trim(), p = String(password ?? '');
  if (!n || !e) return { ok: false, error: 'Completá nombre y email' };
  if (!EMAIL_RE.test(e)) return { ok: false, error: 'El email no es válido' };
  if (p !== '' && p.length < PASSWORD_MIN) return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres (o dejala vacía para enviar una invitación por email)` };
  return { ok: true, nombre: n, email: e, password: p === '' ? null : p };
}

// Cuerpo JSON para crear-cliente: sin password cuando se invita por email.
export function cuerpoCrearCliente(v) {
  const b = { nombre: v.nombre, email: v.email };
  if (v.password) b.password = v.password;
  return b;
}

// Mensaje en español para un error de crear-cliente (status HTTP + texto del servidor).
export function mensajeErrorCrearCliente(status, error) {
  const t = String(error ?? '').toLowerCase();
  if (status === 409 || /already|existe|registrad|duplicate/.test(t)) return 'Ya existe un usuario con ese email';
  if (status === 403 || status === 401) return 'No tenés permiso para crear clientes';
  if (status === 400) {
    if (/password|contrase/.test(t)) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
    if (/email/.test(t)) return 'El email no es válido';
    return 'Datos inválidos: revisá nombre, email y contraseña';
  }
  return 'No se pudo crear el cliente';
}

export const estaEliminado = c => !!(c && c.deleted_at);

// Lista visible: oculta eliminados salvo showDeleted; filtra por nombre.
export function clientesVisibles(clientes, { showDeleted = false, query = '' } = {}) {
  const q = String(query).toLowerCase();
  return (clientes || []).filter(c => (showDeleted || !estaEliminado(c)) && String(c.nombre ?? '').toLowerCase().includes(q));
}

export function clientStatus(c) {
  if (estaEliminado(c)) return { cls: 'red', lbl: 'Eliminado' };
  const disps = c.dispositivos || [];
  if (disps.length === 0) return { cls: 'orange', lbl: 'Sin dispositivo' };
  if (disps.every(d => !d.activo)) return { cls: 'red', lbl: 'Inactivo' };
  return { cls: 'green', lbl: 'Activo' };
}
