# crear-usuario-seccional

Edge Function (Deno) que crea un usuario Auth + su perfil `cliente` para un cliente existente. La llama **solo el administrador de empresa** (`cliente` sin sucursal), que crea en su propia empresa: el `cliente_id` sale de su perfil y un cuerpo con otro devuelve 403. El equipo Neumet (`admin`) ya no la usa y recibe 403 (F10 PR 10; el primer administrador de un cliente lo crea `crear-cliente`).

- Con `sucursal_id`: perfil de **sucursal** (la RLS le muestra solo los vehículos/dispositivos de esa sucursal).
- Sin `sucursal_id`: perfil **global** adicional del cliente (ve todas las sucursales).

## Contrato

`POST /functions/v1/crear-usuario-seccional` con `Authorization: Bearer <JWT del administrador de empresa>` y JSON
`{ cliente_id?, sucursal_id?, email, password? }` (`cliente_id` opcional: si viene debe ser el del llamante).

- Éxito (201): `{ ok: true, usuario: { user_id, cliente_id, sucursal_id, email, modo } }` (`modo`: `password` |
  `invite`).
- Error: `{ ok: false, error }` con 400 (validación; sucursal de otro cliente), 401, 403 (no es administrador de empresa, incluido el equipo Neumet; `cliente_id` ajeno; empresa dada de baja; origen), 404
  (sucursal inexistente), 405, 409 (email ya existe; `codigo: acceso_quitado` si es de esta empresa con el acceso quitado: usar «Reponer acceso»), 429 (más de 20 intentos por hora por administrador de empresa, en memoria de la instancia), 413, 500.
- `password` opcional (12..128 caracteres); sin ella se envía una invitación por email.

## Garantías

- JWT verificado con `auth.getUser` y rol leído con la clave de servicio: solo administrador de empresa (el rol `admin` se rechaza).
- La sucursal debe pertenecer al `cliente_id` (comprobado aquí y por la FK compuesta
  `perfiles(sucursal_id, cliente_id)`).
- Si falla la inserción del perfil se elimina el usuario Auth recién creado (compensación).
- Logs JSON con `request_id`; nunca emails, contraseñas ni tokens.

Variables de entorno: las mismas que `crear-cliente` (`ALLOWED_ORIGINS`, `INVITE_REDIRECT_TO`).

```
deno test --config supabase/functions/deno.json supabase/functions/crear-usuario-seccional
```
