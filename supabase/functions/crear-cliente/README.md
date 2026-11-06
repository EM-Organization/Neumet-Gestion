# crear-cliente

Edge Function (Deno) que crea un cliente: usuario Auth + fila en `clientes` (el trigger `clientes_sync_perfil` crea el perfil `cliente`). Solo admins.

## Contrato

`POST /functions/v1/crear-cliente` con `Authorization: Bearer <JWT del admin>` y JSON `{ nombre, email, password? }`.

- Éxito (201): `{ ok: true, cliente: { id, nombre, created_at, auth_user_id, dispositivos: [], vehiculos: [] } }`
- Error: `{ ok: false, error: "mensaje" }` con 400 (validación), 401 (sin token / token inválido), 403 (no admin u origen no permitido), 405, 409 (email ya existe), 413 (> 10 KB), 500.

Validación: `nombre` 1..100; `email` válido, ≤ 254, sin saltos de línea; `password` opcional pero, si viene, **12..128 caracteres**.
**Tarea del panel:** hoy valida mínimo 6 en el cliente (`saveCliente`, docs/02 S3); hay que subirlo a 12 y, preferiblemente, dejar el campo vacío para usar invitación.

- Sin `password` -> `inviteUserByEmail`: el cliente fija su clave; el admin no la conoce.
- Con `password` -> `createUser({ email_confirm: true })`.

## Garantías

- El JWT se verifica con `auth.getUser(token)` y el rol con `perfiles.rol = 'admin'` (service role).
- Si falla la inserción en `clientes`, se elimina el usuario Auth recién creado (compensación). Un reintento con el mismo email da 409 (no duplica).
- Logs JSON de una línea con `request_id`; nunca emails, contraseñas ni tokens.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Provistas por Supabase. |
| `ALLOWED_ORIGINS` | Orígenes del panel separados por comas. **Si falta, se deniega todo origen de navegador (no se usa `*`).** Se refleja el Origin con `Vary: Origin`. |
| `INVITE_REDIRECT_TO` | (opcional) URL de redirección del email de invitación; debe estar en la lista de redirects de Auth. |

## Desarrollo

```
deno test --config supabase/functions/deno.json supabase/functions/crear-cliente
```

`handler.ts` recibe todo el I/O por inyección (`Deps`); `index.ts` lo cablea con supabase-js. Los tests usan dobles, sin red.
