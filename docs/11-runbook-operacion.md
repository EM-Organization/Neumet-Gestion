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
4. Limitaciones conocidas: un JWT no se revoca antes de expirar (aprox. 1 h); desde el PR 5 de F10, dar de baja un cliente (`deleted_at`) corta su cuenta `api` (login y tokens ya emitidos responden 401) sin tocar su perfil.

## 3. Aplicar migraciones y desplegar funciones

### 3.1 Orden general
1. **Migración antes del front.** Un front que usa una columna, vista o RPC nueva no se fusiona (ni se despliega en Vercel) hasta que la migración esté aplicada y verificada; de lo contrario el panel consulta objetos que todavía no existen.
2. **Función después de la migración.** Una Edge Function que llama a una RPC o columna nueva se despliega solo cuando la migración ya está aplicada. Las funciones y el front que dependen de la misma migración se publican después de ella, nunca antes.
3. Comparar `supabase migration list --remote` con los archivos de `supabase/migrations/` antes de fusionar cualquier PR que dependa de una migración nueva.

### 3.2 Aplicar migraciones
Las migraciones están en `supabase/migrations/` y deben ser idempotentes (el job `sql` del CI las aplica dos veces). La lista vigente es el contenido de `supabase/migrations/` (ordenado por nombre); cada una tiene su apéndice en [`docs/08`](08-esquema-datos.md). El nombre `seccionales` es histórico: en la interfaz y en la documentación el término es «sucursal».
1. Revisar el PR (el CI ejecuta el job `sql` contra un PostgreSQL desechable) y leer la migración entera: permisos, `search_path`, RLS.
2. Aplicar **solo con el CLI**, desde la raíz del repo y con el proyecto enlazado (`kootszos…`): primero `supabase db push --remote --dry-run` (debe listar únicamente la migración nueva) y después `supabase db push --remote --yes`. No usar el MCP `apply_migration`: registra la versión con la fecha del momento y desalinea el historial respecto de los archivos. Las migraciones no llevan `begin`/`commit` propios (salvo `20261106000000_init_schema` y `20261106010000_api_proveedor`): el CLI ya las envuelve en una transacción.
3. Si el CLI falla a mitad, no repetir a ciegas: comprobar con `supabase migration list --remote` qué quedó registrado y revisar el estado real de la base antes de reintentar.
4. Verificar con `supabase migration list --remote` (local y remoto alineados), `get_advisors` (seguridad y rendimiento, lectura por MCP) y `supabase/audit/rls_audit.sql`.
5. Solo entonces fusionar el front y desplegar las funciones que la usan.

### 3.2.1 Programar el cierre mensual de uso (`uso_cerrar_mes`, migración `20261119500000`)
Paso operativo **posterior** a aplicar la migración; no va en ella. Estado al 2026-11-16: `pg_cron` está disponible en el proyecto pero **no instalado** (`list_extensions`). Habilitarlo es acción del dueño o del director desde el dashboard (Database > Extensions), no una migración.
1. Habilitar `pg_cron` y comprobar con `list_extensions` que `installed_version` no es nulo.
2. Programar (SQL editor, una sola vez; día 1 de cada mes a las 03:00 UTC, cierra el mes anterior): `select cron.schedule('uso-cerrar-mes', '0 3 1 * *', $$select public.uso_cerrar_mes()$$);`
3. Cierre inicial de meses pasados con datos (idempotente, reejecutable): `select public.uso_cerrar_mes('2026-10-01');` por cada mes. Para rehacer una foto equivocada (vehículos, dispositivos, usuarios, último ingreso) un re-cierre no basta: borrar antes la fila del mes como dueño (`delete from public.uso_cliente_mensual where mes = '2026-10-01';`) y volver a cerrar. Los vehículos, dispositivos y usuarios de esos cierres reflejan el estado del día en que se corren; los logins previos a 2026-11-16 dan 0.
4. Verificar: `select * from cron.job where jobname = 'uso-cerrar-mes'` y, tras la primera ejecución, `cron.job_run_details`.
Si `pg_cron` no se habilita, el cierre se invoca con una Edge Function programada que llame a la RPC con la clave de servicio (docs/17 §8).

