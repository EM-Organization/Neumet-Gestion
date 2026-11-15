# reponer-acceso-usuario

Edge Function (Deno) que repone el acceso de un usuario quitado y levanta su bloqueo en Auth (docs/17 §4.1).
La autorización la decide la RPC `usuario_empresa_reponer_acceso`, invocada con el JWT de quien llama.

## Contrato
`POST /functions/v1/reponer-acceso-usuario` con `Authorization: Bearer <JWT>` y JSON `{ acceso_id, sucursal_id? }`
(`acceso_id` de la fila «quitado»; `sucursal_id` para elegir otra si la original se borró).

- 200: `{ ok, estado, user_id, acceso_id, bloqueo_auth }`. `estado`: `repuesto`, `ya_repuesto` o `quitado_durante_reposicion` (otra baja ocurrió mientras tanto: Auth queda bloqueado).
- 403 `recargar_lista` (`42501`), 400 `elegir_sucursal` (`22023`; Auth no se toca), 409 `no_converge` (repetir).
- 502 `desbloqueo_auth_pendiente`: el perfil ya está repuesto pero Auth falló; repetir la llamada.
- 400, 401, 405, 413, 500.

La convergencia es la misma que en `quitar-acceso-usuario` (`_shared/acceso.ts`): desbloquea si hay perfil, también ante `ya_repuesto`.

```
deno test --config supabase/functions/deno.json supabase/functions/reponer-acceso-usuario
```
