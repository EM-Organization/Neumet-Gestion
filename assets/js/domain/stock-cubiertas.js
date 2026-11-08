// Stock de cubiertas individuales (lógica pura, sin DOM ni red). Cada cubierta es una fila de `neumaticos` sin montar
// (vehiculo_id nulo): quema, marca, modelo, fecha de compra, precio opcional, condición y sucursal. La escritura pasa por
// las RPC stock_cubierta_* (la autorización real vive en la base). docs/08 apéndice «Stock individual de cubiertas».
// Tests: tests/unit/stock-cubiertas.test.mjs
import { claveBusqueda, resolverBusqueda } from './vehiculo-busqueda.js';
import { normalizarQuema } from './quema.js';

export const MAX_TXT = 60;
export const MAX_PRECIO = 9999999999.99;

// Condición de la banda. «Nuevo» pasa solo a «Usado» al primer montaje; «Reparado» y «Recauchutado» las marca el cliente.
export const CONDICIONES = [
  { id: 'nuevo', label: 'Nuevo' },
  { id: 'usado', label: 'Usado' },
  { id: 'reparado', label: 'Reparado' },
  { id: 'recauchutado', label: 'Recauchutado' },
];
// Las únicas condiciones que el cliente puede marcar a mano.
export const CONDICIONES_MANUALES = CONDICIONES.filter(c => c.id === 'reparado' || c.id === 'recauchutado');

export const etiquetaCondicion = id => (CONDICIONES.find(c => c.id === id) || {}).label || String(id ?? '—');
// Clase del distintivo; el texto siempre acompaña al color.
export const claseCondicion = id => (CONDICIONES.some(c => c.id === id) ? `cond-${id}` : 'cond-usado');

const vacio = v => v === null || v === undefined || String(v).trim() === '';
const idONull = v => (vacio(v) ? null : Number(v));

// Ubicación = sucursal del cliente o «Sin sucursal».
export const SIN_SUCURSAL = 'Sin sucursal';
export function nombreUbicacion(sucursalId, sucursales) {
  if (vacio(sucursalId)) return SIN_SUCURSAL;
  const s = (sucursales || []).find(x => String(x.id) === String(sucursalId));
  return s ? s.nombre : SIN_SUCURSAL;
}

// Precio opcional: vacío = null; número >= 0 con hasta 2 decimales.
export function parsePrecio(texto) {
  if (vacio(texto)) return { ok: true, valor: null };
  const s = String(texto).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'El precio debe ser un número mayor o igual a 0, con hasta 2 decimales' };
  const n = Number(s);
  if (n > MAX_PRECIO) return { ok: false, error: 'El precio es demasiado alto' };
  return { ok: true, valor: n };
}

// Fecha opcional en formato AAAA-MM-DD; no puede ser posterior a hoy (la base admite hasta mañana por la zona horaria).
export function parseFecha(texto, hoy = new Date().toISOString().slice(0, 10)) {
  if (vacio(texto)) return { ok: true, valor: null };
  const s = String(texto).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return { ok: false, error: 'La fecha de compra no es válida' };
  if (s > hoy) return { ok: false, error: 'La fecha de compra no puede ser futura' };
  return { ok: true, valor: s };
}

function textoCorto(valor, etiqueta, obligatorio) {
  const t = String(valor ?? '').trim();
  if (!t) return obligatorio ? { ok: false, error: `Falta ${etiqueta}` } : { ok: true, valor: null };
  if (t.length > MAX_TXT) return { ok: false, error: `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} admite hasta ${MAX_TXT} caracteres` };
  return { ok: true, valor: t };
}

// Formulario «Agregar cubierta» -> argumentos de stock_cubierta_agregar.
// f: {quema, marca, modelo, fechaCompra, precio, sucursalId, clienteId (solo admin)}; esAdmin exige cliente.
export function validarCubierta(f, { esAdmin = false, hoy } = {}) {
  const x = f || {};
  const q = normalizarQuema(x.quema);
  if (!q.ok) return q;
  if (q.valor === null) return { ok: false, error: 'Falta el número de quema' };
  const marca = textoCorto(x.marca, 'la marca', true);
  if (!marca.ok) return marca;
  const modelo = textoCorto(x.modelo, 'el modelo', false);
  if (!modelo.ok) return modelo;
  const fecha = parseFecha(x.fechaCompra, hoy);
  if (!fecha.ok) return fecha;
  const precio = parsePrecio(x.precio);
  if (!precio.ok) return precio;
  if (esAdmin && vacio(x.clienteId)) return { ok: false, error: 'Falta el cliente' };
  const args = {
    p_numero_quema: q.valor, p_marca: marca.valor, p_modelo: modelo.valor, p_fecha_compra: fecha.valor,
    p_precio: precio.valor, p_sucursal_id: idONull(x.sucursalId),
  };
  if (esAdmin) args.p_cliente_id = Number(x.clienteId);
  return { ok: true, args };
}

