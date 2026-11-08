# 07 · API de proveedor para la app de medición (cliente DAC)

> Estado: el análisis (§1 a §8) es de 2026-11-06 y se conserva como registro de decisiones. La API **está implementada** como Edge Function `api-proveedor` en el proyecto `kootszosdejmawanfxug` (base `https://kootszosdejmawanfxug.supabase.co/functions/v1/api-proveedor`); lo construido y decidido está en el Apéndice A. Fuente: `API_PROVEEDOR.pdf` (4 págs., "Especificación de API requerida").
> Contrato formal en [`api/openapi.yaml`](api/openapi.yaml).
> **Convención:** lo marcado **[verificar]** son hipótesis del momento del análisis, anteriores a que el esquema y la RLS se versionaran en `supabase/migrations/`. La función `guardar-montaje-mm` heredada nunca estuvo en este repositorio y no se migró. Lo demás sale del PDF o del código del panel.

## 1. Qué pide el documento

Flujo real del producto: **calibre → (Bluetooth) → app móvil → API de Neumet → base → panel**. La app consume tres endpoints que **Neumet (el proveedor) debe exponer**:

| # | Endpoint | Para qué |
|---|---|---|
| 1 | `POST /auth/login` | La app se autentica con email + clave y recibe un `access_token` |
| 2 | `POST /emenube/neumaticos/obtener_montaje` | La app **pide información**: neumáticos montados en un vehículo (por matrícula o número) y su última medición |
| 3 | `POST /emenube/neumaticos/guardar_montaje_mm` | La app **envía las mediciones** tomadas por posición |

Reglas del contrato: HTTPS, JSON UTF-8; el éxito exige HTTP 2xx **y** `code = 200` en el cuerpo (login: HTTP exactamente 200); 401 si credenciales o token son inválidos; el login puede repetirse (renovación ante 401); **aislamiento por cliente**: la cuenta de DAC solo ve y escribe vehículos de DAC (un vehículo ajeno es "no encontrado"); timeouts del cliente: login 10 s, obtener 5 s, guardar 10 s. El nombre `emenube` sugiere que la app hoy habla con el software de gestión de flota de DAC y se le pide a Neumet un equivalente: las rutas "pueden ser distintas si se comunican de antemano".

## 2. Qué cambia respecto a lo que existe hoy

> La columna "Hoy" sale del README y del código del panel (originalmente `app.js`, hoy módulos en `assets/js/`). **[verificar]** contra la función desplegada y el esquema real: `guardar-montaje-mm` no está en el repo.

| Aspecto | Hoy (`guardar-montaje-mm`, no versionada) | API requerida |
|---|---|---|
| Autenticación | Ninguna documentada; identifica por `device_id` (MAC) | Login con cuenta + token Bearer, acotado a un cliente |
| Origen del cliente | Se deduce asignando el dispositivo a un cliente (onboarding "device-first") | Se deduce del **token** (la cuenta es del cliente) |
| `device_id` | Obligatorio | **No viene** en el contrato |
| Lecturas | `mm1`–`mm3` (3 huellas) | `mm1`–`mm4`, con `mm3 = mm2` siempre |
| Respuesta | `{ok, vehiculo_id, ruedas_guardadas}` | `{code, data.guardados[{posicion, guardado}]}` con fallo parcial por neumático |
| Lectura de datos | No existe | `obtener_montaje` |
| Inventario de neumáticos | `neumaticos` (por `vehiculo_id, posicion`; el panel lee `marca, modelo, fecha_compra, precio_unidad, notas`) y `stock_neumaticos`; `mediciones` ya guarda `idneumatico` (panel, módulo de mediciones). **[verificar]** si existen `codigo` y `auxilio` | Requiere `idneumatico`, `codigo`, `posicion`, `auxilio` por neumático |

Consecuencia: **esta API cierra el hallazgo S7** de la auditoría (ingesta sin autenticación) para el canal de la app, y permite **retirar** el endpoint público basado en MAC una vez migrada la app.

