// Regla de negocio: la rueda de auxilio casi siempre tiene poca vida útil, así que su mayor desgaste / desgaste límite
// NO cuenta como advertencia (ni alerta ni conteo ni chip). Se sigue mostrando con su estado en el diagrama y el detalle.
// Misma regla en SQL (migración 20261125500000_auxilio_sin_alerta.sql): es auxilio la rueda en la posición 99.
// El indicador neumaticos.auxilio no se usa: v_estado_neumaticos no lo expone y puede quedar desfasado tras rotar.
// Lógica pura, sin DOM ni supabase.

export const POS_AUX = 99;

export const esAuxilio = f => Number(f?.posicion) === POS_AUX;

// Estado que cuenta para conteos, semáforo y chips: el auxilio en mayor desgaste o límite pasa a «poco desgaste»
// (sigue sumando en el total de neumáticos). El estado real de la fila no se toca: el diagrama lo sigue usando.
export function estadoContable(f) {
  const e = f?.estado;
  return esAuxilio(f) && (e === 'mayor_desgaste' || e === 'desgaste_limite') ? 'poco_desgaste' : e;
}
