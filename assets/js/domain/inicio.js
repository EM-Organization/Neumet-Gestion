// Reglas puras de la pantalla de Inicio (sin DOM ni supabase). Tests: tests/unit/inicio.test.mjs
// Entradas: filas de v_estado_neumaticos (una por neumático), v_salud_dispositivos y v_resumen_flota_cliente.
import { referenciaTasas, evaluarDesgaste } from './desgaste-flota.js';
import { esAuxilio, estadoContable } from './auxilio.js';
import { BANDERA, ORDEN_ESTADOS } from './estado-desgaste.js';
import { huellaMinima } from './desgaste.js';
import { semanasHasta } from './panel-rueda.js';

export const SEMANAS_ATENCION = 4;   // "cruza el límite en ~N semanas" entra en Requieren atención (igual que la alerta de la base)
export const SEMANAS_PROXIMOS = 12;  // horizonte de Próximos cambios
export const MAX_ATENCION = 6;
export const MAX_PROXIMOS = 5;
// Estados con plazo hasta el desgaste límite (los que aún no lo alcanzaron).
const EN_CAMINO = ['nuevo', 'poco_desgaste', 'mayor_desgaste'];

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// Semanas hasta el desgaste límite de un neumático. Sale de la huella mínima (RN-01: el mínimo decide el estado), no del
// promedio que proyecta v_estado_neumaticos.semanas_hasta_retiro: esa columna sobrestima el plazo (G-04, pendiente en docs/08).
export const semanasRetiroDe = f => semanasHasta(huellaMinima(f), f.umbral_retiro_mm, f.tasa_mm_semana);

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
  const r = { total: 0, nuevo: 0, poco_desgaste: 0, mayor_desgaste: 0, desgaste_limite: 0, desconocido: 0 };
  for (const f of rows || []) {
    r.total++;
    const est = estadoContable(f); // el auxilio no cuenta como advertencia
    if (r[est] !== undefined) r[est]++;
    else r.desconocido++;
  }
  const claves = ['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido'];
  const pct = { nuevo: 0, poco_desgaste: 0, mayor_desgaste: 0, desgaste_limite: 0, desconocido: 0 };
  if (r.total) {
    claves.forEach(k => { pct[k] = Math.floor((r[k] / r.total) * 100); });
    const resto = 100 - claves.reduce((s, k) => s + pct[k], 0);
    const mayor = claves.reduce((m, k) => (r[k] > r[m] ? k : m), 'nuevo');
    pct[mayor] += resto;
  }
  return { ...r, pct };
}