## 3. Mapeo de datos (propuesto, a confirmar)

### 3.1 Lecturas: 4 valores del contrato vs. 3 columnas del panel
Spec: `mm1` borde interno · `mm2` centro · `mm3` centro (= `mm2`) · `mm4` borde externo.
Panel/BD: `mm1`, `mm2`, `mm3` = 3 huellas (commit `9cf63e6`) y `promedio`. **Orden físico confirmado por el dueño (app de DAC): `mm1` interno · `mm2` centro · `mm3` externo**, igual que el contrato (API `mm4` → BD `mm3`).

Propuesta: **no cambiar el esquema**; en escritura guardar `mm1 → mm1`, `mm2 → mm2`, `mm4 → mm3` y descartar `mm3` (validando que sea igual a `mm2`; si difiere, rechazar esa posición). En lectura devolver `mm1 = mm1`, `mm2 = mm2`, `mm3 = mm2`, `mm4 = mm3`.
Resuelto: el orden es el de la app (interno-centro-externo) y el panel lo etiqueta igual. Cambiarlo, si hiciera falta, es una sola constante (`LECTURA_MAP` en `supabase/functions/api-proveedor/mapping.ts`); un mapeo al revés intercambiaría borde interno y externo sin que nada falle.

### 3.2 Entidades
- `matricula`/`patente` ↔ `vehiculos.patente_norm` (mayúsculas, sin espacios) **[verificar]**; `numero` ↔ `vehiculos.numero`.
- Vehículo del cliente de la cuenta ↔ `vehiculos.cliente_id`. **Fuera del cliente = "no encontrado"** (misma respuesta que inexistente, para no revelar su existencia).
- Neumático montado ↔ `neumaticos(vehiculo_id, posicion, …)`; requiere `idneumatico` (único), `codigo`, `auxilio`: `idneumatico` ya aparece en `mediciones`; `codigo` y `auxilio` **[verificar]**.
- Última medida por posición ↔ última fila de `mediciones` por `(vehiculo_id, posicion)`.
- Auxilio (posición convencional, p. ej. 99 según el ejemplo del PDF, `auxilio:"si"`): máximo uno por vehículo; **fuera** de `tipo_ruedas` 10/16 → la validación de posición debe contemplarlo.

## 4. Diseño de seguridad

### 4.1 Autenticación (endpoint 1)
- **Reutilizar Supabase Auth**: el login valida email+clave contra `auth/v1/token?grant_type=password` y devuelve **solo** `access_token` (no `refresh_token`: el contrato renueva re-logueando). Mapear credenciales inválidas a **401** exacto; cualquier otro fallo a 5xx; `tipoLogin` ≠ 2 → 401/400.
- **Cuenta de servicio por cliente**, dedicada y distinta de las personas del panel. Marcarla con un rol explícito (`app_metadata.role = 'api'` + `cliente_id` en `app_metadata`, escribible solo con service role) para que (a) no pueda usarse en el panel ni (b) un usuario humano en la API. No usar la deducción "admin = sin fila en `clientes`" (ver A2).
- **Contraseña**: ≥ 24 caracteres generados, almacenada en el almacén seguro del dispositivo (Keychain/Keystore) de la app; rotación documentada; protección contra filtrado de contraseñas activada.
- **Vida del token**: el JWT de Supabase dura 1 h por defecto; aceptable porque la app re-loguea ante 401. Confirmar con el equipo de la app que lo hace (el contrato lo declara).
- **Fuerza bruta**: límites de Auth de Supabase + bloqueo por cuenta/IP; alertas (doc `04`).
- **Revocación:** un JWT de Supabase **no se puede revocar** antes de expirar (≈ 1 h) aunque se deshabilite o rote la cuenta, y `jwt_expiry` es global, no por cuenta. Opciones: aceptar la ventana de 1 h (recomendado al inicio), o validar en cada request contra una lista de cuentas/`jti` bloqueados dentro de la función. Documentarlo en el runbook de rotación.
- **⚠ Acceso directo con el mismo JWT:** el token que emite el login **también sirve contra PostgREST/Realtime con la anon/publishable key**, sin pasar por la función. Por lo tanto la cuenta `api` no debe poder usar la API REST general: las políticas RLS de cada tabla deben **excluir expresamente** `app_metadata.role = 'api'` (o limitarla a su cliente y a operaciones concretas). Esto exige auditar la RLS actual antes de crear cuentas (ver §8, riesgo 2) y confirmar que el signup público está desactivado.

