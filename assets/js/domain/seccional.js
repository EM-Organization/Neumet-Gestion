// Dominio: filtrado por seccional (sucursal) del perfil global. Funciones PURAS (sin DOM ni supabase) para node:test.
// La seguridad la da la RLS (un perfil de seccional solo recibe sus filas); esto solo acota lo ya visible
// cuando un perfil GLOBAL elige una seccional en el selector.

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// Set de ids de vehículo de una seccional ('' = todas => null, sin filtro). vehs: [{id, sucursal_id}].
export function idsVehiculosDeSucursal(vehs, sucursalId) {
  if (sucursalId === '' || sucursalId === null || sucursalId === undefined) return null;
  const want = String(sucursalId);
  return new Set((vehs || []).filter(v => v.sucursal_id !== null && v.sucursal_id !== undefined && String(v.sucursal_id) === want)
    .map(v => String(v.id)));
}

// Filtra filas que traen vehiculo_id (v_estado_neumaticos, v_alertas...). ids null => sin filtro.
export function filtrarPorVehiculos(rows, ids, key = 'vehiculo_id') {
  if (!ids) return rows || [];
  return (rows || []).filter(r => ids.has(String(r[key])));
}

// Equivalente de una fila de v_resumen_flota_cliente para un subconjunto (una seccional), calculada en cliente.
export function resumenDesdeFilas(estadoRows, alertas, { clienteId = null, nombre = '', nVehiculos = null } = {}) {
  const rows = estadoRows || [];
  const cnt = e => rows.filter(r => r.estado === e).length;
  const sev = s => (alertas || []).filter(a => num(a.severidad) === s).length;
  let ultima = null;
  for (const r of rows) if (r.ultima_medicion_at && (!ultima || r.ultima_medicion_at > ultima)) ultima = r.ultima_medicion_at;
  return {
    cliente_id: clienteId,
    nombre,
    n_vehiculos_activos: nVehiculos ?? new Set(rows.map(r => r.vehiculo_id)).size,
    n_neumaticos_con_datos: rows.filter(r => r.estado !== 'sin_datos').length,
    n_ok: cnt('ok'),
    n_bajo: cnt('bajo'),
    n_critico: cnt('critico'),
    n_sin_datos: cnt('sin_datos'),
    n_alertas_sev1: sev(1),
    n_alertas_sev2: sev(2),
    n_alertas_sev3: sev(3),
    ultima_medicion_at: ultima,
  };
}

// ¿Debe mostrarse el selector? Solo a un perfil global con al menos una seccional.
export function mostrarSelector({ esSeccional, sucursales }) {
  return !esSeccional && (sucursales || []).length > 0;
}

// Traduce errores de la base al ABM de seccionales (mensajes en español para el admin).
export function mensajeErrorSeccional(err) {
  const code = err && err.code;
  if (code === '23505') return 'Ya existe una seccional con ese nombre en este cliente';
  if (code === '23503') return 'No se puede: la seccional tiene vehículos, dispositivos o usuarios asociados (reasígnalos antes)';
  if (code === '23514') return 'Nombre de seccional inválido (1 a 100 caracteres)';
  if (code === '42501') return 'No tienes permiso para gestionar seccionales';
  return 'No se pudo completar la operación';
}

export function validarNombreSeccional(nombre) {
  const n = String(nombre ?? '').trim();
  if (!n) return { ok: false, error: 'Escribe el nombre de la seccional' };
  if (n.length > 100) return { ok: false, error: 'El nombre no puede superar 100 caracteres' };
  return { ok: true, valor: n };
}

// Mensaje de la función crear-usuario-seccional.
export function mensajeErrorCrearUsuario(status, serverMsg) {
  if (status === 409) return 'Ya existe un usuario con ese email';
  if (status === 401 || status === 403) return 'No tienes permiso para crear usuarios';
  if (status === 404) return 'El cliente o la seccional ya no existe';
  if (status === 400 && serverMsg) return String(serverMsg);
  return 'No se pudo crear el usuario';
}

export function cuerpoCrearUsuario({ clienteId, sucursalId, email, password }) {
  const body = { cliente_id: Number(clienteId), email: String(email || '').trim() };
  if (sucursalId !== '' && sucursalId !== null && sucursalId !== undefined) body.sucursal_id = Number(sucursalId);
  if (password) body.password = password;
  return body;
}
