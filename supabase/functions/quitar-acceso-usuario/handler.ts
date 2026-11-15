// `quitar-acceso-usuario` (docs/17 §4.1): quita el acceso de un usuario a la empresa y cierra sus sesiones en Auth.
//   1. Valida el JWT de quien llama.
//   2. Invoca `usuario_empresa_quitar_acceso` CON ESE JWT (auth.uid() identifica al actor; la RPC autoriza). Esta función
//      no decide permisos con la clave de servicio.
//   3. Solo si la RPC tuvo éxito, converge con Auth con la clave de servicio (bloqueo si no hay perfil, desbloqueo si lo
//      hay). El usuario de Auth no se borra: conserva su historial y permite reponer.
// Un 42501 NUNCA es éxito: sin `acceso_id` una baja de un usuario que ya no tiene perfil es 42501 (no `ya_quitado`).

import {
  converger,
  crearLog,
  type DepsBase,
  fail,
  posInt,
  preludio,
  respond,
  type RpcResult,
  UUID_RE,
} from '../_shared/acceso.ts';

export interface Deps extends DepsBase {
  /** `usuario_empresa_quitar_acceso(p_user_id, p_acceso_id)` ejecutada con el JWT del llamante. */
  quitar(token: string, userId: string, accesoId: number | null): Promise<RpcResult>;
}

export const MSG_RECARGAR =
  'No se pudo quitar el acceso: la lista cambió o falta permiso. Actualizar la lista y repetir desde la fila del usuario.';
export const MSG_PENDIENTE =
  'El acceso a los datos ya está cortado, pero no se pudo cerrar la sesión. Repetir «Quitar» desde la fila «quitado».';
export const MSG_NO_CONVERGE =
  'El estado del usuario siguió cambiando. Repetir la operación para terminar de cerrar la sesión.';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const log = crearLog(deps);
  const e = await preludio(req, deps.allowedOrigins, log, deps.getUser);
  if (e instanceof Response) return e;
  const { cors, token, body, actor } = e;

  const userId = typeof body.user_id === 'string' && UUID_RE.test(body.user_id) ? body.user_id.toLowerCase() : null;
  if (!userId) return fail('user_id inválido', 400, cors);
  let accesoId: number | null = null;
  if (body.acceso_id !== undefined && body.acceso_id !== null) {
    accesoId = posInt(body.acceso_id);
    if (accesoId === null) return fail('acceso_id inválido', 400, cors);
  }

  let r: RpcResult;
  try {
    r = await deps.quitar(token, userId, accesoId);
  } catch {
    log('error', 'rpc_failed', { actor });
    return fail('Error interno', 500, cors);
  }
  if ('error' in r) {
    const code = r.error.code;
    log('warn', 'rpc_denied', { actor, code, reintento: accesoId !== null });
    // La RPC responde 42501 de forma uniforme (sin permiso, baja ya hecha, usuario repuesto, otra empresa): no se toca Auth.
    if (code === '42501') return fail(MSG_RECARGAR, 403, cors, { codigo: 'recargar_lista' });
    if (code === '23514') {
      return fail('No se puede quitar al último administrador de la empresa', 409, cors, { codigo: 'ultimo_admin' });
    }
    if (code === '22023') return fail('No se puede quitar el acceso propio', 400, cors, { codigo: 'acceso_propio' });
    if (code === '22004') return fail('Parámetros obligatorios', 400, cors);
    return fail('Error interno', 500, cors);
  }

  const estadoRpc = r.data.estado === 'ya_quitado' ? 'ya_quitado' : 'quitado';
  const idAcceso = posInt(r.data.acceso_id);
  if (!idAcceso) {
    log('error', 'rpc_sin_acceso_id', { actor });
    return fail('Error interno', 500, cors);
  }

  const c = await converger(deps, userId, idAcceso);
  if (!c.ok) {
    log('error', 'convergencia_fallida', { actor, motivo: c.motivo, acceso_id: idAcceso });
    if (c.motivo === 'no_converge') {
      return fail(MSG_NO_CONVERGE, 409, cors, { codigo: 'no_converge', estado: estadoRpc, acceso_id: idAcceso });
    }
    // El acceso a datos ya está cortado (la RPC confirmó): lo que falta es Auth. Repetir con `acceso_id` converge.
    return fail(MSG_PENDIENTE, 502, cors, {
      codigo: 'bloqueo_auth_pendiente',
      estado: estadoRpc,
      acceso_id: idAcceso,
      acceso_cortado: true,
    });
  }

  const estado = c.tienePerfil ? 'repuesto_durante_baja' : estadoRpc;
  log('info', 'acceso_quitado', { actor, user_id: userId, acceso_id: idAcceso, estado });
  return respond({ ok: true, estado, user_id: userId, acceso_id: idAcceso, bloqueo_auth: !c.tienePerfil }, 200, cors);
}
