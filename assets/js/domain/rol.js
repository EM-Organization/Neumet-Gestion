// Rol de la sesión (lógica pura, sin DOM ni supabase). Tests: tests/unit/rol.test.mjs
// El rol se decide por lo que existe, nunca por ausencia: sin perfil reconocido la sesión no entra al panel
// (la RLS ya le niega los datos; esto evita que la interfaz aparente lo contrario).
export const ROL_ADMIN = 'admin';
export const ROL_CLIENTE = 'cliente';
export const ROL_SIN_ACCESO = 'sin_acceso';

export const puedeUsarPanel = rol => rol === ROL_ADMIN || rol === ROL_CLIENTE;

// Precios y costos (neumaticos.precio_unidad, eventos_neumatico.costo): solo admin y perfil global (cliente sin sucursal).
// Espejo de public.precios_visibles(); la base lo hace cumplir con privilegios por columna, esto evita pedir lo que se va a negar.
export const puedeVerPrecios = (rol, sucursalId = null) =>
  rol === ROL_ADMIN || (rol === ROL_CLIENTE && (sucursalId === null || sucursalId === undefined));

/**
 * @param perfil           fila de perfiles del usuario ({rol, cliente_id, sucursal_id}) o null
 * @param clientePerfil    fila de clientes {id, nombre} a la que apunta perfil.cliente_id, o null
 * @param clienteVinculado fila de clientes con auth_user_id = usuario (cuentas anteriores a las sucursales), o null
 * @returns {{rol:string, clienteId:number|null, clienteNombre:string, sucursalId:number|null}}
 */
export function decidirRol({ perfil = null, clientePerfil = null, clienteVinculado = null } = {}) {
  const sin = { rol: ROL_SIN_ACCESO, clienteId: null, clienteNombre: '', sucursalId: null };
  const rol = perfil && typeof perfil === 'object' ? perfil.rol : null;
  if (rol === ROL_ADMIN) return { rol: ROL_ADMIN, clienteId: null, clienteNombre: '', sucursalId: null };
  // El rol 'api' es de integración: no usa el panel, aunque además figure como cliente.
  if (rol === 'api') return sin;
  if (rol === ROL_CLIENTE && perfil.cliente_id != null && clientePerfil) {
    return { rol: ROL_CLIENTE, clienteId: clientePerfil.id, clienteNombre: clientePerfil.nombre, sucursalId: perfil.sucursal_id ?? null };
  }
  if (clienteVinculado) {
    return { rol: ROL_CLIENTE, clienteId: clienteVinculado.id, clienteNombre: clienteVinculado.nombre, sucursalId: null };
  }
  return sin;
}
