# 17 · Plan de separación de roles: equipo Neumet y administrador de empresa

Estado: **planificado**. Este documento no describe comportamiento vigente: ninguna pantalla, función ni migración de este plan existe todavía. Lo vigente está en [docs/08 §4](08-esquema-datos.md) y en [docs/12](12-mapa-navegacion.md). Cada PR del plan actualiza este documento al fusionarse.

## 1. Decisión

El perfil `admin` pasa a ser **interno del equipo Neumet**: ver el uso de cada cliente (vehículos, dispositivos, consultas a la API) y administrar la plataforma. Cada cliente tiene su propio **administrador de empresa**, que gestiona su taller y a sus usuarios. Decisión del dueño, confirmada con un cliente.

Principio transversal: el operario sabe poco de tecnología. Flujos simples, pocos clics, textos según [docs/14](14-guia-de-textos.md).

## 2. Situación actual (verificada en el código)

### 2.1 Roles hoy

`perfiles.rol` admite `admin`, `cliente` y `api` (`supabase/migrations/20261106000000_init_schema.sql:75`). Un perfil por usuario (`user_id` es clave primaria). En la práctica hay cuatro figuras:

| Figura | Cómo se reconoce | Qué hace hoy |
|---|---|---|
| `admin` | `rol = 'admin'`, `cliente_id` nulo | Todo, entre todos los clientes |
| Perfil global | `rol = 'cliente'` y `sucursal_id` nulo | Ya es de hecho el administrador de la empresa: gestiona sucursales, stock, costos, recauchutado y el nivel crítico de alertas |
| Usuario de sucursal | `rol = 'cliente'` con `sucursal_id` | Opera solo su sucursal; no ve stock ni precios |
| `api` | `rol = 'api'` | Integración; sin acceso al panel ni a PostgREST |

El primer usuario de cada cliente es global: el trigger `clientes_sync_perfil` crea el perfil `cliente` sin sucursal al vincular `clientes.auth_user_id` (`20261106000000_init_schema.sql:399-419`).

### 2.2 Helpers y la regla «global» copiada

Funciones `SECURITY DEFINER` con `search_path = ''`: `is_admin()` (`init_schema.sql:297`), `current_cliente_id()` (`:310`), `current_sucursal_id()` (`20261107020000_seccionales.sql:92`) y `precios_visibles()` (`20261116500000_privilegios_precios.sql:42`). `is_admin()` aparece más de 50 veces en las migraciones.

La regla «global = cliente sin sucursal» está repetida:

- En las RPC (por ejemplo `precios_visibles()`, `alerta_configurar` y las de stock y montaje).
- En el panel, **once archivos con doce evaluaciones** de «cliente con `sucursalId` nulo» (inventario por `grep -rnE "currentSucursalId|puedeVerPrecios|puedeGestionarCostos|puedeConfigurar" assets/js`):
  - Vistas de gestión (`esAdmin() || (isClienteMode() && currentSucursalId === null)`): `assets/js/views/stock.js:39`, `recauchutado.js:18`, `cambio-neumatico.js:107` y `montar-neumatico.js:26`.
  - `assets/js/views/alertas.js:101` (`puedeConfigurar`): variante distinta, **excluye al admin** y exige `currentRol === 'cliente'`.
  - `assets/js/views/sucursales.js:61` (carga) y `:144` (visibilidad del menú Sucursales).
  - `assets/js/domain/costos.js:43-44` (`puedeGestionarCostos`); `assets/js/views/costos.js:15` solo la invoca.
  - `assets/js/domain/rol.js:12-13` (`puedeVerPrecios`), usada por `core/auth.js:19` y `core/precios.js:16,25`.
  - `assets/js/core/buscador.js:60` (el usuario de sucursal no busca en stock), `core/seccional.js:33` (selector de sucursal) y la etiqueta del rol en `core/auth.js:34`: las tres con la regla invertida (`!== null`).

### 2.3 Qué solo puede hacer hoy el `admin`

- Crear usuarios: la Edge Function `crear-usuario-seccional` exige `rol = 'admin'` (`supabase/functions/crear-usuario-seccional/handler.ts:79-86`; `index.ts:35-37` solo inyecta la dependencia `isAdmin`).
- Editar umbrales bajo, retiro, días sin medir e irregularidad: UPDATE directo sobre `clientes` desde la ficha de cliente (`assets/js/views/ficha-cliente.js:103`), amparado por la política `clientes_admin_all` (`init_schema.sql:455`). El nivel crítico y la histéresis ya los puede cambiar el perfil global con `alerta_configurar` (`20261118500000_alerta_critica.sql:454`).
- Ver Dispositivos: es la única vista registrada con `soloAdmin` (`assets/js/views/dispositivos.js:228`, mecanismo en `assets/js/core/nav.js:10`). **La ficha de cliente (`ficha-cliente.js:183`), Balance (`balance.js:194`) y Clientes (`clientes.js:172`) se registran sin `soloAdmin`**: las protege el menú y la RLS, no el router. La ficha se abre también en modo cliente (`ficha-cliente.js:23`, `activoId = currentClienteId`) y el cliente ve sus umbrales en solo lectura; la cuenta de API y las acciones de administración están dentro de esa misma ficha.
- Leer `ingesta_log` (política `ingesta_log_admin_select`, `init_schema.sql:520`) y `audit_log`.
- Leer y editar `precio_mensual` en Balance (`balance.js:18` y `:116`). **`precio_mensual` no es exclusivo del admin**: `clientes` tiene `grant select, insert, update, delete` de tabla completa a `authenticated` (`init_schema.sql:448`) y la política `clientes_self_select` (`:458`) deja leer la fila propia, de modo que el usuario global y el de sucursal pueden leer `precio_mensual` de su cliente por PostgREST. Ninguna migración posterior lo restringe (`grep -rn precio_mensual supabase/migrations`). La interfaz no lo muestra, pero la base sí lo entrega: la migración C2 lo cierra (sección 4.1).

