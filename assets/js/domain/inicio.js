// Reglas puras de la pantalla de Inicio (sin DOM ni supabase). Tests: tests/unit/inicio.test.mjs
// Entradas: filas de v_estado_neumaticos (una por neumático), v_salud_dispositivos y v_resumen_flota_cliente.
import { referenciaTasas, evaluarDesgaste } from './desgaste-flota.js';

export const SEMANAS_ATENCION = 4;   // "cruza el límite en ~N semanas" entra en Requieren atención (igual que la alerta de la base)
export const SEMANAS_PROXIMOS = 12;  // horizonte de Próximos cambios
export const MAX_ATENCION = 6;
export const MAX_PROXIMOS = 5;

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// El estado "sin datos" solo corresponde cuando NO hay vehículos registrados ni ninguna fila en las vistas derivadas
// (neumáticos, alertas, dispositivos). Un cliente con vehículos pero sin neumáticos medidos NO está "sin datos":
// tiene vehículos y debe verlos (las vistas v_estado_neumaticos/v_alertas solo traen filas con neumáticos o mediciones).
//   'vacio' | 'sin_mediciones' | 'con_datos'
export function estadoInicio({ vehiculosTotal = 0, estadoRows = [], alertas = [], salud = [] } = {}) {
  const v = Number(vehiculosTotal) || 0;
  if (!v && !estadoRows.length && !alertas.length && !salud.length) return 'vacio';
  if (!estadoRows.length) return 'sin_mediciones';
  return 'con_datos';
}

// Proporciones de la flota por estado de neumático. `pct` suma 100 (el resto del redondeo va al segmento mayor).
export function resumenNeumaticos(rows) {
  const r = { total: 0, ok: 0, bajo: 0, critico: 0, sin_datos: 0 };
  for (const f of rows || []) {
    r.total++;
    if (f.estado === 'ok' || f.estado === 'bajo' || f.estado === 'critico') r[f.estado]++;
    else r.sin_datos++;
  }
  const claves = ['ok', 'bajo', 'critico', 'sin_datos'];
  const pct = { ok: 0, bajo: 0, critico: 0, sin_datos: 0 };
  if (r.total) {
    claves.forEach(k => { pct[k] = Math.floor((r[k] / r.total) * 100); });
    const resto = 100 - claves.reduce((s, k) => s + pct[k], 0);
    const mayor = claves.reduce((m, k) => (r[k] > r[m] ? k : m), 'ok');
    pct[mayor] += resto;
  }
  return { ...r, pct };
}

