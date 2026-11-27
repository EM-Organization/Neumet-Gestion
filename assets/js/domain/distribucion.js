// Distribución de neumáticos del vehículo (ejes simples y dobles). Dominio puro: sin DOM ni supabase.
//
// Catálogo cerrado. Mismo contenido que public.distribucion_ruedas (migración 20261122000000, la fuente en la base) y que
// supabase/functions/api-proveedor/distribuciones.ts; tests/unit/distribucion.test.mjs comprueba que los tres coinciden.
// Código AxB: A = posiciones de rueda (un par doble cuenta como una), B = posiciones motrices.
// Ejes de adelante hacia atrás; S = simple (2 neumáticos), D = doble (4). Sin contar el auxilio.
// Hay cantidades sin cubrir (2, 4, 14, 16 y 18 ruedas): esos vehículos se crean como «Otra» y quedan sin distribución.

export const OTRA_DISTRIBUCION = 'otra';

const ruedasDe = ejes => [...ejes].reduce((n, e) => n + (e === 'D' ? 4 : 2), 0);
const def = (id, ejes) => Object.freeze({ id, ejes, ruedas: ruedasDe(ejes) });

export const DISTRIBUCIONES = Object.freeze([
  def('4x2', 'SD'),
  def('6x2', 'SDS'),
  def('6x4', 'SDD'),
  def('8x2', 'SSDS'),
  def('8x4', 'SSDD'),
]);

export const buscarDistribucion = id => DISTRIBUCIONES.find(d => d.id === id) || null;

// tipo_ruedas (10 o 16) que corresponde a una distribución: hasta 10 ruedas, 10; más, 16. Igual que la base y la API.
export const tipoRuedasDe = id => {
  const d = buscarDistribucion(id);
  return d ? (d.ruedas <= 10 ? 10 : 16) : null;
};

const NOMBRE_EJE = { S: 'simple', D: 'doble' };
export const detalleEjes = d => [...d.ejes].map(e => NOMBRE_EJE[e]).join(', ');

// «6x2 · 8 ruedas»: lo que se muestra en las listas.
export const etiquetaDistribucion = d => `${d.id} · ${d.ruedas} ruedas`;

// Alias de bus: solo cambia el texto de la opción. El código (6x2, 8x2) es el mismo para un camión que para un bus.
const ALIAS_BUS = { '6x2': 'bus convencional', '8x2': 'bus doble piso' };

// «6x2 · 8 ruedas (simple, doble, simple) · bus convencional»: lo que se muestra al elegir, con los ejes de adelante hacia atrás.
export const textoOpcion = d => `${etiquetaDistribucion(d)} (${detalleEjes(d)})${ALIAS_BUS[d.id] ? ` · ${ALIAS_BUS[d.id]}` : ''}`;

// Cantidad de ruedas de un vehículo para listas: su distribución si la tiene; si no, el tipo de ruedas de siempre.
export function textoRuedas(vehiculo) {
  const d = buscarDistribucion(vehiculo && vehiculo.distribucion);
  return d ? etiquetaDistribucion(d) : `${vehiculo && vehiculo.tipo_ruedas} ruedas`;
}

// Lo que se pasa como `tipo` a layoutRuedas y a los nombres de posición: el código de la distribución si es del catálogo;
// si no («Otra» o sin definir), el tipo_ruedas de siempre.
export const tipoLayout = v => (v && buscarDistribucion(v.distribucion) ? v.distribucion : v ? v.tipo_ruedas : null);

// Valor del catálogo que se preselecciona: la distribución actual si es del catálogo; si no, ''. El diálogo convierte ''
// en «Otra» para que guardar solo el servicio no obligue a elegir una distribución.
export const distribucionActual = v => (v && buscarDistribucion(v.distribucion) ? v.distribucion : '');

