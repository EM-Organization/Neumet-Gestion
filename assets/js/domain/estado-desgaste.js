// Estado de desgaste de un neumático: UNA sola función (`wearStatus`) alimenta el esquema, los chips, la etiqueta del panel,
// el punto del gráfico y la banda donde cae (docs/21, criterio 1). Lógica pura, sin DOM ni supabase.
//
// Cuatro estados de la especificación más uno propio del producto, `limite` («Desgaste límite», por debajo del umbral
// más bajo): usa el estilo visual de `mayor` pero conserva nombre y conteo propios (decisión del 2026-11-21,
// TODO-BELOW-MAYOR). Los umbrales salen siempre de la configuración del cliente (umbral_bajo/critico/retiro_mm); aquí
// solo se les da el nombre de la especificación: { buen, poco, mayor }.
import { fmtNum, plural } from './formato.js';
import { TOKENS } from './tokens-detalle.js';

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// { bajo, critico, retiro } (umbralesDe) -> { buen, poco, mayor }.
export const umbralesEstado = u => ({ buen: u.bajo, poco: u.critico, mayor: u.retiro });

// Valor con el que se decide el estado: el que el neumático MUESTRA (un decimal). Se redondea con el mismo motor que
// fmtNum para que el número visible y la decisión nunca discrepen (TODO-STATUS-MEASURE).
export function valorMostrado(v) {
  const n = num(v);
  if (n === null) return null;
  return Number(n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(/,/g, ''));
}

// Límite inferior inclusivo de cada banda (TODO-BOUNDARY): 5,0 es «poco», 8,0 es «bueno», 3,0 es «mayor».
export function wearStatus(valor, th) {
  const m = valorMostrado(valor);
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
  const m = valorMostrado(lecturaMax);
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
