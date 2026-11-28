// Rendimiento de cada cubierta para Stock y su CSV (lógica pura, sin DOM ni red). Los km y los costos se calculan en la
// base (v_km_cubierta, v_costo_cubierta y v_costo_vida, docs/08 apéndices H, J y L); aquí solo se decide qué mostrar y
// qué columnas exportar. Tests: tests/unit/rendimiento-cubierta.test.mjs
import { fmtNum } from './formato.js';
import { buildCsv } from './reportes.js';
import { resumenKm, indexarKm, NOTA_SIN_DATO } from './km-cubierta.js';
import { fmtCpk, indexarCostos, MONEDA_DEFECTO } from './costos.js';
import { ordenarCubiertas, nombreUbicacion, precioPorMm } from './stock-cubiertas.js';
import { etiquetaCoche } from './coche.js';
import { nombrePosicion } from './posicion.js';

export const SIN_DATO = 'Sin dato';
export const MARCA_APROX = 'aprox.';
export const VIDAS = [0, 1, 2, 3];
// Los cpk se exportan con 6 decimales: una cubierta de centésimas no pierde precisión en una planilla.
const DECIMALES_CPK = 1e6;

// Columnas de identificación y de rendimiento (como antes de la ola 5) y, al final, las de compra. Con costos, la compra
// suma precio_compra y precio_por_mm. Las vidas 4 o más (recauchutados sin tope) se suman en su lugar, tras cpk_vida_3.
const COLUMNAS_IDENT = ['quema', 'idneumatico', 'marca', 'modelo', 'vida', 'situacion', 'vehiculo', 'posicion', 'km_confiable'];
export const COLUMNAS_COMPRA = ['medida', 'dot', 'profundidad_inicial_mm', 'fecha_compra', 'proveedor', 'factura', 'soporte', 'ubicacion'];
export const COLUMNAS_COMPRA_COSTOS = ['precio_compra', 'precio_por_mm'];
export const COLUMNAS_CSV_SIN_COSTOS = ['km_total', ...COLUMNAS_IDENT, ...COLUMNAS_COMPRA];
export const COLUMNAS_CSV = ['cpk_total', 'moneda', 'km_total', ...VIDAS.map(v => `km_vida_${v}`), ...VIDAS.map(v => `cpk_vida_${v}`),
  ...COLUMNAS_IDENT, ...COLUMNAS_COMPRA, ...COLUMNAS_COMPRA_COSTOS];

// Vidas de 4 hasta la mayor vida presente en los datos (sin huecos): cada una suma su par km_vida_N, cpk_vida_N.
// Así el encabezado sigue la misma secuencia 0, 1, 2, 3, 4, 5… que el de siempre, aunque falte una vida intermedia.
function vidasExtra(vidas) {
  let max = VIDAS.at(-1);
  for (const f of vidas || []) { const v = Number(f?.vida); if (Number.isInteger(v) && v > max) max = v; }
  return Array.from({ length: max - VIDAS.at(-1) }, (_, i) => VIDAS.at(-1) + 1 + i);
}

// Encabezado del CSV para unos datos: el de COLUMNAS_CSV(_SIN_COSTOS) más las vidas extra. Sin extra, es el de siempre.
export function cabeceraCubiertasCsv({ conCostos = false, vidas = [] } = {}) {
  if (!conCostos) return COLUMNAS_CSV_SIN_COSTOS;
  const extra = vidasExtra(vidas);
  if (!extra.length) return COLUMNAS_CSV;
  const vidasCols = extra.flatMap(v => [`km_vida_${v}`, `cpk_vida_${v}`]);
  return ['cpk_total', 'moneda', 'km_total', ...VIDAS.map(v => `km_vida_${v}`), ...VIDAS.map(v => `cpk_vida_${v}`), ...vidasCols,
    ...COLUMNAS_IDENT, ...COLUMNAS_COMPRA, ...COLUMNAS_COMPRA_COSTOS];
}

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const redondear = v => (v === null ? null : Math.round(v * DECIMALES_CPK) / DECIMALES_CPK);

// Celda de la lista: km totales (con «aprox.» y nota si no son confiables) y, con `conCostos`, el CPK de carcasa
// (costo total / km totales, km previos incluidos). `kmFila` y `costoFila` son las filas de la base o null.
//   kmTexto     «22.000 km», «22.000 km aprox.» o «Sin dato»
//   kmNota      texto de confiabilidad (va en `title`) o null
//   cpkTexto    «USD 0,064 por km», «Sin dato», o null si no corresponde mostrarlo (sin permiso de costos)
export function rendimientoFila(kmFila, costoFila, { conCostos = false } = {}) {
  const km = resumenKm(kmFila ?? null);
  const aprox = km.totales !== null && !km.confiable;
  const cpk = num(costoFila?.cpk_carcasa);
  return {
    kmTexto: km.totales === null ? SIN_DATO : `${fmtNum(km.totales)} km${aprox ? ` ${MARCA_APROX}` : ''}`,
    // Sin fila en la vista la nota es la de «sin dato»; resumenKm solo la da cuando hay fila.
    kmNota: kmFila ? km.nota : NOTA_SIN_DATO,
    cpkTexto: conCostos ? (cpk === null ? SIN_DATO : fmtCpk(cpk, costoFila.moneda || MONEDA_DEFECTO)) : null,
  };
}

