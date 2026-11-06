# 11 · Runbook de operación

> Procedimientos para operar NEUMET sobre el proyecto Supabase `kootszosdejmawanfxug`. Estado general en [10-tablero.md](10-tablero.md). Lo no verificado va marcado **[pendiente]**. Nunca pegar claves reales en el repo, en issues ni en PR.

## 1. Crear el usuario administrador
1. Dashboard → Authentication → Users → Add user (email + contraseña de 12 o más caracteres; MFA recomendado, opcional).
2. Authentication → Providers → Email: desactivar **Allow new users to sign up**.
3. Registrar el rol en `perfiles` (SQL Editor, con el `user_id` del usuario creado):
   ```sql
   insert into public.perfiles (user_id, rol) values ('<uuid del usuario>', 'admin');
   ```
   El CHECK exige `cliente_id` nulo para `admin` (ver [08-esquema-datos.md](08-esquema-datos.md)).
4. Iniciar sesión en el panel y comprobar que ve todos los clientes. **[pendiente]**: aún no se ha probado con sesión real.

## 2. Crear la cuenta `api` (app del calibre)
La cuenta es de mínimo privilegio y queda ligada a un cliente. Contrato en [07-api-proveedor.md](07-api-proveedor.md).
1. Authentication → Users → Add user con un email técnico y una contraseña generada de 24 o más caracteres (guardarla en el almacén seguro de la app: Keychain/Keystore).
2. Insertar la fila de perfil con rol `api` y `cliente_id` obligatorio:
   ```sql
   insert into public.perfiles (user_id, rol, cliente_id) values ('<uuid de la cuenta>', 'api', <id del cliente>);
   ```
3. Probar el login contra `api-proveedor` (contrato en [`api/openapi.yaml`](api/openapi.yaml)). **[pendiente]**: cuenta aún no creada.
4. Limitaciones conocidas: un JWT no se revoca antes de expirar (aprox. 1 h); la baja de un cliente no desactiva su perfil `api` (sugerencias del revisor en el tablero).

## 3. Aplicar migraciones
Las migraciones están en `supabase/migrations/` y deben ser idempotentes. Orden: `20261106000000_init_schema`, `20261106010000_api_proveedor`, `20261106020000_producto_vistas`.
1. Revisar el PR (el CI ejecuta el job `sql` contra un PostgreSQL desechable).
2. Aplicar con el MCP de Supabase (`apply_migration`) o con el CLI (`supabase db push`) apuntando a `kootszos…`.
3. Verificar con `list_migrations`, `get_advisors` (seguridad) y `supabase/audit/rls_audit.sql`.

Las tres migraciones ya están aplicadas.

## 4. Desplegar funciones
Funciones en `supabase/functions/`: `api-proveedor` (desplegada), `crear-cliente` y `contacto` (pendientes). La configuración de `verify_jwt` está en `supabase/config.toml`.
1. Cargar antes los secrets (acción del dueño o `supabase secrets set`):
   - `contacto`: `RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`, opcional `TURNSTILE_SECRET` (ver `supabase/functions/contacto/README.md`).
   - `crear-cliente`: `ALLOWED_ORIGINS`, opcional `INVITE_REDIRECT_TO` (ver su README). Sin `ALLOWED_ORIGINS` se deniega todo origen de navegador.
   - `api-proveedor`: usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que provee Supabase. Otros secrets: **[pendiente]** confirmar.
2. Antes de desplegar: `deno test --config supabase/functions/deno.json supabase/functions/<funcion>`.
3. Desplegar con `supabase functions deploy <funcion>` o el MCP (`deploy_edge_function`), respetando `verify_jwt` de `config.toml`.
4. Comprobar los logs (`query_logs`) y hacer una llamada de humo.

## 5. Rotar claves
- **Cuenta `api`**: cambiar la contraseña en Authentication → Users y actualizarla en la app; los JWT ya emitidos siguen válidos hasta expirar (aprox. 1 h). Una rotación asistida por RPC está **[pendiente]** (PR en curso).
- **Claves del proyecto** (publishable/secret, JWT secret): rotar desde el dashboard. La publishable va en `assets/config.js` (editar, fusionar y redesplegar en Vercel); la secret/service role solo vive como secret de las funciones: actualizarla y redesplegar. Procedimiento exacto sin caída: **[pendiente]** documentar tras probarlo.
- **`RESEND_API_KEY`**: generar una nueva en Resend, ejecutar `supabase secrets set` y revocar la anterior.
- Si una clave secreta aparece en el repo: tratarla como comprometida, rotarla y reportar según [`SECURITY.md`](../SECURITY.md).

## 6. Checklist de cutover del frontend a `kootszos…`
- [x] Migraciones aplicadas (revisar `get_advisors` antes del corte).
- [ ] Usuario admin creado con rol en `perfiles` y signup desactivado (§1).
- [ ] Secrets cargados y `crear-cliente` y `contacto` desplegadas (§4).
- [ ] Cuenta `api` creada y login probado (§2).
- [ ] `assets/config.js`: `SUPABASE_URL` y `SUPABASE_KEY` (publishable) del proyecto nuevo.
- [ ] `vercel.json`: `connect-src` apunta a `https://kootszosdejmawanfxug.supabase.co` (retirar el proyecto viejo cuando ya no se use).
- [ ] `ALLOWED_ORIGINS` incluye el dominio de producción.
- [ ] Prueba de punta a punta: login admin, crear cliente, ver flota/alertas, medición vía API, reporte exportable. **[pendiente]**
- [ ] Confirmado con DAC el orden `mm1..mm4`. **[pendiente]**
- [ ] Vuelta atrás: revertir `assets/config.js` y `vercel.json` al proyecto heredado `dqgrlflrjcarxlfetvoj`.
