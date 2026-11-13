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
- Leer y editar `precio_mensual` en Balance (`balance.js:18` y `:116`). **`precio_mensual` no es exclusivo del admin**: `clientes` tiene `grant select, insert, update, delete` de tabla completa a `authenticated` (`init_schema.sql:448`) y la política `clientes_self_select` (`:458`) deja leer la fila propia, de modo que el usuario global y el de sucursal pueden leer `precio_mensual` de su cliente por PostgREST. Ninguna migración posterior lo restringe (`grep -rn precio_mensual supabase/migrations`). La interfaz no lo muestra, pero la base sí lo entrega: la migración C lo cierra (sección 4.1).

No existe forma de quitar el acceso a un usuario.

### 2.4 Uso de la API hoy

- `ingesta_log` guarda las llamadas autenticadas, no el login (`/auth/login` lo atiende la función `login` de `supabase/functions/api-proveedor/handler.ts:144-162` sin registrar fila).
- Tiene índices por `recibido_at` y por `(device_id, recibido_at)` (`init_schema.sql:288-289`), no por `cliente_id`.
- No hay pantalla ni RPC de agregados de uso.
- El último ingreso de un usuario (`last_sign_in_at`) solo existe en `auth.users`, que el panel no lee.

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
- `usuarios_empresa_listar()`: usuarios del propio cliente con su alcance.
- `usuario_empresa_quitar_acceso(...)`: ver el mecanismo abajo. No borra el usuario de Auth; deja registro en la auditoría; rechaza otro cliente, los perfiles `admin` y `api`, a uno mismo y al último administrador de empresa.
- Ampliar `alerta_configurar` con umbral bajo, retiro y días sin medir. Pasa a ser la vía de escritura de umbrales **solo cuando la migración C retire el UPDATE directo** de `clientes_admin_all` (el que usa `ficha-cliente.js:103`); hasta entonces no es única.
- Auditoría con `actor_rol` `'admin_empresa'` o `'sucursal'` según corresponda.

*Mecanismo de «quitar acceso».* Borrar la fila de `perfiles` no alcanza, por dos hechos verificables:
1. `decidirRol` (`assets/js/domain/rol.js:30-32`) cae en `clienteVinculado` si el usuario figura en `clientes.auth_user_id`: la interfaz mostraría un perfil global con datos vacíos en lugar de «Sin acceso».
2. El trigger `clientes_sync_perfil` (`init_schema.sql:399-419`, `after insert or update of auth_user_id`) recrea el perfil `cliente` ante un UPDATE de `auth_user_id`.

Propuesta: la RPC **no borra** la fila: la deja en un estado explícito «sin acceso» (columna nueva en `perfiles`, por ejemplo `activo boolean not null default true`), que `current_cliente_id()`, `current_sucursal_id()` y `decidirRol` tratan como sin perfil; y, en la misma transacción, pone `clientes.auth_user_id` en nulo si coincidía con el usuario quitado. Así el trigger no tiene qué recrear (`on conflict (user_id) do nothing` deja intacto el estado «sin acceso») y la interfaz muestra «Sin acceso». Reactivar es otra RPC explícita.

*Concurrencia.* La RPC toma `select ... for update` sobre los perfiles de administrador del cliente antes de contar los que quedan, para que dos administradores que se quitan el acceso a la vez no dejen la empresa sin ninguno. La prueba SQL incluye un caso concurrente (dos sesiones, la segunda debe fallar).

**Migración B: uso mensual por cliente.**
- Índice `ingesta_log (cliente_id, recibido_at desc)`.
- Tabla `uso_cliente_mensual` (una fila por cliente y mes, de por vida): llamadas a la API por endpoint y estado, logins a la API, mediciones, vehículos activos, dispositivos activos, usuarios y último ingreso. Sin escritura para `authenticated`.
- Función de cierre mensual, invocada por **pg_cron** el primer día del mes; recalculable para un mes dado desde `ingesta_log` y las tablas operativas. Es la única fuente permanente del uso: la retención de `ingesta_log` pasa a ser un detalle operativo.
- RPC `uso_clientes` y `uso_cliente_mensual`, solo para el equipo Neumet.

