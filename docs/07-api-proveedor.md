# 07 · API de proveedor para la app de medición (cliente DAC)

> Estado: **análisis y diseño** (2026-11-06). Sin código ni despliegue. Fuente: `API_PROVEEDOR.pdf` (4 págs., "Especificación de API requerida").
> Contrato formal en [`api/openapi.yaml`](api/openapi.yaml).

## 1. Qué pide el documento

Flujo real del producto: **calibre → (Bluetooth) → app móvil → API de Neumet → base → panel**. La app consume tres endpoints que **Neumet (el proveedor) debe exponer**:

| # | Endpoint | Para qué |
|---|---|---|
| 1 | `POST /auth/login` | La app se autentica con email + clave y recibe un `access_token` |
| 2 | `POST /emenube/neumaticos/obtener_montaje` | La app **pide información**: neumáticos montados en un vehículo (por matrícula o número) y su última medición |
| 3 | `POST /emenube/neumaticos/guardar_montaje_mm` | La app **envía las mediciones** tomadas por posición |

Reglas del contrato: HTTPS, JSON UTF-8; el éxito exige HTTP 2xx **y** `code = 200` en el cuerpo (login: HTTP exactamente 200); 401 si credenciales o token son inválidos; el login puede repetirse (renovación ante 401); **aislamiento por cliente**: la cuenta de DAC solo ve y escribe vehículos de DAC (un vehículo ajeno es "no encontrado"); timeouts del cliente: login 10 s, obtener 5 s, guardar 10 s. El nombre `emenube` sugiere que la app hoy habla con el software de gestión de flota de DAC y se le pide a Neumet un equivalente: las rutas "pueden ser distintas si se comunican de antemano".

## 2. Qué cambia respecto a lo que existe hoy

| Aspecto | Hoy (`guardar-montaje-mm`, no versionada) | API requerida |
|---|---|---|
| Autenticación | Ninguna documentada; identifica por `device_id` (MAC) | Login con cuenta + token Bearer, acotado a un cliente |
| Origen del cliente | Se deduce asignando el dispositivo a un cliente (onboarding "device-first") | Se deduce del **token** (la cuenta es del cliente) |
| `device_id` | Obligatorio | **No viene** en el contrato |
| Lecturas | `mm1`–`mm3` (3 huellas) | `mm1`–`mm4`, con `mm3 = mm2` siempre |
| Respuesta | `{ok, vehiculo_id, ruedas_guardadas}` | `{code, data.guardados[{posicion, guardado}]}` con fallo parcial por neumático |
| Lectura de datos | No existe | `obtener_montaje` |
| Inventario de neumáticos | Tablas `neumaticos`/`stock_neumaticos` (campos no versionados) | Requiere `idneumatico`, `codigo`, `posicion`, `auxilio` por neumático |

Consecuencia: **esta API cierra el hallazgo S7** de la auditoría (ingesta sin autenticación) para el canal de la app, y permite **retirar** el endpoint público basado en MAC una vez migrada la app.

## 3. Mapeo de datos (propuesto, a confirmar)

### 3.1 Lecturas: 4 valores del contrato vs. 3 columnas del panel
Spec: `mm1` borde interno · `mm2` centro · `mm3` centro (= `mm2`) · `mm4` borde externo.
Panel: `mm1`, `mm2`, `mm3` = 3 huellas ("exterior, medio, interior", commit `9cf63e6`) y `promedio`.

Propuesta: **no cambiar el esquema**; en escritura guardar `mm1 → mm1`, `mm2 → mm2`, `mm4 → mm3` y descartar `mm3` (validando que sea igual a `mm2`; si difiere, rechazar esa posición). En lectura devolver `mm1 = mm1`, `mm2 = mm2`, `mm3 = mm2`, `mm4 = mm3`.
⚠ **El orden físico está invertido o ambiguo**: el panel habla de "exterior, medio, interior" y el contrato de "interno, centro, externo". Hay que confirmar con el desarrollo de la app y con los datos existentes qué es `mm1` en la tabla; un mapeo al revés **intercambia borde interno y externo** sin que nada falle.

