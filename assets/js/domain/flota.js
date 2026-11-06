// Dominio: flota con prioridades y centro de alertas. Funciones PURAS (sin DOM ni supabase) para node:test.
// Entradas = filas de las vistas SQL v_estado_neumaticos, v_alertas y v_resumen_flota_cliente (docs/08, apéndice A).

// Orden de prioridad del semáforo (menor = más urgente).
export const ESTADO_RANK = { critico: 0, bajo: 1, sin_datos: 2, ok: 3 };
export const ESTADO_LABEL = { critico: 'Crítico', bajo: 'Bajo', sin_datos: 'Sin datos', ok: 'OK' };
export const ESTADO_BADGE = { critico: 'red', bajo: 'orange', sin_datos: 'gray', ok: 'green' };

export const SEVERIDAD_LABEL = { 3: 'Crítica', 2: 'Media', 1: 'Informativa' };
export const SEVERIDAD_BADGE = { 3: 'red', 2: 'orange', 1: 'gray' };
export const TIPO_LABEL = {
  critico: 'Neumático crítico',
  bajo: 'Desgaste bajo',
  cruza_critico_pronto: 'Cruzará nivel crítico',
  desgaste_irregular: 'Desgaste irregular',
  sin_medir: 'Sin medir',
};

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
export const estadoRank = e => (e in ESTADO_RANK ? ESTADO_RANK[e] : ESTADO_RANK.sin_datos);
export const estadoLabel = e => ESTADO_LABEL[e] || 'Sin datos';
export const severidadLabel = s => SEVERIDAD_LABEL[num(s)] || 'Informativa';
export const tipoLabel = t => TIPO_LABEL[t] || String(t ?? '');

// Semáforo del vehículo = peor estado entre sus neumáticos con datos; si ninguno tiene datos, 'sin_datos'.
export function semaforoVehiculo(estados) {
  let peor = null;
  for (const e of estados) {
    if (e === 'sin_datos' || !(e in ESTADO_RANK)) continue;
    if (peor === null || ESTADO_RANK[e] < ESTADO_RANK[peor]) peor = e;
  }
  return peor || 'sin_datos';
}

// Agrupa filas de v_estado_neumaticos por vehículo y ordena por severidad:
// semáforo, nº de críticos, nº de bajos, nº sin medir, menor profundidad (mm) y nombre.
export function agruparVehiculos(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = r.vehiculo_id;
    let v = map.get(key);
    if (!v) {
      v = {
        vehiculo_id: key, cliente_id: r.cliente_id, nombre: r.vehiculo_nombre || '', patente: r.patente || '',
        n_neumaticos: 0, n_ok: 0, n_bajo: 0, n_critico: 0, n_sin_datos: 0, n_sin_medir: 0, n_irregular: 0,
        min_mm: null, peor_posicion: null, ultima_medicion_at: null, estados: [],
      };
      map.set(key, v);
    }
    v.n_neumaticos++;
    v.estados.push(r.estado);
    if (r.estado === 'critico') v.n_critico++;
    else if (r.estado === 'bajo') v.n_bajo++;
    else if (r.estado === 'ok') v.n_ok++;
    else v.n_sin_datos++;
    if (r.sin_medir) v.n_sin_medir++;
    if (r.desgaste_irregular) v.n_irregular++;
    const mm = num(r.promedio);
    if (mm !== null && (v.min_mm === null || mm < v.min_mm)) { v.min_mm = mm; v.peor_posicion = r.posicion; }
    if (r.ultima_medicion_at && (!v.ultima_medicion_at || r.ultima_medicion_at > v.ultima_medicion_at)) v.ultima_medicion_at = r.ultima_medicion_at;
  }
  const out = [...map.values()].map(v => {
    const { estados, ...rest } = v;
    return { ...rest, semaforo: semaforoVehiculo(estados) };
  });
  return out.sort(compararVehiculos);
}

export function compararVehiculos(a, b) {
  return estadoRank(a.semaforo) - estadoRank(b.semaforo)
    || b.n_critico - a.n_critico
    || b.n_bajo - a.n_bajo
    || b.n_sin_medir - a.n_sin_medir
    || (a.min_mm === null) - (b.min_mm === null)
    || (a.min_mm ?? 0) - (b.min_mm ?? 0)
    || String(a.nombre).localeCompare(String(b.nombre), 'es');
}

