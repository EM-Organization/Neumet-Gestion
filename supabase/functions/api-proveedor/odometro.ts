// Odómetro del vehículo al momento del registro (RN-12, docs/07 apéndice C).
//
// Campo opcional a nivel de request. Si viene, es un entero finito >= 0 que cabe en `integer` de Postgres.
// Cualquier otra cosa (decimal, negativo, texto, fuera de rango) es un error del cliente: no se guarda un km
// truncado ni inventado. Ausente o null = no informado.

export const ODOMETRO_MAX = 2_147_483_647; // integer de Postgres (int4)

export type OdometroLeido = { ok: true; valor: number | null } | { ok: false };

export function leerOdometro(x: unknown): OdometroLeido {
  if (x === undefined || x === null) return { ok: true, valor: null };
  if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= ODOMETRO_MAX) return { ok: true, valor: x };
  return { ok: false };
}
