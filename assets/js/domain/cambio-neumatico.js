// Lógica pura del cambio de neumático en el taller (sin DOM ni red): validación del formulario, armado de los
// parámetros de la RPC neumatico_cambiar y traducción de sus errores. docs/08 apéndice (autorización de escritura).
import { parseEnteroNoNeg, VIDA_MAX } from './ciclo-vida.js';

export const DESTINOS = [
  { id: 'baja', label: 'Baja por desgaste', ayuda: 'El neumático se retira definitivamente.' },
  { id: 'reencauche', label: 'Reencauche', ayuda: 'Se manda a reencauchar (suma una vida).' },
  { id: 'reparacion', label: 'Reparación', ayuda: 'Queda en reparación.' },
  { id: 'almacenado', label: 'Almacenar', ayuda: 'Se guarda para reutilizarlo.' }
];
const DESTINO_IDS = DESTINOS.map(d => d.id);
export const MOTIVO_POR_DEFECTO = 'Desgaste';
const MAX_TXT = 60, MAX_MOTIVO = 200;

export const etiquetaDestino = id => (DESTINOS.find(d => d.id === id) || {}).label || id;

// Del stock del cliente solo se ofrecen lotes con unidades.
export function stockDisponible(stock) {
  return (stock || []).filter(s => Number.isInteger(s.cantidad) && s.cantidad > 0);
}
export const etiquetaStock = s => `${[s.marca, s.modelo].filter(Boolean).join(' ') || 'Sin marca'} · ${s.cantidad} u.`;

// f: {neum, destino, motivo, origen:'stock'|'nuevo', stockId, stock:[...], marca, modelo, codigo, odometro, odometroActual}
// Devuelve {ok:true, params, resumen} (params = argumentos de la RPC) o {ok:false, error}.
export function validarCambio(f) {
  const n = f && f.neum;
  if (!n) return { ok: false, error: 'No hay un neumático montado en esa posición' };
  if (n.estado === 'baja') return { ok: false, error: 'El neumático de esa posición ya está dado de baja' };
  if (!DESTINO_IDS.includes(f.destino)) return { ok: false, error: 'Elegir el destino del neumático retirado' };
  if (f.destino === 'reencauche' && (n.vida || 0) >= VIDA_MAX) {
    return { ok: false, error: `El neumático ya alcanzó la vida máxima (${VIDA_MAX} reencauches): dalo de baja` };
  }
  const motivo = String(f.motivo == null ? '' : f.motivo).trim();
  if (f.destino === 'baja' && !motivo) return { ok: false, error: 'Falta el motivo de la baja' };
  if (motivo.length > MAX_MOTIVO) return { ok: false, error: `El motivo es demasiado largo (máx. ${MAX_MOTIVO})` };

  const odoTxt = f.odometro == null ? '' : String(f.odometro).trim();
  let odo = null;
  if (odoTxt !== '') {
    odo = parseEnteroNoNeg(odoTxt);
    if (odo === null) return { ok: false, error: 'El kilometraje debe ser un número entero mayor o igual a 0' };
    if (Number.isInteger(f.odometroActual) && odo < f.odometroActual) {
      return { ok: false, error: `El kilometraje no puede ser menor al actual (${f.odometroActual} km)` };
    }
  }

  let stockId = null, nuevo = null, nuevoTxt;
  if (f.origen === 'stock') {
    const s = stockDisponible(f.stock).find(x => String(x.id) === String(f.stockId));
    if (!s) return { ok: false, error: 'Elegir un neumático del stock con unidades disponibles' };
    stockId = Number(s.id);
    nuevoTxt = `${[s.marca, s.modelo].filter(Boolean).join(' ')} (del stock)`;
  } else if (f.origen === 'nuevo') {
    const marca = String(f.marca == null ? '' : f.marca).trim();
    const modelo = String(f.modelo == null ? '' : f.modelo).trim();
    const codigo = String(f.codigo == null ? '' : f.codigo).trim();
    if (!marca) return { ok: false, error: 'Falta la marca del neumático nuevo' };
    if (marca.length > MAX_TXT || modelo.length > MAX_TXT || codigo.length > MAX_TXT) {
      return { ok: false, error: `Marca, modelo y código admiten hasta ${MAX_TXT} caracteres` };
    }
    nuevo = { marca };
    if (modelo) nuevo.modelo = modelo;
    if (codigo) nuevo.codigo = codigo;
    nuevoTxt = [marca, modelo].filter(Boolean).join(' ');
  } else {
    return { ok: false, error: 'Elegir el origen del neumático nuevo' };
  }

  return {
    ok: true,
    params: {
      p_vehiculo_id: n.vehiculo_id,
      p_posicion: n.posicion,
      p_destino_viejo: f.destino,
      p_motivo: motivo || null,
      p_odometro_km: odo,
      p_stock_id: stockId,
      p_nuevo: nuevo
    },
    resumen: resumenCambio(n, f.destino, motivo, nuevoTxt, odo)
  };
}

