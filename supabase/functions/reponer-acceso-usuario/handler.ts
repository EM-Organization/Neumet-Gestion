// `reponer-acceso-usuario` (docs/17 §4.1): repone el acceso de un usuario quitado y levanta el bloqueo en Auth.
//   1. Valida el JWT de quien llama.
//   2. Invoca `usuario_empresa_reponer_acceso` CON ESE JWT: la RPC autoriza (administrador de empresa del mismo cliente).
//   3. Solo si la RPC tuvo éxito (`repuesto` o `ya_repuesto`), converge con Auth: desbloquea si el usuario tiene perfil,
//      también ante `ya_repuesto` (bloqueo huérfano o `unban` tardío), y vuelve a bloquear si hoy está quitado.
// Si la RPC falla (p. ej. la sucursal original se borró), Auth no se toca.

import {
  converger,
  crearLog,
  type DepsBase,
  fail,
  posInt,
  preludio,
  respond,
  type RpcResult,
} from '../_shared/acceso.ts';

export interface Deps extends DepsBase {
  /** `usuario_empresa_reponer_acceso(p_acceso_id, p_sucursal_id)` ejecutada con el JWT del llamante. */
  reponer(token: string, accesoId: number, sucursalId: number | null): Promise<RpcResult>;
}

export const MSG_RECARGAR =
  'No se pudo reponer el acceso: la lista cambió o falta permiso. Actualizar la lista y repetir desde la fila del usuario.';
export const MSG_PENDIENTE =
  'El acceso ya está repuesto, pero no se pudo levantar el bloqueo de la sesión. Repetir «Reponer acceso» para terminar.';
export const MSG_NO_CONVERGE =
  'El estado del usuario siguió cambiando. Repetir la operación para terminar de levantar el bloqueo.';
export const MSG_SUCURSAL = 'La sucursal original ya no existe en la empresa. Elegir otra sucursal.';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const log = crearLog(deps);
  const e = await preludio(req, deps.allowedOrigins, log, deps.getUser);
  if (e instanceof Response) return e;
  const { cors, token, body, actor } = e;

  const accesoId = posInt(body.acceso_id);
  if (accesoId === null) return fail('acceso_id inválido', 400, cors);
  let sucursalId: number | null = null;
  if (body.sucursal_id !== undefined && body.sucursal_id !== null && body.sucursal_id !== '') {
    sucursalId = posInt(body.sucursal_id);
    if (sucursalId === null) return fail('sucursal_id inválido', 400, cors);
  }

  let r: RpcResult;
  try {
    r = await deps.reponer(token, accesoId, sucursalId);
  } catch {
    log('error', 'rpc_failed', { actor });
    return fail('Error interno', 500, cors);
  }
  if ('error' in r) {
    const code = r.error.code;
    log('warn', 'rpc_denied', { actor, code });
    if (code === '42501') return fail(MSG_RECARGAR, 403, cors, { codigo: 'recargar_lista' });
    if (code === '22023') return fail(MSG_SUCURSAL, 400, cors, { codigo: 'elegir_sucursal' });
    if (code === '22004') return fail('Parámetros obligatorios', 400, cors);
    return fail('Error interno', 500, cors);
  }

  const estadoRpc = r.data.estado === 'ya_repuesto' ? 'ya_repuesto' : 'repuesto';
  const userId = typeof r.data.user_id === 'string' ? r.data.user_id : null;
  const idAcceso = posInt(r.data.acceso_id);
  if (!userId || !idAcceso) {
    log('error', 'rpc_sin_datos', { actor });
    return fail('Error interno', 500, cors);
  }

  const c = await converger(deps, userId, idAcceso);
  if (!c.ok) {
    log('error', 'convergencia_fallida', { actor, motivo: c.motivo, acceso_id: idAcceso });
    if (c.motivo === 'no_converge') {
      return fail(MSG_NO_CONVERGE, 409, cors, { codigo: 'no_converge', estado: estadoRpc, acceso_id: idAcceso });
    }
    return fail(MSG_PENDIENTE, 502, cors, {
      codigo: 'desbloqueo_auth_pendiente',
      estado: estadoRpc,
      acceso_id: idAcceso,
      acceso_repuesto: true,
    });
  }

  const estado = c.tienePerfil ? estadoRpc : 'quitado_durante_reposicion';
  log('info', 'acceso_repuesto', { actor, user_id: userId, acceso_id: idAcceso, estado });
  return respond({ ok: true, estado, user_id: userId, acceso_id: idAcceso, bloqueo_auth: !c.tienePerfil }, 200, cors);
}