**Migración C: privilegios y alcance de solo lectura para el equipo Neumet.**
- Recortar las ramas `is_admin()` de **escritura** de las RPC operativas (P1) y retirar el UPDATE directo de `clientes_admin_all` sobre umbrales. La lectura del admin se conserva, incluido el detalle de neumáticos con precios y costos (P2).
- `precio_mensual` (hoy expuesto, sección 2.3): revocar SELECT y UPDATE de la columna a `authenticated` con privilegios por columna. Los privilegios por columna se dan al rol `authenticated`, que **comparten el admin y el cliente**: revocar la columna corta también Balance (`balance.js:18`, lectura) y su UPDATE (`balance.js:116`). Por eso la migración C incluye una RPC `SECURITY DEFINER` solo para el equipo Neumet (lectura y escritura del precio), con el patrón de `neumaticos_precios()` (`20261116500000_privilegios_precios.sql:68`), y el PR adapta Balance a esa RPC. Revisar que ninguna consulta del panel haga `select('*')` sobre `clientes` (hoy ninguna lo hace).

### 4.2 Edge Functions

- `crear-usuario-seccional` se abre al administrador de empresa. El `cliente_id` sale de su perfil, nunca del cuerpo de la petición; responde 403 si el cuerpo trae uno distinto. Nunca crea perfiles `admin` ni `api`. Sin límite de administradores (P4), el administrador de empresa **puede crear otros administradores de empresa** (usuario sin `sucursal_id`); es intencional, y cada alta queda en la auditoría.
- `api-proveedor` registra también el login en `ingesta_log` (función `login`, `handler.ts:144-162`); si falla, la fila queda sin cuenta identificada.

### 4.3 Panel

- Menú **Plataforma** para el equipo Neumet: Clientes, Uso, Dispositivos, Mediciones, Balance. La ficha de cliente muestra datos, precio, administrador de empresa, cuenta de API, dispositivos y uso; umbrales y sucursales en solo lectura (P1).
- Menú **Empresa** para el administrador de empresa: Usuarios y Umbrales.
- `esAdminEmpresa()` único en `assets/js/domain/rol.js`, que reemplaza las copias de la regla del inventario de la sección 2.2; opción `soloEmpresa` en el router, junto a `soloAdmin`.
- Router: registrar con `soloAdmin` la ficha de cliente, Balance y Clientes (hoy sin él, sección 2.3), de modo que el cliente deje de abrir la ficha; los umbrales de la empresa se editan desde Empresa, no desde la ficha.
- Textos de interfaz: «Equipo Neumet», «Administrador de empresa», «Usuario de sucursal».

## 5. Datos de uso por cliente

Uso = API, dispositivos, vehículos, mediciones y último ingreso (P5). **No es para facturar**: son métricas para mostrar valor al cliente.

Para cada cliente y mes: vehículos activos; dispositivos activos (asignados y con medición en el mes, `v_salud_dispositivos`); mediciones; llamadas a la API por endpoint y estado; logins a la API; usuarios y fecha del último ingreso. El uso mes a mes se **almacena de forma permanente** en `uso_cliente_mensual` (migración B), llenada por un cierre mensual automático con pg_cron y recalculable desde `ingesta_log`. Los agregados salen de RPC `SECURITY DEFINER` que solo autorizan al equipo Neumet; el panel no lee `auth.users`.

Retención de `ingesta_log` (detalle operativo, propuesta): 13 meses, sin borrar un mes que aún no esté cerrado en `uso_cliente_mensual`.

## 6. Migración de usuarios

Nadie queda afuera: el valor `admin` no cambia y el usuario del cliente Demo ya es global. Antes de la migración C se comprueba con SQL que cada cliente vigente tiene al menos un administrador de empresa. Nunca se «suplanta» a un usuario para probar.

## 7. Decisiones

Todas las decisiones del dueño están tomadas; no queda pregunta abierta.

| Id | Decisión |
|---|---|
| P1 | El equipo Neumet **solo mira** dentro de una empresa; no opera. Fija la migración C (recortar las ramas `is_admin()` de escritura de las RPC operativas) y el PR 8 (ficha de cliente, umbrales y sucursales en solo lectura para Neumet) |
| P2 | Neumet tiene vista completa de todos los neumáticos de cada cliente, incluido el detalle; el admin conserva su lectura de precios y costos. El cliente (usuario global y de sucursal) **no ve su `precio_mensual`**, dato interno de Neumet |
| P3 | Todos los usuarios que ven la empresa completa son administradores. Sin rol «gerente solo lectura» por ahora |
| P4 | Sin límite de administradores por cliente por ahora |
| P5 | «Uso» = API, dispositivos, vehículos, mediciones y último ingreso. No es para facturar. El uso mes a mes de cada cliente se almacena de forma permanente |
| P6 | El administrador de empresa ve sus dispositivos en solo lectura |
| P7 | La cuenta de API la crea solo el equipo Neumet |