No existe forma de quitar el acceso a un usuario.

### 2.4 Uso de la API hoy

- `ingesta_log` guarda las llamadas autenticadas, no el login (`/auth/login` lo atiende la función `login` de `supabase/functions/api-proveedor/handler.ts:144-162` sin registrar fila).
- Tiene índices por `recibido_at` y por `(device_id, recibido_at)` (`init_schema.sql:288-289`), no por `cliente_id`.
- No hay pantalla ni RPC de agregados de uso.
- El último ingreso de un usuario (`last_sign_in_at`) solo existe en `auth.users`, que el panel no lee.

### 2.5 Dónde se autoriza leyendo `perfiles` directamente

Quitar acceso solo es seguro si **todas** las rutas de autorización lo respetan. No basta con `current_cliente_id()`, `current_sucursal_id()` y `decidirRol`: estas funciones y la Edge Function leen `public.perfiles` por su cuenta (inventario por `grep -rn "from public.perfiles" supabase/migrations`, `grep -rn "perfiles" supabase/functions` y `grep -rn "perfiles" assets/js`). **El inventario debe estar completo**: la regla de la sección 8 («quitar acceso = borrar la fila») depende de que ninguna ruta lea `perfiles` sin que esté aquí; el PR 2 repite los `grep` y falla si aparece una ruta que no está en la tabla:

| Ruta | Dónde | Qué decide |
|---|---|---|
| `neumatico_autorizar_vehiculo` | `20261108000000_cambio_neumatico.sql:57` | Autoriza cambio, montaje, stock, quema, costos, recauchutado y alertas |
| `sucursal_autorizar_gestion` | `20261110010000_gestion_sucursales.sql:53` | Gestión de sucursales (`sucursal_crear`, etc.) |
| `medicion_autorizar` | `20261116000000_calidad_datos.sql:309` | Invalidar y revalidar mediciones; no estaba en el inventario del revisor |
| `km_tramos_cubierta` | `20261115000000_km_por_cubierta.sql:70` | Alcance de lectura de km por cubierta |
| `precios_visibles()` | `20261116500000_privilegios_precios.sql:50` | Muestra u oculta precios y costos |
| `costo_cubierta_items` | `20261117000000_costos_cpk.sql:237` | Costos por cubierta |
| `costo_vida_items` | `20261118000000_recauchutado_carcasa.sql:659` | Costos de vida de la carcasa |
| `alerta_configurar` | `20261118500000_alerta_critica.sql:480` | Escritura de umbrales |
| `is_admin()`, `current_cliente_id()` y `current_sucursal_id()` | `20261106000000_init_schema.sql:305` y `:319`; `20261107020000_seccionales.sql:99` | Base de casi todas las políticas RLS |
| `cuentas_api_listar` | `20261107010000_cuentas_api.sql:25` | Solo lista los perfiles `api` de un cliente; autoriza con `is_admin()`, no con `perfiles` |
| Trigger de auditoría `audit_row` | `20261106000000_init_schema.sql:356` | Solo rotula el rol del actor; no autoriza |
| Edge Function `crear-usuario-seccional` | `supabase/functions/crear-usuario-seccional/index.ts:35` | Exige `rol = 'admin'` con la clave de servicio |
| Edge Functions `crear-cliente` y `crear-cuenta-api` | `index.ts:35` y `index.ts:34` | Igual (exigen `admin`) |
| `crear-cuenta-api` (cuenta y alta del perfil `api`) | `crear-cuenta-api/index.ts:45` y `:60` | Cuenta los perfiles `api` del cliente y hace `upsert` del perfil; no autoriza |
| Edge Function `api-proveedor` | `supabase_deps.ts:81` (`getPerfil`), `handler.ts:160` (login) y `:173` (endpoints autenticados) | Acepta solo `rol = 'api'` con `cliente_id`; sin fila responde 401, es decir, falla cerrado |
| Panel, `resolverRol` | `assets/js/core/auth.js:42` | Lee el propio perfil; sin fila deja «Sin acceso» (salvo `clienteVinculado`, ver abajo) |