// Formulario «Editar cubierta» -> {p_id, p_datos}. Solo se envía lo que cambió respecto de `actual`
// (la condición solo si el usuario la cambió; la quema y la sucursal no se editan aquí).
export function validarEdicion(actual, f, { hoy } = {}) {
  const x = f || {};
  const datos = {};
  const marca = textoCorto(x.marca, 'la marca', true);
  if (!marca.ok) return marca;
  const modelo = textoCorto(x.modelo, 'el modelo', false);
  if (!modelo.ok) return modelo;
  const fecha = parseFecha(x.fechaCompra, hoy);
  if (!fecha.ok) return fecha;
  const precio = parsePrecio(x.precio);
  if (!precio.ok) return precio;
  const prev = actual || {};
  if (marca.valor !== (prev.marca ?? null)) datos.marca = marca.valor;
  if (modelo.valor !== (prev.modelo ?? null)) datos.modelo = modelo.valor;
  if (fecha.valor !== (prev.fecha_compra ?? null)) datos.fecha_compra = fecha.valor;
  const precioPrev = prev.precio_unidad === null || prev.precio_unidad === undefined ? null : Number(prev.precio_unidad);
  if (precio.valor !== precioPrev) datos.precio = precio.valor;
  if (!vacio(x.condicion) && x.condicion !== prev.condicion) {
    if (!CONDICIONES_MANUALES.some(c => c.id === x.condicion)) {
      return { ok: false, error: 'La condición solo puede cambiarse a Reparado o Recauchutado' };
    }
    datos.condicion = x.condicion;
  }
  if (!Object.keys(datos).length) return { ok: false, error: 'No hay cambios para guardar' };
  return { ok: true, args: { p_id: Number(prev.id), p_datos: datos } };
}

export const argsMoverCubierta = (id, sucursalId) => ({ p_id: Number(id), p_sucursal_id: idONull(sucursalId) });

// Filtros de la lista. f: {texto, sucursal ('' todas | 'ninguna' | id), condicion ('' todas | id), cliente ('' | id)}.
// El texto busca en quema, marca y modelo sin distinguir mayúsculas, tildes ni separadores.
export function filtrarCubiertas(rows, f = {}) {
  const needle = claveBusqueda(f.texto);
  return (rows || []).filter(c => {
    if (f.cliente && String(c.cliente_id) !== String(f.cliente)) return false;
    if (f.condicion && c.condicion !== f.condicion) return false;
    if (f.sucursal === 'ninguna' && !vacio(c.sucursal_id)) return false;
    if (f.sucursal && f.sucursal !== 'ninguna' && String(c.sucursal_id ?? '') !== String(f.sucursal)) return false;
    if (needle) {
      return [c.numero_quema, c.marca, c.modelo].some(t => claveBusqueda(t).includes(needle));
    }
    return true;
  });
}

// Orden de la lista: por quema con números naturales (S-2 antes que S-10).
export function ordenarCubiertas(rows) {
  return (rows || []).slice().sort((a, b) =>
    String(a.numero_quema ?? '').localeCompare(String(b.numero_quema ?? ''), 'es', { numeric: true, sensitivity: 'base' }) || a.id - b.id);
}

// Resumen para la cabecera: total y cantidad por condición (solo las que tienen unidades).
export function resumenCubiertas(rows) {
  const total = (rows || []).length;
  const porCondicion = CONDICIONES.map(c => ({ ...c, n: (rows || []).filter(r => r.condicion === c.id).length })).filter(c => c.n > 0);
  return { total, porCondicion };
}

