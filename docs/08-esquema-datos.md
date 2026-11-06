# 08 · Esquema de datos (deducido del código)

> Estado: **aplicado** en Supabase `kootszosdejmawanfxug` (2026-11-06, migraciones 20261106000000/010000/020000). Migración: [`supabase/migrations/20261106000000_init_schema.sql`](../supabase/migrations/20261106000000_init_schema.sql).
> El esquema real de producción **no está en el repo**; este esquema se **deduce** del código del panel (originalmente el monolito `app.js`, hoy módulos ES en `assets/js/`; las referencias `app.js:N` son históricas), `README.md`, `docs/02`, `04`, `07` y `tests/smoke/stub.js`. Lo que no tiene evidencia directa va marcado **[ASUNCIÓN]**. No se ha ejecutado contra ningún proyecto de Supabase.
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

- **`v_ultima_medicion`** `(cliente_id, vehiculo_id, posicion, medicion_id, idneumatico, mm1..mm3, promedio, odometro_km, device_id, created_at)`: última fila por `(vehiculo_id, posicion)` (`distinct on`, desempate por `id`). Solo mediciones con vehículo.
- **`v_estado_neumaticos`**: una fila por posición (filas de `neumaticos` más posiciones medidas sin fila en `neumaticos`). Columnas: identificación (`cliente_id, vehiculo_id, vehiculo_nombre, patente, posicion, neumatico_id, idneumatico, marca, modelo, vida, estado_montaje`), última lectura (`mm1..3, promedio, odometro_km, ultima_medicion_at, dias_desde_medicion`), `estado`, `sin_medir`, `diferencia_huellas_mm`, `desgaste_irregular`, `n_mediciones_90d`, `tasa_mm_semana`, `semanas_hasta_critico`, `semanas_hasta_retiro` y los umbrales del cliente.
- **`v_alertas`** `(cliente_id, vehiculo_id, vehiculo_nombre, patente, posicion, neumatico_id, idneumatico, tipo, severidad, valor, mensaje, ultima_medicion_at)`: una fila por alerta.
- **`v_resumen_flota_cliente`** `(cliente_id, nombre, n_vehiculos_activos, n_neumaticos_con_datos, n_ok, n_bajo, n_critico, n_sin_datos, n_alertas_sev1..3, ultima_medicion_at)`.
- **`v_salud_dispositivos`** `(dispositivo_id, cliente_id, mac_address, nombre, activo, ultima_actividad_at, total_mediciones, dias_sin_actividad, estado)`.

## A.3 Fórmulas

- **Promedio**: `round((mm1+mm2+mm3)/3, 2)` (trigger existente).
- **Semáforo** (con los umbrales del cliente del vehículo): `sin_datos` si no hay promedio; `critico` si `promedio < umbral_critico`; `bajo` si `promedio < umbral_bajo`; si no `ok`. Límites: 5.00 es `bajo`, 4.99 `critico`, 8.00 `ok`, 7.99 `bajo` (con 8/5).
- **Desgaste irregular**: `max(mm1,mm2,mm3) - min(mm1,mm2,mm3) > irregularidad_mm` (estricto: 2.0 con umbral 2.0 no alerta). Ojo: `app.js` hoy usa `|mm1-mm3| >= 1.5`; las vistas usan las tres huellas y el umbral del cliente.
- **Tasa mm/semana** = `-regr_slope(promedio, epoch(created_at)) * 604800` sobre las mediciones de los **últimos 90 días** de cada `(vehiculo, posicion)`; `null` si hay menos de 2 fechas distintas (UTC). Positivo = se está gastando. Es una regresión sobre todas las mediciones de la posición: **no distingue cambios de neumático**; tras cambiar el neumático, la tasa queda sesgada hasta que la ventana lo olvida (mejora futura: partir por `idneumatico`). A diferencia de `mAnalysis` (primera vs última medición), no usa solo los extremos.
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
| 4 | Vista de cliente | `v_resumen_flota_cliente` (una fila), `v_estado_neumaticos where cliente_id=…` y `eventos_neumatico` para costos; el gasto en neumáticos sale de `neumaticos.precio_unidad`/`eventos_neumatico.costo` (no hay vista) |
| 5 | Salud de dispositivos | `v_salud_dispositivos` (combinar con `get_unregistered_devices()` para MAC sin registrar) |
| 8 | Predicción / vida remanente | `v_estado_neumaticos.tasa_mm_semana`, `semanas_hasta_critico`, `semanas_hasta_retiro`; alertas `cruza_critico_pronto` |
| 9 | Desgaste irregular | `v_estado_neumaticos.desgaste_irregular`, `diferencia_huellas_mm`; alertas `desgaste_irregular` |