`sucursal_eliminar` solo cuenta perfiles (`20261110010000_gestion_sucursales.sql:169` y su redefinición en `20261113000000_stock_cubiertas.sql:436`; `stock_cubiertas` es el nombre de la migración, no de una función): un usuario sin perfil deja de contar, lo cual es el comportamiento buscado.

Además: hoy `current_sucursal_id()` nulo significa «global» (`20261107020000_seccionales.sql:92-100` devuelve nulo también para quien no tiene perfil de cliente). Es seguro únicamente porque toda política lo combina con `current_cliente_id()`, que sí es nulo sin perfil (comprobado por el revisor con `pg_policies`: ninguna política usa `current_sucursal_id()` sin `current_cliente_id()`). Una política nueva que lo use sin `current_cliente_id()` convertiría a un usuario sin acceso en «global»; la regla de la sección 8 lo prohíbe.

## 3. Modelo objetivo

Cuatro roles, sin duplicar. **El valor `'admin'` de la base no se renombra** (aparece en más de 50 referencias de políticas y funciones): en la documentación y en la interfaz significa «equipo Neumet».

| Rol (texto de interfaz) | Representación en la base | Alcance |
|---|---|---|
| Equipo Neumet | `rol = 'admin'` | **Solo mira** dentro de una empresa (P1). Vista completa de los neumáticos y el detalle de cada cliente, con precios y costos (P2). Clientes, primer administrador de empresa, dispositivos, cuentas de API, precio mensual y Balance, **Uso** por cliente, logs |
| Administrador de empresa | `rol = 'cliente'`, `sucursal_id` nulo | Todo lo del taller, más **Usuarios** (crear, asignar sucursal, quitar acceso), umbrales, sucursales, stock, costos, recauchutado. No ve `precio_mensual` (P2) |
| Usuario de sucursal | `rol = 'cliente'` con `sucursal_id` | Sin cambios; tampoco ve `precio_mensual` |
| Integración | `rol = 'api'` | Sin cambios |

Se agrega una única función `admin_empresa_cliente_id()` (`SECURITY DEFINER`) que devuelve el `cliente_id` del administrador de empresa o nulo. Las RPC nuevas la reutilizan en lugar de copiar la regla.

## 4. Cambios por capa

### 4.1 Base de datos

**Migración A: administración de empresa.**
- `admin_empresa_cliente_id()`.
- `usuarios_empresa_listar()`: usuarios del propio cliente con su alcance y su email. El email sale de `auth.users`, no de `perfiles.email`: esa columna se agregó sin relleno (`20261107020000_seccionales.sql:61`), la llena solo `crear-usuario-seccional` y queda nula para el primer usuario de cada cliente, que crea el trigger `clientes_sync_perfil` con `(user_id, rol, cliente_id)` (`init_schema.sql:407`). Se sigue el patrón de `cuentas_api_listar` (`20261107010000_cuentas_api.sql:12` y `join auth.users` en `:24-27`).
- Tabla `accesos_quitados` (auditoría de bajas): quién quitó, a quién (`user_id` y `email`, este último tomado de `auth.users` al quitar), cuándo, rol y sucursal previos, y cuándo y por quién se repuso. Además dos marcas del estado de Auth: `bloqueo_auth_aplicado_at` (la Edge Function aplicó el bloqueo) y `bloqueo_auth_levantado_at` (lo levantó al reponer). Sin escritura para `authenticated`; las dos marcas las escribe la Edge Function con la clave de servicio.
- **Acceso a `auth.users`**: las dos RPC (`usuarios_empresa_listar` y `usuario_empresa_quitar_acceso`) son `SECURITY DEFINER` y leen de `auth.users` únicamente el `email`, y solo de usuarios cuyo perfil pertenece al `cliente_id` de `admin_empresa_cliente_id()` del llamante; otros roles reciben `42501`. Fuera de ellas, el plan lee `auth.users` en `cuentas_api_listar` (solo equipo Neumet, ya existente) y en `uso_cerrar_mes` (`last_sign_in_at` agregado, sección 5); el panel no lo lee (sección 8).
- `usuario_empresa_quitar_acceso(...)` y `usuario_empresa_reponer_acceso(...)`: ver el mecanismo abajo. Rechazan otro cliente, los perfiles `admin` y `api`, a uno mismo y al último administrador de empresa vigente.
- Ampliar `alerta_configurar` con **todos** los umbrales que el panel escribe hoy: umbral bajo (`umbral_bajo_mm`), retiro (`umbral_retiro_mm`), días sin medir (`dias_sin_medir_alerta`) e **irregularidad (`irregularidad_mm`)**, además del crítico y la histéresis que ya acepta. Inventario completo: `CAMPOS_UMBRAL` (`assets/js/domain/umbrales.js:5-9`) lista cinco columnas, `ficha-cliente.js:15` arma `COLS` con ellas y `ficha-cliente.js:103` las escribe juntas en un UPDATE; la sexta, `alerta_histeresis_mm` (`20261118500000_alerta_critica.sql:49`), ya tiene RPC. Otras escrituras de `clientes` desde el panel: `nombre` (`clientes.js:151`) y `precio_mensual` (`balance.js:116`), que no son umbrales. `alerta_configurar` pasa a ser la vía de escritura de umbrales **solo cuando la migración C2 retire el UPDATE directo** (sección 4.1, migración C2); hasta entonces no es única.
- Auditoría con `actor_rol` `'admin_empresa'` o `'sucursal'` según corresponda.

