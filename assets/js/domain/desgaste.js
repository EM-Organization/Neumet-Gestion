// Dominio: desgaste de neumáticos. Funciones PURAS (sin DOM, sin supabase) para poder testearlas con node:test.
// Unidades: milímetros de profundidad de dibujo; tiempos en ms (created_at) y días.

// ── Umbrales de desgaste de neumáticos (única definición) ──
export const WEAR={OK_MM:8, LOW_MM:5};
// Profundidad mínima segura usada para proyectar la vida útil.
export const LIFE_LIMIT_MM=3;
// Diferencia exterior vs interior a partir de la cual se considera desgaste desparejo.
export const UNEVEN_MM=1.5;
const MS_DAY=1000*60*60*24;

export function wearStatus(avg){ // avg en mm -> 'ok' | 'bajo' | 'critico' | null
  if(avg==null) return null;
  return avg<WEAR.LOW_MM?'critico':avg<WEAR.OK_MM?'bajo':'ok';
}

// Promedio de mm1/mm2/mm3 ignorando nulls; null si no hay ninguno.
export function avgMm(m){ const v=[m.mm1,m.mm2,m.mm3].filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; }

// Estado de una fila de medición.
export function tireStatus(m){ return wearStatus(avgMm(m)); }

// Clase visual de un promedio: 'neutral' (sin datos) | 'ok' | 'warn' | 'crit'.
export function wearClass(avg){
  const st=wearStatus(avg);
  if(st===null) return 'neutral';
  return st==='ok'?'ok':st==='bajo'?'warn':'crit';
}

// Cuenta promedios por estado (los null se ignoran).
export function countByStatus(avgs){
  const c={ok:0,bajo:0,critico:0};
  avgs.forEach(a=>{ const st=wearStatus(a); if(st) c[st]++; });
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

// Desgaste desparejo de una medición: {diff, side:'exterior'|'interior'} si |mm1-mm3| >= 1.5, si no null.
export function unevenWear(row){
  if(!row || row.mm1==null || row.mm3==null) return null;
  const diff=Math.abs(row.mm1-row.mm3);
  if(diff<UNEVEN_MM) return null;
  return {diff, side:row.mm1<row.mm3?'exterior':'interior'};
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
