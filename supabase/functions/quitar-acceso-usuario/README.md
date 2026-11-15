# quitar-acceso-usuario

Edge Function (Deno) que quita el acceso de un usuario a la empresa y cierra sus sesiones en Auth (docs/17 §4.1).
La autorización la decide la RPC `usuario_empresa_quitar_acceso`, invocada con el JWT de quien llama; esta función no decide permisos.

## Contrato
`POST /functions/v1/quitar-acceso-usuario` con `Authorization: Bearer <JWT>` y JSON `{ user_id, acceso_id? }`.
`acceso_id` solo en un **reintento** de una baja ya hecha (el de la fila «quitado» de `usuarios_empresa_listar`); sin él es una baja nueva.

- 200: `{ ok, estado, user_id, acceso_id, bloqueo_auth }`. `estado`: `quitado`, `ya_quitado` o `repuesto_durante_baja` (otra operación repuso al usuario mientras tanto).
- 403 `recargar_lista`: la RPC respondió `42501` (sin permiso, baja ya hecha sin `acceso_id`, usuario repuesto, otra empresa). **No es éxito** y no se toca Auth:
  actualizar la lista y repetir desde la fila del usuario, con `acceso_id` si figura como quitado.
- 409 `ultimo_admin` (último administrador), 400 `acceso_propio`, 409 `no_converge` (repetir).
- 502 `bloqueo_auth_pendiente`: el acceso a datos ya está cortado pero Auth falló; repetir con el `acceso_id` devuelto.
- 400, 401, 405, 413, 500.

## Convergencia con Auth
Tras una RPC exitosa: lee el estado vigente (`accesos_quitados_marcar_auth`), bloquea (sin perfil) o desbloquea (con perfil) con `ban_duration`, relee y repite hasta 3 intentos si el estado cambió. El usuario de Auth no se borra.

```
deno test --config supabase/functions/deno.json supabase/functions/quitar-acceso-usuario
```
Variables: `ALLOWED_ORIGINS`; `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las provee el runtime.
