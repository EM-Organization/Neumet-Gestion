// Estado de desgaste de un neumático: UNA sola función (`wearStatus`) alimenta el esquema, los chips, la etiqueta del panel,
// el punto del gráfico y la banda donde cae (docs/21, criterio 1). Lógica pura, sin DOM ni supabase.
//
// Cuatro estados de la especificación más uno propio del producto, `limite` («Desgaste límite», por debajo del umbral
// más bajo): usa el estilo visual de `mayor` pero conserva nombre y conteo propios (decisión del 2026-11-21,
// TODO-BELOW-MAYOR). Los umbrales salen siempre de la configuración del cliente (umbral_bajo/critico/retiro_mm); aquí
// solo se les da el nombre de la especificación: { buen, poco, mayor }.
import { fmtNum, plural } from './formato.js';
import { TOKENS } from './tokens-detalle.js';
import { esAuxilio } from './auxilio.js';
import { evaluarDesgaste } from './desgaste-flota.js';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// { bajo, critico, retiro } (umbralesDe) -> { buen, poco, mayor }.
export const umbralesEstado = u => ({ buen: u.bajo, poco: u.critico, mayor: u.retiro });

// Decisión del dueño (2026-11-21, TODO-STATUS-MEASURE): el estado se decide con el valor CRUDO (promedio con 2 decimales,
// igual que la base y las alertas: 7,97 con umbral 8 es «poco desgaste») y el número se MUESTRA TRUNCADO a un decimal
// (7,97 -> «7,9»), de modo que lo que se ve coincide con lo que se decide. Este es el único formato de mm del detalle.
export function truncar1(v) {
  const n = num(v);
  if (n === null) return null;
  // Primero a 2 decimales (la precisión de la base) para que el error de coma flotante no mueva el corte (2,3*10 = 22,999…).
  return Math.floor(Math.round(n * 100) / 10) / 10;
}
export const fmtMedida = v => (num(v) === null ? '—' : fmtNum(truncar1(v), 1));

// Límite inferior inclusivo de cada banda (TODO-BOUNDARY): 5,0 es «poco», 8,0 es «bueno», 3,0 es «mayor».
export function wearStatus(valor, th) {
  const m = num(valor);
  if (m === null) return 'sinDatos';
  if (m >= th.buen) return 'bueno';
  if (m >= th.poco) return 'poco';
  if (m >= th.mayor) return 'mayor';
  return 'limite'; // TODO(neumet-web: TODO-BELOW-MAYOR): comportamiento actual, ver docs/21
}

// `estilo`: qué juego de variables CSS `--est-<estilo>-*` usa. `limite` comparte el de `mayor`.
export const ESTADOS = Object.freeze({
  bueno: { id: 'bueno', texto: 'Buen estado', simbolo: '✓', estilo: 'bueno' },
  poco: { id: 'poco', texto: 'Poco desgaste', simbolo: '▲', estilo: 'poco' },
  mayor: { id: 'mayor', texto: 'Mayor desgaste', simbolo: '×', estilo: 'mayor' },
  limite: { id: 'limite', texto: 'Desgaste límite', simbolo: '×', estilo: 'mayor' },
  sinDatos: { id: 'sinDatos', texto: 'Sin datos', simbolo: '', estilo: 'sinDatos' },
});
export const BANDERA = Object.freeze({ id: 'acelerado', texto: 'Desgaste acelerado', simbolo: '!' });
// Orden de los chips: de lo más urgente a lo mejor; «Sin datos» y la bandera van al final (docs/21 §5.1).
export const ORDEN_ESTADOS = Object.freeze(['limite', 'mayor', 'poco', 'bueno', 'sinDatos']);

// Estado de la base (v_estado_neumaticos.estado, también el del vehículo) -> estado del detalle.
export const DE_ESTADO_BASE = Object.freeze({
  nuevo: 'bueno', poco_desgaste: 'poco', mayor_desgaste: 'mayor', desgaste_limite: 'limite', desconocido: 'sinDatos',
});
export const estadoDeBase = e => DE_ESTADO_BASE[e] || 'sinDatos';
// Nombre mostrado de un estado de la base: ÚNICA fuente de los nombres en todo el panel (docs/14 §3). Los valores de la base
// («nuevo», «desconocido») no cambian; solo el texto que ve el operario.
export const textoEstadoBase = e => ESTADOS[estadoDeBase(e)].texto;

// Regla PR 140 (domain/auxilio.js): la rueda de auxilio (posición 99) no cuenta como advertencia. Su mayor desgaste o
// límite cuenta como «poco desgaste» en chips y semáforo del vehículo; sigue sumando en el total y se dibuja con su estado
// real. TODO(neumet-web: TODO-AUX-IN-STATUS): la spec lo cuenta como uno más; se mantiene la regla del producto.
export function estadoContable(fila, th) {
  const id = wearStatus(fila && fila.promedio, th);
  return esAuxilio(fila) && (id === 'mayor' || id === 'limite') ? 'poco' : id;
}

