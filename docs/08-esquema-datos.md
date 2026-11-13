# 08 · Esquema de datos (deducido del código)

> Estado: **aplicado** en Supabase `kootszosdejmawanfxug` (2026-11-06, migraciones 20261106000000/010000/020000). Migración: [`supabase/migrations/20261106000000_init_schema.sql`](../supabase/migrations/20261106000000_init_schema.sql).
> Nota histórica: al redactar este documento el esquema real no estaba en el repo; el esquema se **dedujo** del código del panel (originalmente el monolito `app.js`, hoy módulos ES en `assets/js/`; las referencias `app.js:N` son históricas), `README.md`, `docs/02`, `04`, `07` y `tests/smoke/stub.js`. Lo que no tiene evidencia directa va marcado **[ASUNCIÓN]**. No se ha ejecutado contra ningún proyecto de Supabase.
> Validación realizada: se aplicó dos veces (idempotencia) en un PostgreSQL local desechable con un `auth` simulado y se probaron RLS por rol, RPCs, CHECKs y auditoría (ver §6). **No** se probó en Supabase real.

## 1. Diagrama ER

```mermaid
erDiagram
    auth_users ||--o| clientes : "auth_user_id (SET NULL)"
    auth_users ||--o| perfiles : "user_id (CASCADE)"
    clientes   ||--o{ perfiles : "cliente_id (CASCADE)"
    clientes   ||--o{ vehiculos : "RESTRICT"
    clientes   ||--o{ dispositivos : "RESTRICT"
    clientes   ||--o{ stock_neumaticos : "RESTRICT"
    clientes   ||--o{ neumaticos : "RESTRICT"
    clientes   ||--o{ mediciones : "RESTRICT, nullable"
    vehiculos  ||--o{ neumaticos : "RESTRICT"
    vehiculos  |o--o{ mediciones : "SET NULL, nullable"
    stock_neumaticos |o--o{ neumaticos : "SET NULL"
    dispositivos }o..o{ mediciones : "mac_address = device_id (sin FK)"

    clientes { bigint id PK
      text nombre
      uuid auth_user_id UK
      numeric precio_mensual
      timestamptz created_at
      timestamptz deleted_at }
    perfiles { uuid user_id PK
      text rol "admin|cliente|api"
      bigint cliente_id FK }
    vehiculos { bigint id PK
      bigint cliente_id FK
      text nombre
      text patente
      text patente_norm "generada"
      text numero
      smallint tipo_ruedas "10|16"
      boolean activo
      date fecha_compra
      date ultimo_servicio
      text notas }
    dispositivos { bigint id PK
      text mac_address UK
      text nombre
      bigint cliente_id FK
      boolean activo }
    mediciones { bigint id PK
      bigint vehiculo_id FK "null"
      bigint cliente_id FK "null"
      text device_id
      text patente_raw
      text numero_raw
      smallint posicion
      numeric mm1
      numeric mm2
      numeric mm3
      numeric promedio
      text idneumatico
      uuid sesion_id }
    neumaticos { bigint id PK
      bigint vehiculo_id FK
      bigint cliente_id FK
      smallint posicion
      bigint stock_id FK
      text marca
      text modelo
      date fecha_compra
      numeric precio_unidad
      text notas
      text idneumatico UK "extension"
      text codigo "extension"
      boolean auxilio "extension" }
    stock_neumaticos { bigint id PK
      bigint cliente_id FK
      text marca
      text modelo
      int cantidad
      numeric precio_unidad
      date fecha_compra
      text notas }
    gastos { bigint id PK
      text nombre
      text categoria
      numeric monto
      text notas
      boolean recurrente
      boolean activo }
    ingesta_log { bigint id PK }
    audit_log { bigint id PK }
```

`ingesta_log` y `audit_log` no tienen FKs a propósito: deben sobrevivir al borrado de lo que describen.

## 2. Tabla por tabla y evidencia

Todas tienen `created_at timestamptz default now()` salvo `perfiles`/logs donde se indica. Los ids son `bigint identity` (el panel hace `parseInt` de los ids: `app.js:406`, `2075`).

### clientes
| Columna | Evidencia |
|---|---|
| `id`, `nombre` | `app.js:105`, `323-325`, `633` |
| `auth_user_id` (unique, → `auth.users`) | `app.js:105`, `149`, `324`; `rls_audit.sql` consulta 7 |
| `precio_mensual` numeric default 0 | `app.js:1347`, `1654` |
| `created_at` | `app.js:325` |
| `deleted_at` | no usado por el panel; pedido por docs/02 S5 |

`ON DELETE`: `auth_user_id` = SET NULL (borrar el usuario Auth no borra al cliente ni su historial).

### perfiles (nueva)
No existe en el código; reemplaza el "admin por exclusión" (`app.js:59-65`, `103-109`; docs/02 S2). CHECK: `admin` ⇒ `cliente_id` nulo; `cliente`/`api` ⇒ `cliente_id` obligatorio. FK a `clientes` = CASCADE (es un mapeo de acceso, no dato de negocio; evita que el `DELETE` del panel quede bloqueado por él). Un trigger en `clientes` crea el perfil `cliente` cuando `crear-cliente` fija `auth_user_id`, sin tocar esa función.

### vehiculos
| Columna | Evidencia |
|---|---|
| `id,nombre,patente,tipo_ruedas` | `app.js:217`, `626` |
| `numero,activo,cliente_id,fecha_compra,ultimo_servicio,notas` | `app.js:1963`, `2084` |
| `clientes(nombre)` embebido (FK cliente) | `app.js:1963` |
| `patente_norm` generada (`upper`, sin espacios) | README (búsqueda por `patente_norm`), docs/07 §3.2 |
| UNIQUE `(cliente_id, patente_norm)` y `(cliente_id, numero)` parciales | docs/07, `asignar_dispositivo...` busca por ambos |

El panel guarda la patente en mayúsculas pero **con** guiones/espacios internos (`app.js:2073`); `patente_norm` solo quita espacios.

### dispositivos
`id,mac_address,nombre,activo,cliente_id,created_at,clientes(nombre)` en `app.js:1740`; escritura `app.js:1929` (`nombre,cliente_id,activo`) y por RPC (`1917`). `mac_address` UNIQUE y CHECK `^([0-9A-F]{2}:){5}[0-9A-F]{2}$`; el panel acepta `-` (`app.js:1908`), por lo que un trigger normaliza `-`→`:` y mayúsculas antes del CHECK.

### mediciones
| Columna | Evidencia |
|---|---|
| `vehiculo_id,posicion,mm1,mm2,mm3,created_at,vehiculos(nombre)` | `app.js:218` |
| `cliente_id` | `app.js:216`, `219` |
| `promedio`, `idneumatico` | `app.js:680` |
| `device_id` | `app.js:1764`, `2634` |
| `patente_raw`, `numero_raw`, `vehiculos(nombre,patente,tipo_ruedas)` | `app.js:2690` |
| `sesion_id` | docs/07 §4.4 (no la lee el panel) |

`vehiculo_id` y `cliente_id` nulos permitidos (modo device-first, README). `vehiculo_id` ON DELETE **SET NULL**: el histórico se conserva y se puede re-vincular por `device_id`/`patente_raw`. `promedio`: **columna normal + trigger** que lo recalcula (no generada), porque la función actual lo inserta (README paso 4) y una columna generada rompería ese INSERT. Mapeo de lecturas: tabla = `mm1,mm2,mm3`; la traducción desde `mm1..mm4` de la API de proveedor ocurre en la Edge Function (`mm4→mm3`, descartar el `mm3` entrante), según docs/07 §3.1.

### neumaticos
> Desde el apéndice F, `vehiculo_id` y `posicion` admiten NULL: una fila sin montar es una **cubierta de stock** (`estado = 'almacenado'`, `condicion`, `sucursal_id`).

`posicion,marca,modelo,fecha_compra,precio_unidad,notas` (`app.js:1023`); escritura con `vehiculo_id,cliente_id,posicion,stock_id,…` y `onConflict:'vehiculo_id,posicion'` (`2343-2355`) ⇒ UNIQUE `(vehiculo_id, posicion)`; `stock_id` y `vehiculos(nombre)` (`2372`). Extensión **no usada por el panel**, requerida por docs/07: `idneumatico text unique`, `codigo text`, `auxilio boolean default false` (un solo auxilio por vehículo, índice parcial). `stock_id` ON DELETE SET NULL (marca/modelo están copiados en la fila).

### stock_neumaticos
`id,marca,modelo,cliente_id,precio_unidad,fecha_compra,cantidad,notas,created_at,clientes(nombre)`: `app.js:2388`, `2530-2538`, `2546`.

### gastos
`nombre,categoria,monto,notas,recurrente,activo` (`app.js:1704`, `1709`), `created_at` (`1348`). Sin `cliente_id`: son gastos de la empresa.

### ingesta_log y audit_log
Estructura de docs/04 §2.1 y §2.2 más campos de docs/07 §4.5 (`endpoint, cuenta, cliente_id, vehiculo_id, n_guardados, n_fallidos`). `audit_log`: trigger `audit_row()` en `clientes, dispositivos, vehiculos, gastos`; trigger de bloqueo de UPDATE/DELETE/TRUNCATE (inmutable incluso para service_role y propietario). Se usan `actor_id`/`actor_rol` (docs/04) en lugar de un único `actor`.

### RPCs
- `get_unregistered_devices() → (device_id, last_seen, total_meds)`: columnas leídas en `app.js:1786-1806`; MAC con mediciones y sin fila en `dispositivos`.
- `asignar_dispositivo_a_cliente(p_mac text, p_cliente_id bigint, p_nombre text default null) → jsonb {dispositivo_id, vehiculos_creados, mediciones_vinculadas}`: parámetros `app.js:1917-1921`, resultado `1924-1925`, lógica README Fase 2.
- Ambas `SECURITY DEFINER`, `search_path=''`, `is_admin()` al inicio, `revoke ... from public, anon`, `grant ... to authenticated`.

## 3. Lista de [ASUNCIÓN]

**Tipos y precisión:** ids `bigint identity`; `precio_mensual numeric(12,2)`; `precio_unidad numeric(12,2)`; `monto numeric(14,2)`; `mm1..3 numeric(5,2)`; `fecha_compra`/`ultimo_servicio` `date`; `numero` text; `tipo_ruedas smallint` default 10; `posicion smallint` 1..99.
**Restricciones:** `mm1..3` NOT NULL y 0..40 (docs/07 §4.3); `cantidad >= 0`; `monto >= 0`; UNIQUE `(cliente_id, numero)`; UNIQUE parcial de un auxilio por vehículo; `mediciones.idneumatico` sin FK.
**Semántica:** `gastos.categoria` texto libre (el `<select>` usa nombres capitalizados y la fixture usa `infra`/`marketing`); `ingesta_log.status in (ok, rechazado, error)`.
**RPC:** identidad de vehículo = `patente_raw` normalizada y, si falta, `numero_raw`; vehículo nuevo con `nombre = patente` o `Nº <numero>` y `tipo_ruedas = 16` si alguna posición > 10; mediciones sin patente ni número solo reciben `cliente_id`; formas de salida de ambas RPC (campos extra como `n` de la fixture se ignoran).
**Extensión API:** `neumaticos.idneumatico/codigo/auxilio`, `mediciones.sesion_id`.
**Mapeo:** `mm1/mm2/mm3` = las tres huellas actuales; orden físico confirmado (app de DAC): `mm1` = interno, `mm2` = centro, `mm3` = externo. Cambiarlo = una constante en `api-proveedor/mapping.ts` (docs/07 §3.1).

## 4. Decisiones de seguridad

- **Defecto = denegar.** RLS activa en las 10 tablas; `anon` sin privilegios de tabla ni de función (y `alter default privileges ... revoke ... from anon`).
- **Rol explícito:** `perfiles` + `is_admin()` / `current_cliente_id()` (`SECURITY DEFINER`, `STABLE`, `search_path=''`, execute solo para `authenticated`). Se acabó el "admin = sin fila en clientes" del lado servidor.

### Matriz de roles vigente

Un perfil por usuario (`perfiles.user_id`). Helpers `SECURITY DEFINER`: `is_admin()`, `current_cliente_id()`, `current_sucursal_id()` (apéndice B) y `precios_visibles()` (migración `20261116500000`). La figura «global» no tiene valor propio: es `rol = 'cliente'` con `sucursal_id` nulo. Las viñetas siguientes de esta sección son del diseño inicial y quedaron desactualizadas: el cliente ya escribe por RPC (apéndices B a G) y el stock, los precios y las sucursales los gestiona el perfil global. Esta matriz es la vigente.

| Rol | Representación | Datos y operaciones |
|---|---|---|
| `admin` | `rol = 'admin'`, `cliente_id` nulo | Lectura y escritura entre todos los clientes. Exclusivas hoy: crear usuarios (Edge `crear-usuario-seccional`), editar umbrales por UPDATE directo sobre `clientes`, cuentas de API, escritura sobre dispositivos, edición de Balance y de `precio_mensual`, lectura de `ingesta_log` y `audit_log`. No son exclusivas del router: la ficha de cliente, Balance y Clientes no usan `soloAdmin` (solo Dispositivos); las protege el menú y la RLS |
| Cliente global | `rol = 'cliente'`, `sucursal_id` nulo | Todo su cliente: sucursales, stock, precios y costos, recauchutado, montaje y cambio de neumático, nivel crítico de alertas (`alerta_configurar`). Lee también `precio_mensual` de su cliente (ver nota) |
| Cliente de sucursal | `rol = 'cliente'` con `sucursal_id` | Solo su sucursal; sin stock, precios ni costos de neumáticos (`precio_mensual` sí lo lee, ver nota); umbrales solo lectura |
| `api` | `rol = 'api'` | Sin política ni acceso por PostgREST; solo vía `api-proveedor` con service role |
| Sin perfil, `anon` | | Sin acceso |

