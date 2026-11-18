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

// «6x2 · 8 ruedas (simple, doble, simple)»: lo que se muestra al elegir, con los ejes de adelante hacia atrás.
export const textoOpcion = d => `${etiquetaDistribucion(d)} (${detalleEjes(d)})`;

// Cantidad de ruedas de un vehículo para listas: su distribución si la tiene; si no, el tipo de ruedas de siempre.
export function textoRuedas(vehiculo) {
  const d = buscarDistribucion(vehiculo && vehiculo.distribucion);
  return d ? etiquetaDistribucion(d) : `${vehiculo && vehiculo.tipo_ruedas} ruedas`;
}
