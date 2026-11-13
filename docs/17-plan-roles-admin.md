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
- En cinco vistas del panel, cada una con su propia copia: `assets/js/views/stock.js:39`, `recauchutado.js:18`, `cambio-neumatico.js:107`, `montar-neumatico.js:26` y `costos.js:15` (esta última vía `puedeGestionarCostos`). Además, `assets/js/domain/rol.js` (`puedeVerPrecios`).

### 2.3 Qué solo puede hacer hoy el `admin`

- Crear usuarios: la Edge Function `crear-usuario-seccional` exige `rol = 'admin'` (`supabase/functions/crear-usuario-seccional/index.ts:35-37`).
- Editar umbrales bajo, retiro, días sin medir e irregularidad: UPDATE directo sobre `clientes` desde la ficha de cliente (`assets/js/views/ficha-cliente.js:103`), amparado por la política `clientes_admin_all` (`init_schema.sql:455`). El nivel crítico y la histéresis ya los puede cambiar el perfil global con `alerta_configurar` (`20261118500000_alerta_critica.sql:454`).
- Ver la ficha de cliente, la cuenta de API, Dispositivos y Balance (`registerView(..., { soloAdmin: true })`, `assets/js/core/nav.js:10`); `precio_mensual` vive en `clientes`.
- Leer `ingesta_log` (política `ingesta_log_admin_select`, `init_schema.sql:519`).

No existe forma de quitar el acceso a un usuario.

### 2.4 Uso de la API hoy

- `ingesta_log` guarda las llamadas autenticadas, no el login (`/auth/login` se atiende en `supabase/functions/api-proveedor/handler.ts:132-156` sin registrar fila).
- Tiene índices por `recibido_at` y por `(device_id, recibido_at)` (`init_schema.sql:288-289`), no por `cliente_id`.
- No hay pantalla ni RPC de agregados de uso.
- El último ingreso de un usuario (`last_sign_in_at`) solo existe en `auth.users`, que el panel no lee.

## 3. Modelo objetivo

Cuatro roles, sin duplicar. **El valor `'admin'` de la base no se renombra** (aparece en más de 50 referencias de políticas y funciones): en la documentación y en la interfaz significa «equipo Neumet».

| Rol (texto de interfaz) | Representación en la base | Alcance |
|---|---|---|
| Equipo Neumet | `rol = 'admin'` | Clientes, primer administrador de empresa, dispositivos, cuentas de API, precio mensual y Balance, **Uso** por cliente, logs |
| Administrador de empresa | `rol = 'cliente'`, `sucursal_id` nulo | Todo lo del taller, más **Usuarios** (crear, asignar sucursal, quitar acceso), umbrales, sucursales, stock, costos, recauchutado |
| Usuario de sucursal | `rol = 'cliente'` con `sucursal_id` | Sin cambios |
| Integración | `rol = 'api'` | Sin cambios |

Se agrega una única función `admin_empresa_cliente_id()` (`SECURITY DEFINER`) que devuelve el `cliente_id` del administrador de empresa o nulo. Las RPC nuevas la reutilizan en lugar de copiar la regla.

### 3.1 Decisiones tomadas por el director

| Id | Decisión |
|---|---|
| P3 | Todos los usuarios que ven la empresa completa son administradores. Sin rol «gerente solo lectura» por ahora |
| P4 | Sin límite de administradores por cliente por ahora |
| P6 | El administrador de empresa ve sus dispositivos en solo lectura |
| P7 | La cuenta de API la crea solo el equipo Neumet |

## 4. Cambios por capa

### 4.1 Base de datos

**Migración A: administración de empresa.**
- `admin_empresa_cliente_id()`.
- `usuarios_empresa_listar()`: usuarios del propio cliente con su alcance.
- `usuario_empresa_quitar_acceso(...)`: no borra el usuario de Auth; deja registro en la auditoría; rechaza otro cliente, los perfiles `admin` y `api`, a uno mismo y al último administrador de empresa.
- Ampliar `alerta_configurar` con umbral bajo, retiro y días sin medir, como **única** vía de escritura de umbrales.
- Auditoría con `actor_rol` `'admin_empresa'` o `'sucursal'` según corresponda.

**Migración B: uso por cliente.**
- Índice `ingesta_log (cliente_id, recibido_at desc)`.
- RPC `uso_clientes` y `uso_cliente_diario`, solo para el equipo Neumet.

**Migración C: privilegios.**
- Privilegios por columna: `precio_mensual` sin SELECT para el cliente.
- Recortar las ramas `is_admin()` de las RPC operativas, según la respuesta a P1 (sección 7).

### 4.2 Edge Functions

- `crear-usuario-seccional` se abre al administrador de empresa. El `cliente_id` sale de su perfil, nunca del cuerpo de la petición; responde 403 si el cuerpo trae uno distinto. Nunca crea perfiles `admin` ni `api`.
- `api-proveedor` registra también el login en `ingesta_log`; si falla, la fila queda sin cuenta identificada.

### 4.3 Panel