Nota: `precio_mensual` **no** es exclusivo del admin. `clientes` tiene grant de tabla completa a `authenticated` (`init_schema.sql:448`) y `clientes_self_select` (`:458`) deja a cualquier usuario del cliente, global o de sucursal, leer esa columna de su fila; la interfaz no la muestra, pero la API la entrega. Lo cierra la migración C2 del plan (docs/17).

El primer usuario de cada cliente es global (trigger `clientes_sync_perfil`). Hoy no existe forma de quitar el acceso a un usuario.

### Cambio planificado de roles (estado: planificado)

El plan [docs/17](17-plan-roles-admin.md) separa el perfil `admin` (pasa a ser el **equipo Neumet**, sin renombrar el valor en la base) del **administrador de empresa** (el cliente global actual, con gestión de usuarios y umbrales). Nada de esto está implementado: la matriz anterior sigue vigente hasta que se fusione cada PR del plan.

| Rol hoy | Rol planificado | Qué cambia |
|---|---|---|
| `admin` | Equipo Neumet | Gana «Uso» por cliente; con la migración C2 solo mira dentro de las empresas (decisión P1 del dueño) |
| Cliente global | Administrador de empresa | Gana Usuarios (crear, asignar sucursal, quitar acceso) y todos los umbrales; función nueva `admin_empresa_cliente_id()`; deja de ver `precio_mensual` (migración C2) |
| Cliente de sucursal, `api` | Usuario de sucursal, Integración | Sin cambios |

### Diseño inicial (desactualizado)

Las viñetas siguientes son del diseño inicial; la matriz vigente es la de arriba.

- **Cliente:** solo SELECT de sus filas (`vehiculos, dispositivos, mediciones, stock_neumaticos`, su fila de `clientes`; `neumaticos` a través del vehículo). El código revisado **no ejecuta ninguna escritura** en modo cliente (todas las mutaciones salen de pantallas `data-admin-only`, `app.js:89-91`), por eso no hay políticas de escritura para él. **No** ve `gastos`, `perfiles` de otros, `audit_log` ni `ingesta_log`.
- **Rol `api`:** sin ninguna política (ni su propia fila de `perfiles`) ⇒ su JWT contra PostgREST ve 0 filas (docs/07 §4.1). Acceso solo vía Edge Function con service role, que debe filtrar por `cliente_id` del token.
- **`mediciones`:** sin política INSERT/UPDATE/DELETE para usuarios; las inserta solo service_role; admin y cliente solo leen.
- **ON DELETE:** RESTRICT para todo lo que cuelga de `clientes` y `vehiculos` (neumáticos); excepciones: `mediciones.vehiculo_id` SET NULL (conservar histórico), `neumaticos.stock_id` SET NULL, `perfiles.cliente_id` CASCADE, `clientes.auth_user_id` SET NULL.
- **Auditoría:** triggers en BD (no manipulables desde el navegador), inmutable, lectura solo admin.
- **Funciones internas** (`audit_row`, `clientes_sync_perfil`): sin execute para nadie salvo uso por trigger.

## 5. Preguntas abiertas

1. **El `DELETE` de clientes del panel (`app.js:343`) fallará** mientras el cliente tenga vehículos, dispositivos, stock o neumáticos (RESTRICT, intencional). Hay que pasar a soft delete (`update deleted_at`) y filtrar `deleted_at is null` en `loadClients`; el panel hoy no lo hace. Idem borrar vehículos con neumáticos asignados (`app.js:2590`).
2. **`precio_mensual` del propio cliente** es visible para él (la RLS filtra filas, no columnas). Si no debe verlo, hay que mover la columna a otra tabla solo-admin o exponer una vista.
3. ¿La BD real tiene columnas que el panel no lee (p. ej. `email`, `updated_at`, más campos de `mediciones`)? Un `supabase db dump --schema-only` lo resolvería; la migración es de arranque, no una réplica.
4. ¿`vehiculo.cliente_id` puede cambiarse con neumáticos asignados? `neumaticos.cliente_id` es redundante y podría quedar inconsistente (la RLS usa el vehículo, no esa columna).
5. Formato del `numero` (docs/07 §5).
6. Los datos existentes (si se migran) pueden violar los CHECK nuevos (MAC con `-`, mm fuera de 0..40, patentes duplicadas por cliente).
7. `crear-cliente` y `guardar-montaje-mm` no están versionadas: confirmar que `crear-cliente` crea la fila `clientes` con `auth_user_id` (el trigger crea el perfil) y que la ingesta inserta con service_role.
8. Primer administrador: debe crearse a mano en `perfiles` (instrucciones al final de la migración). Sin ello, nadie puede usar el panel.
9. Un cliente = un usuario (1:1, `auth_user_id` unique y `perfiles` PK en `user_id`); si cambia (roadmap, decisión 1) habrá que ajustar.

## 6. Cómo se validó

- Sin `psql` contra Supabase. En un Postgres local desechable (con roles `anon/authenticated/service_role` y `auth.users`/`auth.uid()` simulados) la migración se aplicó **dos veces sin errores** y se comprobó: promedio calculado, `patente_norm`, CHECK de mm, RLS para admin/cliente/api/anon, RPCs (admin OK; cliente rechazado; segunda llamada con la misma MAC falla por unicidad; 2 vehículos creados y 3 mediciones vinculadas), auditoría y bloqueo de UPDATE/DELETE en `audit_log`.
- No cubre diferencias propias de Supabase (extensiones, roles `supabase_admin`, privilegios por defecto reales). Repetir las comprobaciones del final de la migración y `supabase/audit/rls_audit.sql` en staging.

---

# Apéndice A · Migración de producto `20261106020000_producto_vistas.sql`

Segunda migración (depende solo de la inicial). Añade umbrales por cliente, odómetro, ciclo de vida del neumático, cinco vistas para el panel y la RPC de baja suave. **No está aplicada**: la aplica el director. Idempotente; sin `begin/commit` (la herramienta ya envuelve). Probada en Postgres local con `tests/sql/run.sh` (ver A.6).

## A.1 Columnas y tablas nuevas

| Objeto | Detalle |
|---|---|
| `clientes.umbral_bajo_mm` / `umbral_critico_mm` / `umbral_retiro_mm` | `numeric(4,1)`, defecto 8 / 5 / 3 (igual que `WEAR` de `app.js`). CHECK `retiro < crítico < bajo` y `> 0` |
| `clientes.dias_sin_medir_alerta` | `integer`, defecto 30 |
| `clientes.irregularidad_mm` | `numeric(3,1)`, defecto 2: diferencia máxima entre huellas |
| `mediciones.odometro_km` | `integer` nullable, `>= 0` |
| `vehiculos.odometro_km`, `odometro_actualizado_at` | `integer >= 0` / `timestamptz`, nullable. **Nada los rellena automáticamente**: la Edge Function (o el panel) debe actualizarlos |
| `neumaticos.vida` | `smallint` 0..3 (0 nuevo, 1..3 reencauches), defecto 0 |
| `neumaticos.estado` | `montado` (defecto) / `almacenado` / `reparacion` / `baja` |
| `neumaticos.fecha_baja`, `motivo_baja` | `date`, `text` |
| `eventos_neumatico` | `id, cliente_id (RESTRICT), vehiculo_id (RESTRICT), neumatico_id (SET NULL), idneumatico, tipo (montaje, desmontaje, rotacion, reparacion, reencauche, baja, inspeccion), posicion_origen/destino, odometro_km, costo, notas, created_by (auth.uid()), created_at`. RLS: admin ALL, cliente SELECT de lo suyo, api/anon nada. Trigger `audit_row()` (INSERT/UPDATE/DELETE quedan en `audit_log`). Los eventos no tienen restricción de coherencia `vehiculo.cliente_id = cliente_id`: lo garantiza quien escribe (solo admin) |
| Índice | `mediciones (cliente_id, created_at desc)`; los de `eventos_neumatico` (cliente, vehículo, neumático, fecha) |

## A.2 Vistas (todas `security_invoker = true`: heredan la RLS de quien consulta)

Admin ve todo; un cliente solo lo suyo; el perfil `api` y usuarios sin perfil, 0 filas; `anon`, `permission denied`. Ninguna vista toca `gastos`. Excluyen vehículos inactivos, clientes eliminados (`deleted_at`) y neumáticos no montados.

- **`v_mediciones_neumatico`** `(cliente_id, vehiculo_id, neumatico_id, idneumatico, estado_montaje, posicion_actual, posicion_medicion, medicion_id, mm1..mm3, promedio, odometro_km, device_id, created_at, atribucion)` (migración `20261109000000`): cada medición atribuida al neumático al que pertenece, con la posición donde está HOY. Es la base de las demás vistas y del historial del detalle del vehículo. Regla en el apéndice D.
- **`v_ultima_medicion`** `(cliente_id, vehiculo_id, posicion, medicion_id, idneumatico, mm1..mm3, promedio, odometro_km, device_id, created_at)`: última medición del neumático **montado** en cada `(vehiculo_id, posicion)` (`posicion` = posición actual; `distinct on`, desempate por `id`). Un neumático recién montado sin mediciones no tiene fila.
- **`v_estado_neumaticos`**: una fila por posición (filas de `neumaticos` más posiciones medidas sin fila en `neumaticos`). Columnas: identificación (`cliente_id, vehiculo_id, vehiculo_nombre, patente, posicion, neumatico_id, idneumatico, marca, modelo, vida, estado_montaje`), última lectura (`mm1..3, promedio, odometro_km, ultima_medicion_at, dias_desde_medicion`), `estado`, `sin_medir`, `diferencia_huellas_mm`, `desgaste_irregular`, `n_mediciones_90d`, `tasa_mm_semana`, `semanas_hasta_critico`, `semanas_hasta_retiro` y los umbrales del cliente.
- **`v_alertas`** `(cliente_id, vehiculo_id, vehiculo_nombre, patente, posicion, neumatico_id, idneumatico, tipo, severidad, valor, mensaje, ultima_medicion_at)`: una fila por alerta.
- **`v_resumen_flota_cliente`** `(cliente_id, nombre, n_vehiculos_activos, n_neumaticos_con_datos, n_ok, n_bajo, n_critico, n_sin_datos, n_alertas_sev1..3, ultima_medicion_at)`.
- **`v_salud_dispositivos`** `(dispositivo_id, cliente_id, mac_address, nombre, activo, ultima_actividad_at, total_mediciones, dias_sin_actividad, estado)`.

## A.3 Fórmulas

- **Promedio**: `round((mm1+mm2+mm3)/3, 2)` (trigger existente).
- **Semáforo** (con los umbrales del cliente del vehículo): `sin_datos` si no hay promedio; `critico` si `promedio < umbral_critico`; `bajo` si `promedio < umbral_bajo`; si no `ok`. Límites: 5.00 es `bajo`, 4.99 `critico`, 8.00 `ok`, 7.99 `bajo` (con 8/5).
- **Desgaste irregular**: `max(mm1,mm2,mm3) - min(mm1,mm2,mm3) > irregularidad_mm` (estricto: 2.0 con umbral 2.0 no alerta). Ojo: `app.js` hoy usa `|mm1-mm3| >= 1.5`; las vistas usan las tres huellas y el umbral del cliente.
- **Tasa mm/semana** = `-regr_slope(promedio, epoch(created_at)) * 604800` sobre las mediciones de los **últimos 90 días** de cada **neumático** montado (apéndice D), con **tiempo transcurrido** (no fechas). Solo hay tasa con **al menos 3 mediciones y 14 días** entre la primera y la última de la ventana; si no, `null` («mediciones insuficientes»). La ventana se **reinicia** en el último evento de `reencauche`, `reparacion` o `montaje` del neumático (`eventos_neumatico.neumatico_id`; la rotación no reinicia) y una pendiente negativa da `null` (nunca hay tasa negativa). `n_mediciones_90d` cuenta las mediciones de los últimos 90 días sin reinicio. Desde `20261111000000_tasa_y_rendimiento.sql` la vista se calcula por neumático con sondas a `mediciones_idneumatico_idx` (y, solo para el histórico sin `idneumatico`, a `mediciones_veh_pos_fecha_idx`). Positivo = se está gastando. Un neumático nuevo no mezcla puntos del viejo y, tras rotar, la tasa acompaña al neumático. A diferencia de `mAnalysis` (primera vs última medición), no usa solo los extremos.
- **Semanas hasta crítico / retiro** = `max(promedio - umbral, 0) / tasa` si `tasa > 0`, si no `null` (0 si ya está por debajo del umbral). El retiro por defecto es 3 mm, igual que el `LIMIT` de `mAnalysis`.
- **Alertas** (`severidad`): `critico` (3); `bajo` (2); `cruza_critico_pronto` (2: estado ok o bajo con `semanas_hasta_critico <= 4`, `valor` = semanas); `desgaste_irregular` (2, `valor` = diferencia en mm); `sin_medir` (1: neumático montado sin ninguna medición, o última medición más vieja que `dias_sin_medir_alerta` días, `valor` = días o null).
- **Salud de dispositivo**: `dias_sin_actividad = floor(días desde la última medición con su device_id)`; `activo` ≤ 7, `sin_actividad` ≤ 30, `caido` > 30, `nunca` si no hay mediciones. `activo=false` del dispositivo se informa aparte.

## A.4 RPC

`public.cliente_eliminar_suave(p_id bigint) → jsonb {cliente_id, vehiculos_desactivados, dispositivos_desactivados}`. `SECURITY DEFINER`, `search_path=''`, exige `is_admin()` (42501), cliente inexistente 23503. Marca `deleted_at` (si no lo tenía), pone `activo=false` en vehículos y dispositivos; no borra nada (el `DELETE` directo sigue fallando por RESTRICT). `execute` solo para `authenticated`. Es idempotente. No toca `auth_user_id`/`perfiles`: el cliente eliminado deja de ver sus datos porque `clientes_self_select` exige `deleted_at is null` y las vistas lo excluyen.

## A.5 Guía para el panel (backlog de docs/09 §6)

