// Recauchutado por carcasa (lógica pura, sin DOM ni red): estados del proceso, validación de los formularios y
// traducción de errores de las RPC recauchutado_*. La autorización y las reglas reales viven en la base (docs/08
// apéndice L). Tests: tests/unit/recauchutado.test.mjs
export const ESTADOS = [
  { id: 'enviado', label: 'Enviado' },
  { id: 'apto', label: 'Apto' },
  { id: 'recibido', label: 'Recibido' },
  { id: 'rechazado', label: 'Rechazado' },
];
export const etiquetaEstado = id => (ESTADOS.find(e => e.id === id) || {}).label || String(id ?? '—');
export const estaAbierto = estado => estado === 'enviado' || estado === 'apto';
export const VIDA_MAXIMA = 3;
export const MAX_PROVEEDOR = 80;
export const MAX_MOTIVO = 300;
export const MAX_PROFUNDIDAD_MM = 30;

// Acciones posibles de un proceso según su estado: enviado -> dictamen; apto -> aceptar o rechazar.
export function accionesDe(estado) {
  if (estado === 'enviado') return [{ id: 'dictamen', label: 'Registrar dictamen' }];
  if (estado === 'apto') return [{ id: 'aceptar', label: 'Aceptar' }, { id: 'rechazar', label: 'Rechazar' }];
  return [];
}

// Cubiertas que pueden enviarse: sin montar, con vida por debajo del máximo y sin proceso abierto.
export function cubiertasEnviables(cubiertas, procesos) {
  const abiertas = new Set((procesos || []).filter(p => estaAbierto(p.estado)).map(p => String(p.neumatico_id)));
  return (cubiertas || []).filter(c => (c.vida ?? 0) < VIDA_MAXIMA && !abiertas.has(String(c.id)));
}

const vacio = v => v === null || v === undefined || String(v).trim() === '';
const txt = v => (vacio(v) ? null : String(v).trim());
const fechaOk = f => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`));
const hoyISO = () => new Date().toISOString().slice(0, 10);

function fecha(f, hoy) {
  if (vacio(f)) return { ok: true, valor: null };
  const s = String(f).trim();
  if (!fechaOk(s)) return { ok: false, error: 'La fecha no es válida' };
  if (s > hoy) return { ok: false, error: 'La fecha no puede ser futura' };
  return { ok: true, valor: s };
}
const sucursal = v => (vacio(v) ? null : Number(v));

export function validarEnvio({ neumaticoId, proveedor, fecha: f, notas } = {}, { hoy = hoyISO() } = {}) {
  if (vacio(neumaticoId)) return { ok: false, error: 'Elegir la cubierta' };
  const p = txt(proveedor);
  if (!p) return { ok: false, error: 'Falta el proveedor' };
  if (p.length > MAX_PROVEEDOR) return { ok: false, error: `El proveedor admite hasta ${MAX_PROVEEDOR} caracteres` };
  const fe = fecha(f, hoy);
  if (!fe.ok) return fe;
  const n = txt(notas);
  if (n && n.length > 500) return { ok: false, error: 'Las notas admiten hasta 500 caracteres' };
  return { ok: true, args: { p_neumatico_id: Number(neumaticoId), p_proveedor: p, p_fecha: fe.valor, p_notas: n } };
}

// apto: true | false. Un dictamen no apto exige motivo (la cubierta vuelve sin nueva vida).
export function validarDictamen({ id, apto, motivo, fecha: f, sucursalId } = {}, { hoy = hoyISO() } = {}) {
  if (vacio(id)) return { ok: false, error: 'Falta el proceso' };
  if (apto !== true && apto !== false) return { ok: false, error: 'Elegir el dictamen' };
  const m = txt(motivo);
  if (apto === false && !m) return { ok: false, error: 'Falta el motivo del rechazo' };
  if (m && m.length > MAX_MOTIVO) return { ok: false, error: `El motivo admite hasta ${MAX_MOTIVO} caracteres` };
  const fe = fecha(f, hoy);
  if (!fe.ok) return fe;
  return { ok: true, args: { p_id: Number(id), p_apto: apto, p_motivo: m, p_fecha: fe.valor, p_sucursal_id: apto ? null : sucursal(sucursalId) } };
}

export function validarRechazo({ id, motivo, fecha: f, sucursalId } = {}, { hoy = hoyISO() } = {}) {
  if (vacio(id)) return { ok: false, error: 'Falta el proceso' };
  const m = txt(motivo);
  if (!m) return { ok: false, error: 'Falta el motivo del rechazo' };
  if (m.length > MAX_MOTIVO) return { ok: false, error: `El motivo admite hasta ${MAX_MOTIVO} caracteres` };
  const fe = fecha(f, hoy);
  if (!fe.ok) return fe;
  return { ok: true, args: { p_id: Number(id), p_motivo: m, p_fecha: fe.valor, p_sucursal_id: sucursal(sucursalId) } };
}

// Aceptación: profundidad inicial obligatoria (mm, 0 a 30); costo opcional en una moneda.
export function validarAceptacion(d = {}, { hoy = hoyISO() } = {}) {
  if (vacio(d.id)) return { ok: false, error: 'Falta el proceso' };
  if (vacio(d.profundidad)) return { ok: false, error: 'Falta la profundidad inicial de la banda' };
  const prof = Number(String(d.profundidad).trim().replace(',', '.'));
  if (!Number.isFinite(prof) || prof <= 0 || prof > MAX_PROFUNDIDAD_MM) {
    return { ok: false, error: `La profundidad debe estar entre 0 y ${MAX_PROFUNDIDAD_MM} mm` };
  }
  let costo = null;
  if (!vacio(d.costo)) {
    const s = String(d.costo).trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'El costo debe ser un número mayor o igual a 0, con hasta 2 decimales' };
    costo = Number(s);
  }
  const moneda = (txt(d.moneda) || 'UYU').toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) return { ok: false, error: 'La moneda debe ser un código de 3 letras' };
  const bm = txt(d.bandaMarca);
  const bmo = txt(d.bandaModelo);
  if ((bm && bm.length > 60) || (bmo && bmo.length > 60)) return { ok: false, error: 'La marca y el modelo de la banda admiten hasta 60 caracteres' };
  const fe = fecha(d.fecha, hoy);
  if (!fe.ok) return fe;
  return {
    ok: true,
    args: {
      p_id: Number(d.id), p_profundidad_mm: prof, p_banda_marca: bm, p_banda_modelo: bmo, p_costo: costo,
      p_moneda: moneda, p_fecha: fe.valor, p_sucursal_id: sucursal(d.sucursalId), p_notas: txt(d.notas),
    },
  };
}

export const ERROR_GENERICO_RECAUCHUTADO = 'No se pudo guardar. Reintentar';

export function traducirErrorRecauchutado(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) return 'Sin permiso para gestionar el recauchutado';
  if (code === 'P0002' || msg.includes('inexistente')) return 'El registro ya no existe. Actualizar la lista';
  if (code === '55000') {
    if (msg.includes('montada')) return 'La cubierta está montada. Retirarla del vehículo antes de enviarla';
    if (msg.includes('ya está en recauchutado')) return 'La cubierta ya está en recauchutado';
    return 'El proceso ya cambió de estado. Actualizar la lista';
  }
  if (code === '23514' && msg.includes('vida máxima')) return 'La carcasa ya alcanzó la vida máxima (3 recauchutados)';
  if (msg.includes('fecha')) return 'La fecha no es válida';
  if (code === '22023' || code === '22004' || code === '22003' || code === '23514') return 'Datos del formulario inválidos';
  return ERROR_GENERICO_RECAUCHUTADO;
}