// Filtros de UI (el aislamiento por cliente lo garantiza RLS en el servidor; esto solo acota lo ya visible).
export function filtrarVehiculos(vehiculos, { clienteId = '', estado = '', q = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return (vehiculos || []).filter(v =>
    (!clienteId || String(v.cliente_id) === String(clienteId))
    && (!estado || v.semaforo === estado)
    && (!needle || `${v.nombre} ${v.patente}`.toLowerCase().includes(needle)));
}

// Suma de filas de v_resumen_flota_cliente (opcionalmente de un solo cliente).
export function sumarResumen(resumen, clienteId = '') {
  const t = { n_vehiculos: 0, n_neumaticos: 0, n_ok: 0, n_bajo: 0, n_critico: 0, n_sin_datos: 0, n_alertas: 0 };
  for (const r of resumen || []) {
    if (clienteId && String(r.cliente_id) !== String(clienteId)) continue;
    t.n_vehiculos += num(r.n_vehiculos_activos) || 0;
    t.n_neumaticos += num(r.n_neumaticos_con_datos) || 0;
    t.n_ok += num(r.n_ok) || 0;
    t.n_bajo += num(r.n_bajo) || 0;
    t.n_critico += num(r.n_critico) || 0;
    t.n_sin_datos += num(r.n_sin_datos) || 0;
    t.n_alertas += (num(r.n_alertas_sev1) || 0) + (num(r.n_alertas_sev2) || 0) + (num(r.n_alertas_sev3) || 0);
  }
  return t;
}

// KPIs de la pantalla de flota. Críticos y alertas salen del resumen SQL si existe; "sin medir" siempre de las filas.
export function kpisFlota(estadoRows, resumen = null, clienteId = '') {
  const rows = (estadoRows || []).filter(r => !clienteId || String(r.cliente_id) === String(clienteId));
  const sinMedir = rows.filter(r => r.sin_medir).length;
  if (resumen && resumen.length) {
    const t = sumarResumen(resumen, clienteId);
    return { vehiculos: t.n_vehiculos, criticos: t.n_critico, bajos: t.n_bajo, sin_medir: sinMedir, alertas: t.n_alertas };
  }
  return {
    vehiculos: new Set(rows.map(r => r.vehiculo_id)).size,
    criticos: rows.filter(r => r.estado === 'critico').length,
    bajos: rows.filter(r => r.estado === 'bajo').length,
    sin_medir: sinMedir,
    alertas: null,
  };
}

// Alertas: severidad desc, luego más antigua primero (ultima_medicion_at asc; null = nunca medido primero), luego vehículo/posición.
export function ordenarAlertas(alertas) {
  return [...(alertas || [])].sort((a, b) =>
    (num(b.severidad) || 0) - (num(a.severidad) || 0)
    || String(a.ultima_medicion_at || '').localeCompare(String(b.ultima_medicion_at || ''))
    || String(a.vehiculo_nombre || '').localeCompare(String(b.vehiculo_nombre || ''), 'es')
    || (num(a.posicion) || 0) - (num(b.posicion) || 0));
}

export function filtrarAlertas(alertas, { severidad = '', tipo = '', clienteId = '' } = {}) {
  return (alertas || []).filter(a =>
    (!severidad || String(a.severidad) === String(severidad))
    && (!tipo || a.tipo === tipo)
    && (!clienteId || String(a.cliente_id) === String(clienteId)));
}

// Conteo por severidad (3/2/1) para los chips del centro de alertas.
export function contarPorSeveridad(alertas) {
  const c = { 3: 0, 2: 0, 1: 0 };
  for (const a of alertas || []) { const s = num(a.severidad); if (s in c) c[s]++; }
  return c;
}

// Tipos presentes (orden estable: por etiqueta) para poblar el filtro.
export function tiposPresentes(alertas) {
  return [...new Set((alertas || []).map(a => a.tipo).filter(Boolean))].sort((x, y) => tipoLabel(x).localeCompare(tipoLabel(y), 'es'));
}