### 4.2 Autorización (endpoints 2 y 3)
- Verificar el JWT en la función (firma/expiración con la clave del proyecto) y exigir `role = 'api'`. El **`cliente_id` sale únicamente del token**, jamás del cuerpo.
- **Defensa en profundidad:** consultar con un cliente Supabase que use el **JWT del usuario** (RLS aplica) *además* de filtrar explícitamente por `cliente_id` en cada consulta. Si se usa `service_role` internamente por conveniencia, **cada** consulta lleva `cliente_id = <token>` y se cubre con tests de aislamiento (cliente A no lee ni escribe vehículos de B).
- Un vehículo de otro cliente y un vehículo inexistente → **respuesta idéntica**, mismo tiempo aproximado.

### 4.3 Validación de entrada (endpoint 3)
- Cuerpo ≤ 64 KB, `montajes` ≤ 40 elementos, JSON estricto; campos desconocidos ignorados (no persistidos).
- `patente` normalizada y validada (`^[A-Z0-9-]{3,12}$`); `numero` debe ser `""`.
- `posicion` entero existente en el montaje del vehículo (o auxilio); sin duplicados dentro del mismo request.
- `mm*` números finitos, `0 ≤ mm ≤ 40` (parametrizable); `mm3 == mm2`; auxilio sin medir: los cuatro `null` → **no se persiste, no es error, no es cero**.
- Fallos por neumático ⇒ HTTP 2xx con `guardado:false` en esa posición; el resto se guarda (semántica del contrato). Errores globales (token, JSON inválido) ⇒ 401/400/5xx.

### 4.4 Integridad y reintentos
- El cliente tiene timeout de 10 s y puede **reintentar**: sin protección se duplican mediciones y se distorsiona el análisis predictivo (mm/semana).
- **Idempotencia (propuesta revisada):**
  1. **Preferida:** exigir a la app una cabecera `Idempotency-Key` (UUID por intento de guardado, reutilizado en los reintentos). La función guarda `(cuenta, key) → respuesta` durante 24 h y devuelve la misma respuesta ante un reintento. Requiere confirmar con DAC (pregunta 9).
  2. **Si la app no puede:** clave derivada = hash de `(cliente_id, patente, montajes normalizados)` con ventana corta (p. ej. 10 min). Limitación conocida: puede descartar una medición **legítimamente repetida** en esa ventana; por eso es el plan B y la ventana debe ser corta y acordada.
  3. La `sesion_id` interna agrupa las filas de un request, pero **no** es mecanismo de deduplicación.
- Escritura **atómica por request** vía RPC de Postgres (una transacción; validación por posición con savepoints para soportar el fallo parcial).

