// Dominio: flota con prioridades y centro de alertas. Funciones PURAS (sin DOM ni supabase) para node:test.
// Entradas = filas de las vistas SQL v_estado_neumaticos, v_alertas y v_resumen_flota_cliente (docs/08, apéndice A).

// Orden de prioridad del semáforo (menor = más urgente).
export const ESTADO_RANK = {
  desgaste_limite: 0,
  mayor_desgaste: 1,
  poco_desgaste: 2,
  desconocido: 3,
  nuevo: 4,
};
export const ESTADO_LABEL = {
  desgaste_limite: ESTADOS.limite.texto,
  desconocido: ESTADOS.sinDatos.texto,
  mayor_desgaste: ESTADOS.mayor.texto,
  poco_desgaste: ESTADOS.poco.texto,
  nuevo: ESTADOS.bueno.texto,
};
export const ESTADO_BADGE = {
  desgaste_limite: 'red',
  desconocido: 'gray',
  mayor_desgaste: 'orange',
  poco_desgaste: 'blue',
  nuevo: 'green',
};

export const SEVERIDAD_LABEL = { 3: 'Alta', 2: 'Media', 1: 'Informativa' };
export const SEVERIDAD_BADGE = { 3: 'red', 2: 'orange', 1: 'gray' };
export const TIPO_LABEL = {
  limite: ESTADOS.limite.texto,
  cruza_limite_pronto: 'Cruzará desgaste límite',
  desgaste_irregular: 'Desgaste irregular',
  sin_medir: 'Sin medir',
};

import { esAuxilio, estadoContable } from './auxilio.js';
import { ESTADOS, textoEstadoBase } from './estado-desgaste.js';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
export const estadoRank = e => (e in ESTADO_RANK ? ESTADO_RANK[e] : ESTADO_RANK.desconocido);
export const estadoLabel = e => ESTADO_LABEL[e] || ESTADOS.sinDatos.texto;
export const severidadLabel = s => SEVERIDAD_LABEL[num(s)] || 'Informativa';
export const tipoLabel = t => TIPO_LABEL[t] || String(t ?? '');

// Semáforo del vehículo = peor estado entre sus neumáticos con datos; si ninguno tiene datos, 'desconocido'.
export function semaforoVehiculo(estados) {
  let peor = null;
  for (const e of estados) {
    if (e === 'desconocido' || !(e in ESTADO_RANK)) continue;
    if (peor === null || ESTADO_RANK[e] < ESTADO_RANK[peor]) peor = e;
  }
  return peor || 'desconocido';
}

// Agrupa filas de v_estado_neumaticos por vehículo y ordena por severidad:
// semáforo, nº de desgaste límite, nº de mayor desgaste, nº sin medir, menor profundidad (mm) y nombre.
export function agruparVehiculos(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = r.vehiculo_id;
    let v = map.get(key);
    if (!v) {
      v = {
        vehiculo_id: key, cliente_id: r.cliente_id, nombre: r.vehiculo_nombre || '', patente: r.patente || '',
        n_neumaticos: 0, n_nuevo: 0, n_poco_desgaste: 0, n_mayor_desgaste: 0, n_desgaste_limite: 0, n_desconocido: 0,
        n_sin_medir: 0, n_irregular: 0,
        min_mm: null, peor_posicion: null, ultima_medicion_at: null, estados: [],
      };
      map.set(key, v);
    }
    v.n_neumaticos++;
    const est = estadoContable(r); // el auxilio no cuenta como advertencia
    v.estados.push(est);
    if (est === 'nuevo') v.n_nuevo++;
    else if (est === 'poco_desgaste') v.n_poco_desgaste++;
    else if (est === 'mayor_desgaste') v.n_mayor_desgaste++;
    else if (est === 'desgaste_limite') v.n_desgaste_limite++;
    else v.n_desconocido++;
    if (r.sin_medir) v.n_sin_medir++;
    if (r.desgaste_irregular) v.n_irregular++;
    const mm = num(r.promedio);
    if (mm !== null && !esAuxilio(r) && (v.min_mm === null || mm < v.min_mm)) { v.min_mm = mm; v.peor_posicion = r.posicion; }
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
    || b.n_desgaste_limite - a.n_desgaste_limite
    || b.n_mayor_desgaste - a.n_mayor_desgaste
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
// v_resumen_flota_cliente conserva nombres históricos: n_ok=nuevo, n_bajo=poco_desgaste,
// n_mayor_desgaste=mayor_desgaste, n_critico=desgaste_limite, n_sin_datos=desconocido.
export function sumarResumen(resumen, clienteId = '') {
  const t = {
    n_vehiculos: 0, n_neumaticos: 0, n_nuevo: 0, n_poco_desgaste: 0, n_mayor_desgaste: 0,
    n_desgaste_limite: 0, n_desconocido: 0, n_alertas: 0,
  };
  for (const r of resumen || []) {
    if (clienteId && String(r.cliente_id) !== String(clienteId)) continue;
    t.n_vehiculos += num(r.n_vehiculos_activos) || 0;
    t.n_neumaticos += num(r.n_neumaticos_con_datos) || 0;
    t.n_nuevo += num(r.n_ok) || 0;
    t.n_poco_desgaste += num(r.n_bajo) || 0;
    t.n_mayor_desgaste += num(r.n_mayor_desgaste) || 0;
    t.n_desgaste_limite += num(r.n_critico) || 0;
    t.n_desconocido += num(r.n_sin_datos) || 0;
    t.n_alertas += (num(r.n_alertas_sev1) || 0) + (num(r.n_alertas_sev2) || 0) + (num(r.n_alertas_sev3) || 0);
  }
  return t;
}

// KPIs de la pantalla de flota. Desgaste límite y alertas salen del resumen SQL si existe; "sin medir" siempre de las filas.
export function kpisFlota(estadoRows, resumen = null, clienteId = '') {
  const rows = (estadoRows || []).filter(r => !clienteId || String(r.cliente_id) === String(clienteId));
  const sinMedir = rows.filter(r => r.sin_medir).length;
  if (resumen && resumen.length) {
    const t = sumarResumen(resumen, clienteId);
    return {
      vehiculos: t.n_vehiculos,
      limite: t.n_desgaste_limite,
      mayor_desgaste: t.n_mayor_desgaste,
      sin_medir: sinMedir,
      alertas: t.n_alertas,
    };
  }
  return {
    vehiculos: new Set(rows.map(r => r.vehiculo_id)).size,
    limite: rows.filter(r => estadoContable(r) === 'desgaste_limite').length,
    mayor_desgaste: rows.filter(r => estadoContable(r) === 'mayor_desgaste').length,
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