*Mecanismo de «quitar acceso»: borrar la fila de `perfiles`.* Se elige borrar la fila, no marcarla con una columna de estado, porque **falla cerrado por construcción**: todas las rutas de la sección 2.5 ya niegan a quien no tiene fila (`not found` → `42501`, `precios_visibles()` falso, `is_admin()` falso, `current_cliente_id()` nulo) sin tocar ninguna. Con una columna `activo` habría que parchear cada ruta de la sección 2.5 y cada función futura que lea `perfiles` quedaría abierta si se olvida el filtro. Motivo en contra encontrado: ninguno concreto; el costo es que reponer exige los datos de la auditoría (por eso se guardan rol y sucursal previos). Comprobado con una sonda sobre un Postgres desechable con todas las migraciones: tras borrar la fila y poner `clientes.auth_user_id` en nulo, el trigger no recrea el perfil, las políticas devuelven 0 filas, `precios_visibles()` da falso y `sucursal_crear` y `alerta_configurar` responden `42501`.

Dos hechos del repo obligan a más que borrar la fila:
1. `decidirRol` (`assets/js/domain/rol.js:30-32`) cae en `clienteVinculado` si el usuario figura en `clientes.auth_user_id`: la interfaz mostraría un perfil global con datos vacíos en lugar de «Sin acceso».
2. El trigger `clientes_sync_perfil` (`init_schema.sql:399-419`) se dispara `after insert or update of auth_user_id` y solo inserta cuando `new.auth_user_id` no es nulo (`on conflict (user_id) do nothing`). Poner `auth_user_id` en nulo no lo activa; reasignar un usuario a un cliente sí recrea el perfil, y eso es una decisión explícita del equipo Neumet, no un efecto de la baja.

La RPC hace, en una sola transacción:
- (a) `update clientes set auth_user_id = null where id = <cliente> and auth_user_id = <usuario>`;
- (b) inserta la fila de `accesos_quitados` con rol y sucursal previos y el `email` de `auth.users`;
- (c) `delete from perfiles where user_id = <usuario>`.
La unicidad `clientes.auth_user_id` (`unique`, `init_schema.sql:64`) no se ve afectada. `usuario_empresa_reponer_acceso` reinserta el perfil desde la auditoría, con la sucursal destino como parámetro (la original pudo borrarse: `perfiles_sucursal_fk`, `20261107020000_seccionales.sql:73-76`, haría fallar la reposición), y marca la fila como repuesta. La RPC no toca Auth: el bloqueo lo levanta la Edge Function `reponer-acceso-usuario` (ver abajo).

*Concurrencia.* La RPC toma `select ... for update` sobre los perfiles **vigentes** del cliente con `rol = 'cliente'` y `sucursal_id` nulo (los administradores de empresa) antes de validar y de contar cuántos quedan, y cuenta solo esos (un usuario ya quitado no tiene fila, así que no puede inflar la cuenta). Dos administradores que se quitan a la vez se serializan sobre las mismas filas: la segunda transacción, al despertar, ya no ve la fila borrada, cuenta uno y falla. **El actor se valida después de tomar el bloqueo y dentro del conjunto bloqueado**: la RPC comprueba que su propia fila sigue entre los administradores bloqueados; con tres administradores, si A ya quitó a B, la transacción de B (que quiere quitar a C) despierta sin su fila y responde `42501`, en lugar de quitar a C en nombre de alguien que ya no es administrador. La prueba SQL incluye el caso concurrente con tres administradores y con dos, y el caso en que el último vigente queda frente a un administrador ya quitado, y el caso de tres administradores en que A quita a B mientras B quita a C (B recibe `42501`, C sigue vigente).

*Sesiones vivas y usuario de Auth.* Borrar la fila corta el acceso a datos de inmediato, aun con el JWT vigente (dura hasta su vencimiento). Para cerrar la sesión, la baja se hace desde una Edge Function nueva `quitar-acceso-usuario` (PR 3): valida el JWT de quien llama, invoca la RPC con ese mismo JWT (para que `auth.uid()` identifique al actor) y, solo si la RPC tuvo éxito, usa la clave de servicio para invalidar las sesiones del usuario quitado con la API de administración de Auth (por ejemplo bloquearlo con `ban_duration` en `auth.admin.updateUserById`, que impide renovar el refresh token). **El usuario de Auth no se borra**: conserva su historial y permite reponer el acceso, que levanta el bloqueo. Si la invalidación falla, el acceso a datos ya está cortado; la respuesta lo informa y la baja queda con `bloqueo_auth_aplicado_at` nulo, que es lo que permite reintentar: repetir la llamada, con la fila ya quitada, sin bloqueo aplicado y del cliente del llamante (comprobado con su JWT), aplica solo el bloqueo.

