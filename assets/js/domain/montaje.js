// Montar y retirar neumáticos sin reemplazo (lógica pura, sin DOM ni red): posiciones libres según el tipo de ruedas,
// validación de los formularios y argumentos de las RPC neumatico_montar y neumatico_desmontar. La autorización real
// vive en la base. docs/08 apéndice «Montar y retirar neumáticos». Tests: tests/unit/montaje.test.mjs
import { layoutRuedas, POS_AUXILIO } from './vehiculo-diagrama.js';
import { normalizarQuema, parseKmPrevios, validarOdometroVehiculo, MAX_QUEMA } from './quema.js';
import { cubiertasMontables, filtrarCubiertas, parsePrecio, parseFecha, etiquetaCubierta, MAX_TXT } from './stock-cubiertas.js';
import { VIDA_MAX } from './ciclo-vida.js';

export const MAX_MOTIVO = 200;
export const MAX_LISTA = 50; // cubiertas visibles en la lista del modal; el buscador acota el resto

export const DESTINOS_RETIRO = [
  { id: 'almacenado', label: 'Stock', ayuda: 'Vuelve al stock con su número de quema.' },
  { id: 'reparacion', label: 'Reparación', ayuda: 'Queda registrado como reparado.' },
  { id: 'baja', label: 'Baja', ayuda: 'Se retira definitivamente. Requiere motivo.' },
];
const DESTINO_IDS = DESTINOS_RETIRO.map(d => d.id);
export const etiquetaDestinoRetiro = id => (DESTINOS_RETIRO.find(d => d.id === id) || {}).label || String(id);

const vacio = v => v === null || v === undefined || String(v).trim() === '';

// Posiciones sin neumático montado, en orden de carga: las ruedas del tipo de vehículo (1..N) y, al final, el auxilio.
// `ocupadas` = posiciones con neumático montado; el layout es el mismo del diagrama (un vehículo de 10 ruedas con un
// neumático en 11..98 se trata como de 16, igual que la base). Devuelve [{posicion, etiqueta, auxilio}].
export function posicionesLibres(ocupadas, tipoRuedas) {
  const lay = layoutRuedas(ocupadas, tipoRuedas);
  const libres = lay.ruedas.filter(r => !r.presente).map(r => ({ posicion: r.posicion, etiqueta: r.etiqueta, auxilio: false }));
  const aux = (ocupadas || []).map(Number).includes(POS_AUXILIO) ? [] : [{ posicion: POS_AUXILIO, etiqueta: 'Auxilio', auxilio: true }];
  return [...libres, ...aux];
}

// Siguiente posición libre después de `actual` (la primera de la lista si no hay una posterior); null si no queda ninguna.
export function siguienteLibre(libres, actual) {
  const l = (libres || []).filter(x => x.posicion !== Number(actual));
  if (!l.length) return null;
  return l.find(x => x.posicion > Number(actual)) || l[0];
}

export const etiquetaPosicion = p => (p.auxilio ? 'Auxilio' : `P${p.posicion} · ${p.etiqueta}`);

// Lista del modal «Del stock»: solo cubiertas montables que coinciden con el texto (quema, marca o modelo).
export function cubiertasParaMontar(cubiertas, texto) {
  return filtrarCubiertas(cubiertasMontables(cubiertas), { texto });
}

function vida(v) {
  const s = vacio(v) ? '0' : String(v).trim();
  if (!/^\d$/.test(s) || Number(s) > VIDA_MAX) return { ok: false, error: `Los recauchutados previos van de 0 a ${VIDA_MAX}` };
  return { ok: true, valor: Number(s) };
}

function textoCorto(valor, etiqueta, obligatorio) {
  const t = String(valor ?? '').trim();
  if (!t) return obligatorio ? { ok: false, error: `Falta ${etiqueta}` } : { ok: true, valor: null };
  if (t.length > MAX_TXT) return { ok: false, error: `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} admite hasta ${MAX_TXT} caracteres` };
  return { ok: true, valor: t };
}

