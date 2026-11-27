// Rendimiento de cada cubierta para Stock y su CSV (lógica pura, sin DOM ni red). Los km y los costos se calculan en la
// base (v_km_cubierta, v_costo_cubierta y v_costo_vida, docs/08 apéndices H, J y L); aquí solo se decide qué mostrar y
// qué columnas exportar. Tests: tests/unit/rendimiento-cubierta.test.mjs
import { fmtNum } from './formato.js';
import { buildCsv } from './reportes.js';
import { resumenKm, indexarKm, NOTA_SIN_DATO } from './km-cubierta.js';
import { fmtCpk, indexarCostos, MONEDA_DEFECTO } from './costos.js';
import { ordenarCubiertas } from './stock-cubiertas.js';
import { etiquetaCoche } from './coche.js';
import { nombrePosicion } from './posicion.js';

export const SIN_DATO = 'Sin dato';
export const MARCA_APROX = 'aprox.';
export const VIDAS = [0, 1, 2, 3];
// Los cpk se exportan con 6 decimales: una cubierta de centésimas no pierde precisión en una planilla.
const DECIMALES_CPK = 1e6;

export const COLUMNAS_CSV_SIN_COSTOS = ['km_total', 'quema', 'idneumatico', 'marca', 'modelo', 'vida', 'situacion', 'vehiculo', 'posicion', 'km_confiable'];
export const COLUMNAS_CSV = ['cpk_total', 'moneda', 'km_total', ...VIDAS.map(v => `km_vida_${v}`), ...VIDAS.map(v => `cpk_vida_${v}`),
  'quema', 'idneumatico', 'marca', 'modelo', 'vida', 'situacion', 'vehiculo', 'posicion', 'km_confiable'];

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
export function filasCubiertasCsv(neumaticos, km, costos, vidas, { conCostos = false, enReca = new Set() } = {}) {
  const kmPor = indexarKm(km);
  const costoPor = indexarCostos(costos);
  const vidasPor = vidasIndexadas(conCostos ? vidas : []);
  return ordenarCubiertas(neumaticos || []).map(n => {
    const k = kmPor.get(n.id);
    const c = conCostos ? costoPor.get(n.id) : undefined;
    const vidasN = vidasPor.get(n.id) || new Map();
    const montada = n.vehiculo_id !== null && n.vehiculo_id !== undefined;
    const base = [
      num(k?.km_totales),
      n.numero_quema ?? '', n.idneumatico ?? '', n.marca ?? '', n.modelo ?? '', n.vida ?? '',
      situacionCubierta(n, enReca),
      montada ? etiquetaCoche(n.vehiculos?.nombre) : '',
      montada && num(n.posicion) !== null ? nombrePosicion(n.posicion, n.vehiculos?.tipo_ruedas) || `Posición ${n.posicion}` : '',
      k ? k.km_confiable === true : null,
    ];
    if (!conCostos) return base;
    const kmVida = VIDAS.map(v => { const f = vidasN.get(v); return f && f.km_confiable === true ? redondear(num(f.km_recorridos)) : null; });
    const cpkVida = VIDAS.map(v => { const f = vidasN.get(v); return f ? redondear(num(f.cpk)) : null; });
    return [
      redondear(num(c?.cpk_carcasa)), c?.moneda ?? null, num(k?.km_totales),
      ...kmVida, ...cpkVida,
      ...base.slice(1),
    ];
  });
}

// Encabezado y filas del CSV de cubiertas (mismo BOM, separador y comillas que el resto de las exportaciones).
export function cubiertasCsv(neumaticos, km, costos, vidas, opciones = {}) {
  const conCostos = opciones.conCostos === true;
  const cabecera = conCostos ? COLUMNAS_CSV : COLUMNAS_CSV_SIN_COSTOS;
  return buildCsv(cabecera, filasCubiertasCsv(neumaticos, km, costos, vidas, opciones));
}
