// Número de quema y km del neumático (lógica pura). docs/08 (apéndice C). Tests: tests/unit/quema.test.mjs
export const MAX_QUEMA = 40;
export const MAX_KM = 999999999;

// Texto del formulario -> { ok, valor } (valor null si está vacío) o { ok:false, error }. Recorta los extremos.
export function normalizarQuema(texto) {
  const t = String(texto ?? '').trim();
  if (t === '') return { ok: true, valor: null };
  if (t.length > MAX_QUEMA) return { ok: false, error: `El número de quema admite hasta ${MAX_QUEMA} caracteres` };
  return { ok: true, valor: t };
}

// Clave de comparación: sin distinguir mayúsculas (igual que el índice único lower(numero_quema)).
export const claveQuema = q => String(q ?? '').trim().toLowerCase();

// Km que ya traía el neumático: vacío = 0; entero >= 0 de hasta 9 dígitos. Rechaza decimales, signo y notación científica.
export function parseKmPrevios(texto) {
  const s = texto === null || texto === undefined ? '' : String(texto).trim();
  if (s === '') return { ok: true, valor: 0 };
  if (!/^\d{1,9}$/.test(s)) return { ok: false, error: 'Los km que ya traía el neumático deben ser un número entero mayor o igual a 0' };
  return { ok: true, valor: Number(s) };
}

// Odómetro del vehículo (dato aparte y opcional): vacío = no se informa. `actual` = odómetro guardado o null.
export function validarOdometroVehiculo(texto, actual = null) {
  const s = texto === null || texto === undefined ? '' : String(texto).trim();
  if (s === '') return { ok: true, valor: null };
  if (!/^\d{1,9}$/.test(s)) return { ok: false, error: 'El odómetro del vehículo debe ser un número entero mayor o igual a 0' };
  const v = Number(s);
  if (Number.isInteger(actual) && v < actual) {
    return { ok: false, error: `El odómetro del vehículo no puede ser menor al actual (${actual} km)` };
  }
  return { ok: true, valor: v };
}

// Km del neumático: previos + recorridos. `infoKm` sale de kmPorNeumatico (odómetro del vehículo actual menos el que
// tenía al montarlo, sumando tramos anteriores). Sin odómetro en el montaje no hay recorridos conocidos: el total
// queda en los km previos y `completo` es false.
export function kmTotalesNeumatico(neumatico, infoKm) {
  const previos = Number.isInteger(neumatico && neumatico.km_previos) && neumatico.km_previos > 0 ? neumatico.km_previos : 0;
  const recorridos = infoKm && Number.isFinite(infoKm.km) ? infoKm.km : 0;
  const completo = !!infoKm && infoKm.tramos > 0 && !infoKm.incompletos;
  return { previos, recorridos, total: previos + recorridos, completo };
}
