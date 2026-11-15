// ¿El email corresponde a un usuario con el acceso quitado en ESTA empresa? Separado de index.ts para probar la consulta
// (filtro por cliente, fila más reciente, perfil ausente) con un cliente simulado, sin Supabase real.

type Fila = Record<string, unknown>;
export interface Consulta extends PromiseLike<{ data: Fila[] | null; error: unknown }> {
  select(columnas: string): Consulta;
  eq(columna: string, valor: unknown): Consulta;
  order(columna: string, opciones: { ascending: boolean }): Consulta;
  limit(n: number): Consulta;
}
export interface ClienteLectura {
  from(tabla: string): Consulta;
}

/**
 * Verdadero solo si la fila MÁS RECIENTE de `accesos_quitados` de ese email en ese cliente sigue sin reponer y el usuario
 * no tiene perfil hoy. Una baja vieja de alguien repuesto, o reasignado por el equipo Neumet, no orienta a «Reponer».
 */
export async function accesoQuitadoDe(db: ClienteLectura, email: string, clienteId: number): Promise<boolean> {
  const { data, error } = await db.from('accesos_quitados').select('id,user_id,repuesto_at')
    .eq('cliente_id', clienteId).eq('email', email.toLowerCase()).order('id', { ascending: false }).limit(1);
  if (error) throw error;
  const fila = data?.[0];
  if (!fila || fila.repuesto_at !== null) return false;
  const { data: perfil, error: e2 } = await db.from('perfiles').select('user_id').eq('user_id', fila.user_id).limit(1);
  if (e2) throw e2;
  return (perfil?.length ?? 0) === 0;
}
