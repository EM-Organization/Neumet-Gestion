// Stock de cubiertas individuales (lógica pura, sin DOM ni red). Cada cubierta es una fila de `neumaticos` sin montar
// (vehiculo_id nulo): quema, marca, modelo, fecha de compra, precio opcional, condición y sucursal. La escritura pasa por
// las RPC stock_cubierta_* (la autorización real vive en la base). docs/08 apéndice «Stock individual de cubiertas».
// Tests: tests/unit/stock-cubiertas.test.mjs
import { claveBusqueda, resolverBusqueda } from './vehiculo-busqueda.js';
import { normalizarQuema, claveQuema } from './quema.js';

export const MAX_TXT = 60;
export const MAX_PRECIO = 9999999999.99;
// Límites de los datos de compra y de la banda: los mismos que la base (stock_cubierta_* y stock_cubiertas_agregar_lote).
export const MAX_MEDIDA = 30;
export const MAX_PROVEEDOR = 80;
export const MAX_FACTURA = 60;
export const MAX_SOPORTE = 200;
export const MAX_MM_INICIAL = 30;
export const MAX_LOTE = 200;

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

function textoCorto(valor, etiqueta, obligatorio, max = MAX_TXT) {
  const t = String(valor ?? '').trim();
  if (!t) return obligatorio ? { ok: false, error: `Falta ${etiqueta}` } : { ok: true, valor: null };
  if (t.length > max) return { ok: false, error: `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} admite hasta ${max} caracteres` };
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
  // Datos de compra y de la banda: lo que se vacía se manda como null (la base lo borra).
  const medida = textoCorto(x.medida, 'la medida', false, MAX_MEDIDA);
  if (!medida.ok) return medida;
  const dot = parseDot(x.dot, hoy);
  if (!dot.ok) return dot;
  const mm = parseMmInicial(x.mmIniciales);
  if (!mm.ok) return mm;
  const proveedor = textoCorto(x.proveedor, 'el proveedor', false, MAX_PROVEEDOR);
  if (!proveedor.ok) return proveedor;
  const factura = textoCorto(x.factura, 'la factura', false, MAX_FACTURA);
  if (!factura.ok) return factura;
  const soporte = textoCorto(x.soporte, 'el soporte', false, MAX_SOPORTE);
  if (!soporte.ok) return soporte;
  const cambiosCompra = [
    ['medida', medida.valor, prev.medida ?? null], ['dot', dot.valor, prev.dot ?? null],
    ['profundidad_inicial_mm', mm.valor, numOrNull(prev.profundidad_inicial_mm)],
    ['proveedor', proveedor.valor, prev.proveedor ?? null], ['factura', factura.valor, prev.factura ?? null],
    ['soporte', soporte.valor, prev.soporte ?? null],
  ];
  for (const [campo, nuevo, previo] of cambiosCompra) if (nuevo !== previo) datos[campo] = nuevo;
  if (!vacio(x.condicion) && x.condicion !== prev.condicion) {
    if (!CONDICIONES_MANUALES.some(c => c.id === x.condicion)) {
      return { ok: false, error: 'La condición solo puede cambiarse a Reparado o Recauchutado' };
    }
    datos.condicion = x.condicion;
  }
  if (!Object.keys(datos).length) return { ok: false, error: 'No hay cambios para guardar' };
  return { ok: true, args: { p_id: Number(prev.id), p_datos: datos } };
}

// ---- Datos de compra, DOT y alta por lote --------------------------------------------------------------------------
// La base valida lo mismo (stock_cubiertas_agregar_lote es todo o nada). Aquí se evita el viaje con lo que ya se sabe
// mal, con los mismos textos que la base para que el operario vea una sola redacción.
const hoyIso = () => new Date().toISOString().slice(0, 10);
function numOrNull(v) { return vacio(v) || !Number.isFinite(Number(v)) ? null : Number(v); }

