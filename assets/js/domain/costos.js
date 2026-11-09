// Costos por cubierta y costo por km, CPK (lógica pura, sin DOM ni red). Los costos y el CPK se calculan en la base
// (v_costo_cubierta y cpk_por_grupo, docs/08 apéndice J); aquí solo se decide qué mostrar, con qué nota de confiabilidad
// y se valida el formulario de «Registrar costo». Tests: tests/unit/costos.test.mjs
import { fmtNum } from './formato.js';
import { buildCsv } from './reportes.js';
import { NOTA_FALTAN_LECTURAS, NOTA_SIN_DATO } from './km-cubierta.js';

export const COLUMNAS_COSTO = 'neumatico_id,vehiculo_id,tiene_costo,moneda,monedas,moneda_mixta,costo_total,costo_por_concepto,km_totales,km_recorridos,km_confiable,cpk,cpk_provisional,cpk_carcasa';

export const CONCEPTOS = [
  { id: 'compra', label: 'Compra' },
  { id: 'reparacion', label: 'Reparación' },
  { id: 'recauchutado', label: 'Recauchutado' },
  { id: 'montaje', label: 'Montaje' },
  { id: 'otro', label: 'Otro' },
];
export const etiquetaConcepto = id => (CONCEPTOS.find(c => c.id === id) || {}).label || String(id ?? '—');

export const MONEDA_DEFECTO = 'UYU';
export const MUESTRA_MINIMA = 5;
export const MAX_MONTO = 9999999999.99;
export const MAX_NOTAS = 500;
export const AVISO_COMPARAR = 'Comparar marcas sin ajustar por eje, carga y época puede engañar.';
export const NOTA_SIN_KM = 'Sin dato: sin km recorridos';
export const NOTA_CPK_BASE = 'Costo por km = costo total / km recorridos (sin los km previos) de los neumáticos con km confiables.';
export const NOTA_SUCURSAL_SELECTOR = 'El costo por marca y modelo no se filtra por la sucursal elegida.';
export const ELEGIR_CLIENTE = 'Elegir un cliente para ver el costo por km';
export const SIN_COSTOS = 'Sin costos registrados';

export const GRUPOS = [
  { id: 'marca', label: 'Marca' },
  { id: 'modelo', label: 'Modelo' },
  { id: 'sucursal', label: 'Sucursal' },
  { id: 'vida', label: 'Vida' },
  { id: 'banda', label: 'Banda' },
];

const vacio = v => v === null || v === undefined || String(v).trim() === '';
const num = v => (vacio(v) || !Number.isFinite(Number(v)) ? null : Number(v));

// Quién ve y registra costos: el administrador y el perfil global de un cliente. El perfil de sucursal no (la base
// tampoco le devuelve filas).
export const puedeGestionarCostos = ({ admin = false, cliente = false, sucursalId = null } = {}) =>
  admin === true || (cliente === true && (sucursalId === null || sucursalId === undefined));

// «UYU 1.234,50»
export const fmtMonto = (monto, moneda = MONEDA_DEFECTO) => (num(monto) === null ? '—' : `${moneda} ${fmtNum(monto, 2)}`);
// «UYU 0,150 por km»: tres decimales, el CPK de un neumático suele ser de centésimas.
export const fmtCpk = (cpk, moneda = MONEDA_DEFECTO) => (num(cpk) === null ? '—' : `${moneda} ${fmtNum(cpk, 3)} por km`);

// Fila de v_costo_cubierta -> datos para mostrar. null/undefined (vista no disponible, perfil sin acceso o sin fila)
// -> {disponible:false}: la interfaz omite la sección en lugar de mostrar «0». El costo por km usa los km RECORRIDOS
// (sin los km previos que ya traía); el CPK de carcasa (con km previos) queda aparte en `cpkCarcasa`.
//   total        costo total o null (sin costos o monedas mixtas)
//   cpk          costo por km confiable (null si no hay)
//   estimado     true si el CPK mostrado es provisional (km no confiables)
//   nota         texto de confiabilidad o null
export function resumenCosto(fila) {
  const vacioR = { disponible: false, cpkCarcasa: null, tieneCosto: false, total: null, moneda: null, mixta: false, cpk: null, estimado: false, nota: null, porConcepto: [], textoCosto: '—', textoCpk: '—' };
  if (!fila) return vacioR;
  const moneda = fila.moneda || MONEDA_DEFECTO;
  const tiene = fila.tiene_costo === true;
  const base = { ...vacioR, disponible: true, tieneCosto: tiene, moneda: fila.moneda || null, mixta: fila.moneda_mixta === true };
  if (!tiene) return { ...base, textoCosto: SIN_COSTOS, textoCpk: 'Sin dato' };
  if (base.mixta) return { ...base, textoCosto: 'Monedas mixtas', textoCpk: 'Sin dato', nota: 'Los costos están en monedas distintas: no se suman' };
  const total = num(fila.costo_total);
  const porConcepto = CONCEPTOS
    .map(c => ({ id: c.id, label: c.label, monto: num((fila.costo_por_concepto || {})[c.id]) }))
    .filter(c => c.monto !== null);
  const out = { ...base, total, porConcepto, textoCosto: fmtMonto(total, moneda) };
  const cpk = num(fila.cpk);
  const prov = num(fila.cpk_provisional);
  const km = num(fila.km_recorridos);
  const kmTot = num(fila.km_totales);
  const carc = num(fila.cpk_carcasa);
  if (cpk !== null) return { ...out, cpk, cpkCarcasa: carc, textoCpk: fmtCpk(cpk, moneda) };
  if (prov !== null) return { ...out, cpk: prov, estimado: true, textoCpk: fmtCpk(prov, moneda), nota: NOTA_FALTAN_LECTURAS };
  if (kmTot === null) return { ...out, textoCpk: 'Sin dato', nota: NOTA_SIN_DATO };
  return { ...out, textoCpk: 'Sin dato', nota: NOTA_SIN_KM };
}

