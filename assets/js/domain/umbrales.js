// Umbrales por cliente (columnas de `clientes`) y resumen de flota. Puro, sin DOM ni supabase.
// En la BD existe el check umbral_retiro_mm < umbral_critico_mm < umbral_bajo_mm; aquí se valida igual para avisar antes
// de enviar. Tests: tests/unit/umbrales.test.mjs
// Orden: de mayor a menor (bajo, crítico, retiro), el mismo de la regla de validación; luego los demás ajustes.
// Solo los tres umbrales de desgaste van a la vista (camposBasicos); el resto, en «Ajustes avanzados» (camposAvanzados).
// Los textos hablan de las categorías de producto; los nombres técnicos de las columnas no se muestran (docs/14).
import { ESTADOS } from './estado-desgaste.js';
import { fmtNum } from './formato.js';
const bajo = e => e.texto.toLowerCase();
// Orden de los nombres para los mensajes de umbrales: de mayor a menor.
export const ORDEN_NOMBRES = `${bajo(ESTADOS.mayor)}, ${bajo(ESTADOS.poco)}, ${bajo(ESTADOS.bueno)}`;

export const CAMPOS_UMBRAL = [
  { key: 'umbral_bajo_mm', lbl: `${ESTADOS.bueno.texto} desde (mm)`, ayuda: `Por encima: «${bajo(ESTADOS.bueno)}»`, mm: true },
  { key: 'umbral_critico_mm', lbl: `${ESTADOS.poco.texto} desde (mm)`, ayuda: `Desde este valor hasta el anterior: «${bajo(ESTADOS.poco)}»`, mm: true },
  { key: 'umbral_retiro_mm', lbl: `${ESTADOS.mayor.texto} desde (mm)`, ayuda: `Desde este valor hasta el anterior: «${bajo(ESTADOS.mayor)}». Por debajo: «${bajo(ESTADOS.limite)}»`, mm: true },
  // Margen de la alerta (columna alerta_histeresis_mm): puede ser 0 y va de 0 a 3 mm, por eso no entra en las reglas de los
  // umbrales en mm (mm: false, hist: true). El nombre técnico no se muestra al operario.
  // La base (alerta_sincronizar, 20261126040000) cierra con minimo >= umbral_retiro_mm + margen: «llega a», no «supera».
  { key: 'alerta_histeresis_mm', lbl: 'Margen para cerrar la alerta (mm)', ayuda: `La alerta de desgaste límite se cierra cuando la huella mínima llega a «${ESTADOS.mayor.texto} desde» más este margen (0 a 3 mm)`, mm: false, hist: true, avanzado: true },
  { key: 'dias_sin_medir_alerta', lbl: 'Días sin medir para indicador', ayuda: 'Indicador «sin medir» pasado este plazo (solo en la vista de estado)', mm: false, avanzado: true },
  { key: 'irregularidad_mm', lbl: 'Irregularidad máxima (mm)', ayuda: 'Diferencia máxima tolerada entre huellas', mm: true, avanzado: true },
  // Pasar atrás (cubiertas de dirección) va en mm, pero fuera de las reglas de los umbrales de desgaste: mm: false y dirMm: true
  // (mayor que 0 y hasta 99,9, igual que el check de la base; ver validarUmbrales). Se mide en la huella mínima, como el resto (RN-01).
  { key: 'direccion_aviso_mm', lbl: 'Pasar atrás desde (mm)', ayuda: 'Cubiertas de dirección con esta huella mínima o menos', mm: false, dirMm: true, avanzado: true },
  { key: 'direccion_limite_mm', lbl: 'Pasar atrás ya bajo (mm)', ayuda: 'Cubiertas de dirección por debajo de esta huella mínima: pasarlas atrás ya', mm: false, dirMm: true, avanzado: true },
  // Caída brusca (RN-09): baja de la huella mínima entre dos mediciones que deja la nueva como sospechosa. Va en mm, de 0 a 30
  // (el check de la base), pero fuera de las reglas de los umbrales de desgaste: mm: false y caida: true (ver validarUmbrales).
  { key: 'caida_brusca_mm', lbl: 'Caída brusca desde (mm)', ayuda: 'Baja de la huella mínima entre dos mediciones que deja la nueva como sospechosa', mm: false, caida: true, avanzado: true },
  // Swap: kilómetros de la primera rotación de una cubierta nueva (RN-05, 20.000 por defecto). Entero, no mm.
  { key: 'swap_km', lbl: 'Primera rotación a los (km)', ayuda: 'Kilómetros desde el montaje de una cubierta nueva', mm: false, avanzado: true }
];

// Los tres umbrales de desgaste (a la vista) y el resto de ajustes («Ajustes avanzados», cerrado al cargar).
export const camposBasicos = () => CAMPOS_UMBRAL.filter(c => !c.avanzado);
export const camposAvanzados = () => CAMPOS_UMBRAL.filter(c => c.avanzado);

const MM_MAX = 99.9; // numeric(3,1)
const CAIDA_MAX = 30; // clientes.caida_brusca_mm: check (> 0 and <= 30)
// Los mensajes los lee el operario: 99,9 con coma (es-AR), no 99.9. MM_MAX queda numérico para comparar.
const MM_MAX_TXT = fmtNum(MM_MAX, 1);
const lblDe = k => CAMPOS_UMBRAL.find(c => c.key === k).lbl;

