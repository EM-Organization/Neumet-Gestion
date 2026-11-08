// Indicador "desgaste mayor al normal" por neumático (lógica pura). Criterio transparente:
//   1) irregular: la diferencia entre huellas supera la irregularidad_mm del cliente (la vista ya lo calcula: desgaste_irregular), o
//   2) la tasa de desgaste (mm/semana) es mayor a FACTOR_TASA (1,5) veces la mediana de la tasa de los neumáticos
//      de la misma posición en la flota visible; si esa posición tiene menos de MIN_MUESTRAS neumáticos con tasa,
//      se compara con los del mismo eje; si tampoco hay muestra suficiente, no se evalúa la tasa.
import { fmtNum } from './formato.js';
import { ejeDePosicion } from './vehiculo-diagrama.js';

export const FACTOR_TASA = 1.5;
export const MIN_MUESTRAS = 5;

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

export function mediana(valores) {
  const v = (valores || []).map(num).filter(x => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Medianas de referencia a partir de las filas de v_estado_neumaticos de la flota visible (solo tasas > 0).
export function referenciaTasas(rows, { minMuestras = MIN_MUESTRAS } = {}) {
  const porPos = new Map(), porEje = new Map();
  const push = (m, k, t) => { if (!m.has(k)) m.set(k, []); m.get(k).push(t); };
  for (const r of rows || []) {
    const t = num(r.tasa_mm_semana);
    if (t === null || t <= 0) continue;
    push(porPos, Number(r.posicion), t);
    push(porEje, ejeDePosicion(r.posicion), t);
  }
  const med = m => new Map([...m].map(([k, arr]) => [k, { n: arr.length, mediana: arr.length >= minMuestras ? mediana(arr) : null }]));
  return { porPosicion: med(porPos), porEje: med(porEje) };
}

/**
 * Evalúa un neumático (fila de v_estado_neumaticos) contra la referencia de la flota.
 * Devuelve { mayorAlNormal, irregular, tasaAlta, motivos: [frase], razon: frase única, tasa, mediana, ratio, grupo }.
 */
export function evaluarDesgaste(row, ref, { factor = FACTOR_TASA } = {}) {
  const out = { mayorAlNormal: false, irregular: false, tasaAlta: false, motivos: [], razon: '', tasa: null, mediana: null, ratio: null, grupo: null };
  if (!row) return out;
  const dif = num(row.diferencia_huellas_mm);
  if (row.desgaste_irregular === true) {
    out.irregular = true;
    out.motivos.push(`Las huellas difieren ${dif === null ? 'más de lo permitido' : fmtNum(dif, 1) + ' mm entre sí'}: desgaste irregular, conviene revisar presión y alineación.`);
  }
  const tasa = num(row.tasa_mm_semana);
  out.tasa = tasa;
  if (tasa !== null && tasa > 0 && ref) {
    const pos = Number(row.posicion);
    let g = ref.porPosicion.get(pos), grupo = `la posición ${pos}`;
    if (!g || g.mediana === null) { g = ref.porEje.get(ejeDePosicion(pos)); grupo = `el eje ${ejeDePosicion(pos)}`; }
    if (g && g.mediana !== null && g.mediana > 0) {
      out.mediana = g.mediana; out.grupo = grupo; out.ratio = tasa / g.mediana;
      if (tasa > factor * g.mediana) {
        out.tasaAlta = true;
        out.motivos.push(`Se gasta ${fmtNum(tasa, 2)} mm por semana, ${fmtNum(out.ratio, 1)} veces lo habitual en ${grupo} de la flota (${fmtNum(g.mediana, 2)} mm por semana).`);
      }
    }
  }
  out.mayorAlNormal = out.irregular || out.tasaAlta;
  out.razon = out.motivos.join(' ');
  return out;
}