*Reponer.* La reposición es una segunda Edge Function, **`reponer-acceso-usuario`** (PR 3, junto a `quitar-acceso-usuario`): valida el JWT de quien llama, invoca `usuario_empresa_reponer_acceso` con ese mismo JWT y, **solo si la RPC tuvo éxito**, usa la clave de servicio para levantar el bloqueo (`ban_duration: 'none'`) y marca `bloqueo_auth_levantado_at`. Sin ese paso el usuario repuesto tendría perfil pero seguiría bloqueado en Auth y no podría iniciar sesión ni renovar el token. Si levantar el bloqueo falla, el perfil ya está repuesto: la respuesta lo informa y repetir la llamada, con la fila repuesta y `bloqueo_auth_levantado_at` nulo, solo reintenta el desbloqueo. Autoriza igual que la baja: `403` si el llamante no es administrador de empresa del mismo cliente.

La firma exacta de la API de Auth se confirma contra la versión de `supabase-js` fijada en `supabase/functions/deno.lock` al implementar el PR 3.

**Migración B: uso mensual por cliente.**
- Índice `ingesta_log (cliente_id, recibido_at desc)`.
- Tabla `uso_cliente_mensual` (una fila por cliente y mes, de por vida): llamadas a la API por endpoint y estado, logins a la API, mediciones, vehículos activos, dispositivos activos, usuarios y último ingreso. Sin escritura para `authenticated`.
- Función de cierre `uso_cerrar_mes(p_mes date)`, **idempotente** (`insert ... on conflict do update`) y definida por la migración sobre el mes anterior; la migración **no** hace `create extension pg_cron`: no hay mención de pg_cron en el repo (`grep -rniw cron docs supabase tests README.md .github` no da resultados fuera de este documento) y el Postgres 16 de CI (`tests/sql/run.sh` y e2e) no lo trae, así que romperían sql y e2e. La programación es un **paso operativo aparte del runbook** (`docs/11`), condicional a que la extensión esté habilitada en `kootszosdejmawanfxug`. El cierre no depende del día 1: en el plan Free el proyecto puede pausarse por inactividad (`docs/03-despliegue-vercel-supabase.md:80`), así que la programación diaria cierra todo mes anterior aún no cerrado, y el cierre se prueba sin cron llamando a la función. Es la única fuente permanente del uso: la retención de `ingesta_log` pasa a ser un detalle operativo.
- Recalcular un mes pasado **no es fiel en todo**: vehículos activos, dispositivos activos, usuarios y último ingreso son fotos del momento del cierre. Solo las métricas de `ingesta_log` (llamadas a la API por endpoint y estado, logins) y de `mediciones` se recalculan exactamente.
- RPC `uso_clientes` y `uso_cliente_mensual`, solo para el equipo Neumet.

**Migración C1: RPC del precio mensual (retrocompatible).**
- RPC `SECURITY DEFINER` solo para el equipo Neumet que lee y escribe `precio_mensual`, con el patrón de `neumaticos_precios()` (`20261116500000_privilegios_precios.sql:68`). No quita nada: el front vigente sigue funcionando.
- El PR del front de Balance sobre esa RPC se fusiona **después** de aplicar C1 y verificarla (regla «migración aplicada y verificada → recién entonces se fusiona el front»).

**Migración C2: privilegios y alcance de solo lectura para el equipo Neumet.** Se aplica solo cuando el front de Balance ya usa la RPC de C1 (si no, `balance.js:18` y `:116` recibirían `42501`).
- Recortar las ramas `is_admin()` de **escritura** de las RPC operativas (P1), incluida la rama de admin de `alerta_configurar`. La lectura del admin se conserva, incluido el detalle de neumáticos con precios y costos (P2).
- `clientes`: hoy `authenticated` tiene `grant select, insert, update, delete` de tabla completa (`init_schema.sql:448`) y la política `clientes_admin_all` (`:455`) es por fila, no por columna: **una política no se limita por columna**. Revocar `update (col)` solo sobre algunas columnas no sirve mientras exista el privilegio de tabla. El mecanismo es el de la migración de precios (`20261116500000_privilegios_precios.sql:120-133`): `revoke select, update on public.clientes from authenticated` y volver a otorgar `grant select (<lista>)` y `grant update (nombre, auth_user_id)` solo con las columnas que corresponden, sin `precio_mensual` y sin `umbral_bajo_mm`, `umbral_critico_mm`, `umbral_retiro_mm`, `dias_sin_medir_alerta`, `irregularidad_mm` ni `alerta_histeresis_mm` para escritura. El equipo Neumet conserva por UPDATE directo: alta (INSERT), `auth_user_id` y `nombre` (la baja lógica ya va por RPC, `clientes.js:41`); el `precio_mensual` pasa por la RPC de C1. Los umbrales los escribe solo `alerta_configurar`. Un test (como `t_90`) falla si queda una columna de `clientes` sin otorgar.
- `precio_mensual` (hoy expuesto en lectura, sección 2.3): se excluye del `grant select (<lista>)`. Los privilegios por columna se dan al rol `authenticated`, que comparten el admin y el cliente: por eso Balance debe estar ya sobre la RPC de C1. Revisar que ninguna consulta del panel haga `select('*')` sobre `clientes` (hoy ninguna lo hace).