### 4.5 Superficie y operación
- **Sin CORS** (no es un cliente de navegador): no emitir `Access-Control-Allow-Origin`.
- Solo HTTPS; HSTS en el dominio propio; nada sensible en la URL ni en logs.
- **Rate limit** por cuenta (p. ej. 60 req/min) y por IP. Las Edge Functions **no lo incluyen**: implementar con una tabla de contadores en Postgres (ventana deslizante por `cuenta`) o un servicio externo (p. ej. Upstash Redis). "Por IP" solo es fiable si se toma la IP de la cabecera que ponga el proxy de Supabase; no confiar en cabeceras arbitrarias del cliente. La protección contra contraseñas filtradas de Supabase Auth **depende del plan** (**[verificar]**).
- **Mismo tiempo de respuesta:** "vehículo ajeno" e "inexistente" deben recorrer **el mismo camino de código** (sin early-return distinto) para no filtrar existencia por tiempos.
- **Auditoría/logs** (doc `04`): `ingesta_log(request_id, cuenta, cliente_id, endpoint, vehiculo_id, http, code, n_guardados, n_fallidos, ms)`; sin contraseñas ni tokens; `request_id` devuelto en una cabecera `X-Request-Id`.
- **Rendimiento** (timeouts de 5 s/10 s): índice `mediciones(vehiculo_id, posicion, created_at desc)` y consulta "última por posición" con `DISTINCT ON`/lateral; evitar el patrón actual del panel de bajar cientos de filas.
- **Entornos:** staging (segundo proyecto Supabase) para que DAC pruebe sin tocar producción; base URL distinta.
- **Versionado:** las rutas del contrato son fijas; si hace falta versionar se hace en la URL base (`/v1/`), no en las rutas.

### 4.6 Dónde vive
**Una Edge Function en Supabase** (`api-proveedor`) con router interno (`/auth/login`, `/emenube/neumaticos/…`), **no** en Vercel: está junto a la base, y ya es el patrón del proyecto. Si se quiere un dominio propio (`api.neumet…`), se expone con un rewrite de Vercel o un dominio personalizado de Supabase; la URL base se comunica a DAC. Las funciones se despliegan con `verify_jwt = false` y la verificación se hace dentro (el login no lleva token).

## 5. Ambigüedades del documento (preguntar al equipo de la app / DAC)

1. **Orden de `mm1..mm4`** y correspondencia con lo que hoy guarda el sistema (ver §3.1). *(bloqueante: riesgo de datos invertidos)*
2. `mm3` aparece descrito como "centro" en las dos tablas y "siempre igual a `mm2`" al enviar: ¿es un duplicado intencional o es un error de tipeo del documento (¿era otra huella)?
3. **Auxilio no medido:** ¿`guardado:true` o `false`? El ejemplo muestra `true` con valores `null`. Proponemos `true` (procesado, nada que persistir).
4. **Vehículo inexistente** en endpoint 2: "data vacío, o `code` distinto de 200". ¿Qué `code` usa el cliente: 404? ¿Con HTTP 200 o 404? Proponemos HTTP 200 y `code: 404`.
5. Vehículos que **solo tienen `numero`** (sin matrícula): `matricula` "debe devolverse siempre". ¿Cadena vacía? Y en `guardar`, `patente` es obligatoria y `numero` siempre vacío: ¿cómo se guarda para esos vehículos?
6. **`tipoLogin: 2`**: ¿qué significan otros valores? ¿Se rechazan?
7. **Origen del inventario:** `idneumatico`, `codigo` y `auxilio` los provee hoy el software de DAC. ¿Quién da de alta los neumáticos y el montaje en Neumet (carga inicial, importación CSV, otra API)? Sin eso `obtener_montaje` no tiene qué devolver. *(decisión de producto)*
8. ¿Cuántos clientes además de DAC? ¿Una cuenta por cliente (modelo multi-tenant)? Volumen esperado (vehículos y requests por día) para dimensionar.
9. ¿La app reintenta ante timeouts? ¿Puede enviar una clave de idempotencia?
10. ¿El token puede ser de 1 h, o se espera una vida mayor? ¿La app guarda la clave para re-loguear?
11. URLs base de **staging y producción** y ventana para pruebas de contrato conjuntas.

## 6. Qué necesito para implementar

- **Esquema real** de `vehiculos`, `neumaticos`, `mediciones`, `dispositivos`, `clientes` y RLS (`supabase db dump --schema-only` o acceso al proyecto). Sin él no se pueden escribir migraciones ni el RPC sin adivinar.
- Respuesta a las preguntas 1, 2, 5 y 7 de §5 como mínimo.
- Un proyecto de staging.

