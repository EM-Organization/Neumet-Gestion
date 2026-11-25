// Dominio: desgaste de neumáticos. Funciones PURAS (sin DOM, sin supabase) para poder testearlas con node:test.
// Unidades: milímetros de profundidad de dibujo; tiempos en ms (created_at) y días.

// ── Umbrales de desgaste de neumáticos (nombres internos históricos, docs/08 apéndice T) ──
// El producto muestra cinco categorías, pero las columnas y parámetros de la base conservan sus nombres.
export const UMBRALES = { BAJO_MM: 8, CRITICO_MM: 5, RETIRO_MM: 3 };
// Alias de compatibilidad para código que aún usa los nombres anteriores.
export const WEAR = { OK_MM: UMBRALES.BAJO_MM, LOW_MM: UMBRALES.CRITICO_MM };
export const LIFE_LIMIT_MM = UMBRALES.RETIRO_MM;
// Umbral de desgaste desparejo por defecto: el de la base (clientes.irregularidad_mm, default 2). Solo se usa si el umbral
// del cliente no se pudo leer; cada cliente tiene el suyo (CA-06).
export const IRREGULARIDAD_MM_DEFECTO = 2;
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

// Desgaste desparejo de una medición (CA-06, RN-06): {diff, side:'interno'|'externo'} si la diferencia entre la medida
// mayor y la menor es `irregularidadMm` o más (>=, como la base), si no null. Orden físico (app DAC): mm1=interno, mm2=centro,
// mm3=externo; el centro cuenta para la diferencia, sobre las medidas presentes (como greatest()/least() de SQL).
// `side` es el borde MÁS DESGASTADO entre interno y externo (el de menos mm). Con interno y externo iguales (desgaste
// central) sale 'externo' por convención; el texto del aviso aún no cubre ese caso.
// La diferencia se redondea a 0,1 como round(numeric,1) de la base. Sin el redondeo, 8,7 − 6,7 da 1,9999999999999991 y no
// llegaría a 2,0. Primero se quita el ruido de coma flotante (a 1e-6) y luego se redondea a 0,1, mitad hacia arriba.
// Sin mm1 o mm3 no hay lado que nombrar: el desparejo lo dice la vista (desgaste_irregular) con su diferencia, y side es null.
const aDecima=x=>Math.round(Math.round(x*1e6)/1e5)/10;
const sinMedida=v=>v===null||v===undefined;
export function unevenWear(row, irregularidadMm){
  if(!row) return null;
  if(sinMedida(row.mm1) || sinMedida(row.mm3)){
    return row.desgaste_irregular===true && !sinMedida(row.diferencia_huellas_mm)
      ? {diff:Number(row.diferencia_huellas_mm), side:null}
      : null;
  }
  const presentes=[row.mm1, row.mm2, row.mm3].filter(v=>!sinMedida(v)).map(Number);
  const diff=aDecima(Math.max(...presentes)-Math.min(...presentes));
  const umbral=Number(irregularidadMm ?? IRREGULARIDAD_MM_DEFECTO);
  if(!(diff>=umbral)) return null;
  return {diff, side:Number(row.mm1)<Number(row.mm3)?'interno':'externo'};
}

// Análisis completo de una rueda a partir de su historial ascendente. null si no hay historial.
// `irregularidadMm`: umbral de desgaste desparejo del cliente (ver unevenWear).
// `estado`: fila de v_estado_neumaticos de la posición, si se leyó. Sin mm1 o mm3 el desparejo lo decide la base (ver unevenWear).
// Campos: lastAvg, mmPerWeek, mmPerDay, days, daysUntilLimit, unevenWear, unevenSide (null si el desparejo no tiene lado).
export function analyzeTire(hist, irregularidadMm, estado){
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
  const u=unevenWear(estado ?? hist[hist.length-1], irregularidadMm);
  if(u){ result.unevenWear=u.diff; result.unevenSide=u.side; }
  return result;
}
