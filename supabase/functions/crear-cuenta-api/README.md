# crear-cuenta-api

Edge Function (Deno) que crea una **cuenta de API** para un cliente: usuario Auth + fila en `perfiles` con `rol='api'` y
`cliente_id`. Solo admins. La app de medición inicia sesión con esa cuenta y `api-proveedor` asigna todo al cliente del
perfil (nunca del cuerpo).

`POST /functions/v1/crear-cuenta-api` con `Authorization: Bearer <JWT admin>` y
`{ cliente_id:int, email:string, password?:string }`.

- 201: `{ ok:true, cuenta:{ user_id, email, cliente_id }, password? }`. `password` solo viene si la generó el servidor
  (28 caracteres aleatorios criptográficos); se muestra una única vez (`Cache-Control: no-store`) y nunca se registra.
- Errores: 400 validación (password propia: 16..128), 401, 403 (no admin/origen), 404 (cliente inexistente o eliminado),
  405, 409 (email existe o ya hay 5 cuentas api), 413, 500.
- No hay trigger sobre `auth.users` (solo `clientes_sync_perfil`, que crea perfiles `cliente`); el perfil `api` se crea
  con upsert desde la función. Si falla, se borra el usuario Auth (compensación).
- Env: `ALLOWED_ORIGINS` (sin él se deniega todo origen de navegador). `verify_jwt = false` en `config.toml` (el handler
  valida el JWT y el rol).