// f: {vehiculoId, posicion, libres:[{posicion}], origen:'stock'|'nuevo', cubiertaId, cubiertas, marca, modelo, quema,
//     kmPrevios, fechaCompra, precio, vida, odometro, odometroActual, hoy}
// Devuelve {ok:true, params, resumen} (params = argumentos de neumatico_montar) o {ok:false, error}.
export function validarMontaje(f) {
  const x = f || {};
  const pos = Number(x.posicion);
  if (!Number.isInteger(pos) || !(x.libres || []).some(p => p.posicion === pos)) {
    return { ok: false, error: 'Elegir una posición libre' };
  }
  const od = validarOdometroVehiculo(x.odometro, x.odometroActual);
  if (!od.ok) return od;
  const params = { p_vehiculo_id: Number(x.vehiculoId), p_posicion: pos, p_cubierta_id: null, p_nuevo: null, p_odometro_km: od.valor };
  const donde = pos === POS_AUXILIO ? 'auxilio' : `P${pos}`;
  let que;
  if (x.origen === 'stock') {
    const c = cubiertasMontables(x.cubiertas).find(k => String(k.id) === String(x.cubiertaId));
    if (!c) return { ok: false, error: 'Elegir una cubierta del stock' };
    params.p_cubierta_id = Number(c.id);
    que = `cubierta ${c.numero_quema || 'sin quema'} (${[c.marca, c.modelo].filter(Boolean).join(' ') || 'sin marca'})`;
  } else if (x.origen === 'nuevo') {
    const marca = textoCorto(x.marca, 'la marca', true);
    if (!marca.ok) return marca;
    const modelo = textoCorto(x.modelo, 'el modelo', false);
    if (!modelo.ok) return modelo;
    const q = normalizarQuema(x.quema);
    if (!q.ok) return q;
    const km = parseKmPrevios(x.kmPrevios);
    if (!km.ok) return km;
    const fecha = parseFecha(x.fechaCompra, x.hoy);
    if (!fecha.ok) return fecha;
    const precio = parsePrecio(x.precio);
    if (!precio.ok) return precio;
    const v = vida(x.vida);
    if (!v.ok) return v;
    params.p_nuevo = { marca: marca.valor, vida: v.valor, km_previos: km.valor };
    if (modelo.valor) params.p_nuevo.modelo = modelo.valor;
    if (q.valor) params.p_nuevo.numero_quema = q.valor;
    if (fecha.valor) params.p_nuevo.fecha_compra = fecha.valor;
    if (precio.valor !== null) params.p_nuevo.precio = precio.valor;
    que = [marca.valor, modelo.valor].filter(Boolean).join(' ') + (q.valor ? ` (quema ${q.valor})` : '');
  } else {
    return { ok: false, error: 'Elegir el origen del neumático' };
  }
  return { ok: true, params, resumen: `${donde}: entra ${que}${od.valor !== null ? ` · odómetro ${od.valor} km` : ''}` };
}

// f: {vehiculoId, posicion, neum:{numero_quema, marca, modelo}, destino, motivo, sucursalStock, quema, odometro,
//     odometroActual, puedeStock}
// Devuelve {ok:true, params, resumen} (params = argumentos de neumatico_desmontar) o {ok:false, error}.
export function validarRetiro(f) {
  const x = f || {};
  const n = x.neum;
  if (!n) return { ok: false, error: 'No hay un neumático montado en esa posición' };
  if (!DESTINO_IDS.includes(x.destino)) return { ok: false, error: 'Elegir el destino del neumático' };
  const motivo = String(x.motivo ?? '').trim();
  if (x.destino === 'baja' && !motivo) return { ok: false, error: 'Falta el motivo de la baja' };
  if (motivo.length > MAX_MOTIVO) return { ok: false, error: `El motivo es demasiado largo (máx. ${MAX_MOTIVO})` };
  const od = validarOdometroVehiculo(x.odometro, x.odometroActual);
  if (!od.ok) return od;
  const params = {
    p_vehiculo_id: Number(x.vehiculoId), p_posicion: Number(x.posicion), p_destino: x.destino,
    p_motivo: motivo || null, p_odometro_km: od.valor, p_sucursal_stock: null, p_quema: null,
  };
  if (x.destino === 'almacenado') {
    if (!x.puedeStock) return { ok: false, error: 'Este usuario no puede usar el stock. Elegir reparación o baja' };
    params.p_sucursal_stock = vacio(x.sucursalStock) ? null : Number(x.sucursalStock);
    if (!n.numero_quema) {
      const q = normalizarQuema(x.quema);
      if (!q.ok) return q;
      if (q.valor === null) return { ok: false, error: 'Falta el número de quema para guardar el neumático en el stock' };
      params.p_quema = q.valor;
    }
  }
  const quien = [n.marca, n.modelo].filter(Boolean).join(' ') || 'Sin marca';
  return {
    ok: true, params,
    resumen: `${Number(x.posicion) === POS_AUXILIO ? 'Auxilio' : `P${x.posicion}`}: sale ${quien} (${etiquetaDestinoRetiro(x.destino).toLowerCase()}${motivo ? `: ${motivo}` : ''}) y la posición queda libre`,
  };
}

