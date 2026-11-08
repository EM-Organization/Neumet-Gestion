// Número de coche (lógica pura). El campo vehiculos.nombre es el número de coche que usa el cliente ("106", "201"):
// la interfaz lo muestra como "Coche 106". Los nombres que no son solo dígitos (datos anteriores, p. ej. "Unidad Sur")
// se muestran tal cual. Tests: tests/unit/coche.test.mjs
export const MAX_NOMBRE_COCHE = 40;
export const MAX_NUMERO = 10; // vehiculos.numero se usa en la API de proveedor; el panel lo acota a 10 caracteres

// "106" -> "Coche 106"; otro texto -> tal cual; vacío -> ''.
export function etiquetaCoche(nombre) {
  const t = String(nombre ?? '').trim();
  if (!t) return '';
  return /^\d+$/.test(t) ? `Coche ${t}` : t;
}

// Valor del campo "Número de coche" del formulario -> { ok, valor } o { ok:false, error }.
export function validarNumeroCoche(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: false, error: 'Falta el número de coche' };
  if (t.length > MAX_NOMBRE_COCHE) return { ok: false, error: `El número de coche admite hasta ${MAX_NOMBRE_COCHE} caracteres` };
  return { ok: true, valor: t };
}

// vehiculos.numero acompaña a nombre para que la API de proveedor y el buscador lo encuentren por el mismo dato.
// Si el nombre no cambió se conserva el número guardado (datos anteriores); si cambió y cabe, es el nombre;
// si no cabe, se conserva el anterior (o null).
export function numeroDesdeNombre(nombre, { nombreAnterior = null, numeroAnterior = null } = {}) {
  const n = String(nombre ?? '').trim();
  if (nombreAnterior !== null && n === String(nombreAnterior).trim()) return numeroAnterior ?? null;
  return n && n.length <= MAX_NUMERO ? n : (numeroAnterior ?? null);
}