export const indexarCostos = filas => new Map((filas || []).map(f => [f.neumatico_id, f]));

// ---- Formulario «Registrar costo» -------------------------------------------------------------------------------

// Monto: número >= 0 con hasta 2 decimales (coma o punto).
export function parseMonto(texto) {
  if (vacio(texto)) return { ok: false, error: 'Falta el monto' };
  const s = String(texto).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'El monto debe ser un número mayor o igual a 0, con hasta 2 decimales' };
  const n = Number(s);
  if (n > MAX_MONTO) return { ok: false, error: 'El monto es demasiado alto' };
  return { ok: true, valor: n };
}

// Valida y arma los argumentos de la RPC costo_registrar. `hoy` en AAAA-MM-DD (inyectable para las pruebas).
export function validarCosto({ neumaticoId, concepto, monto, moneda, fecha, notas } = {}, { hoy = new Date().toISOString().slice(0, 10) } = {}) {
  if (vacio(neumaticoId)) return { ok: false, error: 'Falta el neumático' };
  if (!CONCEPTOS.some(c => c.id === concepto)) return { ok: false, error: 'Elegir el concepto' };
  const m = parseMonto(monto);
  if (!m.ok) return m;
  const mon = String(moneda ?? MONEDA_DEFECTO).trim().toUpperCase() || MONEDA_DEFECTO;
  if (!/^[A-Z]{3}$/.test(mon)) return { ok: false, error: 'La moneda debe ser un código de 3 letras' };
  let f = null;
  if (!vacio(fecha)) {
    f = String(fecha).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(`${f}T00:00:00Z`))) return { ok: false, error: 'La fecha no es válida' };
    if (f > hoy) return { ok: false, error: 'La fecha no puede ser futura' };
  }
  const n = vacio(notas) ? null : String(notas).trim();
  if (n !== null && n.length > MAX_NOTAS) return { ok: false, error: `Las notas admiten hasta ${MAX_NOTAS} caracteres` };
  return {
    ok: true,
    args: { p_neumatico_id: Number(neumaticoId), p_concepto: concepto, p_monto: m.valor, p_fecha: f, p_notas: n, p_moneda: mon },
  };
}

export const ERROR_GENERICO_COSTO = 'No se pudo guardar. Reintentar';

// Error de la RPC costo_registrar -> mensaje en una frase.
export function traducirErrorCosto(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) return 'Sin permiso para registrar costos';
  if (code === 'P0002' || msg.includes('inexistente')) return 'El neumático ya no existe. Actualizar la lista';
  if (msg.includes('fecha')) return 'La fecha no es válida';
  if (msg.includes('moneda')) return 'La moneda debe ser un código de 3 letras';
  if (msg.includes('monto')) return 'El monto no es válido';
  if (code === '22023' || code === '22004' || code === '22003' || code === '23514') return 'Datos del formulario inválidos';
  return ERROR_GENERICO_COSTO;
}

// ---- Reporte «Costo por km» --------------------------------------------------------------------------------------

export const COLUMNAS_GRUPO = ['grupo', 'clave', 'moneda', 'n_neumaticos', 'n_sin_km', 'km_recorridos', 'costo_total', 'cpk', 'muestra_baja'];

// Filas de cpk_por_grupo -> filas para la tabla. El CPK ya viene ponderado de la base (suma de costos / suma de km);
// aquí NUNCA se promedia. Sin km confiables en el grupo -> «Sin dato».
export function filasCpk(rows) {
  return (rows || []).map(r => {
    const n = num(r.n_neumaticos) ?? 0;
    const cpk = num(r.cpk);
    return {
      clave: r.clave ?? '—', moneda: r.moneda || MONEDA_DEFECTO, n,
      sinKm: num(r.n_sin_km) ?? 0,
      km: num(r.km_recorridos) ?? 0,
      costo: num(r.costo_total),
      cpk,
      muestraBaja: r.muestra_baja === true || n < MUESTRA_MINIMA,
      textoCpk: cpk === null ? 'Sin dato' : fmtCpk(cpk, r.moneda || MONEDA_DEFECTO),
    };
  });
}

// CSV del reporte (misma celda y BOM que el resto de las exportaciones).
export function cpkCsv(rows) {
  const filas = (rows || []).map(r => [r.grupo ?? '', r.clave ?? '', r.moneda ?? '', num(r.n_neumaticos), num(r.n_sin_km),
    num(r.km_recorridos), num(r.costo_total), num(r.cpk), r.muestra_baja === true]);
  return buildCsv(COLUMNAS_GRUPO, filas);
}
