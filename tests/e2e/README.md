# Pruebas E2E con base real

Los smoke de `tests/smoke` usan un Supabase simulado: pasan aunque la base real responda otra cosa. Estas pruebas
ejercen el **panel real** en Chrome headless contra una base real.

## Qué levanta `npm run e2e`
- **Postgres** con `tests/sql/00_stub_auth.sql` (roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`),
  **todas** las migraciones de `supabase/migrations`, el cliente `Demo Transportes` y `supabase/seed/demo.sql`.
  Además un segundo cliente (`Otra Empresa SA`, con casos límite de búsqueda) y un usuario sin perfil (`tests/e2e/sql/`).
- **PostgREST** v16.5 (`PGRST_DB_MAX_ROWS=1000` como Supabase), con JWT secret de prueba (`lib/config.mjs`).
- **Servidor local** que sirve `dist/` (el e2e corre `scripts/build.mjs` antes; `E2E_SIN_BUILD=1` reutiliza el `dist/` existente)
  con las cabeceras de `vercel.json` (CSP incluida: una violación sale como error del navegador y rompe el flujo) y hace de proxy de
  `/rest/v1` a PostgREST, registrando cada petición. En `adminpanel/index.html` sustituye solo el CDN de supabase-js (la misma
  versión, desde `node_modules`) y `assets/config.js`. La autenticación es la **real** de supabase-js: `lib/chrome.mjs` precarga la
  sesión (JWT HS256 de prueba) en `localStorage` y el servidor atiende `/auth/v1/user` y `/auth/v1/logout`; `/auth/v1/token` responde 400
  a propósito (si algo intentara refrescar la sesión, el test falla). Todas las consultas `from`/`rpc` van por HTTP a PostgREST.
- **islas** (`specs/islas.mjs`): el panel construido monta la isla de humo de `/panel/islas.js` con la bandera encendida (`localStorage.neumet_islas = 'on:hola'`), la lee con el JWT del rol y la desmonta al cambiar de vista.
- **Sesiones**: `admin`, `global` (Demo), `salto`, `montevideo` (perfiles de sucursal), `otra` (otro cliente), `sinperfil`, `api` (perfil de rol `api`).
- **sin-acceso**: `sinperfil` y `api` ven «Sin acceso» (sin panel ni menú), la API real les devuelve 0 filas y navegar por código no consulta datos.

## Correrlo en local
Requisitos: Node 22, `psql` y binarios de Postgres (`initdb`, `pg_ctl`; p. ej. `brew install postgresql@17`) o una base
con `E2E_PG_URL=postgresql://postgres:...@host:5432/postgres` (superusuario; crea y borra una base temporal), Chrome
(o `CHROME=/ruta`), y `npm ci`.
```
npm ci
npm run e2e
```
PostgREST se descarga la primera vez a `tests/e2e/.cache/` y se verifica su SHA-256 (fijado en `lib/config.mjs`).
Alternativas: `E2E_POSTGREST_BIN=/ruta/postgrest`, o `E2E_POSTGREST_DOCKER=1` (imagen oficial `postgrest/postgrest`,
sin probar aquí; con `--network host`, solo Linux). En macOS el binario necesita `libpq` (`brew install libpq`).
Capturas de los fallos: `tests/e2e/capturas/` (o `E2E_CAPTURAS`). Un solo test: `node --test --test-name-pattern="Buscador" tests/e2e/e2e.test.mjs`.

## Qué cubre (`specs/`)
- **inicio**: tarjetas con las cifras de las vistas SQL, por rol; «Últimas mediciones» contra una consulta independiente (vehículos, orden, comparativa por neumático).
- **buscador**: matrícula completa, parcial, minúsculas/espacios, número de coche y nombre; Enter abre el detalle.
- **detalle**: las 14 fichas de camión: ruedas (10 + auxilio), mm, estado y color según la base.
- **aislamiento**: Salto no ve Montevideo ni otro cliente (lista, búsqueda, abrir por estado, API directa por tabla/vista);
  el selector del perfil global.
- **alertas-dispositivos**: conteos, filtros y estados contra `v_alertas` y `v_salud_dispositivos` (Dispositivos solo para admin); el cliente no abre la vista ni por menú, ni por acción, ni cargando sus datos.
- **ola2-alertas-servicio**: v_alertas con color, severidad y umbral_km por tipo contra la base real; el servicio del vehículo se fija desde «Distribución y servicio» con `vehiculo_fijar_servicio` y el diálogo lo muestra al reabrirlo; el aviso de umbrales nombra Empresa > Umbrales y solo lo ve el administrador de empresa.
- **ola4-calidad-moneda**: una medición con caída de 5 mm queda sospechosa en Calidad (el trigger), el perfil global la corrige desde el panel (`valida`, `corregida_at`, `CORREGIR_MEDICION` en la auditoría), una sucursal ajena recibe 403/42501 por API, la moneda elegida en Empresa llega a `costos_neumatico.moneda` sin tocarla, y el equipo Neumet no ve los botones de corregir ni la moneda.
- **ola3-disco-alineacion**: rotar en disco desde el panel cierra la lateral con `rotacion` y guarda el evento `rotacion_disco`; registrar alineación cierra la lateral con `alineacion`, deja la irregular abierta y guarda un evento por cubierta en ruta; la API rechaza el auxilio (22023) y los roles sin permiso (42501).
- **recorrido**: todas las vistas por rol, CSV de Reportes paginado, Mediciones, Flota, Clientes, Ficha, Stock.
- **taller**: rotar y cambiar neumático con RPC reales (admin, global, sucursal), rechazos 42501 con la base intacta,
  stock solo para el perfil global, odómetro que no baja.
- **mediciones-neumatico**: cambiar un neumático crítico (ingresando uno nuevo) deja la rueda en "sin datos", quita su alerta
  crítica y baja el contador de Inicio; al medir el nuevo toma su valor sin arrastrar el gráfico del viejo; rotar dos ruedas
  lleva mm, color, historial y alertas con el neumático.
- **empresa-panel**: pantalla Empresa en Chrome contra la base real: el perfil global ve la lista real de usuarios (sin «Quitar» para sí mismo), guarda umbrales con Enter por `alerta_configurar` (sin UPDATE directo) y ve sus dispositivos de solo lectura; el admin y el usuario de sucursal no ven la sección ni entran forzándola. Las Edge Functions no corren aquí.
- **sucursales**: el perfil global crea, renombra y elimina sucursales, agrega vehículos y los mueve con confirmación (historial
  de mediciones, neumáticos y eventos intacto, auditoría `MOVER_SUCURSAL`); el perfil de sucursal no puede gestionar; Otra Empresa SA
  no ve ni mueve nada de Demo Transportes (RPC directas rechazadas con 42501 y la base sin cambios).
- **montar-neumaticos**: un coche sin neumáticos se carga desde el detalle (estado vacío, cubierta del stock y cubierta nueva seguidas, siguiente posición libre), se retira un neumático a stock y a baja, el alta con «Cargar neumáticos ahora», la API deja de responder `sin_neumaticos`, el perfil de sucursal monta sin stock y solo en su sucursal, Otra Empresa SA no puede tocar nada de Demo Transportes y los montajes simultáneos (misma posición, misma cubierta) se serializan.
- **km-cubierta**: `v_km_cubierta` por rol en la API real (cada perfil ve solo sus neumáticos; anon, sin perfil y rol `api` nada), el panel de la rueda
  muestra los km de la vista (tramo actual, «Sin dato», notas «Estimado») y `odometro_anomalias` respeta el alcance. Crea un vehículo propio y lo borra.
- **costos-cpk**: `v_costo_cubierta` y `costos_neumatico` por rol en la API real (solo admin y perfil global; sucursal, otro cliente, sin perfil, rol `api` y anon nada), `costo_registrar` rechazada con 42501 para sucursal y otro cliente, el panel de la rueda muestra costo y CPK de la vista y «Registrar costo» escribe y recarga, con auditoría. Crea un vehículo propio y lo borra.
- **precios-solo-global**: nadie lee `neumaticos.precio_unidad` ni `eventos_neumatico.costo` por select (403/42501 en todas las formas: directa, `*`, filtro, orden, embebida; `anon` también); `neumaticos_precios()` y `eventos_costos()` por rol contra la verdad SQL (admin todo, global lo suyo, sucursal/`api`/sin perfil nada, Otra Empresa SA aislada); vistas y RPC existentes intactas; el panel de sucursal no pide ni muestra importes; Stock y Ciclo de vida los muestran a global y admin; la edición de neumáticos del admin no pisa los demás precios.
- **admin-empresa**: RPC de administración de empresa con el JWT de cada rol (listar, quitar y reponer acceso, kilometraje, `alerta_configurar`); `accesos_quitados` inaccesible por REST y `accesos_quitados_marcar_auth` solo con la clave de servicio; restaura los datos al terminar.
- **asistente**: la Edge Function `asistente-reportes` con su handler real (servidor de e2e, modelo guionado) contra la base: 401/403/400 por perfil, cada rol solo ve su alcance aunque el modelo pida otro cliente, costos fuera de la sucursal, cuota de 30 con 429 y uso registrado; en Reportes, el global pregunta y el admin sin cliente no puede. Requiere `deno`.
- **contrato**: ninguna petición real falló por columna/relación/función inexistente; cada `select()`/`rpc()` escrito
  en `assets/js` existe en la base.

Cada flujo **falla** ante `console.error` (incluye "Acción desconocida"), excepción no capturada, error del navegador o
respuesta 4xx/5xx que el flujo no declare como esperada (`opciones.http` en `lib/flujo.mjs`).

## Sin cubrir
Alta/edición/baja de clientes, vehículos, dispositivos y gastos (Edge Functions y escrituras del admin); login real con
GoTrue; Realtime; layout/CSS (ver pruebas visuales); columnas de `insert`/`update` (solo se verifican los `select`);
Safari/Firefox; la ingesta de mediciones (API del proveedor).
