# reponer-acceso-usuario

Edge Function (Deno) que repone el acceso de un usuario quitado y levanta su bloqueo en Auth (docs/17 §4.1).
La autorización la decide la RPC `usuario_empresa_reponer_acceso`, invocada con el JWT de quien llama.

## Contrato
`POST /functions/v1/reponer-acceso-usuario` con `Authorization: Bearer <JWT>` y JSON `{ acceso_id, sucursal_id? }`
(`acceso_id` de la fila «quitado»; `sucursal_id` para elegir otra si la original se borró).

- 200: `{ ok, estado, user_id, acceso_id, bloqueo_auth }`. `estado`: `repuesto`, `ya_repuesto` o `quitado_durante_reposicion` (otra baja ocurrió mientras tanto: Auth queda bloqueado).
- 403 `recargar_lista` (`42501`), 400 `elegir_sucursal` (`22023`; Auth no se toca), 409 `no_converge` (repetir).
- 502: la convergencia con Auth falló tras una RPC exitosa. El código, el texto y los campos salen del **último estado observado** en la base, no de la reposición pedida (otra persona pudo quitar entretanto). Mostrar siempre `error`:
  - `desbloqueo_auth_pendiente` (`acceso_repuesto: true`, `acceso_id`, `estado`): coincide con lo pedido, el usuario tiene perfil y Auth no pudo desbloquearlo. Ofrecer «Reponer acceso» de nuevo con el mismo `acceso_id`.
  - `bloqueo_auth_pendiente` (`acceso_cortado: true`, `acceso_repuesto: false`, **sin `acceso_id`**): otra persona quitó al usuario y Auth no pudo bloquearlo. El `acceso_id` enviado es de la baja anterior, por eso no se devuelve. **No** ofrecer «Reponer» de nuevo: actualizar la lista y ofrecer «Quitar» desde la fila «quitado» vigente.
  - `estado_no_confirmado` (`acceso_id`, sin `acceso_cortado` ni `acceso_repuesto`): no se pudo leer el estado; no se afirma ninguno. Ofrecer actualizar la lista y decidir desde la fila que aparezca.
- 400, 401, 405, 413, 500.

La convergencia es la misma que en `quitar-acceso-usuario` (`_shared/acceso.ts`): desbloquea si hay perfil, también ante `ya_repuesto`.

```
deno test --config supabase/functions/deno.json supabase/functions/reponer-acceso-usuario
```
