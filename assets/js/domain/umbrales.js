// Umbrales por cliente (columnas de `clientes`) y resumen de flota. Puro, sin DOM ni supabase.
// En la BD existe el check umbral_retiro_mm < umbral_critico_mm < umbral_bajo_mm; aquí se valida igual para avisar antes
// de enviar, y mensajeErrorUmbrales traduce el error que igualmente devuelva la BD. Tests: tests/unit/umbrales.test.mjs
export const CAMPOS_UMBRAL = [
  { key: 'umbral_bajo_mm', lbl: 'Umbral bajo (mm)', ayuda: 'Por debajo: estado "bajo" (naranja)', mm: true },
  { key: 'umbral_critico_mm', lbl: 'Umbral crítico (mm)', ayuda: 'Por debajo: estado "crítico" (rojo)', mm: true },
  { key: 'umbral_retiro_mm', lbl: 'Umbral de retiro (mm)', ayuda: 'Profundidad mínima para retirar el neumático', mm: true },
  { key: 'dias_sin_medir_alerta', lbl: 'Días sin medir para alertar', ayuda: 'Alerta "sin medir" pasado este plazo', mm: false },
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

// raw: valores del formulario (string o number). Devuelve {ok:true, valores} | {ok:false, error, campo}.
export function validarUmbrales(raw = {}) {
  const v = {};
  for (const c of CAMPOS_UMBRAL) {
    const n = aNumero(raw[c.key]);
    if (!Number.isFinite(n)) return { ok: false, campo: c.key, error: `${c.lbl}: ingresá un número` };
    v[c.key] = n;
  }
  for (const c of CAMPOS_UMBRAL.filter(c => c.mm)) {
    const n = v[c.key];
    if (n <= 0 || n > MM_MAX) return { ok: false, campo: c.key, error: `${c.lbl}: debe ser mayor que 0 y hasta ${MM_MAX}` };
    if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return { ok: false, campo: c.key, error: `${c.lbl}: máximo un decimal` };
  }
  if (!Number.isInteger(v.dias_sin_medir_alerta) || v.dias_sin_medir_alerta < 1 || v.dias_sin_medir_alerta > 3650) {
    return { ok: false, campo: 'dias_sin_medir_alerta', error: `${lblDe('dias_sin_medir_alerta')}: entero entre 1 y 3650` };
  }
  if (!(v.umbral_retiro_mm < v.umbral_critico_mm && v.umbral_critico_mm < v.umbral_bajo_mm)) {
    return { ok: false, campo: 'umbral_critico_mm', error: 'Los umbrales deben cumplir: retiro < crítico < bajo' };
  }
  return { ok: true, valores: v };
}

// Mensaje para un error devuelto por PostgREST/Postgres al guardar. 23514 = check_violation.
export function mensajeErrorUmbrales(err) {
  const msg = String(err?.message ?? err ?? '').trim();
  if (err?.code === '23514' || /check constraint|violates check/i.test(msg)) {
    return `La base de datos rechazó los umbrales (retiro < crítico < bajo): ${msg}`;
  }
  if (err?.code === '42501' || /permission denied|row-level security/i.test(msg)) return 'No tenés permiso para editar los umbrales';
  return msg ? `No se pudieron guardar los umbrales: ${msg}` : 'No se pudieron guardar los umbrales';
}

// Resumen de flota (fila de v_resumen_flota_cliente): totales y porcentajes sobre neumáticos con datos.
export function resumenFlota(r) {
  const n = k => Number(r?.[k]) || 0;
  const conDatos = n('n_ok') + n('n_bajo') + n('n_critico');
  const pct = x => (conDatos ? Math.round((x / conDatos) * 100) : 0);
  return {
    ok: n('n_ok'), bajo: n('n_bajo'), critico: n('n_critico'), sinDatos: n('n_sin_datos'),
    alertas: n('n_alertas_sev1') + n('n_alertas_sev2') + n('n_alertas_sev3'),
    conDatos, pctOk: pct(n('n_ok')), pctBajo: pct(n('n_bajo')), pctCritico: pct(n('n_critico'))
  };
}
