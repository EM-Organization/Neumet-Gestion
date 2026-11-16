// Capa de datos del front nuevo sobre `ctx.db` (el único cliente de Supabase del panel: el lint prohíbe crear otro en src/).
// Traduce los errores de la base a un mensaje de usuario con las reglas de docs/14 y NUNCA expone `message`, `details` ni `hint`
// del servidor (pueden nombrar tablas, columnas o políticas). Tampoco hace console.error: un error esperado (sin permiso, sin
// conexión) no es un fallo del flujo y CLAUDE.md hace fallar toda prueba que lo emita.

export const MENSAJE_GENERICO = 'No se pudo completar la operación';
export const MENSAJE_SIN_PERMISO = 'Sin permiso para esta operación';
export const MENSAJE_SIN_CONEXION = 'Sin conexión. Revisar la conexión y reintentar.';
export const MENSAJE_SESION = 'La sesión venció. Recargar la página para continuar.';
export const MENSAJE_DUPLICADO = 'Ya existe un registro con esos datos';
export const MENSAJE_EN_USO = 'El registro está en uso y no se puede eliminar';

// PostgREST: 42501 = privilegio o política RLS denegados (el rol no puede); PGRST301 y mensaje «JWT expired» = sesión vencida;
// 23505 = clave duplicada; 23503 = referencia en uso. Un TypeError de fetch es una falla de red.
export function mensajeDeError(error) {
  if (!error) return '';
  const codigo = String(error.code ?? '');
  const texto = String(error.message ?? '');
  if (codigo === '42501') return MENSAJE_SIN_PERMISO;
  if (codigo === 'PGRST301' || /jwt expired/i.test(texto)) return MENSAJE_SESION;
  if (codigo === '23505') return MENSAJE_DUPLICADO;
  if (codigo === '23503') return MENSAJE_EN_USO;
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(texto)) return MENSAJE_SIN_CONEXION;
  return MENSAJE_GENERICO;
}

// Equivalente de userError() de core/ui.js, sin el console.error. Lo inesperado se anota con console.warn, solo el código:
// sirve al desarrollo y no filtra nada al usuario ni ensucia la consola de un flujo normal.
export function userError(error) {
  const mensaje = mensajeDeError(error);
  if (mensaje === MENSAJE_GENERICO && error) console.warn('Error inesperado de datos', error.code ?? '(sin código)');
  return mensaje;
}

// Ejecuta una consulta de supabase-js y devuelve siempre `{ datos, error, codigo }`: `error` es el mensaje de usuario (o null) y
// `codigo` el código original para decisiones de la pantalla. No lanza: un fallo de red o una excepción del cliente también
// terminan en `error`, para que la pantalla tenga un solo camino de falla.
export async function ejecutar(consulta) {
  try {
    const { data, error } = await consulta;
    if (error) return { datos: null, error: userError(error), codigo: error.code ?? null };
    return { datos: data ?? null, error: null, codigo: null };
  } catch (e) {
    return { datos: null, error: userError(e), codigo: e?.code ?? null };
  }
}

// Atajo ligado a un cliente: `const datos = crearDatos(ctx.db)`; `datos.leer((db) => db.from('v_alertas').select('*'))`
// y `datos.rpc('nombre', { arg })`. El `ctx.db` es el cliente del panel viejo; aquí no se crea ninguno.
export function crearDatos(db) {
  return {
    leer: (fn) => ejecutar(Promise.resolve().then(() => fn(db))), // una excepción síncrona de fn también cae en `error`
    rpc: (nombre, args) => ejecutar(Promise.resolve().then(() => db.rpc(nombre, args))),
  };
}
