// Dominio: desgaste de neumáticos. Funciones PURAS (sin DOM, sin supabase) para poder testearlas con node:test.
// Unidades: milímetros de profundidad de dibujo; tiempos en ms (created_at) y días.

// ── Umbrales de desgaste de neumáticos (nombres internos históricos, docs/08 apéndice T) ──
// El producto muestra cinco categorías, pero las columnas y parámetros de la base conservan sus nombres.
export const UMBRALES = { BAJO_MM: 8, CRITICO_MM: 5, RETIRO_MM: 3 };
// Alias de compatibilidad para código que aún usa los nombres anteriores.
export const WEAR = { OK_MM: UMBRALES.BAJO_MM, LOW_MM: UMBRALES.CRITICO_MM };
export const LIFE_LIMIT_MM = UMBRALES.RETIRO_MM;
// Diferencia interno vs externo (mm1 vs mm3) a partir de la cual se considera desgaste desparejo.
export const UNEVEN_MM = 1.5;
const MS_DAY = 1000 * 60 * 60 * 24;

// Estado exacto de una medida promedio en mm. null significa «desconocido» (sin medición).
export function wearStatus(avg) {
  if (avg == null) return null;
  if (avg < UMBRALES.RETIRO_MM) return 'desgaste_limite';
  if (avg < UMBRALES.CRITICO_MM) return 'mayor_desgaste';
  if (avg < UMBRALES.BAJO_MM) return 'poco_desgaste';
  return 'nuevo';
}

// Promedio de mm1/mm2/mm3 ignorando nulls; null si no hay ninguno. Solo es dato informativo (RN-01).
export function avgMm(m) { const v = [m.mm1, m.mm2, m.mm3].filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

// Huella MÍNIMA de una medición: min(mm1, mm2, mm3) (RN-01). Decide estado, alertas y conteos; espejo de least() en SQL.
// NULL si falta cualquiera de las tres: Math.min(null, 4) daría 0 y least() de SQL ignora nulos; ninguno debe fabricar un mínimo.
export function huellaMinima(m) {
  if (!m) return null;
  const v = [m.mm1, m.mm2, m.mm3].map(x => (x === null || x === undefined || x === '' ? NaN : Number(x)));
  return v.every(Number.isFinite) ? Math.min(...v) : null;
}

// Estado de una fila de medición, por la huella mínima (RN-01).
export function tireStatus(m) { return wearStatus(huellaMinima(m)); }

// Clase visual de un promedio: 'neutral' (sin datos) | 'ok' (nuevo/poco desgaste) | 'warn' (mayor desgaste) | 'crit' (desgaste límite).
// Solo cuatro niveles visuales: el operario distingue las categorías por el texto del chip, no solo por color (docs/14 §5).
export function wearClass(avg) {
  const st = wearStatus(avg);
  if (st === null) return 'neutral';
  if (st === 'desgaste_limite') return 'crit';
  if (st === 'mayor_desgaste') return 'warn';
  return 'ok';
}

// Zonas de fondo del gráfico de Mediciones: alineadas a los tres counters de la tarjeta.
// El verde agrupa «nuevo» y «poco desgaste» (≥ crítico), naranja es «mayor desgaste», rojo es «desgaste límite».
export const MEDICIONES_ZONAS = [
  { lo: UMBRALES.CRITICO_MM, hi: Infinity, fill: 'rgba(52,199,89,0.04)' },
  { lo: UMBRALES.RETIRO_MM, hi: UMBRALES.CRITICO_MM, fill: 'rgba(255,149,0,0.04)' },
  { lo: 0, hi: UMBRALES.RETIRO_MM, fill: 'rgba(255,59,48,0.04)' },
];

// Zona visual de un promedio para el gráfico de Mediciones; null si no hay dato.
export function medicionesZonaFill(avg) {
  const st = wearStatus(avg);
  if (st === null) return null;
  if (st === 'desgaste_limite') return MEDICIONES_ZONAS[2].fill;
  if (st === 'mayor_desgaste') return MEDICIONES_ZONAS[1].fill;
  return MEDICIONES_ZONAS[0].fill;
}

// Cuenta promedios por nivel visual (los null se ignoran). Mantiene el contrato {ok, warn, crit} que usan las vistas de medición.
export function countByStatus(avgs) {
  const c = { ok: 0, warn: 0, crit: 0 };
  avgs.forEach(a => { const cls = wearClass(a); if (cls !== 'neutral') c[cls]++; });
  return c;
}

// Tasa de desgaste entre la primera y la última medición del historial (ordenado ascendente por fecha).
// Devuelve {mmPerDay, mmPerWeek, days} (days redondeado) o null si hay <2 mediciones,
// las fechas no avanzan (days<=0) o falta algún promedio. Positivo = se está gastando.
export function wearRate(hist){
  if(!hist||hist.length<2) return null;
  const oldest=hist[0], newest=hist[hist.length-1];
  const avgOld=avgMm(oldest), avgNew=avgMm(newest);
  const days=(new Date(newest.created_at).getTime()-new Date(oldest.created_at).getTime())/MS_DAY;
  if(!(days>0) || avgOld==null || avgNew==null) return null;
  const mmPerDay=(avgOld-avgNew)/days;
  return {mmPerDay, mmPerWeek:mmPerDay*7, days:Math.round(days)};
}

// Días hasta llegar a `limit` mm al ritmo mmPerDay. null si no se está desgastando (mmPerDay<=0),
// si faltan datos, o si ya está en/bajo el límite.
export function daysUntil(lastAvg, mmPerDay, limit=LIFE_LIMIT_MM){
  if(lastAvg==null || mmPerDay==null || !(mmPerDay>0) || !(lastAvg>limit)) return null;
  return Math.round((lastAvg-limit)/mmPerDay);
}

// Fecha estimada en que se alcanza el umbral (null si no hay predicción).
export function dateUntil(lastAvg, mmPerDay, limit=LIFE_LIMIT_MM, from=new Date()){
  const d=daysUntil(lastAvg,mmPerDay,limit);
  return d==null?null:new Date(new Date(from).getTime()+d*MS_DAY);
}

// Desgaste desparejo de una medición: {diff, side:'interno'|'externo'} si |mm1-mm3| >= 1.5, si no null.
// Orden físico (app DAC): mm1=interno, mm2=centro, mm3=externo. `side` es el borde MÁS DESGASTADO (el de menos mm).
export function unevenWear(row){
  if(!row || row.mm1==null || row.mm3==null) return null;
  const diff=Math.abs(row.mm1-row.mm3);
  if(diff<UNEVEN_MM) return null;
  return {diff, side:row.mm1<row.mm3?'interno':'externo'};
}

// Análisis completo de una rueda a partir de su historial ascendente. null si no hay historial.
// Campos: lastAvg, mmPerWeek, mmPerDay, days, daysUntilLimit, unevenWear, unevenSide.
export function analyzeTire(hist){
  if(!hist || hist.length<1) return null;
  const lastAvg=avgMm(hist[hist.length-1]);
  const result={lastAvg};
  const rate=wearRate(hist);
  if(rate){
    result.mmPerWeek=rate.mmPerWeek;
    result.mmPerDay=rate.mmPerDay;
    result.days=rate.days;
    result.daysUntilLimit=daysUntil(lastAvg,rate.mmPerDay);
  }
  const u=unevenWear(hist[hist.length-1]);
  if(u){ result.unevenWear=u.diff; result.unevenSide=u.side; }
  return result;
}
