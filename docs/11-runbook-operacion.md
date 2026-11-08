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

### 2.0 Desde el panel (recomendado)
1. Antes, aplicar `20261107010000_cuentas_api` (RPC `cuentas_api_listar`) y desplegar `crear-cuenta-api` (`verify_jwt = false`, necesita `ALLOWED_ORIGINS`; ver su README).
2. Panel → Ficha de cliente → sección **Cuenta de API** (solo admin) → revisar el email sugerido (editable) → **Crear cuenta de API**.
3. El panel muestra email y contraseña **una sola vez** (la genera el servidor: 28 caracteres aleatorios; no se registra en logs ni se puede recuperar). Usar **Copiar credenciales** y guardarlas en el almacén seguro de la app. Al cambiar de cliente o recargar, desaparecen.
4. Límite de 5 cuentas de API por cliente. La empresa de cada medición sale siempre del `cliente_id` del perfil `api`, nunca del cuerpo de la petición.
5. Si falla el alta del perfil, la función borra el usuario Auth recién creado (no quedan cuentas huérfanas). No existe trigger sobre `auth.users`, por lo que el perfil lo crea la propia función (upsert).

### 2.1 Manual (alternativa)
1. Authentication → Users → Add user con un email técnico y una contraseña generada de 24 o más caracteres (guardarla en el almacén seguro de la app: Keychain/Keystore).
2. Insertar la fila de perfil con rol `api` y `cliente_id` obligatorio:
   ```sql
   insert into public.perfiles (user_id, rol, cliente_id) values ('<uuid de la cuenta>', 'api', <id del cliente>);
   ```
3. Probar el login contra `api-proveedor` (contrato en [`api/openapi.yaml`](api/openapi.yaml)). **[pendiente]**: cuenta aún no creada.
4. Limitaciones conocidas: un JWT no se revoca antes de expirar (aprox. 1 h); la baja de un cliente no desactiva su perfil `api` (sugerencias del revisor en el tablero).

## 3. Aplicar migraciones
Las migraciones están en `supabase/migrations/` y deben ser idempotentes. Orden (por nombre de archivo): `20261106000000_init_schema`, `20261106010000_api_proveedor`, `20261106020000_producto_vistas`, `20261107000000_rpc_rotacion`, `20261107010000_cuentas_api`, `20261107020000_seccionales`, `20261108000000_cambio_neumatico`, `20261108010000_comentarios_mm`, `20261109000000_mediciones_por_neumatico`, `20261110000000_numero_quema`, `20261110010000_gestion_sucursales`, `20261110020000_ultimas_mediciones`. El nombre `seccionales` es histórico: en la interfaz y en la documentación el término es «sucursal».
1. Revisar el PR (el CI ejecuta el job `sql` contra un PostgreSQL desechable).
2. Aplicar con el MCP de Supabase (`apply_migration`) o con el CLI (`supabase db push`) apuntando a `kootszos…`.
3. Verificar con `list_migrations`, `get_advisors` (seguridad) y `supabase/audit/rls_audit.sql`.

Comparar `list_migrations` con la lista anterior antes de fusionar un front que dependa de una migración nueva.

## 4. Desplegar funciones
Funciones en `supabase/functions/`: `api-proveedor`, `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional` y `contacto` (esta última ya desplegada en el proyecto vigente, con sus secretos cargados). Antes de dar una función por disponible, comprobar con `list_edge_functions`. La configuración de `verify_jwt` está en `supabase/config.toml`.
1. Cargar antes los secrets (acción del dueño o `supabase secrets set`):
   - `contacto`: `RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`, opcional `TURNSTILE_SECRET` (ver `supabase/functions/contacto/README.md`).
   - `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional`: `ALLOWED_ORIGINS`, opcional `INVITE_REDIRECT_TO` (ver sus README). Sin `ALLOWED_ORIGINS` se deniega todo origen de navegador.
   - `api-proveedor`: usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que provee Supabase. Otros secrets: **[pendiente]** confirmar.
