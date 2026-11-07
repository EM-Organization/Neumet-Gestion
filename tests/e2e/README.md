# Pruebas E2E con base real

Los smoke de `tests/smoke` usan un Supabase simulado: pasan aunque la base real responda otra cosa. Estas pruebas
ejercen el **panel real** en Chrome headless contra una base real.

## Qué levanta `npm run e2e`
- **Postgres** con `tests/sql/00_stub_auth.sql` (roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`),
  **todas** las migraciones de `supabase/migrations`, el cliente `Demo Transportes` y `supabase/seed/demo.sql`.
  Además un segundo cliente (`Otra Empresa SA`, con casos límite de búsqueda) y un usuario sin perfil (`tests/e2e/sql/`).
- **PostgREST** v16.5 (`PGRST_DB_MAX_ROWS=1000` como Supabase), con JWT secret de prueba (`lib/config.mjs`).
- **Servidor local** que sirve `adminpanel/` y `assets/` sin tocarlos y hace de proxy de `/rest/v1` a PostgREST,
  registrando cada petición. En `adminpanel/index.html` sustituye solo: el CDN de supabase-js (la misma versión,
  desde `node_modules`), `assets/config.js` y añade `browser/auth-shim.js`, que reemplaza únicamente la autenticación
  (`getSession`, login, logout) por un JWT HS256 de prueba. Todas las consultas `from`/`rpc` van por HTTP a PostgREST.
- **Sesiones**: `admin`, `global` (Demo), `salto`, `montevideo` (perfiles de seccional), `otra` (otro cliente), `sinperfil`.

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
- **inicio**: tarjetas con las cifras de las vistas SQL, por rol.
- **buscador**: matrícula completa, parcial, minúsculas/espacios, número de coche y nombre; Enter abre el detalle.
- **detalle**: las 14 fichas de camión: ruedas (10 + auxilio), mm, estado y color según la base.
- **aislamiento**: Salto no ve Montevideo ni otro cliente (lista, búsqueda, abrir por estado, API directa por tabla/vista);
  el selector del perfil global.
- **alertas-dispositivos**: conteos, filtros y estados contra `v_alertas` y `v_salud_dispositivos`.
- **recorrido**: todas las vistas por rol, CSV de Reportes paginado, Mediciones, Flota, Clientes, Ficha, Stock.
- **taller**: rotar y cambiar neumático con RPC reales (admin, global, seccional), rechazos 42501 con la base intacta,
  stock solo para el perfil global, odómetro que no baja.
- **mediciones-neumatico**: cambiar un neumático crítico (ingresando uno nuevo) deja la rueda en "sin datos", quita su alerta
  crítica y baja el contador de Inicio; al medir el nuevo toma su valor sin arrastrar el gráfico del viejo; rotar dos ruedas
  lleva mm, color, historial y alertas con el neumático.
- **sucursales**: el perfil global crea, renombra y elimina sucursales, agrega vehículos y los mueve con confirmación (historial
  de mediciones, neumáticos y eventos intacto, auditoría `MOVER_SUCURSAL`); el perfil de sucursal no puede gestionar; Otra Empresa SA
  no ve ni mueve nada de Demo Transportes (RPC directas rechazadas con 42501 y la base sin cambios).
- **contrato**: ninguna petición real falló por columna/relación/función inexistente; cada `select()`/`rpc()` escrito
  en `assets/js` existe en la base.

Cada flujo **falla** ante `console.error` (incluye "Acción desconocida"), excepción no capturada, error del navegador o
respuesta 4xx/5xx que el flujo no declare como esperada (`opciones.http` en `lib/flujo.mjs`).

## Sin cubrir
Alta/edición/baja de clientes, vehículos, dispositivos y gastos (Edge Functions y escrituras del admin); login real con
GoTrue; Realtime; layout/CSS (ver pruebas visuales); columnas de `insert`/`update` (solo se verifican los `select`);
Safari/Firefox; la ingesta de mediciones (API del proveedor).