export const MENSAJE_MM = `Los mm iniciales deben estar entre 0,1 y ${MAX_MM_INICIAL}`;
// Mm iniciales de la banda: número mayor que 0 y hasta 30, con coma o punto. Vacío = null (lo decide cada formulario).
export function parseMmInicial(texto) {
  if (vacio(texto)) return { ok: true, valor: null };
  const s = String(texto).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: MENSAJE_MM };
  const n = Number(s);
  if (n <= 0 || n > MAX_MM_INICIAL) return { ok: false, error: MENSAJE_MM };
  return { ok: true, valor: n };
}

export const MENSAJE_DOT = 'DOT inválido: deben ser 4 dígitos, semana y año (por ejemplo 0825)';
export const MENSAJE_DOT_FUTURO = 'El DOT no puede ser posterior a la semana actual';

// Semana ISO de una fecha «AAAA-MM-DD»: el jueves de su semana decide el año y el número de semana.
function semanaIso(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const anio = d.getUTCFullYear();
  const diaDelAnio = Math.round((d - Date.UTC(anio, 0, 1)) / 86400000);
  return { anio, semana: Math.floor(diaDelAnio / 7) + 1 };
}

// DOT: cuatro dígitos WWYY (semana 01 a 53 y año de dos cifras). Una semana posterior a la actual no existe todavía.
export function parseDot(texto, hoy = hoyIso()) {
  if (vacio(texto)) return { ok: true, valor: null };
  const s = String(texto).trim();
  const m = /^(\d{2})(\d{2})$/.exec(s);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 53) return { ok: false, error: MENSAJE_DOT };
  const cuando = (2000 + Number(m[2])) * 100 + Number(m[1]);
  const actual = semanaIso(hoy);
  if (cuando > actual.anio * 100 + actual.semana) return { ok: false, error: MENSAJE_DOT_FUTURO };
  return { ok: true, valor: s };
}

// Datos comunes del lote ya parseados (null si no se escribieron). El precio solo se lee con `conCostos`.
function comunLote(f = {}, { hoy = hoyIso(), conCostos = false } = {}) {
  const comun = {
    marca: null, modelo: null, medida: null, profundidad_inicial_mm: null, fecha_compra: null, precio: null,
    proveedor: null, factura: null, soporte: null, sucursal_id: idONull(f.sucursalId),
  };
  const sin = error => ({ ok: false, error, comun });
  const marca = textoCorto(f.marca, 'la marca', true);
  if (!marca.ok) return sin(marca.error);
  comun.marca = marca.valor;
  const modelo = textoCorto(f.modelo, 'el modelo', false);
  if (!modelo.ok) return sin(modelo.error);
  comun.modelo = modelo.valor;
  const medida = textoCorto(f.medida, 'la medida', false, MAX_MEDIDA);
  if (!medida.ok) return sin(medida.error);
  comun.medida = medida.valor;
  const mm = parseMmInicial(f.mmIniciales);
  if (!mm.ok) return sin(mm.error);
  if (mm.valor === null) return sin('Faltan los mm iniciales');
  comun.profundidad_inicial_mm = mm.valor;
  const fecha = parseFecha(f.fechaCompra, hoy);
  if (!fecha.ok) return sin(fecha.error);
  comun.fecha_compra = fecha.valor;
  if (conCostos) {
    const precio = parsePrecio(f.precio);
    if (!precio.ok) return sin(precio.error);
    comun.precio = precio.valor;
  }
  const proveedor = textoCorto(f.proveedor, 'el proveedor', false, MAX_PROVEEDOR);
  if (!proveedor.ok) return sin(proveedor.error);
  comun.proveedor = proveedor.valor;
  const factura = textoCorto(f.factura, 'la factura', false, MAX_FACTURA);
  if (!factura.ok) return sin(factura.error);
  comun.factura = factura.valor;
  const soporte = textoCorto(f.soporte, 'el soporte', false, MAX_SOPORTE);
  if (!soporte.ok) return sin(soporte.error);
  comun.soporte = soporte.valor;
  return { ok: true, comun };
}

