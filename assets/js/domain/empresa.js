// Pantalla Empresa del administrador de empresa (docs/17 §4.3): usuarios, quitar y reponer acceso, umbrales. Puro, sin DOM
// ni supabase. Contrato de las Edge Functions: supabase/functions/{quitar-acceso-usuario,reponer-acceso-usuario,
// crear-usuario-seccional}/README.md. Tests: tests/unit/empresa.test.mjs
import { mensajeErrorCrearUsuario } from './seccional.js';
import { CAMPOS_UMBRAL } from './umbrales.js';

export const ESTADO_VIGENTE = 'vigente';
export const ESTADO_QUITADO = 'quitado';

// Texto del alcance de un usuario (fila de usuarios_empresa_listar).
export const textoAlcance = u => (u.alcance === 'sucursal' ? (u.sucursal_nombre || 'Sucursal') : 'Toda la empresa');

// Alcance del usuario nuevo. El campo «Sucursal» NO tiene valor por defecto que dé acceso amplio: «Toda la empresa» es una
// opción explícita (valor ALCANCE_EMPRESA) y el valor vacío («Elegir sucursal») no se envía. Así escribir solo el email y
// pulsar Enter no crea por descuido un usuario con acceso a toda la empresa.
export const ALCANCE_EMPRESA = 'empresa';

// Valor inicial del campo: la sucursal elegida en la barra superior si existe; sin sucursales en la empresa, «Toda la empresa»
// (no hay otra cosa que elegir); en cualquier otro caso vacío (obliga a decidir).
export function alcanceInicial(sucursales, seleccionada) {
  const lista = sucursales || [];
  if (!lista.length) return ALCANCE_EMPRESA;
  const sel = seleccionada === null || seleccionada === undefined ? '' : String(seleccionada);
  return sel !== '' && lista.some(s => String(s.id) === sel) ? sel : '';
}

// Valida el valor del campo «Sucursal» y devuelve el sucursalId que espera cuerpoCrearUsuario ('' = toda la empresa).
export function validarAlcanceUsuario(valor) {
  const v = valor === null || valor === undefined ? '' : String(valor).trim();
  if (v === ALCANCE_EMPRESA) return { ok: true, sucursalId: '' };
  if (/^\d+$/.test(v)) return { ok: true, sucursalId: v };
  return { ok: false, error: 'Elegir la sucursal del usuario, o «Toda la empresa»' };
}

// Orden de la lista: vigentes primero (la base ya los entrega así; se asegura aquí), luego alcance y email.
export function ordenarUsuarios(lista) {
  return [...(lista || [])].sort((a, b) =>
    (a.estado === ESTADO_QUITADO) - (b.estado === ESTADO_QUITADO)
    || (a.alcance === 'sucursal') - (b.alcance === 'sucursal')
    || String(a.email || '').localeCompare(String(b.email || ''), 'es'));
}

// Acciones que ofrece cada fila. `propio`: el usuario de la sesión no se quita a sí mismo (la base responde 22023).
// `suprimir`: acción que el contrato de la función prohíbe mientras haya un pendiente ('reponer' | 'quitar' | null).
// Una fila ya quitada ofrece siempre «Quitar» (contrato de docs/17 sección 10): la marca de Auth es informativa y no distingue un
// Auth desbloqueado, y repetir la baja es idempotente. La vista lo rotula «Bloquear de nuevo» para no confundir.
export function accionesFila(u, { propio = false, suprimir = null } = {}) {
  const a = u.estado === ESTADO_QUITADO
    ? { reponer: true, quitar: true }
    : { reponer: false, quitar: !propio };
  if (suprimir === 'reponer') a.reponer = false;
  if (suprimir === 'quitar') a.quitar = false;
  return a;
}

// Cuerpo de quitar-acceso-usuario: `acceso_id` solo en el reintento de una baja ya hecha (fila «quitado»).
export function cuerpoQuitar(userId, accesoId = null) {
  const b = { user_id: userId };
  if (accesoId !== null && accesoId !== undefined && accesoId !== '') b.acceso_id = Number(accesoId);
  return b;
}
export function cuerpoReponer(accesoId, sucursalId = null) {
  const b = { acceso_id: Number(accesoId) };
  if (sucursalId !== null && sucursalId !== undefined && sucursalId !== '') b.sucursal_id = Number(sucursalId);
  return b;
}

const ACTUALIZAR = 'Actualizar la lista y decidir desde la fila del usuario.';

