# crear-usuario-seccional

Edge Function (Deno) que crea un usuario Auth + su perfil `cliente` para un cliente existente. Solo admins.

- Con `sucursal_id`: perfil de **seccional** (la RLS le muestra solo los vehículos/dispositivos de esa seccional).
- Sin `sucursal_id`: perfil **global** adicional del cliente (ve todas las seccionales).

## Contrato

`POST /functions/v1/crear-usuario-seccional` con `Authorization: Bearer <JWT del admin>` y JSON
`{ cliente_id, sucursal_id?, email, password? }`.

- Éxito (201): `{ ok: true, usuario: { user_id, cliente_id, sucursal_id, email, modo } }` (`modo`: `password` | `invite`).
- Error: `{ ok: false, error }` con 400 (validación; seccional de otro cliente), 401, 403 (no admin / origen), 404 (cliente o
  seccional inexistente), 405, 409 (email ya existe), 413, 500.
- `password` opcional (12..128 caracteres); sin ella se envía una invitación por email.

## Garantías

- JWT verificado con `auth.getUser` y rol con `perfiles.rol = 'admin'` (service role).
- La seccional debe pertenecer al `cliente_id` (comprobado aquí y por la FK compuesta `perfiles(sucursal_id, cliente_id)`).
- Si falla la inserción del perfil se elimina el usuario Auth recién creado (compensación).
- Logs JSON con `request_id`; nunca emails, contraseñas ni tokens.

Variables de entorno: las mismas que `crear-cliente` (`ALLOWED_ORIGINS`, `INVITE_REDIRECT_TO`).

```
deno test --config supabase/functions/deno.json supabase/functions/crear-usuario-seccional
```