Para el detalle de un neumático (#6/#7) el panel sigue leyendo `mediciones` (historial) y, para la línea de tiempo, `eventos_neumatico where neumatico_id=… order by created_at`. Los umbrales se editan con un `update` de `clientes` (solo admin; los CHECK validan la coherencia). El panel puede dejar de calcular estado/tasa/predicción en JS y leer estas vistas; mientras tanto, `WEAR` en `app.js` debe coincidir con los umbrales por defecto.

## A.6 Cómo se validó y límites

- `tests/sql/run.sh` crea un Postgres desechable (`initdb`/`pg_ctl` en un directorio temporal; o `TEST_PG_URL`; o Docker), simula `auth.users`/`auth.uid()`/roles, aplica la migración inicial y la de producto **dos veces** (idempotencia) y ejecuta ~170 aserciones: semáforo en límites exactos, tasa y semanas con datos conocidos, cada tipo de alerta, aislamiento por cliente/rol (admin, cliente A, cliente B, api, sin perfil, anon) en todas las vistas y tablas nuevas, estructura (security_invoker, grants, RLS), `eventos_neumatico` (RLS, constraints, auditoría), `cliente_eliminar_suave` y la inmutabilidad de `audit_log`. Sale con código ≠ 0 si algo falla. CI: job `sql` (servicio `postgres:16`).
- **No cubierto**: Supabase real (extensiones, roles `supabase_admin`, PostgREST, privilegios por defecto reales), rendimiento con volumen (no se hizo `EXPLAIN` con datos grandes; los índices existentes cubren los accesos previstos), ni la reconciliación con el esquema de producción. Repetir las comprobaciones de la migración inicial y este conjunto en staging antes de aplicar.
- Heredado de la migración inicial (no se cambia aquí): `normalizar_patente`, `dispositivos_normalizar_mac`, `mediciones_set_promedio` y `audit_log_inmutable` conservan EXECUTE para PUBLIC (funciones puras o de trigger, sin acceso a datos).

---

# Apéndice B · Seccionales (`20261107020000_seccionales.sql`) y cliente Demo

Un **cliente** (empresa) puede tener **seccionales** (p. ej. "Montevideo", "Salto"). Hay un único rol `cliente` con dos alcances:

| Perfil | `perfiles.sucursal_id` | Qué ve (RLS) |
|---|---|---|
| **Global** | `NULL` | Todo el cliente: todas las seccionales y lo que no tiene seccional |
| **De seccional** | `= X` | Solo vehículos, neumáticos, mediciones, eventos y dispositivos de la seccional X; sus alertas, estado y salud (las vistas `security_invoker` heredan la RLS). **No** ve el stock del cliente, otras seccionales, mediciones/eventos sin vehículo ni gastos, y no puede editar nada (tampoco los umbrales) |
| Admin | — | Todo; gestiona seccionales y asignaciones |

## B.1 Objetos
| Objeto | Detalle |
|---|---|
| `sucursales` | `id, cliente_id (RESTRICT), nombre, created_at`. Único por `(cliente_id, lower(btrim(nombre)))`. `unique(id, cliente_id)` para las FK compuestas. RLS: admin ALL; cliente SELECT (global: las suyas; de seccional: solo la suya). Auditada con `audit_row()` |
| `vehiculos.sucursal_id`, `dispositivos.sucursal_id` | Nullable ("sin seccional" = solo perfil global). FK compuesta `(sucursal_id, cliente_id)` → `sucursales(id, cliente_id)` `ON DELETE RESTRICT`: no se puede asignar una seccional de otro cliente |
| `perfiles.sucursal_id` | Nullable (NULL = global). FK compuesta igual; CHECK `sucursal_id is null or rol = 'cliente'` |
| `perfiles.email` | Informativo (lo escribe `crear-usuario-seccional`); no se usa para autorizar |
| `current_sucursal_id()` | `SECURITY DEFINER`, `search_path=''`, `stable`; solo `authenticated`. NULL = global o sin perfil (siempre se combina con `current_cliente_id()`) |

**Por qué `RESTRICT` y no `SET NULL`**: con `SET NULL`, borrar una seccional convertiría en perfiles **globales** (ven todo el cliente) a sus usuarios. Con `RESTRICT` hay que reasignar o eliminar antes sus vehículos, dispositivos y usuarios. Consecuencia: un `DELETE` físico de un cliente con seccionales falla (la baja suave `cliente_eliminar_suave` no se ve afectada).

Políticas reescritas (solo `SELECT` del cliente): `vehiculos`, `dispositivos`, `neumaticos` (vía vehículo), `mediciones` (vía `vehiculo_id`), `eventos_neumatico` (vía `vehiculo_id`), `stock_neumaticos` (solo global), más `sucursales`. `clientes_self_select` no cambia (el perfil de seccional ve la fila de su cliente: nombre y umbrales de solo lectura).

## B.2 Panel
- **Cliente global con seccionales**: selector "Todas las seccionales / …" en la barra superior (`core/seccional.js`). Filtra Inicio, Flota, Alertas, Reportes, Vehículos, Dispositivos, Salud y Mediciones por `vehiculos.sucursal_id` / `dispositivos.sucursal_id`. Inicio, Reportes, Vehículos, Dispositivos y Mediciones filtran en el servidor; Flota, Alertas y Salud filtran en el navegador (las vistas v_* no traen la seccional) y Flota recalcula los KPI desde las filas filtradas.
- **Perfil de seccional**: no ve el selector (la RLS ya limita todo); el rol se muestra como "Seccional".
- **Admin** (Ficha de cliente > "Seccionales y usuarios"): alta/renombrar/eliminar seccionales, asignar vehículos y dispositivos, y crear usuarios globales o de seccional con la función `crear-usuario-seccional` (invitación por email o contraseña de 12+ caracteres). No se vincula un usuario Auth ya existente: la API de Auth no permite buscarlo por email de forma fiable; se invita a uno nuevo.
- La detección de rol usa ahora `perfiles` (un usuario de seccional no figura en `clientes.auth_user_id`) con el vínculo `clientes.auth_user_id` como respaldo.

## B.3 Datos de demo
`supabase/seed/demo.sql` (NO es migración; se ejecuta a mano). Ver su cabecera. Resumen: requiere el cliente `Demo Transportes` ya creado; genera 2 seccionales, 14 vehículos `DEMO001..014`, 6 dispositivos `02:DE:00:00:00:0N`, ~10 semanas de mediciones y stock/eventos de ejemplo; es idempotente y re-ejecutarlo refresca las fechas.

## B.4 Cómo se validó
`tests/sql/t_50_seccionales.sql` (global ve todo, seccional A no ve B, admin ve todo, cliente B aislado, anon nada, escrituras y FK compuestas) y `t_60_seed_demo.sql` (seed idempotente, vistas con filas, perfil de seccional del demo). Smoke: `tests/smoke/run.sh admin|cliente|secuser`.

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
| perfil `rol='cliente'` de seccional | vehículos de su cliente **y** `vehiculos.sucursal_id = perfiles.sucursal_id` |
| rol `api`, usuario sin perfil, `anon` | nada (42501) |

El cliente y la seccional se leen de `perfiles` con `auth.uid()`; ningún parámetro del llamador decide el alcance. Un vehículo inexistente o ajeno responde
igual (`42501 permiso denegado`) para no revelar existencia. El **stock** (inventario con precios) solo lo consume el admin o el perfil global (igual que su
política de lectura) y siempre del mismo cliente del vehículo; el de seccional ingresa el neumático nuevo con `p_nuevo`.

## C.2 RPC

- `neumatico_cambiar(p_vehiculo_id, p_posicion, p_destino_viejo, p_motivo, p_odometro_km, p_stock_id, p_nuevo jsonb)`: el viejo (montado, no en baja) pasa a
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

`tests/sql/t_70_cambio_neumatico.sql`: admin, cliente global, seccional A (sí en el suyo, no en el de B ni con stock), otro cliente, api, sin perfil y anon (no); stock ajeno y con cantidad 0
rechazados; validaciones; escritura directa denegada; atomicidad (fallo en el último paso no deja nada a medias); la migración se aplica dos veces en `run.sh`.