// Cifras del resumen que se muestran: solo las que tienen valor, en el orden de siempre (de buen estado a sin datos).
// Un 0 no aporta y solo ocupa lugar. Si no queda ninguna, `vacio` avisa para decir «Sin neumáticos medidos».
const CIFRAS = ['nuevo', 'poco_desgaste', 'mayor_desgaste', 'desgaste_limite', 'desconocido'];
export function cifrasVisibles(rs) {
  const claves = CIFRAS.filter(k => Number(rs?.[k]) > 0);
  return { claves, vacio: claves.length === 0 };
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
// Posiciones (números) de las filas, sin repetir: la vista las muestra como mini vehículo y con su nombre.
const posiciones = filas => [...new Set(filas.map(f => Number(f.posicion)))].sort((a, b) => a - b);

// Causa principal de un vehículo, en una frase. Orden de urgencia (rango): desgaste límite, cruza el límite pronto,
// mayor desgaste, desgaste acelerado, sin medir. Devuelve null si el vehículo no necesita atención.
function causaDe(filas, ref) {
  const limite = filas.filter(f => estadoContable(f) === 'desgaste_limite');
  if (limite.length) return { nivel: 'limite', rango: 0, n: limite.length, posiciones: posiciones(limite), causa: plural(limite.length, 'neumático en desgaste límite', 'neumáticos en desgaste límite') };
  const cruza = filas
    .filter(f => !esAuxilio(f) && EN_CAMINO.includes(f.estado))
    .map(f => ({ f, s: semanasRetiroDe(f) }))
    .filter(x => x.s !== null && x.s <= SEMANAS_ATENCION)
    .sort((a, b) => a.s - b.s);
  if (cruza.length) {
    const { f, s } = cruza[0];
    return { nivel: 'cruza', rango: 1, n: cruza.length, semanas: s, posiciones: [Number(f.posicion)], causa: `Cruza el desgaste límite en ${textoSemanas(s)}` };
  }
  const mayor = filas.filter(f => estadoContable(f) === 'mayor_desgaste');
  if (mayor.length) return { nivel: 'mayor_desgaste', rango: 2, n: mayor.length, posiciones: posiciones(mayor), causa: plural(mayor.length, 'neumático con mayor desgaste', 'neumáticos con mayor desgaste') };
  const anormal = filas.filter(f => !esAuxilio(f) && evaluarDesgaste(f, ref).mayorAlNormal);
  if (anormal.length) return { nivel: 'anormal', rango: 3, n: anormal.length, posiciones: posiciones(anormal), causa: BANDERA.texto };
  const sinMedir = filas.filter(f => f.sin_medir);
  if (sinMedir.length) {
    const dias = Math.max(...sinMedir.map(f => num(f.dias_desde_medicion) ?? -1));
    return { nivel: 'sin_medir', rango: 4, n: sinMedir.length, posiciones: posiciones(sinMedir), causa: dias >= 0 ? `Sin medir hace ${plural(dias, 'día', 'días')}` : 'Sin mediciones registradas' };
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
    const mm = filas.map(huellaMinima).filter(x => x !== null); // RN-01: el mínimo de la flota de la lista
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

// Neumáticos que cruzarán el desgaste límite dentro del horizonte (aún no en límite), el más cercano primero.
export function proximosCambios(rows, { max = MAX_PROXIMOS, semanas = SEMANAS_PROXIMOS } = {}) {
  const lista = (rows || [])
    .filter(f => !esAuxilio(f) && EN_CAMINO.includes(f.estado))
    .map(f => ({ f, s: semanasRetiroDe(f) }))
    .filter(x => x.s !== null && x.s <= semanas)
    .map(({ f, s }) => ({
      vehiculo_id: f.vehiculo_id, nombre: f.vehiculo_nombre || '', patente: f.patente || '', posicion: f.posicion,
      semanas: s, mm: huellaMinima(f),
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

// Admin: clientes con urgencias (neumáticos en desgaste límite o alertas de severidad 3), los de más urgencias primero.
// v_resumen_flota_cliente conserva nombres históricos: n_critico = desgaste_limite.
export function clientesConUrgencias(resumen, max = MAX_ATENCION) {
  return (resumen || [])
    .map(r => ({ ...r, urgencias: (num(r.n_critico) || 0) + (num(r.n_alertas_sev3) || 0) }))
    .filter(r => r.urgencias > 0)
    .sort((a, b) => b.urgencias - a.urgencias || (num(b.n_critico) || 0) - (num(a.n_critico) || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, max);
}

// ---- Últimas mediciones -------------------------------------------------------------------------------------
// Entrada: filas de la función ultimas_mediciones (una por posición de la última visita de cada vehículo, ya ordenadas
// del vehículo medido más recientemente al más antiguo). Salida: un elemento por vehículo con sus neumáticos.
export const MAX_ULTIMAS = 8;
export const DESGASTE_ALTO_MM = 1;   // más de 1 mm perdido entre dos visitas se destaca
export const LECTURA_MAYOR_MM = 0.3; // una lectura mayor que la anterior por más de esto no es desgaste (ruido, cambio de neumático)

// Diferencia en mm entre la medición anterior y la última y su nivel: 'normal' | 'alto' (desgaste mayor al habitual)
// | 'sube' (lectura mayor que la anterior). Sin medición previa del mismo neumático: null.
export function comparativaDesgaste(ahora, antes) {
  const a = num(ahora), b = num(antes);
  if (a === null || b === null) return null;
  const dif = Math.round((a - b) * 100) / 100;
  const nivel = dif > LECTURA_MAYOR_MM ? 'sube' : (-dif > DESGASTE_ALTO_MM ? 'alto' : 'normal');
  return { antes: b, ahora: a, dif, nivel };
}

export function ultimasMediciones(rows, { max = MAX_ULTIMAS } = {}) {
  const porVeh = new Map();
  for (const r of rows || []) {
    if (!porVeh.has(r.vehiculo_id)) {
      if (porVeh.size >= max) continue;
      porVeh.set(r.vehiculo_id, {
        vehiculo_id: r.vehiculo_id, nombre: r.nombre || '', patente: r.patente || '', numero: r.numero || '',
        medido_at: r.medido_at, neumaticos: [],
      });
    }
    porVeh.get(r.vehiculo_id).neumaticos.push({
      posicion: r.posicion, mm: num(r.mm_ahora), antes_at: r.antes_at || null, comparativa: comparativaDesgaste(r.mm_ahora, r.mm_antes),
    });
  }
  const lista = [...porVeh.values()];
  for (const v of lista) v.neumaticos.sort((a, b) => a.posicion - b.posicion);
  return lista;
}

// Peor cambio de un vehículo: el único neumático que su fila de Últimas mediciones muestra. Criterio en orden:
// 1. peor estado (ORDEN_ESTADOS); 2. a igual estado, mayor caída en mm; 3. a igual caída, la primera posición.
// Entrada: { posicion, estado (clave de ORDEN_ESTADOS), comparativa (de comparativaDesgaste) }. Sin neumáticos, null.
export function peorCambio(neumaticos) {
  const rangoEstado = e => { const i = ORDEN_ESTADOS.indexOf(e); return i === -1 ? ORDEN_ESTADOS.length : i; };
  const lista = (neumaticos || []).map(n => ({ ...n, caida: n.comparativa && n.comparativa.dif < 0 ? -n.comparativa.dif : 0 }));
  if (!lista.length) return null;
  lista.sort((a, b) => rangoEstado(a.estado) - rangoEstado(b.estado) || b.caida - a.caida || a.posicion - b.posicion);
  return lista[0];
}

// Desgaste alto de una visita: las ruedas que perdieron más de DESGASTE_ALTO_MM frente a su medición anterior (nivel 'alto' de
// comparativaDesgaste). La fila de Últimas mediciones muestra el peor cambio por estado; esta marca va aparte para que una
// caída fuera de lo común en otra rueda no quede oculta. Devuelve la de mayor caída (a igual caída, la primera posición)
// y cuántas más hay, o null.
export function desgasteAlto(neumaticos) {
  const altos = (neumaticos || []).filter(n => n.comparativa && n.comparativa.nivel === 'alto')
    .sort((a, b) => a.comparativa.dif - b.comparativa.dif || a.posicion - b.posicion);
  if (!altos.length) return null;
  return { posicion: altos[0].posicion, caida: -altos[0].comparativa.dif, otras: altos.length - 1 };
}

// Rueda que «Ver vehículo» deja seleccionada en la ficha. Con desgaste alto, la de mayor caída: es lo que solo este bloque
// revela (el peor estado ya lo listan Requieren atención y los colores del mini). Si no, la del peor cambio. Sin ninguna, null.
export const ruedaParaVer = (peor, alto) => (alto ? alto.posicion : peor ? peor.posicion : null);
