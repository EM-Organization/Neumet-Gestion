// Presentación de los km por cubierta (lógica pura, sin DOM ni red). Los km se calculan en la base (vista
// v_km_cubierta, docs/08 apéndice H); aquí solo se decide qué mostrar y con qué nota de confiabilidad.
// Tests: tests/unit/km-cubierta.test.mjs
export const COLUMNAS_KM = 'neumatico_id,km_previos,km_en_vehiculos,km_tramo_actual,km_totales,km_confiable,tramos_sin_dato,odometro_anomalo';

export const NOTA_FALTAN_LECTURAS = 'Estimado: faltan lecturas de odómetro';
export const NOTA_ODOMETRO_DECRECIENTE = 'Estimado: hay lecturas de odómetro decrecientes';
export const NOTA_SIN_DATO = 'Sin dato: faltan lecturas de odómetro';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Fila de v_km_cubierta -> datos para mostrar. null/undefined (vista no disponible o sin fila) -> {disponible:false}.
//   recorridos     km totales menos los km previos: tramos cerrados + tramo actual conocidos (null si ninguno tiene dato)
//   tramoActual    km del montaje en curso (null si no está montada o faltan odómetros)
//   totales        km previos + recorridos (null si ningún tramo tiene datos)
//   confiable      false si faltan odómetros o hay odómetro decreciente
//   nota           texto de confiabilidad o null cuando todo es confiable
export function resumenKm(fila) {
  if (!fila) return { disponible: false, previos: null, recorridos: null, tramoActual: null, totales: null, confiable: false, nota: null };
  const previos = num(fila.km_previos);
  const actual = num(fila.km_tramo_actual);
  const totales = num(fila.km_totales);
  const confiable = fila.km_confiable === true;
  let recorridos = null;
  if (totales !== null) recorridos = totales - (previos ?? 0);
  let nota = null;
  if (!confiable) {
    if (totales === null) nota = NOTA_SIN_DATO;
    else if (fila.odometro_anomalo === true) nota = NOTA_ODOMETRO_DECRECIENTE;
    else nota = NOTA_FALTAN_LECTURAS;
  }
  return { disponible: true, previos, recorridos, tramoActual: actual, totales, confiable, nota };
}

// Indexa las filas de la vista por neumatico_id.
export const indexarKm = filas => new Map((filas || []).map(f => [f.neumatico_id, f]));