// Texto de una cubierta en un selector: «S-001 · Michelin X Multi Z · Nuevo · Montevideo».
export function etiquetaCubierta(c, sucursales) {
  return [c.numero_quema || 'Sin quema', [c.marca, c.modelo].filter(Boolean).join(' ') || 'Sin marca',
    etiquetaCondicion(c.condicion), nombreUbicacion(c.sucursal_id, sucursales)].join(' · ');
}

// Cubiertas que se pueden montar: sin vehículo y almacenadas (la RLS ya limita qué ve cada perfil).
export const cubiertasMontables = rows => ordenarCubiertas((rows || []).filter(c => (c.vehiculo_id === null || c.vehiculo_id === undefined) && (c.estado || 'almacenado') === 'almacenado'));

// Mensaje para un error inesperado (los de negocio tienen su propio texto y no se registran en consola).
export const ERROR_GENERICO = 'No se pudo guardar. Reintentar';

// Error de las RPC stock_cubierta_* -> mensaje en una frase.
export function traducirErrorStock(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = (err && err.message ? String(err.message) : '').toLowerCase();
  if (code === '42501' || msg.includes('permiso denegado') || msg.includes('permission denied') || msg.includes('row-level security')) {
    return 'Sin permiso para gestionar el stock';
  }
  if (code === '23505' || msg.includes('quema ya')) return 'Ese número de quema ya está registrado en otro neumático';
  if (code === 'P0002' || msg.includes('inexistente')) return 'La cubierta ya no existe. Actualizar la lista';
  if (code === '55000' && msg.includes('montada')) return 'La cubierta está montada en un vehículo. Gestionarla desde el vehículo';
  if (code === '55000' || msg.includes('ya tuvo uso')) return 'La cubierta ya tuvo uso: no se puede eliminar';
  if (msg.includes('quema')) return `El número de quema es obligatorio y admite hasta 40 caracteres`;
  if (msg.includes('marca')) return `Falta la marca (hasta ${MAX_TXT} caracteres)`;
  if (msg.includes('fecha')) return 'La fecha de compra no es válida';
  if (msg.includes('precio')) return 'El precio no es válido';
  if (msg.includes('condici')) return 'La condición solo puede cambiarse a Reparado o Recauchutado';
  if (code === '22023' || code === '22004' || code === '23514' || code === '22007') return 'Datos del formulario inválidos';
  return ERROR_GENERICO;
}

// ---- Buscador global: cubiertas en stock por número de quema -----------------------------------------------------

// Cubiertas cuya quema coincide exacta o por prefijo con el texto (igual criterio que las quemas de vehículos).
export function buscarCubiertas(cubiertas, texto) {
  const needle = claveBusqueda(texto);
  if (!needle) return [];
  return (cubiertas || [])
    .map(c => {
      const q = claveBusqueda(c.numero_quema);
      return { c, p: q && q === needle ? 4 : (q && q.startsWith(needle) ? 3 : 0) };
    })
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || String(a.c.numero_quema).localeCompare(String(b.c.numero_quema), 'es', { numeric: true }))
    .map(x => x.c);
}

// Qué hace el buscador con vehículos y cubiertas en stock a la vez. Los items llevan `tipo`:
//   {tipo:'vehiculo', vehiculo} | {tipo:'cubierta', cubierta}
//   vacio | ninguno | abrir (un vehículo) | abrir-stock (una sola cubierta y ningún vehículo) | lista
// Sin cubiertas el resultado es el de resolverBusqueda con los items envueltos.
export function resolverBusquedaConStock(vehiculos, cubiertas, texto, max = 8) {
  const base = resolverBusqueda(vehiculos, texto, max);
  if (base.accion === 'vacio') return { accion: 'vacio', items: [], total: 0, vehiculo: null, cubierta: null };
  const cubs = buscarCubiertas(cubiertas, texto);
  const vItems = base.items.map(vehiculo => ({ tipo: 'vehiculo', vehiculo }));
  if (!cubs.length) return { ...base, items: vItems, cubierta: null };
  if (base.accion === 'ninguno' && cubs.length === 1) {
    return { accion: 'abrir-stock', items: [{ tipo: 'cubierta', cubierta: cubs[0] }], total: 1, vehiculo: null, cubierta: cubs[0] };
  }
  const items = [...vItems, ...cubs.map(cubierta => ({ tipo: 'cubierta', cubierta }))].slice(0, max);
  return { accion: 'lista', items, total: base.total + cubs.length, vehiculo: null, cubierta: null };
}