// Filas con algo escrito, con su posición en el formulario: las vacías (también las de en medio) se ignoran.
export function filasLote(filas) {
  return (filas || [])
    .map((f, fila) => ({ fila, quema: String(f?.quema ?? '').trim(), dot: String(f?.dot ?? '').trim() }))
    .filter(x => x.quema !== '' || x.dot !== '');
}

// Alta por lote. f: datos comunes (marca, modelo, medida, mmIniciales, fechaCompra, precio, proveedor, factura, soporte,
// sucursalId, clienteId solo admin) y filas [{quema, dot}]. Un error de una fila trae `fila` (su índice en el formulario).
export function validarLote(f = {}, { esAdmin = false, hoy = hoyIso(), conCostos = false } = {}) {
  const comun = comunLote(f, { hoy, conCostos });
  if (!comun.ok) return { ok: false, error: comun.error };
  if (esAdmin && vacio(f.clienteId)) return { ok: false, error: 'Falta el cliente' };
  const filas = filasLote(f.filas);
  if (!filas.length) return { ok: false, error: 'Agregar al menos una cubierta' };
  if (filas.length > MAX_LOTE) return { ok: false, error: `El lote debe tener entre 1 y ${MAX_LOTE} cubiertas` };
  const vistas = new Set();
  for (const x of filas) {
    if (!x.quema) return { ok: false, error: 'Falta el número de quema', fila: x.fila };
    const q = normalizarQuema(x.quema);
    if (!q.ok) return { ok: false, error: q.error, fila: x.fila };
    const clave = claveQuema(x.quema);
    if (vistas.has(clave)) return { ok: false, error: `Quema repetida en el lote: ${x.quema}`, fila: x.fila };
    vistas.add(clave);
    const dot = parseDot(x.dot, hoy);
    if (!dot.ok) return { ok: false, error: dot.error, fila: x.fila };
  }
  return { ok: true };
}

// Argumentos de stock_cubiertas_agregar_lote con un formulario ya validado. En p_comun solo van las claves con valor,
// los números van como número y el precio solo si el usuario ve costos.
export function paramsLote(f = {}, { esAdmin = false, hoy = hoyIso(), conCostos = false } = {}) {
  const { comun } = comunLote(f, { hoy, conCostos });
  const pComun = Object.fromEntries(Object.entries(comun).filter(([, v]) => v !== null && v !== undefined));
  const cubiertas = filasLote(f.filas).map(x => {
    const numero_quema = normalizarQuema(x.quema).valor;
    return x.dot ? { numero_quema, dot: x.dot } : { numero_quema };
  });
  return { p_comun: pComun, p_cubiertas: cubiertas, p_cliente_id: esAdmin ? Number(f.clienteId) : null };
}

// Error de la RPC del lote -> { mensaje, quema }. `quema` nombra la fila que hay que marcar (la base la escribe en el mensaje).
export function errorLote(err) {
  const msg = err && err.message ? String(err.message) : '';
  const nombrada = /(?:Quema repetida en el lote: |Ya existe una cubierta con la quema )(.+)$/.exec(msg);
  if (nombrada) return { mensaje: msg, quema: nombrada[1].trim() };
  if (err && err.code === '22023' && msg) return { mensaje: msg, quema: null };
  return { mensaje: traducirErrorStock(err), quema: null };
}

// Precio por mm de banda que se gasta: el precio entre los mm que la cubierta pierde hasta el umbral de retiro.
// Sin dato, o sin mm por gastar, es null (la pantalla muestra «—»).
export function precioPorMm(precio, mm, umbral) {
  const p = numOrNull(precio);
  const m = numOrNull(mm);
  const u = numOrNull(umbral);
  if (p === null || m === null || u === null || m - u <= 0) return null;
  return Math.round((p / (m - u)) * 100) / 100;
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
  if (code === '55000' || msg.includes('ya tuvo uso')) return 'La cubierta ya tuvo uso y no se puede eliminar. Gestionarla desde el vehículo o desde Recauchutado';
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