### 3.2 Entidades
- `matricula`/`patente` ↔ `vehiculos.patente_norm` (mayúsculas, sin espacios); `numero` ↔ `vehiculos.numero`.
- Vehículo del cliente de la cuenta ↔ `vehiculos.cliente_id`. **Fuera del cliente = "no encontrado"** (misma respuesta que inexistente, para no revelar su existencia).
- Neumático montado ↔ `neumaticos(vehiculo_id, posicion, …)`; requiere columnas `idneumatico` (único), `codigo`, `auxilio` (hoy desconocidas).
- Última medida por posición ↔ última fila de `mediciones` por `(vehiculo_id, posicion)`.
- Auxilio (posición convencional, p. ej. 99, `auxilio:"si"`): máximo uno por vehículo; **fuera** de `tipo_ruedas` 10/16 → la validación de posición debe contemplarlo.

## 4. Diseño de seguridad

### 4.1 Autenticación (endpoint 1)
- **Reutilizar Supabase Auth**: el login valida email+clave contra `auth/v1/token?grant_type=password` y devuelve **solo** `access_token` (no `refresh_token`: el contrato renueva re-logueando). Mapear credenciales inválidas a **401** exacto; cualquier otro fallo a 5xx; `tipoLogin` ≠ 2 → 401/400.
- **Cuenta de servicio por cliente**, dedicada y distinta de las personas del panel. Marcarla con un rol explícito (`app_metadata.role = 'api'` + `cliente_id` en `app_metadata`, escribible solo con service role) para que (a) no pueda usarse en el panel ni (b) un usuario humano en la API. No usar la deducción "admin = sin fila en `clientes`" (ver A2).
- **Contraseña**: ≥ 24 caracteres generados, almacenada en el almacén seguro del dispositivo (Keychain/Keystore) de la app; rotación documentada; protección contra filtrado de contraseñas activada.
- **Vida del token**: el JWT de Supabase dura 1 h por defecto; aceptable porque la app re-loguea ante 401. Confirmar con el equipo de la app que lo hace (el contrato lo declara).
- **Fuerza bruta**: límites de Auth de Supabase + bloqueo por cuenta/IP; alertas (doc `04`).

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
- Idempotencia: aceptar cabecera opcional `Idempotency-Key` y, además, deduplicar por clave natural `(vehiculo_id, posicion, valores, ventana de N min)`. Se propone una **sesión de medición** (`sesion_id`) generada por la función por request.
- Escritura **atómica por request** vía RPC de Postgres (una transacción; validación por posición con savepoints para soportar el fallo parcial).

### 4.5 Superficie y operación
- **Sin CORS** (no es un cliente de navegador): no emitir `Access-Control-Allow-Origin`.
- Solo HTTPS; HSTS en el dominio propio; nada sensible en la URL ni en logs.
- **Rate limit** por cuenta (p. ej. 60 req/min) y por IP.
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
| D | Tests de contrato con los ejemplos del PDF, tests de aislamiento entre clientes, tests de reintento/idempotencia (Deno) | C |
| E | Staging + pruebas conjuntas con DAC | C, D |
| F | Producción, rotación de credenciales, **retiro de `guardar-montaje-mm`** público | E |

## 8. Riesgos principales

1. **Datos invertidos** (interno/externo) por mapeo mal confirmado.
2. **Fuga entre clientes** si el aislamiento se apoya solo en filtros de aplicación o en una RLS sin auditar.
3. **Duplicados** por reintentos tras timeout.
4. **Inventario sin origen**: la API no sirve si Neumet no tiene los neumáticos cargados.
5. La clave de la cuenta de servicio vive en un dispositivo móvil: usar almacén seguro, cuenta de mínimo privilegio y rotación.