## 7. Plan de implementación

| Paso | Contenido | Depende de |
|---|---|---|
| A | Confirmar mapeo de lecturas y semántica de bordes (§5: 1–6) | Equipo de la app |
| B | Migraciones: columnas `idneumatico/codigo/auxilio`, `perfiles`/rol `api`, `ingesta_log`, índices, RPC `api_guardar_montaje`, `api_obtener_montaje` | Esquema real |
| C | Edge Function `api-proveedor` (router + validación + logs) | B |
| D | Tests de contrato con los ejemplos del PDF, tests de aislamiento entre clientes (incluido `guardar` con posiciones de otro vehículo y `obtener` de vehículo ajeno), tests de reintento/idempotencia (Deno) | C |
| E | Staging + pruebas conjuntas con DAC | C, D |
| F | Producción, rotación de credenciales, **retiro de `guardar-montaje-mm`** público | E |

## 8. Riesgos principales

0. **Hipótesis sin verificar:** esquema, RLS y `guardar-montaje-mm` no están en el repo; este documento no puede confirmarlos.
1. **Datos invertidos** (interno/externo) si se toca el mapeo: el orden confirmado es mm1 interno, mm2 centro, mm3 externo.
2. **Fuga entre clientes** si el aislamiento se apoya solo en filtros de aplicación o en una RLS sin auditar. Además, la cuenta `api` podría ser tratada como admin por la lógica actual ("sin fila en `clientes`") y su JWT sirve directo contra PostgREST: **auditar la RLS y excluir `role = 'api'` antes de crear la primera cuenta**.
3. **Duplicados** por reintentos tras timeout.
4. **Inventario sin origen**: la API no sirve si Neumet no tiene los neumáticos cargados.
5. La clave de la cuenta de servicio vive en un dispositivo móvil: usar almacén seguro, cuenta de mínimo privilegio y rotación.

## Apéndice A · Decisiones de implementación (2026-11-06)

Implementación: `supabase/functions/api-proveedor/` (Deno, sin dependencias externas) y `supabase/migrations/20261106010000_api_proveedor.sql`. Todo lo anterior en este documento sigue siendo el análisis; aquí lo que se **decidió y construyó**.

**Estructura.** `handler.ts` (router + lógica, sin red: recibe `Deps`), `supabase_deps.ts` (implementación con `fetch` a Auth/PostgREST), `mapping.ts` (`LECTURA_MAP`), `index.ts` (`Deno.serve`). Rutas aceptadas con y sin prefijo (`/functions/v1/api-proveedor`, `/api-proveedor`). Solo `POST`. `verify_jwt = false` en `config.toml` (el Bearer se valida dentro). Sin CORS.