### 4.2 Edge Functions

- `crear-usuario-seccional` se abre al administrador de empresa. El `cliente_id` sale de su perfil, nunca del cuerpo de la petición; responde 403 si el cuerpo trae uno distinto. Nunca crea perfiles `admin` ni `api`. Sin límite de administradores (P4), el administrador de empresa **puede crear otros administradores de empresa** (usuario sin `sucursal_id`); es intencional, y cada alta queda en la auditoría.
- `quitar-acceso-usuario` y `reponer-acceso-usuario` (nuevas; sección 4.1): invocan la RPC con el JWT de quien llama y, solo si tuvo éxito, bloquean o desbloquean al usuario de Auth.
- `crear-usuario-seccional`: cuando el email ya existe (409, `handler.ts:140`) y corresponde a un usuario con acceso quitado en `accesos_quitados` del mismo cliente (consulta con la clave de servicio), el mensaje orienta a «Reponer acceso» en lugar de «Ya existe un usuario con ese email»; si el usuario es de otro cliente o no figura, el mensaje sigue siendo el genérico, para no revelar usuarios ajenos.
- `api-proveedor` registra también el login en `ingesta_log` (función `login`, `handler.ts:144-162`); si falla, la fila queda sin cuenta identificada.

### 4.3 Panel

- Menú **Plataforma** para el equipo Neumet: Clientes, Uso, Dispositivos, Mediciones, Balance. La ficha de cliente muestra datos, precio, administrador de empresa, cuenta de API, dispositivos y uso; umbrales y sucursales en solo lectura (P1).
- Menú **Empresa** para el administrador de empresa: Usuarios, Umbrales y **Dispositivos de la empresa en solo lectura** (P6). Hoy la vista Dispositivos es `soloAdmin` (`dispositivos.js:228`) y escribe directo en `dispositivos` (`:200`, `:218`); el administrador de empresa no puede reutilizarla. Se agrega una vista de solo lectura sobre `v_salud_dispositivos` (RLS ya filtra por cliente) en el PR 4, sin acciones de alta, edición ni baja.
- `esAdminEmpresa()` único en `assets/js/domain/rol.js`, que reemplaza las copias de la regla del inventario de la sección 2.2; opción `soloEmpresa` en el router, junto a `soloAdmin`.
- Router: registrar con `soloAdmin` la ficha de cliente, Balance y Clientes (hoy sin él, sección 2.3), de modo que el cliente deje de abrir la ficha; los umbrales de la empresa se editan desde Empresa, no desde la ficha.
- Textos de interfaz: «Equipo Neumet», «Administrador de empresa», «Usuario de sucursal».

## 5. Datos de uso por cliente

Uso = API, dispositivos, vehículos, mediciones y último ingreso (P5). **No es para facturar**: son métricas para mostrar valor al cliente.

Para cada cliente y mes: vehículos activos; dispositivos activos (asignados y con medición en el mes, `v_salud_dispositivos`); mediciones; llamadas a la API por endpoint y estado; logins a la API; usuarios y fecha del último ingreso. El uso mes a mes se **almacena de forma permanente** en `uso_cliente_mensual` (migración B), llenada por la función de cierre (programada con pg_cron en un paso operativo, ver migración B) y recalculable solo en lo que sale de `ingesta_log` y `mediciones`; vehículos, dispositivos, usuarios y último ingreso son fotos del cierre. Los agregados salen de RPC `SECURITY DEFINER` que solo autorizan al equipo Neumet; el panel no lee `auth.users`.

Retención de `ingesta_log` (detalle operativo, propuesta): 13 meses, sin borrar un mes que aún no esté cerrado en `uso_cliente_mensual`.

## 6. Migración de usuarios

Nadie queda afuera: el valor `admin` no cambia y el usuario del cliente Demo ya es global. Antes de la migración C2 se comprueba con SQL que cada cliente vigente tiene al menos un administrador de empresa. Nunca se «suplanta» a un usuario para probar.

## 7. Decisiones

Todas las decisiones del dueño están tomadas; no queda pregunta abierta.

| Id | Decisión |
|---|---|
| P1 | El equipo Neumet **solo mira** dentro de una empresa; no opera. Fija la migración C2 (recortar las ramas `is_admin()` de escritura de las RPC operativas) y el PR 9 (ficha de cliente, umbrales y sucursales en solo lectura para Neumet) |
| P2 | Neumet tiene vista completa de todos los neumáticos de cada cliente, incluido el detalle; el admin conserva su lectura de precios y costos. El cliente (usuario global y de sucursal) **no ve su `precio_mensual`**, dato interno de Neumet |
| P3 | Todos los usuarios que ven la empresa completa son administradores. Sin rol «gerente solo lectura» por ahora |
| P4 | Sin límite de administradores por cliente por ahora |
| P5 | «Uso» = API, dispositivos, vehículos, mediciones y último ingreso. No es para facturar. El uso mes a mes de cada cliente se almacena de forma permanente |
| P6 | El administrador de empresa ve sus dispositivos en solo lectura (menú Empresa, PR 4; sección 4.3) |
| P7 | La cuenta de API la crea solo el equipo Neumet |

