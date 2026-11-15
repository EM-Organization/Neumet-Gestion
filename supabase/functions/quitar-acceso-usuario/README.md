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
- 502: la convergencia con Auth falló tras una RPC exitosa. El código, el texto y los campos salen del **último estado observado** en la base, no de la baja pedida (otra persona pudo reponer entretanto). Mostrar siempre `error`:
  - `bloqueo_auth_pendiente` (`acceso_cortado: true`, `acceso_id`, `estado`): coincide con lo pedido, el usuario no tiene perfil y Auth no pudo bloquearlo. Ofrecer «Quitar» de nuevo desde la fila «quitado», enviando `acceso_id`.
  - `desbloqueo_auth_pendiente` (`acceso_repuesto: true`, `acceso_cortado: false`, `acceso_id`): otra persona repuso al usuario y Auth no pudo desbloquearlo. **No** ofrecer «Quitar» (sería una baja nueva que nadie decidió): ofrecer «Reponer acceso» con ese `acceso_id`.
  - `estado_no_confirmado` (`acceso_id`, sin `acceso_cortado` ni `acceso_repuesto`): no se pudo leer el estado, por lo que no se afirma ninguno. Ofrecer actualizar la lista y decidir desde la fila que aparezca.
- 400, 401, 405, 413, 500.

## Convergencia con Auth
Tras una RPC exitosa: lee el estado vigente (`accesos_quitados_marcar_auth`), bloquea (sin perfil) o desbloquea (con perfil) con `ban_duration`, relee y repite hasta 3 intentos si el estado cambió. El usuario de Auth no se borra.

```
deno test --config supabase/functions/deno.json supabase/functions/quitar-acceso-usuario
```
Variables: `ALLOWED_ORIGINS`; `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las provee el runtime.

El front ofrece «Quitar» en toda fila «quitado», tenga o no la marca `bloqueo_auth_aplicado_at` (es informativa; repetir es idempotente).
