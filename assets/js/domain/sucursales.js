// Dominio: gestión de sucursales y alta/movimiento de vehículos del cliente con perfil global.
// Funciones PURAS (sin DOM ni supabase) para node:test. La autorización real vive en las RPC de la base.

const vacio = v => v === null || v === undefined || String(v).trim() === '';

export function validarNombreSucursal(nombre) {
  const n = String(nombre ?? '').trim();
  if (!n) return { ok: false, error: 'Falta el nombre de la sucursal' };
  if (n.length > 100) return { ok: false, error: 'El nombre no puede superar 100 caracteres' };
  return { ok: true, valor: n };
}

// Valida el formulario de vehículo nuevo y devuelve los argumentos de la RPC vehiculo_crear.
export function validarVehiculoNuevo({ numero, patente, tipoRuedas, sucursalId } = {}) {
  const num = String(numero ?? '').trim();
  const pat = String(patente ?? '').trim();
  if (!num) return { ok: false, error: 'Falta el número de coche' };
  if (num.length > 50) return { ok: false, error: 'El número de coche no puede superar 50 caracteres' };
  if (pat.length > 20) return { ok: false, error: 'La matrícula no puede superar 20 caracteres' };
  const tipo = Number(tipoRuedas);
  if (tipo !== 10 && tipo !== 16) return { ok: false, error: 'El tipo de ruedas debe ser 10 o 16' };
  return {
    ok: true,
    args: { p_numero: num, p_patente: pat || null, p_tipo_ruedas: tipo, p_sucursal_id: vacio(sucursalId) ? null : Number(sucursalId) },
  };
}

// Argumentos de la RPC vehiculo_mover_sucursal ('' = sin sucursal).
export const argsMover = (vehiculoId, sucursalId) =>
  ({ p_vehiculo_id: Number(vehiculoId), p_sucursal_id: vacio(sucursalId) ? null : Number(sucursalId) });

// Cantidad de vehículos por sucursal; la clave '' agrupa los que no tienen sucursal.
export function contarPorSucursal(vehiculos) {
  const out = new Map();
  for (const v of vehiculos || []) {
    const k = vacio(v.sucursal_id) ? '' : String(v.sucursal_id);
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

// Ignora mayúsculas, espacios y guiones: «sab 1234» encuentra «SAB-1234».
const norm = s => String(s ?? '').toUpperCase().replace(/[\s-]+/g, '');

// Filtro del listado por matrícula, número de coche o nombre; sin texto devuelve todo.
export function filtrarVehiculos(vehiculos, texto) {
  const q = norm(texto);
  if (!q) return vehiculos || [];
  return (vehiculos || []).filter(v => [v.patente, v.numero, v.nombre].some(c => norm(c).includes(q)));
}

export const textoSucursal = (id, sucursales) =>
  vacio(id) ? 'Sin sucursal' : ((sucursales || []).find(s => String(s.id) === String(id)) || {}).nombre || 'Sin sucursal';

export function confirmacionMover(vehiculo, destinoNombre) {
  const quien = vehiculo.numero ? `el coche ${vehiculo.numero}` : `«${vehiculo.nombre}»`;
  return {
    titulo: 'Mover vehículo',
    mensaje: `¿Mover ${quien} a «${destinoNombre}»? El historial de mediciones se conserva.`,
  };
}

export function confirmacionEliminar(nombre, nVehiculos) {
  return {
    titulo: 'Eliminar sucursal',
    mensaje: nVehiculos > 0
      ? `«${nombre}» tiene ${nVehiculos} ${nVehiculos === 1 ? 'vehículo' : 'vehículos'}. Moverlos antes de eliminarla.`
      : `¿Eliminar la sucursal «${nombre}»?`,
  };
}

// Traduce errores de las RPC a textos de la interfaz. El detalle de 23503 viene redactado por la base.
export function mensajeErrorGestion(err) {
  const code = err && err.code;
  if (code === '23505') {
    const m = String((err && err.message) || '');
    if (/numero/i.test(m)) return 'Ya existe un vehículo con ese número de coche';
    if (/patente/i.test(m)) return 'Ya existe un vehículo con esa matrícula';
    return 'Ya existe una sucursal con ese nombre';
  }
  if (code === '23503') {
    const m = String((err && err.message) || '');
    return /^la sucursal tiene/i.test(m) ? m.replace(/^./, c => c.toUpperCase()) : 'La sucursal tiene datos asociados. Reasignarlos antes de eliminarla';
  }
  if (code === '23514') return 'Datos inválidos. Revisar los campos';
  if (code === '42501') return 'Sin permiso para esta operación';
  if (code === 'P0002') return 'La sucursal o el vehículo ya no existe';
  return 'No se pudo completar la operación';
}