// Estado del vehículo (cabecera) = el peor de sus neumáticos con datos, con la regla del auxilio.
const RANGO_ESTADO = { limite: 0, mayor: 1, poco: 2, bueno: 3 };
export function estadoVehiculo(filas, th) {
  let peor = 'sinDatos';
  for (const f of filas || []) {
    const id = estadoContable(f, th);
    if (id === 'sinDatos') continue;
    if (peor === 'sinDatos' || RANGO_ESTADO[id] < RANGO_ESTADO[peor]) peor = id;
  }
  return peor;
}

// Conteo de los chips: el mismo estado contable que la cabecera, de modo que chips y cabecera no discrepen.
export function contarEstadosFilas(filas, th) {
  const out = { total: 0, bueno: 0, poco: 0, mayor: 0, limite: 0, sinDatos: 0 };
  for (const f of filas || []) { out[estadoContable(f, th)] += 1; out.total += 1; }
  return out;
}

// «Desgaste acelerado»: UNA regla para el chip, la insignia, el filtro, la etiqueta y el panel. El auxilio no la lleva.
export function banderaDeFila(fila, ref) {
  const ind = evaluarDesgaste(fila, ref);
  return esAuxilio(fila) ? { ...ind, mayorAlNormal: false } : ind;
}

// Umbral con coma y sin decimales sobrantes: 8 -> «8», 3,5 -> «3,5».
export const fmtUmbral = v => fmtNum(v, Number.isInteger(Number(v)) ? 0 : 1);

// Rango de cada estado, formateado: «≥ 8 mm», «5–8 mm», «3–5 mm», «< 3 mm».
export function rangoEstado(id, th) {
  const b = fmtUmbral(th.buen), p = fmtUmbral(th.poco), m = fmtUmbral(th.mayor);
  if (id === 'bueno') return `≥ ${b} mm`;
  if (id === 'poco') return `${p}–${b} mm`;
  if (id === 'mayor') return `${m}–${p} mm`;
  if (id === 'limite') return `< ${m} mm`;
  return '';
}

// Descripción completa del rango, para lectores de pantalla.
export function rangoLargo(id, th) {
  const b = fmtUmbral(th.buen), p = fmtUmbral(th.poco), m = fmtUmbral(th.mayor);
  if (id === 'bueno') return `${b} mm o más`;
  if (id === 'poco') return `de ${p} mm a menos de ${b} mm`;
  if (id === 'mayor') return `de ${m} mm a menos de ${p} mm`;
  if (id === 'limite') return `menos de ${m} mm`;
  return '';
}

export function etiquetaChip(id, n, th) {
  if (id === 'sinDatos') return `${plural(n, 'neumático', 'neumáticos')} sin datos`;
  const largo = rangoLargo(id, th);
  return `${plural(n, 'neumático', 'neumáticos')} con ${ESTADOS[id].texto.toLowerCase()}${largo ? `, ${largo}` : ''}`;
}

// Conteo por estado de una lista de valores (mm medios; null = sin datos). La suma de los estados es el total.
export function contarEstados(valores, th) {
  const out = { total: 0, bueno: 0, poco: 0, mayor: 0, limite: 0, sinDatos: 0 };
  for (const v of valores || []) { out[wearStatus(v, th)] += 1; out.total += 1; }
  return out;
}

// Eje Y del gráfico: de 0 al mayor entre (buen + margen) y la lectura máxima redondeada hacia arriba a la marca.
// Con umbrales 8/5/3: lectura 4,7 -> 0–12; lectura 16,0 -> 0–16.
export function ejeY(lecturaMax, th) {
  const { yTickStepMm: paso, headroomAboveBuenMm: margen } = TOKENS.chart;
  const m = num(lecturaMax);
  const techo = m === null ? 0 : Math.ceil(m / paso) * paso;
  const max = Math.max(th.buen + margen, techo);
  const marcas = [];
  for (let v = 0; v <= max; v += paso) marcas.push(v);
  return { min: 0, max, marcas };
}

// Bandas del gráfico, de abajo hacia arriba: son las del modelo de estados. La inferior (0 a `mayor`) usa el estilo
// de `mayor` y no lleva rótulo propio (TODO-BELOW-MAYOR): el chip «Desgaste límite» la nombra.
export function bandasGrafico(th, max) {
  const rotulo = id => `${ESTADOS[id].texto} · ${rangoEstado(id, th)}`;
  return [
    { id: 'limite', estilo: 'mayor', desde: 0, hasta: th.mayor, rotulo: null },
    { id: 'mayor', estilo: 'mayor', desde: th.mayor, hasta: th.poco, rotulo: rotulo('mayor') },
    { id: 'poco', estilo: 'poco', desde: th.poco, hasta: th.buen, rotulo: rotulo('poco') },
    { id: 'bueno', estilo: 'bueno', desde: th.buen, hasta: max, rotulo: rotulo('bueno') },
  ];
}