// Situación de la cubierta según `neumaticos.estado`; una cubierta con proceso de recauchutado abierto figura así.
const SITUACION = { montado: 'Montada', almacenado: 'En stock', reparacion: 'En reparación', baja: 'Baja' };
export const situacionCubierta = (n, enReca) => (enReca.has(n.id) ? 'En recauchutado' : (SITUACION[n.estado] ?? ''));

// Filas de vidas (v_costo_vida) de un neumático, indexadas por número de vida.
function vidasIndexadas(filasVida) {
  const porNeumatico = new Map();
  for (const f of filasVida || []) {
    if (!porNeumatico.has(f.neumatico_id)) porNeumatico.set(f.neumatico_id, new Map());
    porNeumatico.get(f.neumatico_id).set(Number(f.vida), f);
  }
  return porNeumatico;
}

// Filas CSV, una por cubierta del cliente, en orden de quema. Sin `conCostos` las columnas de costo no existen (no se
// dejan vacías) y se ignoran `costos` y `vidas`. Las celdas sin dato quedan vacías (null), no «0».
//   neumaticos   filas de `neumaticos` con `vehiculos:{nombre,tipo_ruedas}` (vehículo y posición)
//   km           filas de v_km_cubierta; costos: filas de v_costo_cubierta; vidas: filas de v_costo_vida
//   enReca       Set de neumatico_id con un proceso de recauchutado abierto
//   sucursales   filas de sucursales (para el nombre de la columna ubicacion)
//   umbral       umbral de retiro del cliente en mm (para precio_por_mm); sin dato, la columna queda vacía
export function filasCubiertasCsv(neumaticos, km, costos, vidas, { conCostos = false, enReca = new Set(), sucursales = [], umbral = null } = {}) {
  const kmPor = indexarKm(km);
  const costoPor = indexarCostos(costos);
  const vidasPor = vidasIndexadas(conCostos ? vidas : []);
  const extra = conCostos ? vidasExtra(vidas) : [];
  const todasLasVidas = [...VIDAS, ...extra];
  return ordenarCubiertas(neumaticos || []).map(n => {
    const k = kmPor.get(n.id);
    const c = conCostos ? costoPor.get(n.id) : undefined;
    const vidasN = vidasPor.get(n.id) || new Map();
    const montada = n.vehiculo_id !== null && n.vehiculo_id !== undefined;
    const compra = [
      n.medida ?? '', n.dot ?? '', num(n.profundidad_inicial_mm) ?? '', n.fecha_compra ?? '', n.proveedor ?? '',
      n.factura ?? '', n.soporte ?? '', nombreUbicacion(n.sucursal_id, sucursales),
    ];
    const base = [
      num(k?.km_totales),
      n.numero_quema ?? '', n.idneumatico ?? '', n.marca ?? '', n.modelo ?? '', n.vida ?? '',
      situacionCubierta(n, enReca),
      montada ? etiquetaCoche(n.vehiculos?.nombre) : '',
      montada && num(n.posicion) !== null ? nombrePosicion(n.posicion, n.vehiculos?.tipo_ruedas) || `Posición ${n.posicion}` : '',
      k ? k.km_confiable === true : null,
    ];
    if (!conCostos) return [...base, ...compra];
    const kmVida = todasLasVidas.map(v => { const f = vidasN.get(v); return f && f.km_confiable === true ? redondear(num(f.km_recorridos)) : null; });
    const cpkVida = todasLasVidas.map(v => { const f = vidasN.get(v); return f ? redondear(num(f.cpk)) : null; });
    const celdasVida = [
      ...VIDAS.map((_, i) => kmVida[i]), ...VIDAS.map((_, i) => cpkVida[i]),
      ...extra.flatMap((_, i) => [kmVida[VIDAS.length + i], cpkVida[VIDAS.length + i]]),
    ];
    return [
      redondear(num(c?.cpk_carcasa)), c?.moneda ?? null, num(k?.km_totales),
      ...celdasVida,
      ...base.slice(1),
      ...compra,
      redondear(num(n.precio_unidad)), redondear(precioPorMm(n.precio_unidad, n.profundidad_inicial_mm, umbral)),
    ];
  });
}

// Encabezado y filas del CSV de cubiertas (mismo BOM, separador y comillas que el resto de las exportaciones).
export function cubiertasCsv(neumaticos, km, costos, vidas, opciones = {}) {
  const conCostos = opciones.conCostos === true;
  return buildCsv(cabeceraCubiertasCsv({ conCostos, vidas }), filasCubiertasCsv(neumaticos, km, costos, vidas, opciones));
}
