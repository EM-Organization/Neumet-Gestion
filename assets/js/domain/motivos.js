// Motivos de los movimientos de neumáticos (RN-14) y odómetro obligatorio por cliente (RN-12). Lógica pura: sin DOM ni red.
// El catálogo lo carga core/motivos.js desde motivos_movimiento; la base vuelve a validar todo (RPC 22023).
// docs/08 apéndice AA. Tests: tests/unit/motivos.test.mjs
import { validarOdometroVehiculo } from './quema.js';

export const MOTIVO_OTRO = 'otro';
export const MAX_MOTIVO_TEXTO = 300;

// Tipo de catálogo que usa cada operación (espejo de la base). El retiro y el cambio a baja usan el catálogo de baja.
export const TIPO_MOTIVO = Object.freeze({ rotar: 'rotacion', baja: 'baja', cambio: 'cambio', desmontaje: 'desmontaje', rotarDisco: 'rotacion_disco', alinear: 'alineacion', corregir: 'correccion_medicion' });

// Motivos activos del tipo, en el orden del catálogo. `catalogo` = filas de motivos_movimiento {tipo, codigo, etiqueta, orden, activo}.
export function motivosDelTipo(catalogo, tipo) {
  return (catalogo || [])
    .filter(m => m.tipo === tipo && m.activo !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

// Valida el código y, si es «otro», el texto libre. Devuelve el par que se envía a la RPC (texto solo con «otro»).
export function validarMotivo(catalogo, tipo, codigo, texto) {
  const cod = String(codigo ?? '').trim();
  if (!cod) return { ok: false, error: 'Elegir el motivo' };
  if (!motivosDelTipo(catalogo, tipo).some(m => m.codigo === cod)) return { ok: false, error: 'Elegir un motivo de la lista' };
  if (cod !== MOTIVO_OTRO) return { ok: true, codigo: cod, texto: null };
  const txt = String(texto ?? '').trim();
  if (!txt) return { ok: false, error: 'Escribir el motivo' };
  if (txt.length > MAX_MOTIVO_TEXTO) return { ok: false, error: `El motivo admite hasta ${MAX_MOTIVO_TEXTO} caracteres` };
  return { ok: true, codigo: cod, texto: txt };
}

// Con el flag del cliente en true el odómetro es obligatorio; con false, opcional como antes.
export function validarOdometroObligatorio(texto, actual, obligatorio) {
  const s = String(texto ?? '').trim();
  if (s === '' && obligatorio) return { ok: false, error: 'Indicar la lectura del odómetro del vehículo' };
  return validarOdometroVehiculo(texto, actual);
}

// Texto corto del motivo para resúmenes e historial: con «otro», el texto escrito. Sin código no se inventa nada.
export function etiquetaMotivo(catalogo, codigo, texto) {
  if (!codigo) return '';
  if (codigo === MOTIVO_OTRO) return texto || 'Otro';
  const m = (catalogo || []).find(x => x.codigo === codigo);
  return m ? m.etiqueta : codigo;
}

// Tipo de motivo de un cambio según su destino viejo: la baja usa el catálogo de baja; el resto, el de cambio.
export const tipoMotivoCambio = destino => (destino === 'baja' ? TIPO_MOTIVO.baja : TIPO_MOTIVO.cambio);
export const tipoMotivoRetiro = destino => (destino === 'baja' ? TIPO_MOTIVO.baja : TIPO_MOTIVO.desmontaje);
