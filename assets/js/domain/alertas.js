// Dominio: alerta única «Neumático crítico» con estado (docs/08 apéndice M). Funciones PURAS (sin DOM ni supabase).
// Entradas = filas de v_alertas (estado: abierta | reconocida; silenciada_hasta).

export const ESTADO_ALERTA_LABEL = { abierta: 'Abierta', reconocida: 'Reconocida', silenciada: 'Silenciada' };
export const DIAS_SILENCIO = 7;
export const NOTA_MAX = 200;

const ts = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };

// Silenciada = abierta o reconocida con silencio vigente. Sin estado (filas previas a la migración) = abierta.
export function estadoAlerta(a, ahora = Date.now()) {
  const hasta = ts(a && a.silenciada_hasta);
  if (hasta !== null && hasta > ahora) return 'silenciada';
  return a && a.estado === 'reconocida' ? 'reconocida' : 'abierta';
}
export const etiquetaEstadoAlerta = e => ESTADO_ALERTA_LABEL[e] || ESTADO_ALERTA_LABEL.abierta;

export function contarPorEstadoAlerta(alertas, ahora = Date.now()) {
  const c = { abierta: 0, reconocida: 0, silenciada: 0 };
  for (const a of alertas || []) c[estadoAlerta(a, ahora)]++;
  return c;
}

export function filtrarPorEstadoAlerta(alertas, estado = '', ahora = Date.now()) {
  return (alertas || []).filter(a => !estado || estadoAlerta(a, ahora) === estado);
}

// Alertas que nadie atendió: abiertas y no silenciadas (las que Inicio destaca).
export const sinReconocer = (alertas, ahora = Date.now()) => contarPorEstadoAlerta(alertas, ahora).abierta;

export function hastaSilencio(dias = DIAS_SILENCIO, ahora = Date.now()) {
  return new Date(ahora + dias * 86400000).toISOString();
}

export function validarNota(raw) {
  const nota = String(raw ?? '').trim();
  if (!nota) return { ok: false, error: 'Falta la nota de resolución' };
  if (nota.length > NOTA_MAX) return { ok: false, error: `La nota admite hasta ${NOTA_MAX} caracteres` };
  return { ok: true, nota };
}

export function traducirErrorAlerta(err) {
  const code = err && err.code;
  if (code === '42501') return 'Sin permiso para esta alerta';
  if (code === '55000') return 'La alerta ya estaba resuelta. Actualizar la lista.';
  if (code === '22023' || code === '23514' || code === '22004') return 'Datos inválidos. Revisar los valores.';
  return 'No se pudo completar la operación';
}
