// Dominio: calidad de las mediciones (F3, docs/16). Funciones PURAS (sin DOM ni supabase). Tests: tests/unit/calidad.test.mjs
// Estados de mediciones.calidad: 'valida' | 'sospechosa' | 'invalidada'. Solo las invalidadas se excluyen de tasas,
// estados y alertas (lo hace la base); las sospechosas siguen contando hasta que una persona decide.
import { fmtNum, plural } from './formato.js';
import { validarMotivo as validarMotivoCatalogo, TIPO_MOTIVO, MOTIVO_OTRO } from './motivos.js';

export const OBSERVADAS = ['sospechosa', 'invalidada'];
export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 300;
export const MAX_LISTA = 200;
export const HUELLA_MIN = 0;
export const HUELLA_MAX = 30;
const PREFIJO_CAIDA_BRUSCA = 'Caída brusca';

const nulo = v => v === null || v === undefined;
const ETIQUETA = { sospechosa: 'En revisión', invalidada: 'Invalidada', valida: 'Válida' };
const SIMBOLO = { sospechosa: '!', invalidada: '✕', valida: '✓' };

// Una medición válida que se corrigió se muestra como «Corregida»: la base deja corregida_at no nulo.
export const esCorregida = r => !nulo(r) && r.calidad === 'valida' && !nulo(r.corregida_at);
export const etiquetaCalidad = (c, corregida = false) => (c === 'valida' && corregida ? 'Corregida' : ETIQUETA[c] || 'Válida');
export const simboloCalidad = c => SIMBOLO[c] || '✓';

// La base escribe «Caída brusca de X mm desde la medición anterior» como motivo de una medición sospechosa.
export const esCaidaBrusca = motivo => typeof motivo === 'string' && motivo.startsWith(PREFIJO_CAIDA_BRUSCA);

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

// ---- Corrección de una medición (RPC medicion_corregir) --------------------------------------------------------------
// La base vuelve a validar todo (23514, 22023, 22004). Aquí se evita el viaje y se da el mensaje junto al campo.

// Una huella: obligatoria, número con coma o punto, de 0 a 30 mm, máximo un decimal.
function validarHuella(valor, campo, numero) {
  const s = String(valor ?? '').trim();
  if (s === '') return { ok: false, campo, error: `Indicar la huella ${numero}` };
  const t = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, campo, error: `La huella ${numero} debe ser un número` };
  const mm = Number(t);
  if (mm < HUELLA_MIN || mm > HUELLA_MAX) return { ok: false, campo, error: `La huella debe estar entre ${HUELLA_MIN} y ${HUELLA_MAX} mm` };
  if (t.includes('.') && t.split('.')[1].length > 1) return { ok: false, campo, error: 'Máximo un decimal' };
  return { ok: true, valor: mm };
}

// Formulario de corrección -> argumentos de medicion_corregir. {ok, args} | {ok:false, campo, error}.
// El motivo sale del catálogo `correccion_medicion` (motivos.js); el error de texto va al campo motivoTexto.
export function validarCorreccion({ medicionId, mm1, mm2, mm3, motivoCodigo, motivoTexto } = {}, catalogo) {
  if (!(Number(medicionId) > 0)) return { ok: false, campo: 'medicionId', error: 'Falta la medición' };
  const valores = {};
  for (const [campo, valor, numero] of [['mm1', mm1, 1], ['mm2', mm2, 2], ['mm3', mm3, 3]]) {
    const h = validarHuella(valor, campo, numero);
    if (!h.ok) return h;
    valores[campo] = h.valor;
  }
  const motivo = validarMotivoCatalogo(catalogo, TIPO_MOTIVO.corregir, motivoCodigo, motivoTexto);
  if (!motivo.ok) {
    const campo = String(motivoCodigo ?? '').trim() === MOTIVO_OTRO ? 'motivoTexto' : 'motivoCodigo';
    return { ok: false, campo, error: motivo.error };
  }
  return {
    ok: true,
    args: {
      p_medicion_id: Number(medicionId), p_mm1: valores.mm1, p_mm2: valores.mm2, p_mm3: valores.mm3,
      p_motivo_codigo: motivo.codigo, p_motivo_texto: motivo.texto,
    },
  };
}

// Número de una huella guardada (puede venir como texto «9.0») o de un argumento; NaN si falta.
const numeroMm = v => (nulo(v) || String(v).trim() === '' ? NaN : Number(String(v).trim().replace(',', '.')));

// true si las tres huellas de `args` (salida de validarCorreccion) son iguales a las de la medición: la vista no llama a la RPC.
export const sinCambios = (medicion, args) => ['mm1', 'mm2', 'mm3'].every(k => numeroMm(medicion?.[k]) === numeroMm(args?.[`p_${k}`]));

// Error de medicion_corregir -> mensaje para la interfaz (frases cortas, docs/14).
export function traducirErrorCorreccion(e) {
  const code = e && e.code ? String(e.code) : '';
  const msg = (e && e.message ? String(e.message) : '').toLowerCase();
  if (code === '42501') return 'Sin permiso para corregir esta medición';
  if (code === 'P0002') return 'La medición ya no existe';
  if (code === '22023' && msg.includes('revalidar')) return 'Marcar la medición como válida antes de corregirla';
  if (code === '22023' && msg.includes('motivo')) return 'Elegir un motivo de la lista';
  if (code === '22004' || code === '23514' || code === '22023') return 'Revisar los valores de las huellas';
  return 'No se pudo guardar la corrección. Reintentar';
}