// "7,5" y "7.5" valen; '' o texto no numérico => NaN
export function aNumero(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// Margen de la alerta (histéresis) en mm: de 0 a 3 con un decimal (acepta coma). Es la regla que tenía la tarjeta de Alertas antes del PR 9c.
export function validarHisteresis(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d)?$/.test(s) || Number(s) > 3) return { ok: false, error: `${lblDe('alerta_histeresis_mm')}: va de 0 a 3 mm, con un decimal` };
  return { ok: true, valor: Number(s) };
}

// raw: valores del formulario (string o number). Devuelve {ok:true, valores} | {ok:false, error, campo}.
export function validarUmbrales(raw = {}) {
  const v = {};
  for (const c of CAMPOS_UMBRAL) {
    const n = aNumero(raw[c.key]);
    if (!Number.isFinite(n)) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser un número` };
    v[c.key] = n;
  }
  const h = validarHisteresis(raw.alerta_histeresis_mm);
  if (!h.ok) return { ok: false, campo: 'alerta_histeresis_mm', error: h.error };
  for (const c of CAMPOS_UMBRAL.filter(c => c.mm)) {
    const n = v[c.key];
    if (n <= 0 || n > MM_MAX) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser mayor que 0 y hasta ${MM_MAX_TXT}` };
    if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { ok: false, campo: c.key, error: `${c.lbl}: máximo un decimal` };
  }
  if (!Number.isInteger(v.dias_sin_medir_alerta) || v.dias_sin_medir_alerta < 1 || v.dias_sin_medir_alerta > 3650) {
    return { ok: false, campo: 'dias_sin_medir_alerta', error: `${lblDe('dias_sin_medir_alerta')}: entero entre 1 y 3650` };
  }
  // Pasar atrás: mayor que 0 y hasta 99,9 con un decimal, igual que el check de la base. Con 0, la base rechaza sin decir
  // qué campo falla; por eso se valida aquí, con el nombre del campo.
  for (const c of CAMPOS_UMBRAL.filter(c => c.dirMm)) {
    const n = v[c.key];
    if (n <= 0 || n > MM_MAX) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser mayor que 0 y hasta ${MM_MAX_TXT}` };
    if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { ok: false, campo: c.key, error: `${c.lbl}: máximo un decimal` };
  }
  // Caída brusca: mayor que 0 y hasta 30 con un decimal. Con 0 o 30,1 la base rechaza sin decir qué campo falla.
  for (const c of CAMPOS_UMBRAL.filter(c => c.caida)) {
    const n = v[c.key];
    if (n <= 0 || n > CAIDA_MAX) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser mayor que 0 y hasta ${CAIDA_MAX}` };
    if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { ok: false, campo: c.key, error: `${c.lbl}: máximo un decimal` };
  }
  if (!Number.isInteger(v.swap_km) || v.swap_km < 1000 || v.swap_km > 200000) {
    return { ok: false, campo: 'swap_km', error: `${lblDe('swap_km')}: entero entre 1000 y 200000` };
  }
  if (!(v.umbral_retiro_mm < v.umbral_critico_mm && v.umbral_critico_mm < v.umbral_bajo_mm)) {
    return { ok: false, campo: 'umbral_critico_mm', error: `Los umbrales deben descender: ${ORDEN_NOMBRES}` };
  }
  // El límite (ya bajo) debe quedar por debajo del aviso (desde): si no, el segundo nivel no añade nada.
  if (!(v.direccion_limite_mm < v.direccion_aviso_mm)) {
    return { ok: false, campo: 'direccion_limite_mm', error: `${lblDe('direccion_limite_mm')}: debe ser menor que ${lblDe('direccion_aviso_mm')}` };
  }
  return { ok: true, valores: v };
}

// Resumen de flota (fila de v_resumen_flota_cliente): totales y porcentajes sobre neumáticos con datos.
// v_resumen_flota_cliente conserva nombres históricos: n_ok=nuevo, n_bajo=poco_desgaste,
// n_mayor_desgaste=mayor_desgaste, n_critico=desgaste_limite, n_sin_datos=desconocido.
export function resumenFlota(r) {
  const n = k => Number(r?.[k]) || 0;
  const conDatos = n('n_ok') + n('n_bajo') + n('n_mayor_desgaste') + n('n_critico');
  const pct = x => (conDatos ? Math.round((x / conDatos) * 100) : 0);
  return {
    nuevo: n('n_ok'), pocoDesgaste: n('n_bajo'), mayorDesgaste: n('n_mayor_desgaste'),
    limite: n('n_critico'), desconocido: n('n_sin_datos'),
    alertas: n('n_alertas_sev1') + n('n_alertas_sev2') + n('n_alertas_sev3'),
    conDatos,
    pctNuevo: pct(n('n_ok')), pctPocoDesgaste: pct(n('n_bajo')),
    pctMayorDesgaste: pct(n('n_mayor_desgaste')), pctLimite: pct(n('n_critico')),
  };
}
