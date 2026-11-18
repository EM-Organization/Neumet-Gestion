// Distribución de neumáticos del vehículo (ejes simples y dobles).
//
// Catálogo cerrado. Mismo contenido que public.distribucion_ruedas (migración 20261122000000, la fuente en la base) y que
// assets/js/domain/distribucion.js (panel); tests/unit/distribucion.test.mjs comprueba que los tres coinciden.
// Código AxB: A = posiciones de rueda (un par doble cuenta como una), B = posiciones motrices.
// Ejes de adelante hacia atrás; S = simple (2 ruedas), D = doble (4 ruedas). Ruedas sin contar el auxilio (posición 99).
//   4x2 = S,D (6)   6x2 = S,D,S (8)   6x4 = S,D,D (10)   8x2 = S,S,D,S (10)   8x4 = S,S,D,D (12)
// Numeración: eje S = izquierda, derecha; eje D = izquierda exterior, izquierda interior, derecha interior, derecha exterior.

export const DISTRIBUCIONES = ['4x2', '6x2', '6x4', '8x2', '8x4'] as const;
export type Distribucion = (typeof DISTRIBUCIONES)[number];

export type DistribucionLeida = { ok: true; valor: Distribucion | null } | { ok: false };

/**
 * Lee el campo opcional `distribucion` del cuerpo. Ausente, null o vacío = no informada (`valor: null`).
 * Tolera espacios y mayúsculas («6X2»); cualquier otra cosa (tipo distinto de texto, código fuera del catálogo) es inválida.
 */
export function leerDistribucion(x: unknown): DistribucionLeida {
  if (x === undefined || x === null) return { ok: true, valor: null };
  if (typeof x !== 'string') return { ok: false };
  const t = x.trim().toLowerCase();
  if (t === '') return { ok: true, valor: null };
  return (DISTRIBUCIONES as readonly string[]).includes(t) ? { ok: true, valor: t as Distribucion } : { ok: false };
}