### 3.3 Desplegar funciones
Funciones en `supabase/functions/`: `api-proveedor`, `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional`, `quitar-acceso-usuario`, `reponer-acceso-usuario` y `contacto` (esta última ya desplegada en el proyecto vigente, con sus secretos cargados). Antes de dar una función por disponible, comprobar con `list_edge_functions`.

**Todas tienen `verify_jwt = false`** en `supabase/config.toml`: `api-proveedor` (el Bearer se valida dentro del handler), `contacto` (formulario público), `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional`, `quitar-acceso-usuario` y `reponer-acceso-usuario` (validan el JWT dentro del handler y el rol: solo el administrador de empresa en `crear-usuario-seccional` (el equipo Neumet recibe 403), y la RPC con el JWT del llamante en las otras dos; el preflight CORS no lleva token). Con el CLI el valor sale de `config.toml`; con el MCP (`deploy_edge_function`) pasar `verify_jwt` en `false` de forma explícita, y comprobarlo después en `list_edge_functions`. Desplegar con `verify_jwt` activo rompe el preflight CORS y el login de la app de medición.

1. Cargar antes los secrets (acción del dueño o `supabase secrets set`):
   - `contacto`: `RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`, opcional `TURNSTILE_SECRET` (ver `supabase/functions/contacto/README.md`).
   - `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional`: `ALLOWED_ORIGINS`, opcional `INVITE_REDIRECT_TO` (ver sus README). `quitar-acceso-usuario` y `reponer-acceso-usuario`: solo `ALLOWED_ORIGINS` (no invitan). Sin `ALLOWED_ORIGINS` se deniega todo origen de navegador.
   - `api-proveedor`: usa `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que provee Supabase. Otros secrets: **[pendiente]** confirmar.
2. Antes de desplegar: `deno test --config supabase/functions/deno.json supabase/functions/<funcion>`.
3. Desplegar con `supabase functions deploy <funcion>` o el MCP (`deploy_edge_function`), siempre con `verify_jwt = false`.
4. Comprobar los logs (`query_logs`) y hacer una llamada de humo.

## 4. Regenerar el demo
`supabase/seed/demo.sql` no es una migración: no se aplica solo y se ejecuta a mano (SQL Editor de Supabase o `psql`) con un rol que no esté sujeto a RLS (por ejemplo `postgres`), porque las mediciones no son editables desde el panel.
1. Requisitos: todas las migraciones de `supabase/migrations/` aplicadas (§3.2) y el cliente `Demo Transportes` creado desde el panel (Clientes > Nuevo cliente). Sin el cliente, el script falla con un mensaje claro.
2. Ejecutar el archivo completo. Es seguro repetirlo y **refresca el demo**: borra y regenera todo lo regenerable del cliente Demo, a saber eventos, mediciones, neumáticos y stock (`stock_neumaticos`), incluido lo creado a mano en pruebas (cambios de neumático, rotaciones, cubiertas agregadas o movidas). Las fechas son relativas a `now()`.
3. Qué regenera: 14 vehículos con número de coche 101 a 109 y 201 a 205, mediciones semanales de unas 10 semanas, 6 dispositivos de ejemplo, el stock con 3 lotes antiguos y las **12 cubiertas individuales `S-001` a `S-012`** (condiciones nuevo, usado, reparado y recauchutado, repartidas entre Montevideo, Salto y sin sucursal), y algunos eventos. Las sucursales, los vehículos y los dispositivos se actualizan sin duplicar.
4. No toca ningún otro cliente. No ejecutarlo contra un cliente real: el nombre se busca por `Demo Transportes`.
5. Tras regenerar, comprobar en el panel que Inicio, Alertas y Stock muestran datos con fechas actuales. La prueba `tests/sql/t_60_seed_demo.sql` cubre el script contra un Postgres desechable.

## 5. Rotar claves
- **Cuenta `api`**: cambiar la contraseña en Authentication → Users y actualizarla en la app; los JWT ya emitidos siguen válidos hasta expirar (aprox. 1 h). Una rotación asistida por RPC está **[pendiente]** (PR en curso).
- **Claves del proyecto** (publishable/secret, JWT secret): rotar desde el dashboard. La publishable va en `assets/config.js` (editar, fusionar y redesplegar en Vercel); la secret/service role solo vive como secret de las funciones: actualizarla y redesplegar. Procedimiento exacto sin caída: **[pendiente]** documentar tras probarlo.
- **`RESEND_API_KEY`**: generar una nueva en Resend, ejecutar `supabase secrets set` y revocar la anterior.
- Si una clave secreta aparece en el repo: tratarla como comprometida, rotarla y reportar según [`SECURITY.md`](../SECURITY.md).

## 6. Cutover del frontend a `kootszos…` (realizado)

El frontend ya apunta al proyecto vigente. La lista queda como registro y como guía si hubiera que repetir el procedimiento. Los ítems sin marcar no se pudieron verificar desde el repositorio: confirmarlos en el dashboard.

- [x] Migraciones aplicadas (revisar `get_advisors` antes del corte).
- [ ] Usuario admin creado con rol en `perfiles` y signup desactivado (§1).
- [x] `contacto` desplegada con `RESEND_API_KEY`, `FROM_EMAIL`, `TO_EMAIL` y `ALLOWED_ORIGINS` cargados (§3.3).
- [ ] `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional` desplegadas, con `ALLOWED_ORIGINS` (§3.3). Confirmar.
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


## 8. Pruebas en un worktree (autores, correctores y revisores)

Un worktree nuevo no trae `node_modules`. Antes de correr nada:

```
scripts/preparar-worktree.sh   # o: npm run preparar — npm ci con caché (segundos), idempotente, y comprueba que lint y check corren
npm run verificar:rapido       # lint + check + unitarias, test:front y el smoke de todos los modos según el diff contra origin/main
```

- **Por qué `npm ci` propio** y no un enlace al `node_modules` del repo principal: ese puede estar desactualizado y un `npm install` en un
  worktree cambiaría las dependencias de todos los demás.
- **Smoke y capturas**: `tests/smoke/run.sh <modo>` y `tests/visual/run.sh` levantan `scripts/servir-estatico.mjs` (Node, concurrente, cola larga) en el primer
  puerto libre; se pueden correr varios a la vez en distintos worktrees. `scripts/smoke-modos.sh` corre los 22 modos (el CI también: job `smoke`).
  `PORT` y `BUDGET` siguen funcionando. Necesitan Google Chrome y `node` (>= 22.12).
- **`npm run e2e`** (verificado desde un worktree): necesita `npm ci` hecho (el e2e corre `npm run build`), Postgres con
  `initdb`/`pg_ctl` (`brew install postgresql@17`, o `E2E_PG_URL` con un superusuario), `libpq` en macOS y Chrome. El binario de PostgREST se
  descarga la primera vez (con SHA-256 fijado) en `tests/e2e/.cache/` **de cada worktree**; para no repetir la descarga, `E2E_POSTGREST_BIN=/ruta`.
  Tarda unos 3,5 minutos y usa puertos libres, pero no conviene correr dos e2e a la vez en la misma máquina (carga de Chrome).
- **`verificar:rapido` no corre** SQL (`tests/sql/run.sh`), e2e, Deno ni capturas: al final lista cuáles corresponden según el diff.
- Si el smoke falla con `window.xFlow is not a function` o `reading 'closest'`: antes del servidor Node era, con casi total seguridad, un `<script>` del arnés que no
  llegaba (cola de conexiones del servidor de un hilo; no se reprodujo a voluntad); `reading 'closest'` era el síntoma secundario de una sección de Inicio
  ausente (ahora el flujo se detiene tras el primer mensaje). Con el servidor Node no reapareció en decenas de corridas seguidas y en paralelo; si vuelve, mirar primero el primer mensaje de `SMOKE:FAIL`.