| # | Pantalla | Qué consultar |
|---|---|---|
| 1 | Panel de flota con prioridades | `v_estado_neumaticos` (contadores por `estado`; orden: `estado`, `promedio` asc); `v_resumen_flota_cliente` para los totales y el filtro por cliente |
| 2 | Centro de alertas | `v_alertas order by severidad desc, ultima_medicion_at` (filtrar por `tipo`/`cliente_id`) |
| 4 | Vista de cliente | `v_resumen_flota_cliente` (una fila), `v_estado_neumaticos where cliente_id=…` y `eventos_neumatico` para costos; el gasto en neumáticos sale de `neumaticos.precio_unidad`/`eventos_neumatico.costo`, que desde el apéndice K solo se leen con `neumaticos_precios()` / `eventos_costos()` |
| 5 | Salud de dispositivos | `v_salud_dispositivos` (combinar con `get_unregistered_devices()` para MAC sin registrar) |
| 8 | Predicción / vida remanente | `v_estado_neumaticos.tasa_mm_semana`, `semanas_hasta_critico`, `semanas_hasta_retiro`; alertas `cruza_critico_pronto` |
| 9 | Desgaste irregular | `v_estado_neumaticos.desgaste_irregular`, `diferencia_huellas_mm`; alertas `desgaste_irregular` |