// Interpreta la respuesta de quitar-acceso-usuario o reponer-acceso-usuario.
//   op: 'quitar' | 'reponer'; status: código HTTP (0 o null si no hubo respuesta); body: JSON o null.
// Devuelve:
//   ok         true si la operación pedida quedó hecha (o ya estaba hecha); false si hay que reintentar o decidir.
//   mensaje    texto para el operario (en errores, el `error` del servidor cuando existe).
//   recargar   true: volver a leer la lista (siempre salvo error de validación sin cambios).
//   ofrecer    null | 'reponer' | 'quitar' | 'sucursal' | 'actualizar': qué botón mostrar en la fila del usuario.
//   accesoId   acceso_id con el que reintentar (el que devolvió el servidor).
//   suprimir   null | 'reponer' | 'quitar': acción que la fila NO debe ofrecer mientras el pendiente siga (README de cada función).
// Reglas de los 502 (README de cada función): el código sale del ÚLTIMO estado observado, no de lo pedido.
export function resultadoAcceso(op, status, body) {
  const b = body && typeof body === 'object' ? body : {};
  const err = typeof b.error === 'string' && b.error ? b.error : '';
  const accesoId = b.acceso_id ?? null;
  const base = { ok: false, mensaje: err, recargar: true, ofrecer: null, accesoId: null, suprimir: null };

  if (status === 200 && b.ok) {
    if (op === 'quitar') {
      if (b.estado === 'repuesto_durante_baja') return { ...base, ok: false, mensaje: 'Otra persona repuso el acceso mientras tanto. El usuario sigue con acceso.' };
      return { ...base, ok: true, mensaje: b.estado === 'ya_quitado' ? 'El acceso ya estaba quitado' : 'Acceso quitado' };
    }
    if (b.estado === 'quitado_durante_reposicion') return { ...base, ok: false, mensaje: 'Otra persona quitó el acceso mientras tanto. El usuario sigue sin acceso.' };
    return { ...base, ok: true, mensaje: b.estado === 'ya_repuesto' ? 'El acceso ya estaba repuesto' : 'Acceso repuesto' };
  }

  if (status === 502) {
    const msg = err || 'No se pudo confirmar el cambio en el acceso. Reintentar.';
    if (b.codigo === 'bloqueo_auth_pendiente') {
      // bloqueo_auth_pendiente: el usuario no tiene perfil y Auth no pudo bloquearlo. En «reponer» no trae acceso_id
      // (es de la baja anterior): no se ofrece reponer de nuevo, la fila «quitado» vigente ofrece Quitar.
      return { ...base, mensaje: msg, ofrecer: op === 'quitar' && accesoId !== null ? 'quitar' : 'actualizar', accesoId: op === 'quitar' ? accesoId : null, suprimir: op === 'reponer' ? 'reponer' : null };
    }
    if (b.codigo === 'desbloqueo_auth_pendiente') {
      // desbloqueo_auth_pendiente: el usuario tiene perfil y Auth no pudo desbloquearlo. Nunca «Quitar» (sería una baja nueva
      // que nadie decidió): se ofrece «Reponer acceso» con ese acceso_id.
      return { ...base, mensaje: msg, ofrecer: accesoId !== null ? 'reponer' : 'actualizar', accesoId, suprimir: 'quitar' };
    }
    // estado_no_confirmado (o un 502 sin código reconocible): no se afirma ningún estado.
    return { ...base, mensaje: `${msg} ${ACTUALIZAR}`.trim(), ofrecer: 'actualizar' };
  }

  if (status === 403 && b.codigo === 'recargar_lista') return { ...base, mensaje: `La lista cambió. ${ACTUALIZAR}`, ofrecer: 'actualizar' };
  if (status === 409 && b.codigo === 'no_converge') return { ...base, mensaje: 'El estado cambió varias veces mientras se aplicaba. Repetir la acción.', ofrecer: 'actualizar' };
  if (status === 409 && b.codigo === 'ultimo_admin') return { ...base, recargar: false, mensaje: 'No se puede quitar al último administrador de la empresa. Antes, crear otro.' };
  if (status === 400 && b.codigo === 'acceso_propio') return { ...base, recargar: false, mensaje: 'No se puede quitar el acceso propio.' };
  if (status === 400 && b.codigo === 'elegir_sucursal') return { ...base, recargar: false, mensaje: 'La sucursal original ya no existe. Elegir otra.', ofrecer: 'sucursal' };
  if (status === 401) return { ...base, recargar: false, mensaje: 'La sesión venció. Volver a iniciar sesión.' };
  // Sin respuesta (0) o 500: la RPC pudo haber cambiado el estado antes del fallo; se relee la lista. Un 4xx de validación no cambia nada.
  return { ...base, recargar: status === 0 || status >= 500, mensaje: err || (op === 'quitar' ? 'No se pudo quitar el acceso' : 'No se pudo reponer el acceso') };
}

// Alta de usuario: añade al mensaje de crear-usuario-seccional los casos de la empresa (409 con acceso quitado, 429).
export function mensajeCrearUsuarioEmpresa(status, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (status === 409 && b.codigo === 'acceso_quitado') return 'Ese usuario tiene el acceso quitado. Usar «Reponer acceso» en la lista.';
  if (status === 429) return 'Demasiados intentos. Esperar un rato y repetir.';
  if (status === 403) return 'Sin permiso para crear usuarios en esta empresa';
  return mensajeErrorCrearUsuario(status, b.error);
}

// Umbrales de la empresa: argumentos de la RPC alerta_configurar. Todos los umbrales viajan juntos (parámetro nulo = sin cambio).
const PARAM_UMBRAL = {
  umbral_critico_mm: 'p_umbral_critico_mm',
  alerta_histeresis_mm: 'p_histeresis_mm',
  umbral_bajo_mm: 'p_umbral_bajo_mm',
  umbral_retiro_mm: 'p_umbral_retiro_mm',
  dias_sin_medir_alerta: 'p_dias_sin_medir',
  irregularidad_mm: 'p_irregularidad_mm'
};
export function argsAlertaConfigurar(clienteId, valores) {
  const a = { p_cliente_id: Number(clienteId) };
  for (const c of CAMPOS_UMBRAL) a[PARAM_UMBRAL[c.key]] = valores[c.key];
  return a;
}

// Traduce el error de alerta_configurar (docs/08 apéndice de F10): 42501 sin permiso, 22023/23514 valores.
export function mensajeErrorConfigurar(err) {
  const code = err && err.code;
  const msg = String((err && err.message) || '').trim();
  if (code === '42501') return 'Sin permiso para editar los umbrales';
  if (code === '23514' || code === '22023') return msg ? `Los umbrales no son válidos: ${msg}` : 'Los umbrales no son válidos: el retiro debe ser menor que el crítico, y el crítico menor que el bajo';
  return msg ? `No se pudieron guardar los umbrales: ${msg}` : 'No se pudieron guardar los umbrales';
}