const norm = err => ({
  code: err && err.code ? String(err.code) : '',
  msg: (err && err.message ? String(err.message) : '').toLowerCase(),
  raw: err && err.message ? String(err.message) : '',
});

function comunes({ code, msg, raw }) {
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied')) return 'Sin permiso para modificar los neumáticos de este vehículo';
  if (code === 'P0002' && msg.includes('vehículo inexistente'))return 'No se encontró el vehículo. Actualizar la pantalla';
  if (msg.includes('odómetro del vehículo no puede ser menor')) {
    const m = /\((\d+) km\)/.exec(raw);
    return m ? `El odómetro del vehículo no puede ser menor al actual (${m[1]} km)` : 'El odómetro del vehículo no puede ser menor al actual';
  }
  if (msg.includes('odómetro')) return 'Odómetro del vehículo inválido: no puede ser negativo ni menor al actual';
  if (code === '23505' || msg.includes('número de quema ya')) return 'Ese número de quema ya está registrado en otro neumático';
  if (msg.includes('quema demasiado')) return `El número de quema admite hasta ${MAX_QUEMA} caracteres`;
  return null;
}

export function traducirErrorMontaje(err) {
  const e = norm(err);
  const c = comunes(e);
  if (c) return c;
  if (e.code === '55000' && e.msg.includes('auxilio')) return 'El vehículo ya tiene un neumático de auxilio';
  if (e.code === '55000' || e.msg.includes('ya tiene un neumático')) return 'La posición ya tiene un neumático. Actualizar la pantalla y elegir otra';
  if (e.code === 'P0002') return 'Esa cubierta ya no está disponible en el stock. Actualizar la lista y elegir otra';
  if (e.msg.includes('no existe en un vehículo')) return 'Esa posición no existe en este vehículo';
  if (e.msg.includes('stock lo gestiona')) return 'Este usuario no puede usar el stock. Cargar el neumático a mano';
  if (e.msg.includes('marca')) return 'Falta la marca del neumático (hasta 60 caracteres)';
  if (e.msg.includes('km previos')) return 'Los km que ya traía el neumático deben ser un número entero mayor o igual a 0';
  if (e.msg.includes('vida')) return `Los recauchutados previos van de 0 a ${VIDA_MAX}`;
  if (e.msg.includes('fecha')) return 'La fecha de compra no es válida';
  if (e.msg.includes('precio')) return 'El precio no es válido';
  if (e.code === '22023' || e.code === '22004' || e.code === '23514') return 'Datos del formulario inválidos';
  return 'No se pudo montar el neumático. No se guardó nada. Reintentar';
}

export function traducirErrorRetiro(err) {
  const e = norm(err);
  const c = comunes(e);
  if (c) return c;
  if (e.msg.includes('stock lo gestiona')) return 'Este usuario no puede usar el stock. Elegir reparación o baja';
  if (e.msg.includes('necesita número de quema')) return 'Falta el número de quema para guardar el neumático en el stock';
  if (e.code === 'P0002') return 'Ya no hay un neumático montado en esa posición. Actualizar la pantalla';
  if (e.msg.includes('motivo')) return `Falta el motivo de la baja (máx. ${MAX_MOTIVO} caracteres)`;
  if (e.msg.includes('posición libre')) return 'No hay lugar para guardar el neumático retirado en este vehículo';
  if (e.code === '22023' || e.code === '22004' || e.code === '23514') return 'Datos del formulario inválidos';
  return 'No se pudo retirar el neumático. No se guardó nada. Reintentar';
}

// Etiqueta de una cubierta en la lista del modal (misma que Stock y el cambio de neumático).
export { etiquetaCubierta };