2. Antes de desplegar: `deno test --config supabase/functions/deno.json supabase/functions/<funcion>`.
3. Desplegar con `supabase functions deploy <funcion>` o el MCP (`deploy_edge_function`), respetando `verify_jwt` de `config.toml`.
4. Comprobar los logs (`query_logs`) y hacer una llamada de humo.

## 5. Rotar claves
- **Cuenta `api`**: cambiar la contraseña en Authentication → Users y actualizarla en la app; los JWT ya emitidos siguen válidos hasta expirar (aprox. 1 h). Una rotación asistida por RPC está **[pendiente]** (PR en curso).
- **Claves del proyecto** (publishable/secret, JWT secret): rotar desde el dashboard. La publishable va en `assets/config.js` (editar, fusionar y redesplegar en Vercel); la secret/service role solo vive como secret de las funciones: actualizarla y redesplegar. Procedimiento exacto sin caída: **[pendiente]** documentar tras probarlo.
- **`RESEND_API_KEY`**: generar una nueva en Resend, ejecutar `supabase secrets set` y revocar la anterior.
- Si una clave secreta aparece en el repo: tratarla como comprometida, rotarla y reportar según [`SECURITY.md`](../SECURITY.md).

## 6. Cutover del frontend a `kootszos…` (realizado)

El frontend ya apunta al proyecto vigente. La lista queda como registro y como guía si hubiera que repetir el procedimiento. Los ítems sin marcar no se pudieron verificar desde el repositorio: confirmarlos en el dashboard.

- [x] Migraciones aplicadas (revisar `get_advisors` antes del corte).
- [ ] Usuario admin creado con rol en `perfiles` y signup desactivado (§1).
- [x] `contacto` desplegada con `RESEND_API_KEY`, `FROM_EMAIL`, `TO_EMAIL` y `ALLOWED_ORIGINS` cargados (§4).
- [ ] `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional` desplegadas, con `ALLOWED_ORIGINS` (§4). Confirmar.
- [ ] Cuenta `api` creada y login probado (§2).
- [x] `assets/config.js`: `SUPABASE_URL` y `SUPABASE_KEY` (publishable) del proyecto nuevo. El formulario de contacto de la landing toma la URL de esa misma constante.
- [x] `vercel.json`: `connect-src` apunta solo a `https://kootszosdejmawanfxug.supabase.co` (el proyecto anterior se retiró; `tests/unit/despliegue.test.mjs` lo verifica).
- [ ] `ALLOWED_ORIGINS` de cada función incluye el dominio de producción de Vercel. Confirmar.
- [ ] Prueba de punta a punta: login admin, crear cliente, ver flota/alertas, medición vía API, reporte exportable. **[pendiente]**
- [ ] Confirmado con DAC el orden `mm1..mm4`. **[pendiente]**
- Vuelta atrás: dato histórico. El proyecto anterior (`dqgrlflrjcarxlfetvoj`) ya no figura en el código; volver a él exigiría restaurar `assets/config.js`, `connect-src` y la URL de contacto desde el historial, y no está previsto.

## 7. QA visual y recarga forzada tras desplegar

- **QA visual** (antes de un PR que toque la interfaz): `tests/visual/run.sh` saca capturas de las vistas clave en escritorio y móvil
  con datos de prueba; revisarlas a ojo. Detalle en `tests/visual/README.md`. No usa el sitio real ni credenciales.
- **Hard reload tras desplegar**: el panel carga módulos ES (`assets/js/*.js`) que el navegador y el CDN pueden tener en caché; si
  tras un despliegue el panel muestra vistas vacías o un indicador «Conectado/Reintentar» raro, hacer recarga forzada
  (Cmd+Shift+R / Ctrl+F5) o abrir en ventana privada antes de investigar. Un módulo viejo con uno nuevo mezclados es la causa más probable.

