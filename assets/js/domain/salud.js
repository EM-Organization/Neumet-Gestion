// Reglas puras de salud de dispositivos (sin DOM ni supabase). Los estados los calcula la vista SQL v_salud_dispositivos
// (activo <= 7 días, sin_actividad <= 30, caido > 30, nunca = sin mediciones). Tests: tests/unit/salud.test.mjs
export const ESTADOS = ['caido', 'sin_actividad', 'nunca', 'activo']; // de más a menos grave (orden de la tabla)

export const ESTADO_INFO = {
  activo: { cls: 'green', lbl: 'Activo' },
  sin_actividad: { cls: 'orange', lbl: 'Sin actividad' },
  caido: { cls: 'red', lbl: 'Caído' },
  nunca: { cls: 'gray', lbl: 'Nunca midió' }
};

export const infoEstado = e => ESTADO_INFO[e] || { cls: 'gray', lbl: String(e ?? '—') };

const rango = e => { const i = ESTADOS.indexOf(e); return i < 0 ? ESTADOS.length : i; };

// Filtra por estado, cliente y texto (MAC / nombre). '' = sin filtro. Devuelve una copia ordenada: más grave primero,
// y dentro del estado, más días sin actividad primero (luego por MAC).
export function filtrarSalud(rows, { estado = '', clienteId = '', query = '' } = {}) {
  const q = String(query).trim().toLowerCase();
  return (rows || [])
    .filter(r => (!estado || r.estado === estado)
      && (!clienteId || String(r.cliente_id) === String(clienteId))
      && (!q || String(r.mac_address ?? '').toLowerCase().includes(q) || String(r.nombre ?? '').toLowerCase().includes(q)))
    .sort((a, b) => rango(a.estado) - rango(b.estado)
      || (Number(b.dias_sin_actividad) || 0) - (Number(a.dias_sin_actividad) || 0)
      || String(a.mac_address ?? '').localeCompare(String(b.mac_address ?? '')));
}

// Conteo por estado (todas las claves presentes) + total. Respeta el filtro de cliente si se indica.
export function contarPorEstado(rows, clienteId = '') {
  const out = { total: 0, activo: 0, sin_actividad: 0, caido: 0, nunca: 0 };
  (rows || []).forEach(r => {
    if (clienteId && String(r.cliente_id) !== String(clienteId)) return;
    out.total++;
    if (r.estado in out) out[r.estado]++;
  });
  return out;
}

// Texto de "días sin actividad": nunca/null => '—'; 0 => 'hoy'.
export function textoDias(r) {
  if (!r || r.estado === 'nunca' || r.dias_sin_actividad === null || r.dias_sin_actividad === undefined) return '—';
  const d = Number(r.dias_sin_actividad);
  if (!Number.isFinite(d)) return '—';
  if (d <= 0) return 'hoy';
  return d === 1 ? '1 día' : `${d} días`;
}