export function resumenCambio(n, destino, motivo, nuevoTxt, odo) {
  const viejo = [n.marca, n.modelo].filter(Boolean).join(' ') || 'Sin marca';
  return `P${n.posicion}: sale ${viejo} (${etiquetaDestino(destino).toLowerCase()}${motivo ? ': ' + motivo : ''}) y entra ${nuevoTxt}`
    + (odo != null ? ` · ${odo} km` : '');
}

// Error de la RPC (PostgREST: {code, message}) -> mensaje comprensible para el gomero.
export function traducirErrorCambio(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) {
    return 'Sin permiso para cambiar neumáticos de este vehículo';
  }
  if (msg.includes('stock lo gestiona')) return 'Este usuario no puede usar el stock. Cargar el neumático nuevo a mano';
  if (code === '55000' || msg.includes('sin unidades')) return 'No quedan unidades de ese neumático en el stock';
  if (code === 'P0002') {
    if (msg.includes('stock')) return 'Ese neumático ya no está en el stock. Actualizar la lista y elegir otro';
    if (msg.includes('neumático')) return 'Ya no hay un neumático montado en esa posición. Actualizar la pantalla';
    return 'No se encontró el vehículo o el neumático. Actualizar la pantalla';
  }
  if (msg.includes('vida máxima')) return `El neumático ya alcanzó la vida máxima (${VIDA_MAX} reencauches): dalo de baja`;
  if (msg.includes('dado de baja')) return 'Ese neumático ya está dado de baja';
  if (msg.includes('motivo')) return 'Motivo obligatorio para la baja (máx. 200 caracteres)';
  if (msg.includes('odómetro') || msg.includes('kilometraje')) return 'Kilometraje inválido: no puede ser negativo ni menor al actual';
  if (msg.includes('marca') || msg.includes('precio') || msg.includes('vida fuera')) return 'Datos del neumático nuevo inválidos';
  if (msg.includes('posición libre')) return 'No hay lugar para guardar el neumático retirado en este vehículo';
  if (code === '22023' || code === '22004' || code === '23514') return 'Datos del formulario inválidos';
  return 'No se pudo registrar el cambio. No se guardó nada. Reintentar';
}

// Rotación desde un botón de posición: valida y detecta el intercambio.
export function validarRotacion(neumaticos, vehiculoId, posA, posB) {
  const a = Number(posA), b = Number(posB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > 99 || b < 1 || b > 99) {
    return { ok: false, error: 'Posiciones válidas: 1 a 99' };
  }
  if (a === b) return { ok: false, error: 'La posición de destino es la misma' };
  const montados = (neumaticos || []).filter(n => n.vehiculo_id === vehiculoId);
  const na = montados.find(n => n.posicion === a);
  if (!na) return { ok: false, error: `No hay neumático en P${a}` };
  if (na.estado === 'baja') return { ok: false, error: `El neumático de P${a} está dado de baja` };
  const nb = montados.find(n => n.posicion === b);
  if (nb && nb.estado === 'baja') return { ok: false, error: `P${b} está ocupada por un neumático dado de baja` };
  return { ok: true, intercambio: nb || null, params: { p_vehiculo_id: vehiculoId, p_pos_a: a, p_pos_b: b } };
}