## 8. Riesgos y reglas

- **No agregar políticas de escritura sobre `perfiles` ni `clientes` para la empresa.** Permitiría cambiar un perfil a `rol = 'admin'` (escalada de privilegios) o modificar `precio_mensual`. Hoy `precio_mensual` ya está expuesto en lectura al cliente (sección 2.3); la migración C lo cierra. Todo cambio de usuarios pasa por RPC o Edge Function.
- RPC nuevas `SECURITY DEFINER` con `search_path = ''`, `revoke` a `public` y `anon`, y `42501` uniforme para cualquier rol no autorizado.
- No leer metadatos de `auth.users` desde el panel.
- Bloqueo de acceso (lockout): el último administrador de empresa no se puede quitar, con `for update` sobre sus perfiles para resistir la concurrencia (sección 4.1); un perfil `admin` no se borra desde el panel.
- MFA (`aal2`) obligatorio para el equipo Neumet, en un PR propio, después de enrolar al dueño.
- La baja de un cliente no desactiva su perfil `api`: se resuelve junto con el retiro de acceso.

## 9. Orden de PR

En serie, una migración a la vez. Sin dependencias abiertas: todas las decisiones están tomadas.

| PR | Contenido |
|---|---|
| 1 | Este documento y la actualización de docs/08 §4, docs/12 y el índice |
| 2 | Migración A y prueba SQL `t_93_admin_empresa` (incluye el caso concurrente) |
| 3 | `crear-usuario-seccional` abierta al administrador de empresa |
| 4 | Panel «Empresa», `esAdminEmpresa()` y `soloEmpresa`; el router cierra con `soloAdmin` la ficha, Balance y Clientes |
| 5 | Login de `api-proveedor` en `ingesta_log` (antes de la migración B, para que el primer cierre mensual ya cuente logins) |
| 6 | Migración B (índice, `uso_cliente_mensual`, cierre con pg_cron, RPC de uso) y prueba `t_94` |
| 7 | Pantalla «Uso» |
| 8 | Migración C (escritura recortada, `precio_mensual` por columna y RPC solo Neumet) y, en el mismo PR, ficha de cliente, umbrales y sucursales en solo lectura para Neumet, y Balance sobre la RPC |
| 9 | MFA obligatorio para el equipo Neumet y sincronización final de docs y runbook: `docs/05-roadmap.md:59`, `README.md:197` y `docs/08` §5 punto 9 listan «¿un cliente tendrá más de un usuario?» como decisión abierta o 1:1 y quedan desactualizados; también `docs/10` y `docs/16` |

El PR 1 no toca `docs/10`, `docs/16` ni `CLAUDE.md` (hay otro PR abierto sobre ellos); esos archivos se actualizan con este plan después.

## 10. Pruebas requeridas

- Matriz SQL por rol: equipo Neumet, administrador de la empresa Demo, administrador de otra empresa, usuario de sucursal, `api`, sin perfil y `anon`. Incluye que global y sucursal no lean `precio_mensual` tras la migración C, y que el equipo Neumet no escriba en las RPC operativas.
- Quitar acceso: el usuario queda «Sin acceso» aunque figure en `clientes.auth_user_id`, y un UPDATE posterior de `auth_user_id` no lo reactiva; dos quitas simultáneas no dejan la empresa sin administrador.
- UPDATE e INSERT directos sobre `perfiles` y `clientes` por la empresa: 0 filas afectadas.
- Idempotencia: cada migración aplicada dos veces sin errores.
- Pruebas del handler de `crear-usuario-seccional`: 403 con `cliente_id` ajeno, 403 con sucursal ajena, rechazo de rol sucursal y `api`, nunca crea `admin` ni `api`.
- E2E: el administrador crea un usuario de sucursal, este entra y ve solo su sucursal, se le quita el acceso y pasa a ver «Sin acceso»; el equipo Neumet ve «Uso».
