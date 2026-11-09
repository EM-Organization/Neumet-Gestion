// Dominio: calidad de las mediciones (F3, docs/16). Funciones PURAS (sin DOM ni supabase). Tests: tests/unit/calidad.test.mjs
// Estados de mediciones.calidad: 'valida' | 'sospechosa' | 'invalidada'. Solo las invalidadas se excluyen de tasas,
// estados y alertas (lo hace la base); las sospechosas siguen contando hasta que una persona decide.
import { fmtNum, plural } from './formato.js';

export const OBSERVADAS = ['sospechosa', 'invalidada'];
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 300;
export const MAX_LISTA = 200;

const nulo = v => v === null || v === undefined;
const ETIQUETA = { sospechosa: 'En revisión', invalidada: 'Invalidada', valida: 'Válida' };
const SIMBOLO = { sospechosa: '!', invalidada: '✕', valida: '✓' };

export const etiquetaCalidad = c => ETIQUETA[c] || 'Válida';
export const simboloCalidad = c => SIMBOLO[c] || '✓';

// Solo las filas con observaciones (sospechosa o invalidada), en el orden recibido.
export const soloObservadas = rows => (rows || []).filter(r => r && OBSERVADAS.includes(r.calidad));

// {total, sospechosas, invalidadas}
export function contarObservadas(rows) {
  const o = soloObservadas(rows);
  const sospechosas = o.filter(r => r.calidad === 'sospechosa').length;
  return { total: o.length, sospechosas, invalidadas: o.length - sospechosas };
}

// «1 medición con observaciones» / «3 mediciones con observaciones»
export const textoObservaciones = n => plural(n, 'medición con observaciones', 'mediciones con observaciones');

// Detalle: «2 en revisión · 1 invalidada»; vacío si no hay ninguna.
export function detalleObservaciones(rows) {
  const c = contarObservadas(rows);
  return [c.sospechosas ? `${fmtNum(c.sospechosas)} en revisión` : '', c.invalidadas ? plural(c.invalidadas, 'invalidada', 'invalidadas') : '']
    .filter(Boolean).join(' · ');
}

// Aviso sobrio de Inicio. Sin mediciones por revisar no hay aviso (cadena vacía).
export function textoAvisoInicio(n) {
  const k = Number(n) || 0;
  if (k <= 0) return '';
  return k === 1 ? '1 medición requiere revisión' : `${fmtNum(k)} mediciones requieren revisión`;
}

// «9,5 · 9,0 · 8,8 mm» (interno · centro · externo). Un valor ausente se muestra «—», nunca 0.
export function valoresTexto(r) {
  const v = [r.mm1, r.mm2, r.mm3].map(x => (nulo(x) ? '—' : fmtNum(x, 1)));
  return `${v.join(' · ')} mm`;
}

// Asigna cada medición con observaciones al neumático montado (fila de v_estado_neumaticos) al que pertenece:
//   * con idneumatico: el neumático con ese identificador, esté en la posición que esté;
//   * sin idneumatico: el neumático montado en esa posición.
// Devuelve {porPosicion: Map(posicion actual -> filas), otras: filas que no son de un neumático montado ahora}.
export function agruparPorNeumatico(obs, filasEstado) {
  const porId = new Map(), porPos = new Map();
  (filasEstado || []).forEach(f => {
    if (f.idneumatico) porId.set(String(f.idneumatico), Number(f.posicion));
    porPos.set(Number(f.posicion), Number(f.posicion));
  });
  const porPosicion = new Map(), otras = [];
  soloObservadas(obs).forEach(r => {
    const pos = r.idneumatico ? porId.get(String(r.idneumatico)) : porPos.get(Number(r.posicion));
    if (nulo(pos)) { otras.push(r); return; }
    if (!porPosicion.has(pos)) porPosicion.set(pos, []);
    porPosicion.get(pos).push(r);
  });
  return { porPosicion, otras };
}

// Motivo de invalidación: obligatorio, 3 a 300 caracteres. {ok, motivo} | {ok:false, error}.
export function validarMotivo(texto) {
  const t = String(texto ?? '').trim();
  if (t.length < MOTIVO_MIN) return { ok: false, error: `Indicar el motivo (mínimo ${MOTIVO_MIN} caracteres)` };
  if (t.length > MOTIVO_MAX) return { ok: false, error: `El motivo admite hasta ${MOTIVO_MAX} caracteres` };
  return { ok: true, motivo: t };
}

// Error de las RPC medicion_invalidar / medicion_revalidar -> mensaje para la interfaz (frases cortas, docs/14).
export function traducirErrorCalidad(e) {
  const code = e && e.code;
  if (code === '42501') return 'Sin permiso para modificar esta medición';
  if (code === 'P0002') return 'La medición ya no existe';
  if (code === '22023' || code === '22004') return 'Indicar el motivo de la invalidación';
  return 'No se pudo guardar el cambio. Reintentar';
}