1. **Login.** Valida contra `/auth/v1/token?grant_type=password` con la anon key. Éxito: HTTP 200 `{code:200, access_token}`, sin `refresh_token`. Credenciales inválidas, `tipoLogin !== 2` (sin consultar Auth) o cuenta sin perfil `rol='api'` con `cliente_id` → HTTP 401 `{code:401}` idéntico (no se revela el motivo). Cuerpo mal formado → 400. Límite 30 req/min por IP (`x-forwarded-for`, solo como pista: es falsificable).
2. **Autorización (2 y 3).** `auth/v1/user` valida el Bearer; el perfil se lee con service role; se exige `rol='api'`; el `cliente_id` sale solo del perfil. Cualquier fallo → 401. Vehículo ajeno e inexistente recorren el mismo código (la RPC filtra por `cliente_id`) y devuelven la misma respuesta.
3. **Mapeo.** Constante única `LECTURA_MAP = {mm1:'mm1', mm2:'mm2', mm3:'mm2', mm4:'mm3'}` (API→columna BD en lectura); la escritura se **deriva** de ella (`mm1→mm1, mm2→mm2, mm4→mm3`, y `mm3` debe ser igual a `mm2`, si no esa posición da `guardado:false`). **Riesgo abierto: el orden físico interno/externo no está confirmado**; un mapeo invertido cambia bordes sin error. `mapping_test.ts` fija el comportamiento.
4. **obtener_montaje.** Busca por `matricula` (misma regla que `normalizar_patente`) o por `numero`; una sola consulta con `DISTINCT ON (posicion)`. Neumáticos sin `idneumatico` se omiten. Vehículo inexistente/ajeno → HTTP 200 `{code:404, matricula:"", numero:"", data:[]}`. `matricula` vacía si el vehículo no tiene. Ambos campos vacíos o con más de 64 caracteres → 400. Si vienen ambos, manda `matricula`.
5. **guardar_montaje_mm.** 400 para: JSON inválido o > 64 KB, `patente` vacía o fuera de `^[A-Z0-9-]{3,12}$`, `numero ≠ ""`, `montajes` fuera de 1..40, `posicion` no entera o fuera de 1..99, **posición duplicada**, `mm*` que no sean número/null. Por posición (HTTP 200, `guardado:false` solo ahí, el resto se guarda): `mm` fuera de 0..40, mediciones incompletas (algunos `null`), `mm3≠mm2`, posición inexistente en el montaje visible del vehículo (sin `idneumatico` cuenta como inexistente), rueda no auxilio con los cuatro `null`. **Auxilio con los cuatro `null`: no se persiste, no es error, no es cero, `guardado:true`.** La respuesta lleva un objeto por elemento recibido, en el mismo orden. Vehículo inexistente/ajeno: todas `guardado:false`, indistinguible entre sí. Persistencia atómica por request en `public.api_guardar_montaje` (SECURITY DEFINER, `search_path=''`, solo `service_role`; savepoint por posición); `sesion_id` uuid por request; `device_id='api:'||cuenta`.
6. **Idempotencia.** Con `Idempotency-Key` (1..128 caracteres ASCII imprimibles): clave `k:<valor>`, TTL 24 h; misma clave + mismo contenido → misma respuesta sin reescribir; misma clave + contenido distinto → 409. Sin cabecera: clave `h:<sha256(cliente_id, patente, montajes ordenados por posición)>` con ventana de 10 min. **Limitación:** una medición legítimamente repetida (mismos valores) dentro de 10 min se descarta como duplicado y se devuelve la respuesta previa; las respuestas de fallo también se repiten durante la ventana. Los reintentos concurrentes se serializan con un `pg_advisory_xact_lock`. Tabla `api_idempotencia` (RLS sin políticas, solo `service_role`).
7. **Rate limit.** Tabla `api_rate_limit` (contador por minuto, `api_rate_limit_hit`): 120 req/min por cuenta (tras validar el token), 30/min por IP en login → 429 `{code:429}` con `Retry-After: 60`. Ventana fija por minuto (permite ráfagas de hasta 2× en el borde). Limpieza oportunista.
8. **Logs.** Una fila en `ingesta_log` por request a 2 y 3 autenticado (incluidos 400/429/500) con request_id, endpoint, cuenta, cliente, vehículo, status (`ok|rechazado|error`), http, motivo, n_guardados/n_fallidos, duración y un resumen mínimo (`n_montajes`, sin valores). Nunca contraseñas, tokens ni payload. No se registran 401 (sin cuenta identificada). Un fallo al escribir el log no rompe la respuesta. `X-Request-Id` en todas las respuestas.
9. **Errores globales.** 401 `{code:401}`; 400 `{code:400}`; 404/405 para rutas/métodos desconocidos; 500 `{code:500,message:"Error interno"}` sin detalles.

**Pruebas.** `deno task test` (en `supabase/functions`): 35 pruebas con dobles (login, token, rol, aislamiento, auxilio, mm3≠mm2, fallo parcial, duplicados, límites, idempotencia, rate limit, logs, mapeo) y `sql_test.ts`, que levanta un Postgres local desechable (initdb temporal, socket unix), aplica ambas migraciones y prueba las RPC, la idempotencia (ventanas y TTL), el aislamiento, el rate limit y los privilegios (anon/authenticated sin acceso; la cuenta `api` sin lectura por PostgREST). Se omite si no hay binarios de Postgres. **No probado:** Supabase real (Auth, PostgREST, límites de tiempo de la Edge Function), la app real de DAC, carga.

