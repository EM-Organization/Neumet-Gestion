// Umbrales por cliente (columnas de `clientes`) y resumen de flota. Puro, sin DOM ni supabase.
// En la BD existe el check umbral_retiro_mm < umbral_critico_mm < umbral_bajo_mm; aquí se valida igual para avisar antes
// de enviar, y mensajeErrorUmbrales traduce el error que igualmente devuelva la BD. Tests: tests/unit/umbrales.test.mjs
// Orden: de mayor a menor (bajo, crítico, retiro), el mismo de la regla de validación; luego los demás ajustes.
// Los textos hablan de las cinco categorías de producto; los nombres técnicos de las columnas no se muestran (docs/14).
export const CAMPOS_UMBRAL = [
  { key: 'umbral_bajo_mm', lbl: 'Umbral bajo (mm)', ayuda: 'Por encima: estado «nuevo»', mm: true },
  { key: 'umbral_critico_mm', lbl: 'Umbral crítico (mm)', ayuda: 'Entre este umbral y el de bajo: «poco desgaste»', mm: true },
  { key: 'umbral_retiro_mm', lbl: 'Umbral de retiro (mm)', ayuda: 'Por debajo: estado «desgaste límite»', mm: true },
  // Margen de la alerta (columna alerta_histeresis_mm): puede ser 0 y va de 0 a 3 mm, por eso no entra en las reglas de los
  // umbrales en mm (mm: false, hist: true). El nombre técnico no se muestra al operario.
  { key: 'alerta_histeresis_mm', lbl: 'Histéresis de alerta (mm)', ayuda: 'Margen sobre el umbral de retiro para resolver la alerta (0 a 3 mm)', mm: false, hist: true },
  { key: 'dias_sin_medir_alerta', lbl: 'Días sin medir para alertar', ayuda: 'Alerta «sin medir» pasado este plazo', mm: false },
  { key: 'irregularidad_mm', lbl: 'Irregularidad máxima (mm)', ayuda: 'Diferencia máxima tolerada entre huellas', mm: true }
];

const MM_MAX = 99.9; // numeric(3,1)
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
  if (!/^\d+(\.\d)?$/.test(s) || Number(s) > 3) return { ok: false, error: 'El margen para resolver la alerta va de 0 a 3 mm, con un decimal' };
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
    if (n <= 0 || n > MM_MAX) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser mayor que 0 y hasta ${MM_MAX}` };
    if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { ok: false, campo: c.key, error: `${c.lbl}: máximo un decimal` };
  }
  if (!Number.isInteger(v.dias_sin_medir_alerta) || v.dias_sin_medir_alerta < 1 || v.dias_sin_medir_alerta > 3650) {
    return { ok: false, campo: 'dias_sin_medir_alerta', error: `${lblDe('dias_sin_medir_alerta')}: entero entre 1 y 3650` };
  }
  if (!(v.umbral_retiro_mm < v.umbral_critico_mm && v.umbral_critico_mm < v.umbral_bajo_mm)) {
    return { ok: false, campo: 'umbral_critico_mm', error: 'El umbral de retiro debe ser menor que el crítico, y el crítico menor que el bajo' };
  }
  return { ok: true, valores: v };
}

// Mensaje para un error devuelto por PostgREST/Postgres al guardar. 23514 = check_violation.
export function mensajeErrorUmbrales(err) {
  const msg = String(err?.message ?? err ?? '').trim();
  if (err?.code === '23514' || /check constraint|violates check/i.test(msg)) {
    return `Los umbrales no son válidos: el retiro debe ser menor que el crítico, y el crítico menor que el bajo. ${msg}`;
  }
  if (err?.code === '42501' || /permission denied|row-level security/i.test(msg)) return 'Sin permiso para editar los umbrales';
  return msg ? `No se pudieron guardar los umbrales: ${msg}` : 'No se pudieron guardar los umbrales';
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
