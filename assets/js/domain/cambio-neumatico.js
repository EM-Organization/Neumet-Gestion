// Lógica pura del cambio de neumático en el taller (sin DOM ni red): validación del formulario, armado de los
// parámetros de la RPC neumatico_cambiar y traducción de sus errores. docs/08 apéndice (autorización de escritura).
import { VIDA_MAX } from './ciclo-vida.js';
import { normalizarQuema, parseKmPrevios, validarOdometroVehiculo } from './quema.js';
import { cubiertasMontables, nombreUbicacion } from './stock-cubiertas.js';

export const DESTINOS = [
  { id: 'baja', label: 'Baja por desgaste', ayuda: 'El neumático se retira definitivamente.' },
  { id: 'reencauche', label: 'Recauchutado', ayuda: 'Se manda a recauchutar (suma una vida).' },
  { id: 'reparacion', label: 'Reparación', ayuda: 'Queda en reparación.' },
  { id: 'almacenado', label: 'Almacenar', ayuda: 'Vuelve al stock para reutilizarlo.' }
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

// f: {neum, destino, motivo, origen:'cubierta'|'stock'|'nuevo', cubiertaId, cubiertas:[...], stockId, stock:[...], marca,
//     modelo, codigo, kmPrevios, numeroQuema, odometro, odometroActual, sucursales:[...],
//     devolverStock, sucursalStock, quemaViejo}
// origen 'cubierta' = cubierta individual del stock (conserva su quema y km); 'stock' = lote antiguo con cantidad.
// devolverStock (solo con destino 'almacenado'): el neumático retirado vuelve al stock en la sucursal sucursalStock
// (vacío = sin sucursal); si no tiene número de quema hay que indicarlo en quemaViejo.
// Conceptos separados: kmPrevios = km que ya traía el NEUMÁTICO (0 si es nuevo); odometro = lectura opcional del
// VEHÍCULO, que no puede ser menor al odómetro actual.
// Devuelve {ok:true, params, resumen} (params = argumentos de la RPC) o {ok:false, error}.
export function validarCambio(f) {
  const n = f && f.neum;
  if (!n) return { ok: false, error: 'No hay un neumático montado en esa posición' };
  if (n.estado === 'baja') return { ok: false, error: 'El neumático de esa posición ya está dado de baja' };
  if (!DESTINO_IDS.includes(f.destino)) return { ok: false, error: 'Elegir el destino del neumático retirado' };
  if (f.destino === 'reencauche' && (n.vida || 0) >= VIDA_MAX) {
    return { ok: false, error: `El neumático ya alcanzó la vida máxima (${VIDA_MAX} recauchutados): dar de baja` };
  }
  const motivo = String(f.motivo == null ? '' : f.motivo).trim();
  if (f.destino === 'baja' && !motivo) return { ok: false, error: 'Falta el motivo de la baja' };
  if (motivo.length > MAX_MOTIVO) return { ok: false, error: `El motivo es demasiado largo (máx. ${MAX_MOTIVO})` };

  // La cubierta individual ya trae su quema y sus km: los campos del formulario (ocultos) no se validan.
  const esCubierta = f.origen === 'cubierta';
  const kp = esCubierta ? { ok: true, valor: 0 } : parseKmPrevios(f.kmPrevios);
  if (!kp.ok) return { ok: false, error: kp.error };
  const q = esCubierta ? { ok: true, valor: null } : normalizarQuema(f.numeroQuema);
  if (!q.ok) return { ok: false, error: q.error };
  const od = validarOdometroVehiculo(f.odometro, f.odometroActual);
  if (!od.ok) return { ok: false, error: od.error };
  const odo = od.valor;

  // Devolver al stock el neumático retirado: necesita número de quema (el propio o uno nuevo).
  const devolver = f.destino === 'almacenado' && !!f.devolverStock;
  let quemaViejo = null, sucursalStock = null;
  if (devolver) {
    sucursalStock = f.sucursalStock === null || f.sucursalStock === undefined || f.sucursalStock === '' ? null : Number(f.sucursalStock);
    if (!n.numero_quema) {
      const qv = normalizarQuema(f.quemaViejo);
      if (!qv.ok) return qv;
      if (qv.valor === null) return { ok: false, error: 'Falta el número de quema del neumático retirado para guardarlo en el stock' };
      quemaViejo = qv.valor;
    }
  }

  let stockId = null, cubiertaId = null, nuevo = null, nuevoTxt;
  if (f.origen === 'cubierta') {
    const c = cubiertasMontables(f.cubiertas).find(x => String(x.id) === String(f.cubiertaId));
    if (!c) return { ok: false, error: 'Elegir una cubierta del stock disponible' };
    cubiertaId = Number(c.id);
    nuevoTxt = `${[c.marca, c.modelo].filter(Boolean).join(' ') || 'cubierta'} (cubierta ${c.numero_quema} del stock)`;
  } else if (f.origen === 'stock') {
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

  const quemaNueva = q.valor, kmNuevo = kp.valor;
  const params = {
    p_vehiculo_id: n.vehiculo_id,
    p_posicion: n.posicion,
    p_destino_viejo: f.destino,
    p_motivo: motivo || null,
    p_odometro_km: odo,
    p_stock_id: stockId,
    p_nuevo: nuevo,
    p_numero_quema: quemaNueva,
    p_km_previos: kmNuevo
  };
  if (cubiertaId) params.p_cubierta_id = cubiertaId;
  if (devolver) {
    params.p_devolver_stock = true;
    params.p_sucursal_stock = sucursalStock;
    if (quemaViejo) params.p_quema_viejo = quemaViejo;
  }
  return {
    ok: true,
    params,
    resumen: resumenCambio(n, f.destino, motivo, nuevoTxt, odo, {
      quema: q.valor, kmPrevios: kmNuevo,
      stockDestino: devolver ? nombreUbicacion(sucursalStock, f.sucursales) : null,
    })
  };
}

export function resumenCambio(n, destino, motivo, nuevoTxt, odo, extra = {}) {
  const viejo = [n.marca, n.modelo].filter(Boolean).join(' ') || 'Sin marca';
  return `P${n.posicion}: sale ${viejo} (${etiquetaDestino(destino).toLowerCase()}${motivo ? ': ' + motivo : ''}${extra.stockDestino ? ' · vuelve al stock, ' + extra.stockDestino : ''}) y entra ${nuevoTxt}`
    + (extra.quema ? ` · quema ${extra.quema}` : '')
    + (extra.kmPrevios > 0 ? ` · ${extra.kmPrevios} km previos` : '')
    + (odo != null ? ` · odómetro ${odo} km` : '');
}

// Error de la RPC (PostgREST: {code, message}) -> mensaje comprensible para el gomero.
export function traducirErrorCambio(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) {
    return 'Sin permiso para cambiar neumáticos de este vehículo';
  }
  if (msg.includes('necesita número de quema')) return 'El neumático retirado necesita número de quema para volver al stock';
  if (msg.includes('stock lo gestiona')) return 'Este usuario no puede usar el stock. Cargar el neumático nuevo a mano';
  if (code === '55000' || msg.includes('sin unidades')) return 'No quedan unidades de ese neumático en el stock';
  if (code === 'P0002') {
    if (msg.includes('cubierta')) return 'Esa cubierta ya no está disponible en el stock. Actualizar la lista y elegir otra';
    if (msg.includes('stock')) return 'Ese neumático ya no está en el stock. Actualizar la lista y elegir otro';
    if (msg.includes('neumático')) return 'Ya no hay un neumático montado en esa posición. Actualizar la pantalla';
    return 'No se encontró el vehículo o el neumático. Actualizar la pantalla';
  }
  if (msg.includes('vida máxima')) return `El neumático ya alcanzó la vida máxima (${VIDA_MAX} recauchutados): dar de baja`;
  if (msg.includes('dado de baja')) return 'Ese neumático ya está dado de baja';
  if (msg.includes('motivo')) return 'Motivo obligatorio para la baja (máx. 200 caracteres)';
  if (code === '23505' || msg.includes('número de quema ya')) return 'Ese número de quema ya está registrado en otro neumático';
  if (msg.includes('quema demasiado')) return 'El número de quema admite hasta 40 caracteres';
  if (msg.includes('km previos')) return 'Los km que ya traía el neumático deben ser un número entero mayor o igual a 0';
  if (msg.includes('odómetro del vehículo no puede ser menor')) {
    const m = /\((\d+) km\)/.exec(String(err.message));
    return m ? `El odómetro del vehículo no puede ser menor al actual (${m[1]} km)` : 'El odómetro del vehículo no puede ser menor al actual';
  }
  if (msg.includes('odómetro') || msg.includes('kilometraje')) return 'Odómetro del vehículo inválido: no puede ser negativo ni menor al actual';
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