## 8. Riesgos y reglas

- **No agregar políticas de escritura sobre `perfiles` ni `clientes` para la empresa.** Permitiría cambiar un perfil a `rol = 'admin'` (escalada de privilegios) o modificar `precio_mensual`. Hoy `precio_mensual` ya está expuesto en lectura al cliente (sección 2.3); la migración C2 lo cierra. Todo cambio de usuarios pasa por RPC o Edge Function.
- RPC nuevas `SECURITY DEFINER` con `search_path = ''`, `revoke` a `public` y `anon`, y `42501` uniforme para cualquier rol no autorizado.
- No leer metadatos de `auth.users` desde el panel.
- Bloqueo de acceso (lockout): el último administrador de empresa vigente no se puede quitar, con `for update` sobre los perfiles vigentes para resistir la concurrencia (sección 4.1); un perfil `admin` no se borra desde el panel.
- **Quitar acceso = borrar la fila de `perfiles`.** Ninguna ruta de autorización nueva ni existente puede depender de un indicador de estado en `perfiles`: la negación debe venir de la ausencia de fila. Una política o función nueva que lea `current_sucursal_id()` debe combinarlo con `current_cliente_id()` (sección 2.5).
- La extensión `pg_cron` **no está confirmada en producción**: antes de la migración B, `neumet-operativo` o el DBA lo comprueba con `list_extensions` sobre `kootszosdejmawanfxug`. Si no está, el cierre se invoca de otra forma (p. ej. una Edge Function programada) y el plan se ajusta.
- MFA (`aal2`) obligatorio para el equipo Neumet, en un PR propio, después de enrolar al dueño.
- **La baja lógica de un cliente deja viva su cuenta `api`.** `cliente_eliminar_suave` (`20261106020000_producto_vistas.sql:311-314`) solo marca `clientes.deleted_at` y desactiva vehículos y dispositivos, no toca `perfiles`, y `api-proveedor` no consulta `deleted_at` (`supabase_deps.ts:81` selecciona solo `rol,cliente_id`). Decisión: `api-proveedor` rechaza (mismo 401 que sin perfil) a las cuentas cuyo cliente tiene `deleted_at` no nulo, tanto en el login (`handler.ts:160`) como en cada llamada (`handler.ts:173`), por lo que también corta los tokens ya emitidos. Se prefiere a borrar el perfil `api` porque no cambia estado (es idempotente: repetir la baja no hace nada nuevo), falla cerrado y, si el cliente se reactivara (`deleted_at` en nulo; hoy no existe esa operación), la cuenta vuelve a funcionar sin recrearla ni tocar sus credenciales. Va en el PR 5 (que ya modifica `login` de `api-proveedor`) con prueba. Al fusionarse, quitar la línea «La baja de un cliente no desactiva su perfil `api`» de `docs/10`.

## 9. Orden de PR

Sin dependencias abiertas: todas las decisiones están tomadas.

| PR | Contenido |
|---|---|
| 1 | Este documento y la actualización de docs/08 §4, docs/12 y el índice |
| 2 | Migración A (incluye `accesos_quitados` con sus marcas de Auth, quitar y reponer acceso y la ampliación de `alerta_configurar`) y prueba SQL `t_93_admin_empresa` (incluye el caso concurrente y la matriz de la sección 10) |
| 3 | Edge Functions: `crear-usuario-seccional` abierta al administrador de empresa (con el 409 orientado a reponer), `quitar-acceso-usuario` y `reponer-acceso-usuario` |
| 4 | Panel «Empresa» (incluye Dispositivos en solo lectura), `esAdminEmpresa()` y `soloEmpresa`; el router cierra con `soloAdmin` la ficha, Balance y Clientes |
| 5 | `api-proveedor`: login en `ingesta_log` (antes de la migración B, para que el primer cierre mensual ya cuente logins) y rechazo de cuentas `api` de clientes con `deleted_at` (sección 8) |
| 6 | Migración B (índice, `uso_cliente_mensual`, función de cierre sin cron, RPC de uso) y prueba `t_94`; paso operativo posterior: programar el cierre si pg_cron está habilitado |
| 7 | Pantalla «Uso» |
| 8 | Migración C1 (RPC del precio mensual, retrocompatible) |
| 9 | Front de Balance sobre la RPC de C1 y ficha de cliente, umbrales y sucursales en solo lectura para Neumet; se fusiona con C1 ya aplicada y verificada |
| 10 | Migración C2 (privilegios por columna sobre `clientes` y escritura recortada) y prueba SQL; solo con el PR 9 fusionado |
| 11 | MFA obligatorio para el equipo Neumet y sincronización final de docs y runbook: `docs/05-roadmap.md:59`, `README.md:197` y `docs/08` §5 punto 9 listan «¿un cliente tendrá más de un usuario?» como decisión abierta o 1:1 y quedan desactualizados; también `docs/10` y `docs/16` |