**Antes de desplegar.** Aplicar la migración; crear el usuario Auth y su `perfiles(rol='api', cliente_id)`; cargar `neumaticos.idneumatico` (sin inventario `obtener_montaje` devuelve `data` vacío, §5.7); definir `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (los provee Supabase por defecto); confirmar el orden de `mm1..mm4`.

## Apéndice B · Motivos de rechazo (2026-11-12)

`api_guardar_montaje` devuelve por posición `{posicion, guardado, motivo}`. **La respuesta a DAC no cambia**: la Edge Function solo reenvía `{posicion, guardado}` (contrato intacto). El motivo queda en `ingesta_log`: `motivo` agregado de la petición y, en `payload_resumen.motivos`, el recuento por motivo de posición (sin valores ni datos del cliente).

### Motivos por posición (RPC)

| Motivo | Cuándo | Significado / acción esperada |
|---|---|---|
| `vehiculo` | La matrícula no existe o es de otro cliente (misma respuesta, no revela existencia) | Revisar la matrícula enviada. Estado global `no_encontrado`. |
| `sin_neumaticos` | El coche existe pero no tiene ningún neumático montado con `idneumatico` | Cargar las ruedas del coche en el panel para que se guarden las mediciones. Estado global `ok` (el coche se encontró). Prevalece sobre `rango`, `incompleta` y `posicion`; no se escribe nada. |
| `posicion` | El coche tiene neumáticos pero esa posición no existe en su montaje visible (o el neumático no está montado o no tiene `idneumatico`) | Revisar el montaje con `obtener_montaje` y la posición enviada. |
| `sin_medicion` | Rueda que no es auxilio con los cuatro `mm` en `null` | Medir la rueda y reenviar. (El auxilio sin medir es `guardado:true`, sin motivo.) |
| `incompleta` | Algunos `mm` `null` y otros con valor | Enviar los cuatro valores. |
| `rango` | Algún `mm` fuera de 0..40 o no finito | Repetir la medición. |
| `duplicado_distinto` | `mm3` distinto de `mm2` | Corregir la app: `mm3` debe ser igual a `mm2`. |
| `error` | Fallo inesperado al guardar esa posición (el resto se guarda) | Reintentar; si persiste, avisar a Neumet con el `X-Request-Id`. |

### Motivo agregado en `ingesta_log.motivo`

`no_encontrado` (vehículo), `sin_neumaticos` (todas las posiciones rechazadas por esa causa; también `obtener_montaje` de un coche con `data` vacío), `fallo_parcial` (alguna posición rechazada por otro motivo), `idempotencia_conflicto`, `rate_limit`, `error_interno` y los de validación de entrada (`patente`, `montajes`, `posicion`, `posicion_duplicada`, `tipo_mm`, etc., con HTTP 400). Vacío si todo se guardó. Los reintentos con la misma clave repiten la respuesta y el mismo motivo.

### Contrato de `obtener_montaje`

Sin cambios: coche existente sin neumáticos cargados responde `code 200`, `data: []` (la app de DAC lo interpreta como «sin ruedas»). No se agregó ningún campo; el motivo solo se registra en `ingesta_log`.

### Panel admin: siguiente paso

El panel **no tiene hoy ninguna vista del log de ingesta** (`ingesta_log` solo la lee el admin por SQL/API), por lo que no se creó una. Siguiente paso: una lista de ingesta para el admin que muestre este motivo con la etiqueta «Coche sin neumáticos cargados» y la ayuda «Cargar las ruedas del coche en el panel para que se guarden las mediciones» (textos según `14-guia-de-textos.md`).