Para el detalle de un neumático (#6/#7) el panel sigue leyendo `mediciones` (historial) y, para la línea de tiempo, `eventos_neumatico where neumatico_id=… order by created_at`. Los umbrales se editan con un `update` de `clientes` (solo admin; los CHECK validan la coherencia). El panel puede dejar de calcular estado/tasa/predicción en JS y leer estas vistas; mientras tanto, `WEAR` en `app.js` debe coincidir con los umbrales por defecto.

## A.6 Cómo se validó y límites

- `tests/sql/run.sh` crea un Postgres desechable (`initdb`/`pg_ctl` en un directorio temporal; o `TEST_PG_URL`; o Docker), simula `auth.users`/`auth.uid()`/roles, aplica la migración inicial y la de producto **dos veces** (idempotencia) y ejecuta ~170 aserciones: semáforo en límites exactos, tasa y semanas con datos conocidos, cada tipo de alerta, aislamiento por cliente/rol (admin, cliente A, cliente B, api, sin perfil, anon) en todas las vistas y tablas nuevas, estructura (security_invoker, grants, RLS), `eventos_neumatico` (RLS, constraints, auditoría), `cliente_eliminar_suave` y la inmutabilidad de `audit_log`. Sale con código ≠ 0 si algo falla. CI: job `sql` (servicio `postgres:16`).
- **No cubierto**: Supabase real (extensiones, roles `supabase_admin`, PostgREST, privilegios por defecto reales), rendimiento con volumen (no se hizo `EXPLAIN` con datos grandes; los índices existentes cubren los accesos previstos), ni la reconciliación con el esquema de producción. Repetir las comprobaciones de la migración inicial y este conjunto en staging antes de aplicar.
- Heredado de la migración inicial (no se cambia aquí): `normalizar_patente`, `dispositivos_normalizar_mac`, `mediciones_set_promedio` y `audit_log_inmutable` conservan EXECUTE para PUBLIC (funciones puras o de trigger, sin acceso a datos).

---

# Apéndice B · Sucursales (`20261107020000_seccionales.sql`) y cliente Demo

Un **cliente** (empresa) puede tener **sucursales** (p. ej. "Montevideo", "Salto"). Hay un único rol `cliente` con dos alcances:

| Perfil | `perfiles.sucursal_id` | Qué ve (RLS) |
|---|---|---|
| **Global** | `NULL` | Todo el cliente: todas las sucursales y lo que no tiene sucursal |
| **De sucursal** | `= X` | Solo vehículos, neumáticos, mediciones, eventos y dispositivos de la sucursal X; sus alertas, estado y salud (las vistas `security_invoker` heredan la RLS). **No** ve el stock del cliente, otras sucursales, mediciones/eventos sin vehículo ni gastos, y no puede editar nada (tampoco los umbrales) |
| Admin | — | Todo; gestiona sucursales y asignaciones |

## B.1 Objetos
| Objeto | Detalle |
|---|---|
| `sucursales` | `id, cliente_id (RESTRICT), nombre, created_at`. Único por `(cliente_id, lower(btrim(nombre)))`. `unique(id, cliente_id)` para las FK compuestas. RLS: admin ALL; cliente SELECT (global: las suyas; de sucursal: solo la suya). Auditada con `audit_row()` |
| `vehiculos.sucursal_id`, `dispositivos.sucursal_id` | Nullable ("sin sucursal" = solo perfil global). FK compuesta `(sucursal_id, cliente_id)` → `sucursales(id, cliente_id)` `ON DELETE RESTRICT`: no se puede asignar una sucursal de otro cliente |
| `perfiles.sucursal_id` | Nullable (NULL = global). FK compuesta igual; CHECK `sucursal_id is null or rol = 'cliente'` |
| `perfiles.email` | Informativo (lo escribe `crear-usuario-seccional`); no se usa para autorizar |
| `current_sucursal_id()` | `SECURITY DEFINER`, `search_path=''`, `stable`; solo `authenticated`. NULL = global o sin perfil (siempre se combina con `current_cliente_id()`) |

**Por qué `RESTRICT` y no `SET NULL`**: con `SET NULL`, borrar una sucursal convertiría en perfiles **globales** (ven todo el cliente) a sus usuarios. Con `RESTRICT` hay que reasignar o eliminar antes sus vehículos, dispositivos y usuarios. Consecuencia: un `DELETE` físico de un cliente con sucursales falla (la baja suave `cliente_eliminar_suave` no se ve afectada).

Políticas reescritas (solo `SELECT` del cliente): `vehiculos`, `dispositivos`, `neumaticos` (vía vehículo), `mediciones` (vía `vehiculo_id`), `eventos_neumatico` (vía `vehiculo_id`), `stock_neumaticos` (solo global), más `sucursales`. `clientes_self_select` no cambia (el perfil de sucursal ve la fila de su cliente: nombre y umbrales de solo lectura).

## B.2 Panel
- **Cliente global con sucursales**: selector "Todas las sucursales / …" en la barra superior (`core/seccional.js`). Filtra Inicio, Flota, Alertas, Reportes, Vehículos, Dispositivos, Salud y Mediciones por `vehiculos.sucursal_id` / `dispositivos.sucursal_id`. Inicio, Reportes, Vehículos, Dispositivos y Mediciones filtran en el servidor; Flota, Alertas y Salud filtran en el navegador (las vistas v_* no traen la sucursal) y Flota recalcula los KPI desde las filas filtradas.
- **Perfil de sucursal**: no ve el selector (la RLS ya limita todo); el rol se muestra como "Sucursal".
- **Admin** (Ficha de cliente > "Sucursales y usuarios"): alta/renombrar/eliminar sucursales, asignar vehículos y dispositivos, y crear usuarios globales o de sucursal con la función `crear-usuario-seccional` (invitación por email o contraseña de 12+ caracteres). No se vincula un usuario Auth ya existente: la API de Auth no permite buscarlo por email de forma fiable; se invita a uno nuevo.
- La detección de rol usa ahora `perfiles` (un usuario de sucursal no figura en `clientes.auth_user_id`) con el vínculo `clientes.auth_user_id` como respaldo.

## B.3 Datos de demo
`supabase/seed/demo.sql` (NO es migración; se ejecuta a mano). Ver su cabecera. Resumen: requiere el cliente `Demo Transportes` ya creado; genera 2 sucursales, 14 vehículos `DEMO001..014`, 6 dispositivos `02:DE:00:00:00:0N`, ~10 semanas de mediciones y stock/eventos de ejemplo; es idempotente y re-ejecutarlo refresca las fechas.

## B.4 Cómo se validó
`tests/sql/t_50_seccionales.sql` (global ve todo, sucursal A no ve B, admin ve todo, cliente B aislado, anon nada, escrituras y FK compuestas) y `t_60_seed_demo.sql` (seed idempotente, vistas con filas, perfil de sucursal del demo). Smoke: `tests/smoke/run.sh admin|cliente|secuser`.

---

# Apéndice C · Escritura del cliente (gomero): cambio de neumático (`20261108000000_cambio_neumatico.sql`)

El rol `cliente` sigue siendo de **solo lectura sobre las tablas**: no se añadió ninguna política de INSERT/UPDATE/DELETE para él. Cuando el taller
cambia un neumático, el gomero lo registra por **RPC `SECURITY DEFINER` acotadas** (`search_path=''`, `revoke` de `public`/`anon`, `grant execute` a `authenticated`).

## C.1 Modelo de autorización (verificado dentro de la función)

`public.neumatico_autorizar_vehiculo(p_vehiculo_id)` es interna (sin `grant`: solo la ejecutan las RPC, que corren como dueño). Bloquea la fila del vehículo
(`FOR UPDATE`, serializa cambios concurrentes) y autoriza a:

| Quien llama | Alcance |
|---|---|
| `is_admin()` | cualquier vehículo |
| perfil `rol='cliente'` global (`sucursal_id` null) | vehículos de **su** cliente (cliente no dado de baja) |
| perfil `rol='cliente'` de sucursal | vehículos de su cliente **y** `vehiculos.sucursal_id = perfiles.sucursal_id` |
| rol `api`, usuario sin perfil, `anon` | nada (42501) |

El cliente y la sucursal se leen de `perfiles` con `auth.uid()`; ningún parámetro del llamador decide el alcance. Un vehículo inexistente o ajeno responde
igual (`42501 permiso denegado`) para no revelar existencia. El **stock** (inventario con precios) solo lo consume el admin o el perfil global (igual que su
política de lectura) y siempre del mismo cliente del vehículo; el de sucursal ingresa el neumático nuevo con `p_nuevo`.

## C.2 RPC

- `neumatico_cambiar(p_vehiculo_id, p_posicion, p_destino_viejo, p_motivo, p_odometro_km, p_stock_id, p_nuevo jsonb, p_numero_quema text, p_km_previos integer)` (los dos últimos desde el apéndice E): el viejo (montado, no en baja) pasa a
  `baja` (fecha/motivo) / `reencauche` (`vida+1`, máx. 3, queda `almacenado`) / `reparacion` / `almacenado`; como `(vehiculo_id, posicion)` es único, queda
  "aparcado" en una posición libre (98 hacia abajo; las vistas solo cuentan `estado='montado'`). El nuevo sale del stock (`p_stock_id`: marca/modelo/precio/fecha del lote,
  `cantidad-1` con control `>0`, error `55000` si no hay) **o** de `p_nuevo` (`marca` obligatoria, `modelo`, `codigo`, `precio`, `vida`; se valida tipo y rango; exactamente
  uno de los dos). Se monta en la misma posición con `idneumatico` generado (`CN-<veh>-<pos>-<hash>`) y hereda `auxilio`. Eventos (`created_by = auth.uid()`, odómetro, costo = precio del nuevo):
  `baja`, o `desmontaje` (+ `reencauche`), y `montaje`. Si `p_odometro_km` es mayor al del vehículo se actualiza `odometro_km`/`odometro_actualizado_at`. Todo en una transacción.
  Devuelve jsonb con ids, posición del viejo, stock restante y ids de eventos.
- `vehiculo_registrar_odometro(p_vehiculo_id, p_odometro_km)`: misma autorización; el cliente no puede bajar el kilometraje (`23514`), el admin sí (cambio de tablero).
- `neumatico_rotar(...)`: misma lógica que antes pero con esta autorización (antes solo admin), de modo que el gomero también puede rotar en su vehículo.

## C.3 Panel

`views/cambio-neumatico.js` registra `neumatico-cambiar` (`data-vehiculo-id`, `data-posicion`; `core/actions.js` pasa esos números como argumentos si no hay `data-args`) y
`neumatico-rotar-pos`; lógica pura y traducción de errores en `domain/cambio-neumatico.js`. Al terminar emite `neumet:neumatico-cambiado` y recarga la vista activa.
Punto de entrada temporal: botón "Cambiar neumático" en el modal de ciclo de vida.

## C.4 Pruebas

`tests/sql/t_70_cambio_neumatico.sql`: admin, cliente global, sucursal A (sí en el suyo, no en el de B ni con stock), otro cliente, api, sin perfil y anon (no); stock ajeno y con cantidad 0
rechazados; validaciones; escritura directa denegada; atomicidad (fallo en el último paso no deja nada a medias); la migración se aplica dos veces en `run.sh`.

# Apéndice D · Las mediciones siguen al neumático (migración `20261109000000`)

## D.1 Regla de atribución

Antes las vistas tomaban la última medición por `(vehículo, posición)`: tras **cambiar** un neumático crítico la rueda nueva seguía mostrando los mm del viejo y tras **rotar** el estado se quedaba en la posición. Ahora cada posición montada toma sus datos de las mediciones del **neumático montado ahí**:

1. **Por `idneumatico`**: una medición pertenece al neumático con ese `idneumatico`, esté donde esté hoy y en el estado que sea (el historial de un neumático en baja o almacenado se conserva, pero no cuenta para el estado de la flota).
2. **Histórico con `idneumatico` NULL**: se atribuye al neumático **montado** en su `(vehículo, posición)` solo si (a) ese neumático no tiene **ninguna** medición con `idneumatico` y (b) ningún evento `montaje`, `desmontaje`, `rotacion` o `baja` del vehículo tocó esa posición (origen o destino) **después** de la medición. Si no, queda huérfana: no cuenta para el estado actual (mejor `sin_datos` que mm de otro neumático). Si el neumático no tiene `idneumatico`, solo aplica (b).
3. **Posición sin fila en `neumaticos`**: se conserva el comportamiento anterior (última medición de la posición), con las mismas exclusiones (medición de un neumático conocido o anterior a un evento que movió esa posición).
4. Un neumático **recién montado** sin mediciones propias figura `sin_datos` y `sin_medir`; no hereda nada de la posición.
5. La **tasa de desgaste** se calcula por neumático. `v_alertas` y `v_resumen_flota_cliente` no cambian de definición: leen `v_estado_neumaticos`.

Las vistas conservan sus columnas, tipos, `security_invoker` y permisos. `v_ultima_medicion` deja de listar posiciones de neumáticos que no están montados (antes aparecía, p. ej., la posición de un neumático en baja).

## D.2 API de proveedor

`api_obtener_montaje` devuelve, por posición, la última medición **del neumático montado** (misma regla) y solo neumáticos `montado` (el viejo, aparcado tras un cambio, ya no se ofrece). `api_guardar_montaje` inserta con el `idneumatico` del neumático montado actual de la posición y rechaza (`posicion`) posiciones sin neumático montado.

## D.3 Panel

El detalle del vehículo (gráfico y última medición), la vista Mediciones y el PDF de reporte leen `v_mediciones_neumatico` (por `posicion_actual` y `estado_montaje = 'montado'`); los eventos del panel se filtran por neumático. El CSV de Mediciones, Reportes y el modo Dispositivo muestran el registro crudo de lo medido (posición donde se midió) y no cambian.

## D.4 Pruebas

`tests/sql/t_55_mediciones_neumatico.sql` (cambio, rotación, histórico con `idneumatico` NULL, neumáticos fuera de servicio, aislamiento por cliente y sucursal, API, columnas y permisos); `run.sh` aplica la migración dos veces. E2E: `tests/e2e/specs/mediciones-neumatico.mjs`.

# Apéndice E · Número de coche, número de quema y km del neumático (migración `20261110000000_numero_quema.sql`)

## E.1 Número de coche

`vehiculos.nombre` es el **número de coche** que usa el cliente (`106`, `201`). La interfaz lo pide como «Número de coche» y lo muestra como «Coche 106» cuando son solo dígitos (`domain/coche.js`); los nombres anteriores con texto («Unidad Sur») se muestran tal cual. No se renombra ninguna columna. El formulario ya no tiene un campo «Nombre del vehículo» aparte: `vehiculos.numero` (único por cliente, lo usa la API de proveedor) acompaña al nombre (`numeroDesdeNombre`): se escribe igual al nombre si cabe en 10 caracteres y se conserva el valor guardado si el nombre no cambió. El buscador encuentra por matrícula, número de coche (también escrito «Coche 106») y número de quema. `supabase/seed/demo.sql` usa nombres `101..109` y `201..205`.

## E.2 Número de quema (`neumaticos.numero_quema`)

| Aspecto | Decisión |
|---|---|
| Tipo | `text`, nullable. Un trigger `BEFORE INSERT/UPDATE` recorta los extremos y convierte `''` en `NULL`; un CHECK exige 1 a 40 caracteres sin espacios en los extremos |
| Unicidad | Índice único parcial `neumaticos_cliente_quema_uk` sobre `(cliente_id, lower(numero_quema)) where numero_quema is not null`. `neumaticos.cliente_id` existe en cada fila (lo escriben `neumatico_cambiar` y el panel de administración); se ancla en él y no en el vehículo para poder indexar. Abarca todos los estados (montado, almacenado, reparación, baja): el número identifica al neumático físico. Dos clientes pueden repetir un número |
| Captura | `neumatico_cambiar(..., p_numero_quema text default null, p_km_previos integer default 0)` y el formulario de ruedas del administrador. Quema repetida: `23505` «el número de quema ya está registrado en otro neumático» (se comprueba antes de tocar nada). El neumático retirado conserva su quema |
| Lectura | Se lee de `neumaticos` (la RLS por vehículo y sucursal ya existente): panel de la rueda y detalle del vehículo, tabla de ciclo de vida y buscador. **Las vistas `v_*` no cambian** (no hizo falta recrearlas ni tocar sus columnas); un perfil de sucursal solo ve las quemas de sus vehículos |
| Buscador | Coincide exacta o por prefijo (sin distinguir mayúsculas, espacios ni guiones) con las quemas de neumáticos **montados** y abre el vehículo donde está montado. No se busca «dentro» de la quema: un `101` contenido en `Q1101` daría coincidencias sin relación |
| Compatibilidad | Se eliminó la firma de 7 argumentos y la nueva (9, con valores por defecto) la reemplaza: las llamadas anteriores, posicionales o por nombre, siguen valiendo y no queda una segunda sobrecarga ambigua |

## E.3 Km: tres datos distintos

El campo que el taller llamaba «kilometraje» mezclaba dos conceptos y rechazaba un `0` porque lo comparaba con el odómetro del vehículo. Ahora:

| Dato | Dónde vive | Reglas |
|---|---|---|
| **Km que ya traía el neumático** (`p_km_previos`) | `neumaticos.km_previos integer not null default 0` | Entero entre 0 y 999 999 999. `0` es válido y es el valor por defecto (neumático nuevo). `NULL` en la RPC se toma como 0. No depende del vehículo |
| **Odómetro del vehículo** (`p_odometro_km`) | `vehiculos.odometro_km` (sin cambios) | Dato aparte y **opcional**. Si se informa no puede ser menor al actual: `23514` «el odómetro del vehículo no puede ser menor al actual (X km)» (antes la RPC lo aceptaba y solo ignoraba la actualización; para corregir a la baja el admin usa `vehiculo_registrar_odometro`). Se guarda en los eventos del cambio |
| **Km recorridos** | calculado | Suma de tramos montados (odómetro final menos inicial de cada montaje en el mismo vehículo) más el tramo actual; desde `20261115000000` lo calcula la vista `v_km_cubierta` (apéndice H). Sin odómetro no hay recorridos conocidos y se muestra «Sin dato» |
| **Km totales** | calculado | `km_previos` más km recorridos (`km_totales` de la vista; NULL si ningún tramo tiene dato) |

El modelo ya permitía el cálculo con `eventos_neumatico.odometro_km`; solo hizo falta la columna `km_previos`. El evento de montaje anota la quema y los km previos en `notas`.

## E.4 Pruebas

SQL: `tests/sql/t_75_numero_quema.sql` (restricciones, trigger, unicidad por cliente y entre mayúsculas, firma anterior, 0 km previos, odómetro menor/igual, alcance por rol: admin, global, sucursal A/B, otro cliente, api, anon) y `t_60_seed_demo.sql` (nombres y quemas del demo); `run.sh` aplica la migración dos veces. Unitarias: `coche.test.mjs`, `quema.test.mjs`, `cambio-neumatico.test.mjs`, `busqueda.test.mjs`. Smoke: formulario de vehículo, cambio con quema/km, panel de la rueda y buscador por quema. E2E: `specs/taller.mjs` (cambio por la interfaz, rechazos en la base, aislamiento) y `specs/buscador.mjs`.

# Apéndice F · Stock individual de cubiertas (migración `20261113000000_stock_cubiertas.sql`)

El cliente con perfil **global** agrega y gestiona él mismo su stock. Hasta ahora el stock eran **lotes** (`stock_neumaticos`: marca, modelo, cantidad, precio) que solo cargaba el administrador. El modelo nuevo es **una cubierta = una unidad física** con identidad propia (hoja de ruta F1, `docs/16`): número de quema (obligatorio, único por cliente y el mismo que `neumaticos.numero_quema`), marca, modelo, fecha de compra, precio opcional, **condición** y **ubicación** (una sucursal del cliente o «sin sucursal»).

## F.1 Decisión de diseño

**Una cubierta de stock es una fila de `neumaticos` sin montar**: `vehiculo_id` y `posicion` nulos, `estado = 'almacenado'`, `sucursal_id` = ubicación, `condicion` nueva. La misma fila (mismo `id`, mismo `idneumatico`, misma quema) vive toda la vida de la carcasa: stock → vehículo → stock → otro vehículo. Así las mediciones (`mediciones.idneumatico`), los eventos (`eventos_neumatico.neumatico_id`) y los km previos siguen a la misma cubierta sin copiar ni migrar datos, y condición, ubicación y estado son dimensiones separadas (`docs/16`, principios 2 y 3).

| Alternativa | Por qué no |
|---|---|
| Tabla nueva `stock_cubiertas` y, al montar, copiar a `neumaticos` | Dos identidades por carcasa: al volver a stock habría que copiar en sentido inverso; la quema única por cliente tendría que repartirse entre dos tablas; las mediciones y eventos se pegan a `idneumatico`/`neumatico_id` y habría que reasignarlos. Es justo lo que F1 pide evitar |
| Extender `stock_neumaticos` con cantidad 1 | Mantiene dos modelos mezclados en una tabla y no resuelve el regreso desde un vehículo |
| **Fila de `neumaticos` sin montar** (elegida) | Una sola identidad; los cambios del esquema son pequeños y verificables (abajo); montar es un `UPDATE` de la misma fila |

**Restricciones que lo impedían y cómo se resolvieron**

| Restricción | Resolución |
|---|---|
| `vehiculo_id` y `posicion` `NOT NULL` | Se admiten nulos. `UNIQUE (vehiculo_id, posicion)` y el índice de auxilio no se ven afectados (los nulos no chocan) |
| `CHECK (posicion between 1 and 99)` | Sin cambio: no se evalúa con `NULL` |
| `CHECK` de coherencia | Nuevo `neumaticos_stock_ck`: sin vehículo ⇔ sin posición; sin vehículo ⇒ `almacenado` y sin auxilio; sucursal solo si no está montada; condición `nuevo` solo sin vehículo |
| FK y unicidad | `neumaticos_cliente_quema_uk` (`cliente_id, lower(numero_quema)`) ya cubre todos los estados. Nueva FK compuesta `(sucursal_id, cliente_id) → sucursales (id, cliente_id)`, `ON DELETE RESTRICT`: la ubicación es siempre del **mismo cliente** |
| RLS de lectura por vehículo | Nueva política `neumaticos_stock_cliente_select`: filas sin vehículo del propio cliente, **solo perfil global** (el de sucursal sigue sin ver el stock, igual que los lotes). El admin ya ve todo. No hay políticas de escritura nuevas |
| Vistas `v_*` | `v_estado_neumaticos`, `v_alertas`, `v_ultima_medicion`, `v_resumen_flota_cliente` y las RPC `api_obtener_montaje` y `api_guardar_montaje` filtran `estado = 'montado'` o parten de vehículos: no cambian y una cubierta sin montar no entra en ellas (probado). `v_mediciones_neumatico` sí se ajusta: su regla 1 hacía `join vehiculos` y una cubierta devuelta a stock perdía su historial en la vista. Ahora lee el cliente de `neumaticos.cliente_id` y usa el vehículo actual o, en stock, aquel donde se midió; el join eliminado además la abarata. Sin CTE recursivas nuevas en vistas |
| Triggers | `neumaticos_condicion_auto` (`BEFORE INSERT/UPDATE`): «Nuevo» pasa a «Usado» al tener vehículo, también ante una escritura directa del admin. `neumaticos_normalizar_quema` sigue aplicando |
| `neumatico_cambiar` y `neumatico_rotar` | La rotación no cambia (opera por `vehiculo_id` y `posicion`). `neumatico_cambiar` se amplía (F.4) |
| `CHECK` de tipos de evento | Se amplía: `alta_stock`, `traslado`, `cambio_condicion` (constante `eventos_neumatico_tipo_ck`; se elimina la restricción de nombre automático) |

## F.2 Esquema

| Objeto | Detalle |
|---|---|
| `neumaticos.condicion` | `text not null default 'usado'`: `nuevo`, `usado`, `reparado` o `recauchutado`. Al crear la columna, lo existente queda `usado` (o `recauchutado` si `vida > 0`): todo neumático existente ya estuvo montado. La cubierta que se agrega nace `nuevo` |
| `neumaticos.sucursal_id` | `bigint` nullable, FK compuesta con `cliente_id`; solo con la cubierta sin montar. Al montar vuelve a `NULL` (la ubicación de un neumático montado es la de su vehículo) |
| `eventos_neumatico.sucursal_origen_id` y `sucursal_destino_id` | `bigint` sin FK (historial: sobrevive a la sucursal). Los nombres se copian en `notas` |
| Índice | `neumaticos_stock_idx (cliente_id, sucursal_id) where vehiculo_id is null` |
| `idneumatico` | `CB-<cliente>-<8 hex>`; se genera al agregar y no cambia |

**Condición, ubicación y vida son datos distintos.** «Recauchutado» es una etiqueta de la banda que marca el cliente (o el destino «Recauchutado» del cambio, que además suma una vida como antes). Marcarla a mano en stock **no** modifica `vida` (el flujo completo de recauchutado por carcasa es F5, `docs/16`).

## F.3 RPC nuevas (`SECURITY DEFINER`, `search_path = ''`, autorización dentro)

La autorización reutiliza `sucursal_autorizar_gestion` (apéndice de sucursales): **admin** (indica `p_cliente_id`) o perfil **global** de su propio cliente. Perfil de sucursal, rol `api`, sin perfil, `anon` y otro cliente reciben el mismo `42501`; para un no-admin, «no existe», «es de otro cliente» y «es de una sucursal» son indistinguibles. Hay dos auxiliares internos sin `grant`: `stock_cubierta_autorizar_por_id` (bloquea la fila `FOR UPDATE`) y `stock_cubierta_sucursal` (valida y bloquea la sucursal `FOR SHARE`).

| RPC | Qué hace |
|---|---|
| `stock_cubierta_agregar(p_numero_quema, p_marca, p_modelo, p_fecha_compra, p_precio, p_sucursal_id, p_cliente_id)` | Quema de 1 a 40 caracteres, marca obligatoria (hasta 60), precio ≥ 0, fecha no futura, sucursal del mismo cliente. Quema repetida (sin distinguir mayúsculas, en cualquier estado): `23505` «el número de quema ya está registrado en otro neumático». Crea la fila `nuevo/almacenado` y el evento `alta_stock` |
| `stock_cubierta_editar(p_id, p_datos jsonb)` | Claves admitidas: `marca`, `modelo`, `fecha_compra`, `precio`, `condicion` (ausente = no se toca; `null` borra modelo, fecha o precio). La condición solo pasa a `reparado` o `recauchutado`. **No** edita la quema ni la sucursal (esta última, con `mover`, para que nunca haya un cambio de ubicación sin registro). Cubierta montada: `55000`. Evento `cambio_condicion` si cambió y auditoría `STOCK_CUBIERTA_EDITAR` con antes y después |
| `stock_cubierta_mover(p_id, p_sucursal_id)` | `null` = «sin sucursal». Evento `traslado` con origen, destino, fecha y autor (`created_by`, `created_at`) y auditoría `MOVER_SUCURSAL` (entidad `neumaticos`). Mover al mismo lugar no hace nada |
| `stock_cubierta_eliminar(p_id)` | Solo si nunca se usó: sin mediciones y sin eventos que no sean propios del stock (`alta_stock`, `traslado`, `cambio_condicion`). Borra la fila y esos eventos y deja `STOCK_CUBIERTA_ELIMINAR` en `audit_log` con la fila completa. Si tuvo uso: `55000` y el historial se conserva |
| `sucursal_eliminar` | Ahora cuenta también las cubiertas en stock de la sucursal (`23503` con el recuento) |

## F.4 Montar y devolver (`neumatico_cambiar`, 13 parámetros)

Se elimina la firma de 9 argumentos; los 4 nuevos tienen valor por defecto, así que las llamadas anteriores siguen valiendo.

- `p_cubierta_id`: tercera fuente del neumático nuevo (exactamente una entre lote, cubierta e ingresado). Solo admin o perfil global. Bloquea la cubierta (`FOR UPDATE`), exige que sea del mismo cliente, sin vehículo y `almacenado` (si no, `P0002`), y hace `UPDATE` de la **misma fila**: ocupa la posición, `estado = 'montado'`, `sucursal_id = NULL`, y el trigger pasa «Nuevo» a «Usado». Conserva quema, `idneumatico`, `km_previos` y vida. El costo de compra se imputa una sola vez (primer montaje). Dos montajes simultáneos de la misma cubierta: uno confirma y el otro recibe `P0002` (probado en e2e).
- `p_devolver_stock`, `p_sucursal_stock`, `p_quema_viejo`: con destino `almacenado`, el neumático retirado **vuelve al stock** (misma fila, sin vehículo ni posición) en esa sucursal, conservando su quema; si no tenía, se indica `p_quema_viejo` (`22023` si falta, `23505` si ya existe). Solo admin o global. Sin `p_devolver_stock` se mantiene el comportamiento anterior (queda «aparcado» en una posición libre del vehículo): lo usa el perfil de sucursal y los flujos anteriores. El evento `desmontaje` conserva el vehículo y lleva la sucursal de destino.
- Los destinos `reencauche` y `reparacion` marcan la condición `recauchutado` y `reparado` del neumático retirado (siguen aparcados en el vehículo). Un neumático ingresado con vida mayor a 0 nace `recauchutado`; con vida 0, `usado`.

## F.5 Convivencia con los lotes anteriores

No se migran ni se tocan: `stock_neumaticos` sigue con su cantidad y su RLS (solo lectura para el cliente, ABM del admin) y `neumatico_cambiar(..., p_stock_id)` sigue descontando una unidad y creando un neumático nuevo `usado`. En el panel, «Cambiar neumático» ofrece «Cubierta del stock» (por defecto si hay), «Lote del stock» e «Ingresar uno nuevo». El bloque de lotes se muestra solo si el cliente tiene lotes (o al admin, que los carga); cuando no queden se podrá retirar.

## F.6 Panel

`views/stock.js` y `domain/stock-cubiertas.js`: lista con distintivo de condición (con texto: no depende del color), filtros por sucursal y condición, búsqueda por quema, marca o modelo, y las acciones Editar, Mover y Eliminar; «Agregar cubierta» (el admin elige el cliente). El filtro de sucursal de la barra superior es de vehículos y se oculta en Stock. El buscador global (`core/buscador.js`) suma las quemas de las cubiertas en stock: una coincidencia abre Stock filtrado; varias, una lista. Textos: `docs/14`.

## F.7 Riesgos y límites

- La RLS de `neumaticos` tiene ahora dos políticas de lectura del cliente (por vehículo y la de stock). Toda consulta nueva sobre `neumaticos` debe tener en cuenta que `vehiculo_id` puede ser nulo (las del panel que filtran por `vehiculo_id` no cambian).
- Los km por cubierta entre vehículos distintos se calculan en `v_km_cubierta` (apéndice H); `km_previos` no se actualiza al devolver a stock.
- Las cubiertas que vuelven por `reparacion` o `recauchutado` siguen «aparcadas» en el vehículo (comportamiento anterior); llevarlas al stock con su ubicación es parte de F1 y F5.
- Un perfil de sucursal que retira un neumático con «Almacenar» lo deja aparcado en su vehículo (no puede gestionar stock).
- `idneumatico` de cubiertas (`CB-…`) y de montajes manuales (`CN-…`) comparten el espacio único de `neumaticos.idneumatico`.
- Aplicación: la migración debe aplicarse **antes** de fusionar el front (usa `condicion`, `sucursal_id` y las RPC). Es aditiva e idempotente y no borra datos.

## F.8 Pruebas

SQL: `tests/sql/t_85_stock_cubiertas.sql` (matriz admin, global, sucursal, otro cliente, api, sin perfil y anon sobre las cuatro RPC; quema duplicada; sucursal de otro cliente; CHECK y FK; lectura y escritura directa; Nuevo → Usado al montar; no eliminar con uso; historial conservado al mover, montar y devolver; vistas y API sin cubiertas sin montar; lotes y destinos anteriores) y `t_60_seed_demo.sql` (12 cubiertas del demo); `run.sh` aplica la migración dos veces. Unitarias: `stock-cubiertas.test.mjs` y `cambio-neumatico.test.mjs`. Smoke: `stock.flow.js` y `cambio.flow.js`. Visual: `stock`, `stock-alta`, `stock-mover`, `stock-busqueda`, `cambio-cubierta` y `cambio-almacenar`. E2E: `specs/stock-cubiertas.mjs` (lista contra la base, alta, edición, traslado y eliminación por la interfaz, montar y devolver, montajes simultáneos, aislamiento de la sucursal y de «Otra Empresa SA»).

# Apéndice G · Montar y retirar neumáticos sin reemplazo (migración `20261114500000_montar_neumaticos.sql`)

Un vehículo creado sin neumáticos (`vehiculo_crear`) no podía recibirlos: `neumatico_cambiar` solo sustituye uno existente. La migración añade dos RPC `SECURITY DEFINER` (`search_path = ''`) con la **misma autorización que `neumatico_cambiar`** (`neumatico_autorizar_vehiculo`, que bloquea la fila del vehículo): admin; perfil global, en los vehículos de su cliente; perfil de sucursal, solo en los de su sucursal y sin usar el stock. Rol `api`, sin perfil, `anon` y otro cliente reciben el mismo `42501` (para un no-admin un vehículo inexistente es indistinguible de uno ajeno). No toca tablas, vistas ni RLS y es independiente de la migración de km por cubierta.

## G.1 `neumatico_montar(p_vehiculo_id, p_posicion, p_cubierta_id, p_nuevo, p_odometro_km, p_notas)`

Monta un neumático en una posición **libre**. Origen: una cubierta del stock (`p_cubierta_id`) o un neumático ingresado a mano (`p_nuevo`); exactamente uno.

| Regla | Detalle |
|---|---|
| Posición | Entero de 1 a 99. **Esperada** según el tipo del vehículo: 1-10 si `tipo_ruedas = 10`, 1-16 si es 16, y **99 = auxilio**. Igual que `layoutRuedas` del panel, un vehículo de 10 con algún neumático montado en 11..98 se trata como de 16. Las posiciones 17..98 no se crean aquí (las crea la ingesta de la API). Fuera de lo esperado: `23514` |
| Libre | Si cualquier fila ocupa `(vehiculo_id, posicion)` (también un neumático aparcado): `55000` «la posición N ya tiene un neumático». Un segundo auxilio: `55000` |
| Cubierta del stock | Solo admin o perfil global (sucursal: `42501`), del **mismo cliente** que el vehículo, sin vehículo y `almacenado`; si no (inexistente, de otro cliente o ya montada, mismo mensaje): `P0002`. Misma fila: conserva quema, `idneumatico`, `km_previos` y mediciones; `sucursal_id` pasa a `NULL` y el trigger convierte «Nuevo» en «Usado». El costo de compra se imputa solo en el primer montaje |
| Ingresado a mano | `p_nuevo` (jsonb): `marca` (obligatoria, hasta 60), `modelo`, `codigo`, `numero_quema` (hasta 40, **única por cliente** sin distinguir mayúsculas: `23505`), `km_previos` (entero 0..999999999), `fecha_compra` (no futura), `precio` (≥ 0), `vida` (entero 0..3; con vida > 0 nace «Recauchutado», si no «Usado»). Una clave desconocida da `22023`. `idneumatico` = `CN-<vehículo>-<posición>-<8 hex>` (el mismo formato que genera `neumatico_cambiar`) |
| Odómetro | Opcional: no puede ser menor al del vehículo (regla de `neumatico_cambiar`, `23514`); solo sube el del vehículo |
| Evento | `montaje` con `posicion_destino`, `odometro_km`, `costo`, `sucursal_origen_id` (cubierta del stock) y `notas` |
| Concurrencia | El vehículo queda bloqueado: dos montajes simultáneos en la misma posición se serializan (uno confirma, el otro `55000`). La cubierta se bloquea `FOR UPDATE`: la misma cubierta en dos vehículos, uno confirma y el otro `P0002` |

## G.2 `neumatico_desmontar(p_vehiculo_id, p_posicion, p_destino, p_motivo, p_odometro_km, p_sucursal_stock, p_quema)`

Retira el neumático **montado** de una posición **sin poner otro** (corrige un montaje equivocado). Sin neumático montado ahí: `P0002`.

| Destino | Efecto |
|---|---|
| `almacenado` (stock) | Solo admin o perfil global. Misma fila sin vehículo ni posición, en la sucursal indicada (del mismo cliente o `null` = sin sucursal), conservando quema, condición y mediciones. Necesita quema (la propia o `p_quema`, `22023` si falta, `23505` si ya existe). Evento `desmontaje` con la sucursal de destino |
| `reparacion` | Queda «aparcado» en el vehículo (posición libre de 98 hacia abajo, como en `neumatico_cambiar`) con estado `reparacion` y condición `reparado`. Evento `desmontaje` |
| `baja` | Motivo obligatorio (hasta 200). Aparcado con estado `baja`, `fecha_baja` y `motivo_baja`. Evento `baja` |

El odómetro opcional sigue la misma regla. La sucursal y la quema solo se aceptan con destino stock.

## G.3 API de proveedor

`api_guardar_montaje` resuelve por `neumaticos.idneumatico` de los neumáticos `montado`. Un coche al que se montan neumáticos (siempre con `idneumatico`) deja de dar el motivo `sin_neumaticos`: sus posiciones montadas guardan la medición, y una posición sin neumático sigue dando `posicion` (probado en SQL y e2e). Las mediciones quedan en el neumático: una cubierta del stock conserva su historial.

## G.4 Panel

`views/montar-neumatico.js` y `domain/montaje.js`. En el detalle del vehículo, las posiciones sin neumático se dibujan como **ruedas punteadas «Vacía»** (no «sin datos»: un neumático montado sin mediciones sigue siendo «sin datos»). Elegir una rueda vacía abre un panel con «Montar neumático»; un vehículo sin neumáticos muestra un estado vacío con «Cargar neumáticos». El modal tiene las pestañas «Del stock» (búsqueda por quema, marca o modelo; solo admin y perfil global) y «Cubierta nueva», y tras montar ofrece la **siguiente posición libre** sin cerrar el flujo («Terminar» lo cierra). El panel de una rueda montada suma «Retirar neumático» (destino stock + sucursal, reparación o baja + motivo). En Sucursales, «Cargar neumáticos ahora» lleva al detalle del vehículo recién creado. El auxilio no se dibuja vacío: se monta eligiendo «Auxilio» en la lista de posiciones.

## G.5 Riesgos y límites

- Retirar a reparación o baja deja el neumático aparcado en el vehículo (como `neumatico_cambiar`); llevarlo al stock con su ubicación al volver de reparación es parte de F1.
- Una baja por montaje equivocado queda como baja (con su motivo); para corregir sin perder la cubierta, retirar a stock.
- Se asume que `tipo_ruedas` es 10 o 16. Un vehículo con más ruedas necesita una migración propia.
- Aplicación: la migración debe aplicarse **antes** de fusionar el front. Es aditiva e idempotente y no borra datos.

## G.6 Pruebas

SQL: `tests/sql/t_87_montar_neumaticos.sql` (matriz admin, global, sucursal propia y ajena, otro cliente, api, sin perfil y anon; posición ocupada, fuera de rango y por tipo de ruedas; auxilio 99; quema duplicada; cubierta de otro cliente; odómetro; evento; desmontar a stock, reparación y baja; historial conservado; API). Unitarias: `montaje.test.mjs`. Smoke: `montar.flow.js` (`tests/smoke/run.sh montar`). Visual: `detalle-vacio`, `detalle-vacio-rueda`, `montar-neumatico`, `montar-nueva`, `montar-siguiente`, `retirar-neumatico`. E2E: `specs/montar-neumaticos.mjs` (coche vacío, montar del stock y nueva, retirar, alta con «Cargar neumáticos ahora», perfil de sucursal, «Otra Empresa SA», concurrencia y API).

# Apéndice H · Km por cubierta y control de odómetro (migración `20261115000000_km_por_cubierta.sql`, hoja de ruta F2)

## H.1 Regla

**Km totales de una cubierta = `km_previos` + suma de sus tramos montados.** Un tramo es un `montaje` y su cierre (`desmontaje` o `baja`) **en el mismo vehículo**: odómetro del evento de cierre menos odómetro del evento de montaje. El tramo en curso de una cubierta montada llega hasta el odómetro actual del vehículo (`vehiculos.odometro_km`), con mínimo 0. Nunca se comparan odómetros de vehículos distintos.

- **Rotación**: `neumatico_rotar` registra un evento `rotacion` por cubierta pero no abre ni cierra tramo: la cubierta sigue en el mismo vehículo, así que no se duplican ni se pierden km.
- **Cambio de vehículo**: son un `desmontaje` (cierra el tramo en el vehículo A, puede volver al stock) y un `montaje` (abre uno en el vehículo B). Los km de A quedan en `km_en_vehiculos`.
- **Sin precisión inventada**: un tramo sin odómetro en algún extremo, con fin menor que inicio, sin evento de montaje, o un montaje sin cierre en una cubierta que ya no está montada es un tramo **sin dato**: no suma km y deja `km_confiable = false`. Si todos los tramos son sin dato, el valor es NULL (nunca 0). Una cubierta que nunca estuvo montada tiene 0 km en vehículos (dato real) y su total son los `km_previos`.

## H.2 Vista `v_km_cubierta` (`security_invoker = true`, `select` solo para `authenticated`)

| Columna | Significado |
|---|---|
| `neumatico_id`, `cliente_id`, `vehiculo_id`, `idneumatico`, `numero_quema`, `estado` | identidad y ubicación actual (`vehiculo_id` nulo = stock) |
| `km_previos` | km que ya traía (`neumaticos.km_previos`) |
| `km_en_vehiculos` | suma de tramos cerrados con dato; 0 si no hay tramos cerrados; NULL si los hay y ninguno tiene dato |
| `km_tramo_actual` | odómetro actual del vehículo menos el del último montaje (mínimo 0); NULL si no está montada o falta algún odómetro |
| `km_totales` | `km_previos + km_en_vehiculos + km_tramo_actual` con lo conocido; NULL si hay tramos sin dato y ninguno con dato |
| `km_confiable` | false si hay tramos sin dato o un odómetro decreciente; true en caso contrario |
| `tramos_con_dato`, `tramos_sin_dato`, `odometro_anomalo` | desglose de la confiabilidad |

Una cubierta montada sin evento de `montaje` (p. ej. cargada a mano antes de existir el historial) tiene tramo actual NULL y `km_confiable = false`: la vista no supone un odómetro de montaje.

**Historial completo con RLS.** Los tramos de cada cubierta los agrega `km_tramos_cubierta(p_neumatico)` (`SECURITY DEFINER`, `search_path = ''`, `plpgsql`, `select`/`execute` sin `anon`). La RLS de `eventos_neumatico` oculta a un perfil de sucursal los eventos de vehículos de otras sucursales; si la vista agregara solo los eventos visibles, una cubierta que pasó por otra sucursal mostraría km subestimados con `km_confiable = true`. La función responde **solo** por una cubierta que quien llama ya puede ver (el mismo criterio que las políticas de `neumaticos`: admin; perfil cliente con la cubierta en un vehículo de su cliente y, si es de sucursal, de su sucursal; perfil global con la cubierta en su stock) y devuelve solo agregados (cantidad de tramos, km, último odómetro de montaje y si hubo odómetro decreciente), sin fechas, notas ni datos de otras sucursales. Para `api`, sin perfil u otro cliente no devuelve ninguna fila (ni una de ceros). Un rol que ya omite la RLS (`service_role`, dueño, superusuario) ve todo. Los eventos en sí siguen ocultos para el perfil de sucursal.

**Rendimiento.** Sin CTE recursiva. La vista hace un `LATERAL` correlacionado por `n.id` (la función usa `eventos_neumatico_neum_idx`), así que un filtro por `vehiculo_id` o `neumatico_id` solo agrega los eventos de esas cubiertas. Medido con `tests/perf/gen.sql` (ahora con unos 7 eventos de km por neumático: montajes, desmontajes en otro vehículo y rotaciones) y `tests/perf/bench.sh`, como `authenticated` con RLS, mediana de 3 `EXPLAIN ANALYZE`:

| Consulta | PG17 `jit=off`, 3.000 neumáticos / 18.905 eventos | PG17 `jit=off`, 29.400 / 189.050 | PG16 `jit=on`, 3.000 |
|---|---|---|---|
| un vehículo, cliente | 2,7 ms | 2,8 ms | 2,8 ms |
| un vehículo, admin | 2,3 ms | 2,3 ms | 2,3 ms |
| un neumático, cliente | 1,8 ms | 1,7 ms | 1,8 ms |
| vista completa, cliente | 83 ms | 87 ms | 82 ms |
| vista completa, admin | 72 ms | 819 ms | 73 ms |

Costo estimado del plan: 140 a 153 por vehículo; vista completa 30.350 (3.000) y 303.693 (29.400 como admin, que en una base con JIT activo lo dispararía; producción tiene `jit = off`). La vista completa cuesta unos 30 µs por cubierta (una llamada a la función por fila): para reportes sobre toda la flota (F4) conviene una agregación por lotes.

## H.3 Diagnóstico `odometro_anomalias(p_vehiculo bigint)`

Función `STABLE`, `SECURITY INVOKER` (la RLS de `eventos_neumatico` y `vehiculos` decide qué se ve; un vehículo ajeno devuelve cero filas), sin `grant` a `anon`. **Señala; no corrige ni borra nada.** Recorre los eventos con odómetro del vehículo por fecha y devuelve una fila por anomalía:

| `anomalia` | Cuándo |
|---|---|
| `decreciente` | el odómetro del evento es menor al del evento anterior con odómetro del mismo vehículo |
| `negativo` | odómetro < 0 (la tabla ya lo impide con un CHECK; defensa por si se relaja) |
| `actual_menor_que_evento` | el odómetro actual del vehículo es menor al del último evento con odómetro |

Columnas: `vehiculo_id, evento_id, neumatico_id, tipo_evento, fecha, odometro_km, odometro_previo_km, evento_previo_id, anomalia`. En la fila `actual_menor_que_evento` no hay evento propio: `evento_id` es NULL, `odometro_km` es el odómetro actual del vehículo y `evento_previo_id`, `odometro_previo_km`, `tipo_evento`, `fecha` y `neumatico_id` son los del último evento con odómetro. La vista marca `odometro_anomalo` con el mismo criterio pero solo sobre los eventos del propio neumático (un odómetro decreciente entre eventos de neumáticos distintos del mismo vehículo lo ve la función, no la vista): así la vista se puede consultar por vehículo o por neumático sin recorrer todos los eventos.

`neumatico_cambiar` rechaza un odómetro menor al actual del vehículo (`23514`) y `vehiculo_registrar_odometro` solo deja bajarlo al admin; no cambian. La corrección auditada de un odómetro queda pendiente de F2.

## H.4 Invariantes de montaje (verificados, sin cambios de esquema)

- Una posición, una cubierta: `neumaticos_vehiculo_posicion_uk unique (vehiculo_id, posicion)` (las cubiertas de stock tienen ambos nulos y no chocan) y un solo auxilio por vehículo (`neumaticos_un_auxilio_por_vehiculo`).
- Una cubierta, una posición: cada cubierta es una fila de `neumaticos`; solo tiene un `vehiculo_id` y una `posicion`; el CHECK `neumaticos_stock_ck` exige que sean ambos nulos o ambos con valor.
- Montaje simultáneo de la misma cubierta: `neumatico_cambiar` la bloquea con `FOR UPDATE`; uno confirma y el otro recibe `P0002` (`tests/e2e/specs/stock-cubiertas.mjs`, «dos montajes simultáneos»).
- Rotación atómica: `neumatico_rotar` intercambia por una posición libre dentro de una transacción.

## H.5 Límites

- Un perfil de **sucursal** ve los km completos de sus cubiertas (incluidos los tramos en vehículos de otras sucursales) a través de `km_tramos_cubierta`, pero no los eventos de esas sucursales: el detalle de dónde se recorrieron queda para el perfil global y el admin.
- Los eventos se ordenan por `created_at` y luego por `id`: una carga manual con fecha anterior que altere el orden puede producir tramos sin dato.
- El orden de eventos de un mismo instante (varios eventos de una RPC comparten transacción) se resuelve por `id`.

## H.6 Panel y pruebas

Panel: el detalle del vehículo (panel de la rueda) y Ciclo de vida muestran «Km que ya traía», «Km recorridos», «En el tramo actual» y «Km totales» desde `v_km_cubierta` (`domain/km-cubierta.js`), con la nota «Estimado: faltan lecturas de odómetro» (o «hay lecturas de odómetro decrecientes») cuando `km_confiable` es false y «Sin dato» cuando no hay ningún tramo con dato. Se retiraron `kmPorNeumatico` y `kmTotalesNeumatico`: el cálculo vive solo en la base.

Pruebas: SQL `tests/sql/t_86_km_por_cubierta.sql` (tramos, rotación sin duplicar, cambio de vehículo por el stock, odómetros faltantes, decreciente, invariantes, matriz admin / global / sucursal Norte y Sur / otro cliente / api / sin perfil / anon, los km completos que ve Sur de una cubierta que pasó por Norte y `km_tramos_cubierta` sin filas para quien no ve la cubierta); `run.sh` aplica la migración dos veces. Unitarias: `km-cubierta.test.mjs`. Smoke: `vehiculo.flow.js` y `ciclo.flow.js`. Visual: `ciclo-vida` y `detalle-rueda-km`. E2E: `specs/km-cubierta.mjs`.

## I. Calidad de datos de las mediciones (migración `20261116000000`)

Decisión: columnas en `mediciones` (no una tabla aparte), para que cada sonda por índice de las vistas filtre sobre la fila que ya lee, sin anti-join. El historial de cambios vive en `audit_log` (inmutable).

| Columna | Significado |
|---|---|
| `calidad` | `valida` (defecto) / `sospechosa` / `invalidada`. Solo `invalidada` se excluye de `v_mediciones_neumatico`, `v_ultima_medicion`, `v_estado_neumaticos`, `v_alertas`, `ultimas_mediciones`, `api_obtener_montaje` y de los reportes del panel. |
| `calidad_motivo`, `calidad_at`, `calidad_por` | Hallazgo o motivo, momento y autor (`sistema` o uuid del usuario). |
| `unidad_origen` | `mm` (defecto) o `32avos`. `mm1..mm3` siempre normalizados a mm (1/32" = 0,79375 mm; `convertir_32avos_a_mm`, espejo de `convertir32avos` en `mapping.ts`). |
| `valor_original` | jsonb opcional con el valor crudo en la unidad de origen. La API de proveedor sigue recibiendo mm. |
| `clientes.huella_absurda_mm` | Umbral por cliente (defecto 10 mm) de la regla de huellas. |

Detección: `medicion_evaluar_calidad` (función pura) y el trigger `AFTER INSERT` `mediciones_registrar_calidad`, que nunca rechaza la inserción (un fallo interno queda como aviso). Reglas, todas hacia `sospechosa`: medición incompleta o no numérica (nulo, nunca cero; la tabla exige las tres huellas), huella fuera de 0..30 mm, diferencia entre huellas mayor al umbral, aumento mayor a 1,0 mm del promedio sin evento de recauchutado, reparación o montaje entre ambas («Aumento sin recauchutado»), lectura duplicada (±2 min) y odómetro menor al anterior del vehículo. Una medición invalidada que era la previa se ignora al comparar.

Acción manual: `medicion_invalidar(p_medicion_id, p_motivo)` (motivo obligatorio, 3 a 300 caracteres) y `medicion_revalidar(p_medicion_id)`; SECURITY DEFINER, `search_path = ''`; admin, perfil global (su cliente) o perfil de sucursal (su sucursal); resto 42501. Ambas registran en `audit_log` (`INVALIDAR_MEDICION`, `REVALIDAR_MEDICION`; los hallazgos del sistema, `CALIDAD_DETECTADA`).

Límites: una medición etiquetada invalidada sigue impidiendo la atribución por posición (el neumático figura «sin datos»). Una medición antigua que llega tarde no se recomprueba contra las posteriores. No hay pantalla para editar `huella_absurda_mm`. Pruebas: `tests/sql/t_88_calidad_datos.sql`.

# Apéndice K · Precios y costos solo para admin y perfil global (migración `20261116500000_privilegios_precios.sql`)

## K.1 El fallo
La RLS filtra **filas**, no columnas. `authenticated` tenía `SELECT` de tabla sobre `neumaticos` y `eventos_neumatico`, así que un perfil de **sucursal** (rol `cliente` con `sucursal_id`) leía por la API REST `neumaticos.precio_unidad` y `eventos_neumatico.costo` de los vehículos de su sucursal. La regla del producto es que ese perfil no ve costos ni precios (`stock_neumaticos` ya los esconde: su política es solo del perfil global).

## K.2 Solución: privilegios por columna
| Pieza | Qué hace |
|---|---|
| `REVOKE SELECT` de tabla a `authenticated` sobre `neumaticos` y `eventos_neumatico` | Se otorga de nuevo `SELECT (columna, …)` para todas **menos** `precio_unidad` y `costo`. Pedir esas columnas, o `*`, filtrarlas, ordenarlas o embeberlas (`vehiculos?select=neumaticos(precio_unidad)`) responde **403 / 42501** a todos los autenticados, admin incluido. `anon` sigue sin nada |
| `precios_visibles()` | `SECURITY DEFINER`, `search_path=''`, `stable`; `true` para el admin y para el perfil **global** de un cliente (rol `cliente`, sin sucursal); `false` para sucursal, rol `api`, sin perfil. Solo `authenticated` ejecuta |
| `neumaticos_precios(p_vehiculo bigint default null, p_solo_stock boolean default false)` → `(id, precio_unidad)` | Único camino de lectura del precio. Solo filas con precio, ordenadas por `id` (se pagina con `.order('id').range()`: PostgREST corta en 1.000). Alcance igual al de la RLS de `neumaticos`: admin todo; global los neumáticos de vehículos de su cliente y las cubiertas de stock de su cliente. Para los demás: cero filas (no error) |
| `eventos_costos(p_vehiculo bigint default null)` → `(id, costo)` | Igual para el costo de los eventos (alcance de `eventos_cliente_select`: eventos del propio cliente) |

Las escrituras no cambian: `INSERT`/`UPDATE` siguen siendo privilegios de tabla y solo el admin tiene política. Las RPC `SECURITY DEFINER` (`neumatico_cambiar`, `neumatico_montar`, `stock_cubierta_*`) leen y escriben como su dueño y no se ven afectadas; copian el precio al evento (`costo`) como antes.

## K.3 Qué NO cambia y por qué sigue funcionando
Las vistas `security_invoker` (`v_estado_neumaticos`, `v_alertas`, `v_mediciones_neumatico`, `v_ultima_medicion`, `v_km_cubierta`, `v_resumen_flota_cliente`) y las funciones `SECURITY INVOKER` (`ultimas_mediciones`, `odometro_anomalias`, `posiciones_medidas_sin_neumatico`) leen estas tablas con los privilegios del invocante, pero **ninguna lee `precio_unidad` ni `costo`**: se comprobó por rol. Los privilegios de columna no alteran el plan: `tests/perf/bench.sh` sobre 3 clientes × 300 vehículos (8.820 neumáticos) da los mismos tiempos antes y después (p. ej. `v_estado_neumaticos` 1.000 filas como cliente 21,4 → 21,8 ms; `v_km_cubierta` completa como admin 224 → 222 ms; `v_alertas` 29,9 → 29,8 ms). `neumaticos_precios()` cuesta unos 0,8 ms para un vehículo y 3 a 5 ms para toda la base de esa prueba.

## K.4 Contrato para migraciones futuras
- Una **columna nueva** de `neumaticos` o `eventos_neumatico` no es legible hasta que la migración haga `grant select (columna) on …`. `tests/sql/t_90_precios_solo_global.sql` falla si alguna columna (salvo `precio_unidad`/`costo`) no tiene el permiso.
- **Ninguna vista `security_invoker` ni función `SECURITY INVOKER` puede leer `precio_unidad` o `costo`**: fallaría con 42501 para todos. Debe usar `neumaticos_precios()` / `eventos_costos()`, o ser `SECURITY DEFINER` con `precios_visibles()` en su condición y su propio filtro de alcance. **F4 (costos y CPK, `v_costo_cubierta`) debe reutilizar `precios_visibles()` como su `costos_visibles()`** (misma regla) y reescribir las lecturas de `n.precio_unidad` y `e.costo`.
- `INSERT ... ON CONFLICT DO UPDATE SET precio_unidad = excluded.precio_unidad` también exige `SELECT` sobre la columna: no usar `upsert` con ella. El panel del admin (Neumáticos del vehículo) actualiza por `id` o inserta. Los `RETURNING`/`.select()` tras escribir no pueden pedir `precio_unidad` ni `costo`.
- `select('*')` sobre `neumaticos` o `eventos_neumatico` ya no funciona para `authenticated`: usar listas de columnas.

## K.5 Panel
`core/precios.js` (`traerPrecios`, `traerCostos`) llama a las funciones solo si `puedeVerPrecios()` (admin o perfil global; espejo de `precios_visibles()` en `domain/rol.js`): el perfil de sucursal no hace la llamada. Se incorporan por `id` con `domain/precios.js` (`conValor`). Usan los precios: **Stock** (`views/stock.js`, cubiertas sin montar), **Ciclo de vida** (costo de cada evento) y **Neumáticos del vehículo** del admin (`views/neumaticos.js`, que ya no hace `upsert` y no guarda si no pudo cargar los precios, para no pisarlos con vacío). El reporte imprimible dejó de pedir `precio_unidad` (no lo mostraba).

## K.6 Pruebas
SQL `tests/sql/t_90_precios_solo_global.sql`: contrato de privilegios (tabla, columna, columnas nuevas, `anon`, `PUBLIC`), sucursal Norte y Sur (denegado por select directo, `select *`, `to_jsonb`, filtro, orden, agregado y subconsulta; sigue leyendo el resto con su RLS; funciones vacías; vistas y funciones existentes; `neumatico_cambiar` con precio), global, admin (incluidas escrituras: insert, update por id, `RETURNING`; el upsert con `excluded.precio_unidad` se documenta como denegado), otro cliente, rol `api`, sin perfil y `anon`. Los tests existentes que leían precio o costo como `authenticated` usan ahora `test.pu(id)` / `test.cu(id)` (`01_fixtures.sql`). Smoke: `privilegios.fixture.js` emula los privilegios (cualquier `select('*')` o con las columnas sensibles falla con 42501 y la sucursal no puede llamar a las funciones; `precios.flow.js`). Unit `tests/unit/precios.test.mjs`. E2E `tests/e2e/specs/precios-solo-global.mjs`: matriz por la API real (403/42501 en todas las formas de pedir, funciones por rol contra la verdad SQL, Otra Empresa SA aislada, `anon`), el panel de sucursal sin precios, Stock y Ciclo de vida con importes, y la edición del admin sin pisar los demás precios.

## K.7 Aplicación y riesgos
Aplicar con `supabase db push --remote` **antes** de fusionar el front. Orden de versión: entre `20261116000000` (calidad de datos) y `20261117000000` (costos y CPK). El front anterior (`select('*')` en `neumaticos` y `eventos_neumatico`, `upsert` del admin, `precio_unidad` en Stock) deja de funcionar al aplicar la migración, y el nuevo front no funciona sin ella (llama a las funciones). Cualquier integración externa que lea esas dos columnas con un usuario `authenticated` recibirá 42501; `service_role` (Edge Functions, API de proveedor) no cambia. La API de proveedor no devuelve precios. Si algún día se habilita Realtime sobre `neumaticos` o `eventos_neumatico`, tener en cuenta que Realtime filtra filas con la RLS pero no aplica privilegios de columna: las dos tablas no deben publicarse (hoy no hay ninguna publicación ni suscripción).

---

# Apéndice J · Costos por cubierta y costo por km, CPK (migración `20261117000000_costos_cpk.sql`, hoja de ruta F4)

## J.1 Tabla `costos_neumatico`

`id`, `cliente_id`, `neumatico_id`, `concepto` (`compra`, `reparacion`, `recauchutado`, `montaje`, `otro`), `monto numeric(12,2) >= 0`, `moneda` (3 letras mayúsculas, por omisión `UYU`), `fecha`, `notas` (hasta 500), `created_by`, `created_at`. FK compuesta `(neumatico_id, cliente_id)` a `neumaticos (id, cliente_id)` (se agrega `unique (id, cliente_id)`, trivial porque `id` ya es clave primaria), `on delete cascade`: borrar una cubierta borra sus costos y queda en `audit_log`. Auditoría con `audit_row`.

RLS: lectura solo para el admin y el perfil **global** del cliente. El perfil de sucursal, `api`, anon y sin perfil no ven nada. Sin políticas ni privilegios de escritura: se escribe solo con `costo_registrar` y `costo_eliminar` (`SECURITY DEFINER`, `search_path = ''`, autorización con `sucursal_autorizar_gestion`: admin o global del cliente dueño; todo lo demás, incluida una cubierta o costo inexistente para un no admin, es `42501`; el admin recibe `P0002`). Validaciones: concepto, monto (>= 0, no NaN, hasta 9.999.999.999,99), moneda de 3 letras (se normaliza a mayúsculas), fecha no posterior a mañana ni anterior a 2000, notas.

## J.2 Sin doble conteo

El precio de compra ya existe en `neumaticos.precio_unidad` y `neumatico_cambiar` / `neumatico_montar` lo copian al evento de `montaje` (`eventos_neumatico.costo`, solo en el alta o primer montaje). Es la misma compra. La vista cuenta **una** compra, con esta precedencia: entradas `compra` de `costos_neumatico` (corrigen el dato original) > `precio_unidad` > costo del evento de montaje (cubiertas cargadas sin precio). Eventos con costo que no son montaje suman por tipo (`reparacion`, `reencauche` como `recauchutado`, el resto como `otro`). Las demás entradas manuales suman siempre. Un costo escrito a mano directamente en un evento de `montaje` se descarta si hay precio (`precio_unidad` o entrada `compra`): se toma como la compra repetida. `precio_unidad` y los eventos sin moneda se toman como `UYU`.

## J.3 Vista `v_costo_cubierta` (`security_invoker`, solo `authenticated`)

Una fila por cubierta visible, solo para quien ve costos (`precios_visibles()` de la migración 20261116500000: admin y global; un rol que omite la RLS ve todo): el perfil de sucursal no recibe filas. Columnas: identidad y `sucursal_id` efectiva, `marca`, `modelo`, `vida`, `condicion`, `fecha_alta` (compra o creación), `tiene_costo`, `moneda`, `monedas`, `moneda_mixta`, `costo_total`, `costo_por_concepto` (jsonb), `km_totales`, `km_recorridos`, `km_confiable` (de `v_km_cubierta`), `cpk`, `cpk_provisional`, `cpk_carcasa`.

- Monedas distintas: `costo_total`, `costo_por_concepto`, `cpk` y `cpk_provisional` son NULL y `moneda_mixta` es true. Nunca se suman monedas.
- **Costo por km recorrido.** `km_recorridos = km_totales - km_previos`: lo recorrido en vehículos (tramos cerrados más tramo actual). `cpk = costo_total / km_recorridos` solo con `km_confiable` y `km_recorridos > 0`; si no, NULL (nunca divide por cero ni inventa). El costo total (incluida la compra) se divide íntegro sobre los km recorridos desde que el cliente tiene la cubierta: los `km_previos` no entran en el divisor. `cpk_provisional` es el mismo cociente cuando los km no son confiables pero hay `km_recorridos > 0` (la interfaz lo rotula «Estimado»). `cpk_carcasa = costo_total / km_totales` (con los km previos) es una columna aparte, solo con km confiables.
- **Dependencia de `v_km_cubierta`.** `v_costo_cubierta` se basa en `v_km_cubierta`: al cambiar o recrear esa vista (`drop view`) hay que recrear `v_costo_cubierta` (reaplicar la migración 20261117).
- **Vida y carcasa.** La identidad del neumático es la carcasa y la vista acumula costos y km de todas sus vidas (`cpk_carcasa` es el CPK final de carcasa: costo neto total / suma de km de todas las vidas; `cpk` solo cuenta lo recorrido). Un CPK por vida requiere el flujo de F5 (vida con costo y km propios).

## J.4 `cpk_por_grupo(p_grupo, p_desde, p_hasta, p_cliente_id)`

`p_grupo` es `marca`, `modelo` (marca + modelo) o `sucursal` (la del vehículo donde está montada o la de stock). **CPK de grupo = suma de costos / suma de km**, nunca el promedio de CPK individuales (ejemplo de prueba: CPK 1,0 y 0,01 con km recorridos 1.000 y 10.000 dan 0,1, no 0,505). Entran solo cubiertas con costo en una moneda y km recorridos confiables > 0 (el grupo suma `km_recorridos`); las demás con costo se cuentan en `n_sin_km`; las de moneda mixta no entran. Una fila por grupo y moneda. `muestra_baja` si `n_neumaticos < 5`. `p_desde`/`p_hasta` definen una **cohorte** por fecha de alta (inclusivos, opcionales): los costos y km de cada cubierta son siempre los de toda su vida. `p_cliente_id` acota a un cliente (el admin, si no, agrega todos). `SECURITY INVOKER` sobre la vista: el perfil de sucursal no recibe filas.

## J.5 Rendimiento

`tests/perf/gen.sql` (ahora con marcas, precios, montajes con costo y costos manuales) y `tests/perf/bench.sh`; mediana de 3 `EXPLAIN ANALYZE`, como `authenticated` con RLS, en ms.

| Consulta | PG17 `jit=off` 3.000 neum. | PG17 `jit=off` 29.400 | PG16 `jit=on` 29.400 |
|---|---|---|---|
| costo de un vehículo, cliente | 4,7 | 4,9 | 4,9 |
| costo de un vehículo, admin | 4,0 | 4,1 | 4,4 |
| costo de un neumático, cliente | 2,5 | 2,5 | 2,6 |
| vista completa, cliente (3.000 de su cliente) | 183 | 185 | 191 |
| vista completa, admin | 164 | 1.833 | 1.876 |
| `cpk_por_grupo` marca, cliente | 184 | 188 | 198 |
| `cpk_por_grupo` modelo, cliente | 184 | 192 | 195 |
| `cpk_por_grupo` sucursal, cliente | 187 | 186 | 198 |
| `cpk_por_grupo` marca, admin (todos los clientes) | 163 | 1.849 | 1.928 |

Sin CTE recursiva. Tras los privilegios por columna (apéndice K), la vista `security_invoker` no puede leer `precio_unidad` ni `eventos_neumatico.costo`: el costo de cada cubierta lo calcula `costo_cubierta_items(neumatico_id)` (`SECURITY DEFINER`, `search_path = ''`, exige `precios_visibles()` y que la cubierta sea visible para quien llama; devuelve también marca, modelo, vida, condición, fecha de alta y sucursal efectiva, de modo que la vista no vuelve a unirse a `neumaticos`). Es una llamada por fila (unos 20 µs), igual que `km_tramos_cubierta`; frente a la versión que leía las tablas, la vista completa de un cliente pasó de unos 110 ms a unos 185 ms y el admin sobre 29.400 cubiertas de 1,1 s a 1,8 s. Se eligió una función por fila y no una vista `SECURITY DEFINER` para no disparar el aviso del linter de Supabase y conservar la RLS de `v_km_cubierta`. El reporte de toda la flota del admin se evita en el panel: exige elegir cliente (`p_cliente_id`).

## J.6 Panel y pruebas

Panel: panel de la rueda y Ciclo de vida muestran «Costo» y «Costo por km» (nota «Estimado: faltan lecturas de odómetro» cuando corresponde) y «Registrar costo» (modal: concepto, monto, moneda, fecha, notas) solo para admin y perfil global; Reportes agrega la tabla «Costo por km» por marca, modelo o sucursal con muestra y km, el aviso de comparación y exportación CSV. Dominio `domain/costos.js`. En Reportes, el administrador debe elegir un cliente (sin cliente no se consulta: «Elegir un cliente para ver el costo por km»); con una sucursal elegida en el selector del perfil global, el reporte por marca o modelo no se filtra por ella (la pantalla lo avisa).

## J.7 Precios y costos con privilegios por columna

Desde la migración 20261116500000 (apéndice K) `authenticated` no tiene `select` sobre `neumaticos.precio_unidad` ni `eventos_neumatico.costo`; el perfil de sucursal tampoco los lee por la API. Esta migración respeta ese contrato: `v_costo_cubierta` lee precio y costo solo por `costo_cubierta_items` (`SECURITY DEFINER`, con `precios_visibles()`), y `costos_neumatico`, la vista y `cpk_por_grupo` devuelven vacío al perfil de sucursal. No hay interfaz para eliminar costos (la RPC `costo_eliminar` existe).

---

# Apéndice L · Recauchutado por carcasa (migración `20261118000000_recauchutado_carcasa.sql`, hoja de ruta F5)

## L.1 Modelo

La carcasa es la fila de `neumaticos` (misma quema, mismo `idneumatico`). Un recauchutado exitoso suma una **vida** (`neumaticos.vida`, 0 a 3) a esa misma fila; los km no se reinician (`v_km_cubierta` sigue sumando todos los tramos). La vida 0 es la banda original.

Flujo: `enviado` → `apto` (dictamen del proveedor) → `recibido` (aceptación, nueva banda). Un rechazo (dictamen no apto, o rechazo al recibir una cubierta apta) cierra el proceso como `rechazado` **sin** crear vida ni costo: la cubierta vuelve al stock con la vida y la condición que tenía.

| Objeto | Detalle |
|---|---|
| `recauchutados` | Un proceso por envío: cubierta, copia de quema, marca y modelo, `vida_origen`, `vida_nueva` (solo si `recibido`), proveedor, fechas de envío, dictamen y cierre, motivo, notas. Un solo proceso abierto (`enviado` o `apto`) por cubierta (índice único parcial) |
| `neumatico_vidas` | Una fila por banda aplicada (vida 1 a 3): profundidad inicial (mm, 0 a 30), marca y modelo de la banda. `unique (neumatico_id, vida)` |
| `costos_neumatico.vida` | El costo pertenece a una vida. Los costos anteriores se asignaron a la vida actual de su cubierta (la compra, a la vida base) al crear la columna |
| Eventos | `envio_recauchutado`, `dictamen_recauchutado`, `rechazo_recauchutado`; la aceptación deja un `reencauche` sin costo (el costo va en `costos_neumatico`, sin doble conteo). El `reencauche` justifica un aumento de profundidad en F3 y reinicia la ventana de la tasa |

Lectura por RLS: admin y perfil global del cliente (como el stock); sucursal, otro cliente, api, sin perfil y anon no ven nada. Sin escritura directa.

## L.2 RPC (`SECURITY DEFINER`, `search_path = ''`, autorización dentro)

Autorización: `sucursal_autorizar_gestion` (admin, o perfil global del cliente dueño). Sucursal, api, sin perfil, anon, otro cliente e inexistente (para un no-admin) dan el mismo `42501`; el admin recibe `P0002` si no existe. Los procesos se bloquean `FOR UPDATE` (junto con la cubierta): dos operaciones concurrentes, una confirma y la otra recibe `55000`.

| RPC | Regla |
|---|---|
| `recauchutado_enviar(p_neumatico_id, p_proveedor, p_fecha, p_notas)` | Cubierta no montada y no dada de baja, con vida < 3 y sin proceso abierto. Una cubierta aparcada en un vehículo sale de él. Queda sin vehículo ni sucursal («en el proveedor») |
| `recauchutado_dictaminar(p_id, p_apto, p_motivo, p_fecha, p_sucursal_id)` | Desde `enviado`. Apto → `apto`. No apto exige motivo, cierra como `rechazado` y devuelve la cubierta a la sucursal indicada |
| `recauchutado_aceptar(p_id, p_profundidad_mm, p_banda_marca, p_banda_modelo, p_costo, p_moneda, p_fecha, p_sucursal_id, p_notas)` | Desde `apto`. Profundidad obligatoria. Suma la vida, condición `recauchutado`, fila en `neumatico_vidas`, costo `recauchutado` de la vida nueva (opcional) y evento `reencauche`. Todo o nada |
| `recauchutado_rechazar(p_id, p_motivo, p_fecha, p_sucursal_id)` | Desde `apto`, con motivo |

**Guardia:** el trigger `neumaticos_guardia_recauchutado` impide, con `55000`, cambiar `vehiculo_id`, `sucursal_id`, `estado` o `vida` de una cubierta con proceso abierto (no se monta con `neumatico_montar` ni `neumatico_cambiar`, ni se mueve). Las RPC la omiten con una variable de transacción que apagan al terminar.

`neumatico_cambiar` con destino «Recauchutado» sigue sumando la vida al retirar el neumático, sin proceso ni banda registrada (para un recauchutado hecho fuera de este flujo). Se consideran ambos caminos al repartir costos y km.

## L.3 Costo y km por vida

Vida vigente en un evento = `vida_base` + eventos `reencauche` hasta él, con `vida_base = neumaticos.vida` menos el total de eventos `reencauche` (cubiertas que entraron con vida > 0). `costo_vida_items(neumatico_id)` (`SECURITY DEFINER`, solo con `precios_visibles()`, mismo contrato que `costo_cubierta_items`) devuelve una fila por vida: costo (mismas fuentes y misma regla de no doble conteo; la suma de las vidas es el total de la carcasa; la compra va a la vida base), y km (tramos de montaje asignados a la vida vigente al montar; tramo sin dato → `km_confiable = false`; los `km_previos` no pertenecen a ninguna vida).

- `v_costo_vida` (`security_invoker`): una fila por cubierta y vida con banda, profundidad inicial, costo, moneda mixta (→ NULL), km, `cpk` y `cpk_provisional`. La sucursal no recibe filas.
- `cpk_por_grupo(p_grupo, …)` acepta `'vida'` («Banda original», «Recauchutado nº N») y `'banda'` (marca y modelo de la banda; «Sin dato de banda» si no se registró). Mismas reglas: ponderado, muestra baja (< 5), una fila por grupo y moneda, cohorte por fecha de alta de la cubierta.
- Sin CTE recursiva en vistas; planes muy por debajo de 100.000 (probado en `t_91`).

## L.4 Panel y pruebas

Panel: vista **Recauchutado** (admin y perfil global; `views/recauchutado.js`, `domain/recauchutado.js`): lista de procesos con las acciones de cada estado y «Enviar a recauchutar» (solo cubiertas del stock); Stock marca «En recauchutado» y oculta «Mover»; Reportes suma los grupos «Vida» y «Banda» al costo por km. Textos según `docs/14`.

Pruebas: SQL `tests/sql/t_91_recauchutado_carcasa.sql` (flujo completo, rechazos sin vida ficticia, guardia, matriz de roles, costos y km por vida, ponderación, planes), con doble pasada de la migración y PG16/PG17. Unitarias: `recauchutado.test.mjs`. Smoke: el menú de `inicio.flow.js`.

## L.5 Límites

- Un recauchutado hecho por «Cambiar neumático» no registra banda ni proceso.
- El costo por vida usa los km recorridos en vehículos de esa vida; un recauchutado sin km aún no tiene costo por km.
- Aplicación: la migración debe aplicarse **antes** de fusionar el front. Es aditiva e idempotente; la asignación de `vida` a los costos existentes se hace una sola vez, al crear la columna.

---

# Apéndice M · Alerta única «Neumático crítico» con estado (migración `20261118500000_alerta_critica.sql`, hoja de ruta F7)

Implementa la etapa 1 de `docs/15` sección B. Sin ML. La migración está lista para aplicar; no se aplicó a Supabase desde el PR.

## M.1 Regla de producto

Un solo tipo de alerta: **crítico**. Un neumático montado genera una alerta cuando su promedio de mm es menor que el umbral crítico de su cliente (`clientes.umbral_critico_mm`), que el propio cliente edita. «Bajo», «cruza el crítico pronto», «desgaste irregular» y «sin medir» ya no son alertas: son indicadores de `v_estado_neumaticos` (`estado`, `semanas_hasta_critico`, `desgaste_irregular`, `sin_medir`), visibles en la ficha, el diagrama y «Requieren atención». Un dato no medido (promedio nulo) nunca abre alerta.

## M.2 Esquema

- `clientes.alerta_histeresis_mm numeric(3,1)` (0,5 por defecto, entre 0 y 3).
- Tabla `alertas` (RLS activa; `authenticated` solo `select`): `estado` (`abierta`, `reconocida`, `resuelta`), `umbral_mm` vigente, `mm_apertura`, `mm_minimo`, `mm_actual`, `silenciada_hasta` con motivo y autor, `resuelta_motivo` (`recuperada`, `cambio`, `baja`, `manual`, `sin_datos`), `veces_reabierta`. Índice único parcial: a lo sumo una alerta no resuelta por neumático. Auditada con `audit_row` (`trg_audit_alertas`).
- Política de lectura como `vehiculos`: admin todo; cliente lo de su cliente; el perfil de sucursal solo alertas de vehículos de su sucursal. Cliente eliminado: sin alertas en la vista.
- `v_alertas` (`security_invoker`) lee la tabla y conserva sus columnas y tipos (`severidad` = 3, `tipo` = `critico`); agrega al final `alerta_id`, `estado`, `umbral_mm`, `mm_apertura`, `mm_minimo`, `abierta_at`, `reconocida_at`, `silenciada_hasta`, `veces_reabierta`. `v_resumen_flota_cliente` no cambia: `n_alertas_sev3` cuenta las críticas vivas y `sev1`/`sev2` quedan en 0.

## M.3 Evaluación

`alerta_sincronizar(cliente, neumáticos[])` (interna, sin `execute` para nadie fuera del dueño) es la única función de evaluación, una sola sentencia sobre `v_estado_neumaticos`:

| Situación | Resultado |
|---|---|
| promedio < umbral y sin alerta no resuelta | abre; si el neumático tuvo una alerta resuelta por `recuperada` en los últimos 7 días, reabre esa fila (`veces_reabierta` + 1) |
| alerta no resuelta y promedio < umbral + histéresis | sigue; actualiza mm actual, mínimo, umbral, vehículo y posición |
| alerta no resuelta y promedio >= umbral + histéresis | resuelve `recuperada` |
| alerta no resuelta y sin promedio válido (todas las mediciones invalidadas) | resuelve `sin_datos` |
| neumático ya no montado | resuelve `cambio` o `baja` |

La alerta sigue al neumático: rotar no crea otra y cambiarlo la resuelve. Disparadores: `mediciones` (insert y update, por sentencia con tabla de transición: un lote de la API es una evaluación), `neumaticos` (estado, posición, vehículo, idneumatico) y `clientes` (umbral crítico o histéresis: reevalúa toda la flota). Un fallo de la evaluación no bloquea la escritura de origen: queda como `WARNING`. El relleno inicial abre las alertas de los neumáticos críticos actuales.

## M.4 RPC (`SECURITY DEFINER`, `search_path` vacío, autorización interna con `neumatico_autorizar_vehiculo`, 42501 uniforme)

- `alerta_reconocer(id, nota)`: `abierta` a `reconocida`; idempotente.
- `alerta_silenciar(id, hasta, motivo)`: hasta 90 días; `hasta` nulo quita el silencio. La alerta sigue abierta.
- `alerta_resolver(id, nota)`: nota obligatoria; motivo `manual`. Con el neumático aún bajo el umbral, la siguiente medición abre una alerta nueva.
- `alerta_configurar(cliente, umbral_critico_mm, histeresis_mm)`: solo admin o perfil de cliente global (el de sucursal recibe 42501). Mantiene retiro < crítico < bajo (23514), un decimal (22023); reevalúa la flota.
- Resuelta o con estado incompatible: 55000. Alerta inexistente: 42501 para no admin (P0002 para admin). Rol `api`, sin perfil y `anon`: sin acceso.

## M.5 Panel

- Alertas: tabla con estado (Abierta, Reconocida, Silenciada, siempre con texto y símbolo), mensaje, vehículo, posición y acciones: Ver vehículo (abre el coche en la rueda), Reconocer, Silenciar 7 días o Quitar silencio, y Resolver (modal con nota obligatoria). Filtro y chips por estado.
- Bloque «Nivel crítico» (nivel y histéresis) solo para el cliente global; el admin edita el umbral desde la ficha del cliente (el trigger reevalúa igual).
- Inicio: «N alertas críticas sin reconocer» y enlace a Alertas.

## M.6 Pruebas

`tests/sql/t_92_alerta_critica.sql` (apertura sin duplicados, histéresis, reapertura, lote de la API, rotar, cambiar, baja, sin datos, umbral por cliente, matriz de roles, RLS por sucursal, sin escritura directa, auditoría con actor, consistencia con `v_estado_neumaticos`, privilegios de funciones y planes < 100000 para que PG16 no active el JIT); ajustes en t_10, t_20, t_55, t_58, t_60 y t_88; `tests/unit/alertas.test.mjs`; smoke de Flota y Alertas; e2e `alertas-dispositivos` (estados, reconocer, nivel crítico).

## M.7 Límites

Sin anulaciones por eje, posición ni marca/modelo, sin destinatarios, correo ni reevaluación nocturna (docs/15 B.5, etapas 2 y 3). La reapertura a 7 días no es configurable todavía.