- Menú **Plataforma** para el equipo Neumet: Clientes, Uso, Dispositivos, Mediciones, Balance. La ficha de cliente muestra datos, precio, administrador de empresa, cuenta de API, dispositivos y uso; umbrales, sucursales y usuarios en solo lectura.
- Menú **Mi empresa** para el administrador de empresa: Usuarios y Umbrales.
- `esAdminEmpresa()` único en `assets/js/domain/rol.js`, que reemplaza las cinco copias de la regla; opción `soloEmpresa` en el router, junto a `soloAdmin`.
- Textos de interfaz: «Equipo Neumet», «Administrador de empresa», «Usuario de sucursal».

## 5. Datos de uso por cliente

Para cada cliente y período: vehículos activos; dispositivos asignados y con medición en el período (`v_salud_dispositivos`); mediciones; llamadas a la API por endpoint y estado; logins a la API; usuarios y fecha del último ingreso. Los agregados salen de RPC `SECURITY DEFINER` que solo autorizan al equipo Neumet; el panel no lee `auth.users`.

Retención propuesta de `ingesta_log`: 13 meses. Si la tabla supera aproximadamente un millón de filas, tabla `uso_api_diario` alimentada con pg_cron, en un PR aparte.

## 6. Migración de usuarios

Nadie queda afuera: el valor `admin` no cambia y el usuario del cliente Demo ya es global. Antes de la migración C se comprueba con SQL que cada cliente vigente tiene al menos un administrador de empresa. Nunca se «suplanta» a un usuario para probar.

## 7. Preguntas abiertas (solo el dueño puede responderlas)

Solo bloquean el PR 7 (migración C).

| Id | Pregunta | Recomendación |
|---|---|---|
| P1 | ¿El equipo Neumet debe poder operar dentro de una empresa o solo mirar? | Solo mirar. Operar únicamente a pedido del cliente, con marca «soporte» en la auditoría |
| P2 | ¿El equipo Neumet ve el detalle de precios y costos de neumáticos de cada cliente? ¿El cliente ve su `precio_mensual`? | Neumet ve totales de costo, no el detalle. El cliente no ve `precio_mensual` |
| P5 | ¿«Uso» alcanza con API, dispositivos, vehículos, mediciones y último ingreso, o también debe incluir el uso del panel? ¿Se usa para facturar y qué cuenta como consulta facturable? | Sin definir; si se factura, fijar la definición antes de construir la pantalla |

## 8. Riesgos y reglas

- **No agregar políticas de escritura sobre `perfiles` ni `clientes` para la empresa.** Permitiría cambiar un perfil a `rol = 'admin'` (escalada de privilegios) o exponer `precio_mensual`. Todo cambio de usuarios pasa por RPC o Edge Function.
- RPC nuevas `SECURITY DEFINER` con `search_path = ''`, `revoke` a `public` y `anon`, y `42501` uniforme para cualquier rol no autorizado.
- No leer metadatos de `auth.users` desde el panel.
- Bloqueo de acceso (lockout): el último administrador de empresa no se puede quitar; un perfil `admin` no se borra desde el panel.
- MFA (`aal2`) obligatorio para el equipo Neumet, en un PR propio, después de enrolar al dueño.
- La baja de un cliente no desactiva su perfil `api`: se resuelve junto con el retiro de acceso.

## 9. Orden de PR

En serie, una migración a la vez.

| PR | Contenido |
|---|---|
| 1 | Este documento y la actualización de docs/08 §4, docs/12 y el índice |
| 2 | Migración A y prueba SQL `t_93_admin_empresa` |
| 3 | `crear-usuario-seccional` abierta al administrador de empresa |
| 4 | Panel «Mi empresa», `esAdminEmpresa()` y ficha de cliente en lectura |
| 5 | Migración B y prueba `t_94` |
| 6 | Login de `api-proveedor` en `ingesta_log` y pantalla «Uso» |
| 7 | Migración C (después de las respuestas a P1 y P2) |
| 8 | MFA obligatorio para el equipo Neumet y sincronización final de docs y runbook |

El PR 1 no toca `docs/10`, `docs/16` ni `CLAUDE.md` (hay otro PR abierto sobre ellos); esos archivos se actualizan con este plan después.

## 10. Pruebas requeridas

- Matriz SQL por rol: equipo Neumet, administrador de la empresa Demo, administrador de otra empresa, usuario de sucursal, `api`, sin perfil y `anon`.
- UPDATE e INSERT directos sobre `perfiles` y `clientes` por la empresa: 0 filas afectadas.
- Idempotencia: cada migración aplicada dos veces sin errores.
- Pruebas del handler de `crear-usuario-seccional`: 403 con `cliente_id` ajeno, 403 con sucursal ajena, rechazo de rol sucursal y `api`, nunca crea `admin` ni `api`.
- E2E: el administrador crea un usuario de sucursal, este entra y ve solo su sucursal, se le quita el acceso y pasa a ver «Sin acceso»; el equipo Neumet ve «Uso».