// "~1 semana", "~6 semanas", "menos de 1 semana".
export function textoSemanas(s) {
  const n = num(s);
  if (n === null) return '';
  if (n < 1) return 'menos de 1 semana';
  const r = Math.round(n);
  return `~${r} ${r === 1 ? 'semana' : 'semanas'}`;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const posiciones = filas => filas.map(f => `P${f.posicion}`).join(', ');

// Causa principal de un vehículo, en una frase. Orden de urgencia (rango): crítico, cruza el límite pronto, desgaste bajo,
// desgaste mayor al normal, sin medir. Devuelve null si el vehículo no necesita atención.
function causaDe(filas, ref) {
  const crit = filas.filter(f => f.estado === 'critico');
  if (crit.length) return { nivel: 'critico', rango: 0, n: crit.length, causa: `${plural(crit.length, 'neumático crítico', 'neumáticos críticos')} (${posiciones(crit)})` };
  const cruza = filas
    .filter(f => (f.estado === 'ok' || f.estado === 'bajo') && num(f.semanas_hasta_critico) !== null && num(f.semanas_hasta_critico) <= SEMANAS_ATENCION)
    .sort((a, b) => num(a.semanas_hasta_critico) - num(b.semanas_hasta_critico));
  if (cruza.length) {
    const s = num(cruza[0].semanas_hasta_critico);
    return { nivel: 'cruza', rango: 1, n: cruza.length, semanas: s, causa: `Cruza el límite crítico en ${textoSemanas(s)} (P${cruza[0].posicion})` };
  }
  const bajo = filas.filter(f => f.estado === 'bajo');
  if (bajo.length) return { nivel: 'bajo', rango: 2, n: bajo.length, causa: `${plural(bajo.length, 'neumático con desgaste bajo', 'neumáticos con desgaste bajo')} (${posiciones(bajo)})` };
  const anormal = filas.filter(f => evaluarDesgaste(f, ref).mayorAlNormal);
  if (anormal.length) return { nivel: 'anormal', rango: 3, n: anormal.length, causa: `Desgaste mayor al normal (${posiciones(anormal)})` };
  const sinMedir = filas.filter(f => f.sin_medir);
  if (sinMedir.length) {
    const dias = Math.max(...sinMedir.map(f => num(f.dias_desde_medicion) ?? -1));
    return { nivel: 'sin_medir', rango: 4, n: sinMedir.length, causa: dias >= 0 ? `Sin medir hace ${plural(dias, 'día', 'días')}` : 'Sin mediciones registradas' };
  }
  return null;
}

// Vehículos que requieren atención, del más al menos urgente (máx. `max`). `total` = cuántos hay en realidad.
export function requierenAtencion(rows, { max = MAX_ATENCION } = {}) {
  const ref = referenciaTasas(rows || []);
  const porVeh = new Map();
  for (const f of rows || []) {
    if (!porVeh.has(f.vehiculo_id)) porVeh.set(f.vehiculo_id, []);
    porVeh.get(f.vehiculo_id).push(f);
  }
  const lista = [];
  for (const [id, filas] of porVeh) {
    const c = causaDe(filas, ref);
    if (!c) continue;
    const mm = filas.map(f => num(f.promedio)).filter(x => x !== null);
    lista.push({
      vehiculo_id: id, cliente_id: filas[0].cliente_id, nombre: filas[0].vehiculo_nombre || '', patente: filas[0].patente || '',
      ...c, min_mm: mm.length ? Math.min(...mm) : null,
    });
  }
  lista.sort((a, b) => a.rango - b.rango
    || b.n - a.n
    || (a.semanas ?? 99) - (b.semanas ?? 99)
    || (a.min_mm ?? 99) - (b.min_mm ?? 99)
    || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return { items: lista.slice(0, max), total: lista.length };
}

// Neumáticos que cruzarán el nivel crítico dentro del horizonte (aún no críticos), el más cercano primero.
export function proximosCambios(rows, { max = MAX_PROXIMOS, semanas = SEMANAS_PROXIMOS } = {}) {
  const lista = (rows || [])
    .filter(f => (f.estado === 'ok' || f.estado === 'bajo') && num(f.semanas_hasta_critico) !== null && num(f.semanas_hasta_critico) <= semanas)
    .map(f => ({
      vehiculo_id: f.vehiculo_id, nombre: f.vehiculo_nombre || '', patente: f.patente || '', posicion: f.posicion,
      semanas: num(f.semanas_hasta_critico), mm: num(f.promedio),
    }))
    .sort((a, b) => a.semanas - b.semanas || String(a.nombre).localeCompare(String(b.nombre), 'es') || a.posicion - b.posicion);
  return { items: lista.slice(0, max), total: lista.length };
}

// Dispositivos: activos (midieron en los últimos 7 días) y el resto.
export function resumenDispositivos(salud) {
  const total = (salud || []).length;
  const activos = (salud || []).filter(s => s.estado === 'activo').length;
  return { total, activos, inactivos: total - activos };
}

// Fecha (ISO) de la medición más reciente, o null.
export function ultimaMedicion(rows) {
  let max = null;
  for (const f of rows || []) if (f.ultima_medicion_at && (!max || f.ultima_medicion_at > max)) max = f.ultima_medicion_at;
  return max;
}

// Admin: clientes con urgencias (neumáticos críticos o alertas críticas), los de más urgencias primero.
export function clientesConUrgencias(resumen, max = MAX_ATENCION) {
  return (resumen || [])
    .map(r => ({ ...r, urgencias: (num(r.n_critico) || 0) + (num(r.n_alertas_sev3) || 0) }))
    .filter(r => r.urgencias > 0)
    .sort((a, b) => b.urgencias - a.urgencias || (num(b.n_critico) || 0) - (num(a.n_critico) || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, max);
}