En serie, una sola migración en producción a la vez (A, B, C1 y C2 nunca se solapan).

`docs/10` y `docs/16` enlazan a este plan con estado «planificado»; `CLAUDE.md` no se toca.

## 10. Pruebas requeridas

- Matriz SQL por rol: equipo Neumet, administrador de la empresa Demo, administrador de otra empresa, usuario de sucursal, `api`, sin perfil y `anon`. **Se genera desde `pg_proc`**: todas las funciones `SECURITY DEFINER` del esquema `public` con `execute` para `authenticated`, de modo que una función nueva sin caso en la matriz hace fallar la prueba. Cubre, entre otras, `sucursal_crear`, `sucursal_eliminar`, `alerta_configurar`, `alerta_reconocer`, `alerta_silenciar`, `alerta_resolver`, `neumatico_rotar`, `vehiculo_crear`, `vehiculo_mover_sucursal`, `vehiculo_registrar_odometro`, cambio, montaje, stock, quema, costos, recauchutado y `medicion_autorizar`. Incluye que global y sucursal no lean `precio_mensual` tras la migración C2, y que el equipo Neumet no escriba en las RPC operativas.
- Inventario de la sección 2.5: los `grep` de esa sección se ejecutan en la prueba y fallan si encuentran una ruta que lee `perfiles` y no figura en la tabla.
- Quitar acceso: el usuario queda «Sin acceso» aunque figure en `clientes.auth_user_id` (la RPC lo pone en nulo); el trigger `clientes_sync_perfil` no recrea el perfil; dos quitas simultáneas no dejan la empresa sin administrador, también cuando uno de los dos ya estaba quitado; con tres administradores, A quita a B mientras B quita a C: B recibe `42501` y C sigue vigente; reponer acceso con una sucursal borrada exige otra sucursal.
- Email: el primer usuario de un cliente (creado por `crear-cliente`, `perfiles.email` nulo) se quita y `accesos_quitados.email` trae su email real de `auth.users`; `usuarios_empresa_listar()` lo muestra con email. Un usuario de otro cliente o un rol no autorizado no obtiene ningún email (`42501` o 0 filas).
- Baja y reposición con Auth (prueba de handler con Auth simulado y e2e): quitar acceso aplica el bloqueo y marca `bloqueo_auth_aplicado_at`; si el bloqueo falla, la respuesta lo informa, la marca queda nula y el reintento lo aplica; reponer acceso levanta el bloqueo y marca `bloqueo_auth_levantado_at`; si la RPC falla (por ejemplo sucursal borrada sin otra elegida) el bloqueo **no** se levanta; si levantarlo falla, repetir la llamada solo reintenta el desbloqueo. E2E: baja, reposición y el usuario vuelve a iniciar sesión y a operar su sucursal.
- Cuenta `api` de cliente dado de baja: tras `cliente_eliminar_suave`, `/auth/login` y las llamadas con un token emitido antes responden 401 (prueba de handler y e2e); con `deleted_at` en nulo, la misma cuenta vuelve a autenticarse.
- Matriz «usuario sin acceso con JWT vigente» (se baja al usuario y se sigue usando el mismo JWT). El resultado esperado depende de la ruta, no es siempre `42501`:

| Ruta | Resultado esperado |
|---|---|
| RPC de escritura: `sucursal_crear`, `alerta_configurar`, cambio, montaje, stock, quema, costos, recauchutado, `medicion_autorizar` (invalidar y revalidar) | `42501` |
| Lectura de precios: `precios_visibles()` (falso), `neumaticos_precios()`, `eventos_costos()`, `costo_cubierta_items`, `costo_vida_items`, `km_tramos_cubierta` | falso o 0 filas, sin error de datos |
| SELECT por RLS de tablas operativas | 0 filas |
| `crear-usuario-seccional`, `quitar-acceso-usuario` y `reponer-acceso-usuario` | `403` |

Es un caso por rol quitado: administrador de empresa, usuario de sucursal.
- UPDATE e INSERT directos sobre `perfiles` y `clientes` por la empresa: 0 filas afectadas.
- Idempotencia: cada migración aplicada dos veces sin errores.
- Pruebas del handler de `crear-usuario-seccional`: 403 con `cliente_id` ajeno, 403 con sucursal ajena, rechazo de rol sucursal y `api`, nunca crea `admin` ni `api`; 409 con el mensaje de «Reponer acceso» solo para un quitado del mismo cliente.
- E2E: el administrador crea un usuario de sucursal, este entra y ve solo su sucursal, se le quita el acceso y pasa a ver «Sin acceso»; el equipo Neumet ve «Uso».