// Parámetros de la RPC vehiculo_cambiar_distribucion (mismas opciones que al crear). «Otra» pide el tipo de ruedas (10 o 16).
export function validarCambioDistribucion({ vehiculoId, distribucion, tipoRuedas } = {}) {
  if (!Number.isInteger(vehiculoId)) return { ok: false, error: 'Elegir el vehículo' };
  const dist = String(distribucion ?? '').trim();
  if (!dist) return { ok: false, error: 'Falta elegir la distribución de neumáticos' };
  if (dist === OTRA_DISTRIBUCION) {
    const tipo = Number(tipoRuedas);
    if (tipo !== 10 && tipo !== 16) return { ok: false, error: 'El tipo de ruedas debe ser 10 o 16' };
    return { ok: true, params: { p_vehiculo_id: vehiculoId, p_distribucion: dist, p_tipo_ruedas: tipo } };
  }
  if (!buscarDistribucion(dist)) return { ok: false, error: 'La distribución elegida no es válida' };
  return { ok: true, params: { p_vehiculo_id: vehiculoId, p_distribucion: dist, p_tipo_ruedas: null } };
}

// Texto para el operario ante un rechazo de la base. El de «hay neumáticos en posiciones que no existen» ya viene en español
// con las posiciones afectadas: se muestra tal cual.
export function traducirErrorDistribucion(err) {
  const msg = String((err && err.message) || '');
  if (/^la distribución tiene \d+ ruedas/.test(msg)) return msg.charAt(0).toUpperCase() + msg.slice(1);
  if (err && err.code === '42501') return 'Sin permiso para cambiar este vehículo';
  if (err && err.code === '22023') return 'Falta elegir la distribución de neumáticos';
  if (err && err.code === '23514') return 'La distribución o el tipo de ruedas no es válido';
  return 'No se pudo cambiar la distribución. Reintentar';
}

// Servicio del vehículo (vehiculos.servicio, docs/18): camión o bus. «Sin definir» se guarda como null, que la regla trata como bus.
export const SERVICIOS = Object.freeze(['camion', 'bus']);
export const AYUDA_SERVICIO = 'Sin definir, la sugerencia de rotación trata el vehículo como bus.';

// Parámetros de la RPC vehiculo_fijar_servicio. Campo vacío = sin definir.
export function validarCambioServicio({ vehiculoId, servicio } = {}) {
  if (!Number.isInteger(vehiculoId)) return { ok: false, error: 'Elegir el vehículo' };
  const s = String(servicio ?? '').trim();
  if (s && !SERVICIOS.includes(s)) return { ok: false, error: 'Elegir camión o bus' };
  return { ok: true, params: { p_vehiculo_id: vehiculoId, p_servicio: s || null } };
}

// Texto para el operario ante un rechazo al guardar el servicio, sin el mensaje crudo de la base.
export function traducirErrorServicio(err) {
  const code = err && err.code;
  if (code === '42501') return 'Sin permiso para cambiar el servicio de este vehículo';
  if (code === '23514') return 'El servicio no es válido. Elegir camión o bus';
  return 'No se pudo guardar el servicio. Reintentar';
}

// Pictograma de la distribución para las tarjetas del selector: vista desde arriba, el frente arriba. Mismas medidas para
// todas las distribuciones, así las tarjetas miden lo mismo. `x` es el centro de la rueda, en unidades del viewBox.
const PICTO = Object.freeze({ ancho: 60, alto: 100, margen: 12, anchoRueda: 6 });
const CENTRO = PICTO.ancho / 2;

// Una S pone una rueda por lado; una D, dos (la interior y la exterior).
const ruedasDeEje = letra => (letra === 'D' ? [10, 20] : [14]).flatMap(separacion => [CENTRO - separacion, CENTRO + separacion]).sort((a, b) => a - b);

// Ejes de adelante hacia atrás (eje 0 = el de arriba). Dirección: los S antes del primer D. En el catálogo, el eje S que
// queda detrás de los dobles es un eje portador, no de dirección. Mismo criterio que rol-eje.js, sin importarlo (evita un ciclo).
export function pictogramaDistribucion(id) {
  const d = buscarDistribucion(id);
  if (!d) return null;
  const n = d.ejes.length;
  const primerDoble = d.ejes.indexOf('D');
  const ejes = [...d.ejes].map((letra, i) => ({
    y: n === 1 ? PICTO.alto / 2 : PICTO.margen + Math.round(i * (PICTO.alto - 2 * PICTO.margen) / (n - 1)),
    direccion: letra === 'S' && i < primerDoble,
    ruedas: ruedasDeEje(letra).map(x => ({ x, ancho: PICTO.anchoRueda })),
  }));
  return { ancho: PICTO.ancho, alto: PICTO.alto, ejes };
}
