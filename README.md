# NEUMET · Sistema de Gestión

NEUMET mide la profundidad de dibujo de los neumáticos de una flota con un calibre digital y muestra el estado de cada vehículo en un panel web. Este repositorio contiene el sitio público, el panel, la base de datos (migraciones y pruebas) y las Edge Functions.

Estilo de la documentación: impersonal, en infinitivo, sin segunda persona (ver [`docs/14-guia-de-textos.md`](docs/14-guia-de-textos.md)). El código manda: si algo de este texto no coincide con el comportamiento real, corregir el texto.

## Contenido

1. [Qué es NEUMET](#1-qué-es-neumet)
2. [Arquitectura](#2-arquitectura)
3. [Roles y permisos](#3-roles-y-permisos)
4. [Mapa de funcionalidades del panel](#4-mapa-de-funcionalidades-del-panel)
5. [Modelo de datos y aislamiento por cliente](#5-modelo-de-datos-y-aislamiento-por-cliente)
6. [API de proveedor](#6-api-de-proveedor)
7. [Puesta en marcha local y pruebas](#7-puesta-en-marcha-local-y-pruebas)
8. [Despliegue](#8-despliegue)
9. [Procesos del equipo](#9-procesos-del-equipo)
10. [Estructura del repositorio](#10-estructura-del-repositorio)
11. [Pendientes y decisiones](#11-pendientes-y-decisiones)
12. [Índice de documentación](#12-índice-de-documentación)

## 1. Qué es NEUMET

Un taller o gestor de flota mide cada neumático con el calibre; el desgaste queda registrado por neumático y por vehículo, y el panel indica qué requiere atención y cuándo conviene cambiar o rotar.

Cada medición guarda tres lecturas en milímetros, una por huella de la banda: `mm1` interno, `mm2` centro y `mm3` externo; `promedio` es la media de las tres. Los umbrales por defecto son: OK desde 8 mm, desgaste bajo entre 5 y 8 mm, crítico por debajo de 5 mm, y retiro en 3 mm. Cada cliente puede ajustar sus umbrales (columnas `umbral_*_mm` de `clientes`, editables desde la ficha del cliente). El estado se comunica siempre con texto y símbolo, nunca solo con color.

## 2. Arquitectura

```
Calibre digital ──Bluetooth──► App de medición (DAC) ──HTTPS──► API de proveedor ──► Postgres ──► Panel web
                                                                (Edge Function        (Supabase,      (Vercel,
                                                                 api-proveedor)        RLS)            módulos ES)
```

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| Calibre y app de medición | Toma las lecturas por posición y las envía autenticada con una cuenta de API del cliente | Fuera de este repositorio |
| API de proveedor | Login, consulta del montaje de un vehículo y guardado de mediciones (ver [sección 6](#6-api-de-proveedor)) | `supabase/functions/api-proveedor/` |
| Base de datos | PostgreSQL con RLS, RPC, vistas y auditoría | `supabase/migrations/` |
| Panel (`/adminpanel`) | SPA en módulos ES nativos, sin bundler; usa `supabase-js` y consulta bajo demanda (sin Realtime) | `adminpanel/index.html`, `assets/js/` |
| Sitio público (`/`) | Landing estática con formulario de contacto | `index.html`, `assets/js/landing.js` |
| Edge Functions auxiliares | Alta de clientes, usuarios de sucursal y cuentas de API (solo administrador); formulario de contacto | `supabase/functions/` |
| Hosting | Vercel sirve el sitio estático con CSP y cabeceras de seguridad | `vercel.json` |

Proyecto Supabase vigente: `kootszosdejmawanfxug`. El proyecto anterior (`dqgrlflrjcarxlfetvoj`) quedó fuera de uso tras el cutover y ya no figura en el código ni en la CSP; solo se menciona de forma histórica en la documentación.

La URL y la clave publicable de Supabase están en [`assets/config.js`](assets/config.js) (`window.NEUMET_CONFIG`). Cambiar de proyecto implica editar ese archivo y la directiva `connect-src` de `vercel.json`. La landing toma de esa misma constante la base del endpoint `contacto`.

## 3. Roles y permisos

El rol se guarda en `perfiles.rol` (`admin`, `cliente` o `api`); la autorización la decide la base de datos (RLS y RPC), no el panel.

| Rol | Alcance | Puede |
|---|---|---|
| Administrador (`admin`) | Todos los clientes | Todo el panel: clientes, ficha, dispositivos, balance, mediciones, vehículos, stock, sucursales y cuentas de API |
| Cliente global (`cliente`, `sucursal_id` nulo) | Todo su cliente | Ver su flota completa, gestionar sucursales y mover vehículos, cambiar y rotar neumáticos, registrar odómetro, ver stock |
| Cliente de sucursal (`cliente`, `sucursal_id` = X) | Solo los vehículos, neumáticos, mediciones y dispositivos de la sucursal X | Ver su flota, cambiar y rotar neumáticos de sus vehículos, registrar odómetro. No ve stock, otras sucursales ni gestión de sucursales |
| Cuenta de API (`api`) | Un cliente, solo a través de `api-proveedor` | Login, `obtener_montaje` y `guardar_montaje_mm`. Sin acceso a las tablas por PostgREST |

Las operaciones de escritura del cliente (cambio de neumático, rotación, odómetro, sucursales) pasan por RPC acotadas; el cliente no escribe tablas directamente. Detalle del modelo de autorización en [`docs/08-esquema-datos.md`](docs/08-esquema-datos.md) (apéndices B a E).

## 4. Mapa de funcionalidades del panel

Menú del cliente: Inicio, Vehículos, Alertas, Stock, Reportes y, con perfil global, Sucursales. El administrador añade Dispositivos y la sección Administración (Estado de la flota, Mediciones, Clientes, Balance). Flujos y destinos de cada click en [`docs/12-mapa-navegacion.md`](docs/12-mapa-navegacion.md).

| Pantalla | Qué ofrece |
|---|---|
| Inicio | Buscador de «Matrícula, número de coche o quema» (atajo `/`), proporciones de la flota, «Requieren atención», «Próximos cambios» y «Últimas mediciones» (los 8 vehículos medidos más recientemente, con la diferencia de mm por neumático respecto de la visita anterior). El administrador ve además «Clientes con más urgencias» |
| Vehículos | Lista ordenada por urgencia, filtro por matrícula o número de coche; alta, edición y baja solo para el administrador |
| Detalle de vehículo | Diagrama de ruedas con el estado de cada posición, panel de la rueda con mediciones y gráfico de desgaste, odómetro y ciclo de vida. Desde la rueda: cambio de neumático, rotación y número de quema |
| Cambio de neumático | Destino del neumático retirado (baja, reencauche, reparación o almacén), neumático nuevo desde el stock o ingresado a mano, número de quema, km que ya traía el neumático y odómetro opcional del vehículo |
| Rotación | Intercambio de dos posiciones del mismo vehículo; el historial y las alertas siguen al neumático |
| Número de quema | Identifica al neumático físico; único por cliente. El buscador lo resuelve y abre el vehículo donde está montado |
| Km previos | Km que el neumático ya traía al montarlo; junto con los recorridos en el vehículo dan los km totales |
| Sucursales (cliente global) | Crear, renombrar y eliminar sucursales vacías; agregar vehículos; mover un vehículo entre sucursales o a «Sin sucursal», con confirmación. Mover solo cambia `vehiculos.sucursal_id`: el historial queda intacto y el movimiento queda en la auditoría |
| Stock | Inventario de neumáticos por cliente; solo lectura para el cliente global, alta y edición para el administrador. No visible para el perfil de sucursal |
| Alertas | Lista de problemas activos, filtrable por severidad y tipo (`critico`, `bajo`, `cruza_critico_pronto`, `desgaste_irregular`, `sin_medir`) |
| Reportes | Informes exportables en CSV o versión imprimible |
| Dispositivos (solo administrador) | Alta, edición y asignación de medidores a clientes; estado de actividad y dispositivos con mediciones aún sin cliente asignado |
| Clientes y ficha de cliente (administrador) | Alta con invitación o contraseña, baja lógica, umbrales de desgaste, sucursales y usuarios, cuenta de API |
| Estado de la flota, Mediciones y Balance (administrador) | Vista de flota entre clientes, historial por vehículo o dispositivo, ingresos, gastos y valor del inventario |

Con perfil global y sucursales, un selector «Sucursal» en la barra superior filtra las pantallas. Con perfil de sucursal el selector no aparece porque la base ya limita los datos.

## 5. Modelo de datos y aislamiento por cliente

Tablas principales (todas con RLS): `clientes`, `perfiles`, `sucursales`, `vehiculos`, `neumaticos`, `mediciones`, `eventos_neumatico`, `dispositivos`, `stock_neumaticos`, `gastos`, `ingesta_log`, `audit_log`, `api_idempotencia` y `api_rate_limit`. Vistas (con `security_invoker`, heredan la RLS de quien consulta): `v_ultima_medicion`, `v_mediciones_neumatico`, `v_estado_neumaticos`, `v_alertas`, `v_resumen_flota_cliente` y `v_salud_dispositivos`.

Reglas centrales:

- Defecto: denegar. `anon` no tiene privilegios de tablas ni de funciones.
- Las funciones `is_admin()`, `current_cliente_id()` y `current_sucursal_id()` leen `perfiles` con `auth.uid()`; ningún parámetro del llamador decide el alcance.
- Un cliente solo lee filas de su `cliente_id`; un perfil de sucursal solo las de su sucursal. Claves foráneas compuestas impiden asignar una sucursal de otro cliente.
- Las mediciones siguen al neumático (`idneumatico`): tras cambiar o rotar, cada posición muestra los datos del neumático montado ahí.
- Las escrituras del cliente van por RPC `SECURITY DEFINER` con `search_path` vacío: `neumatico_cambiar`, `neumatico_rotar`, `vehiculo_registrar_odometro`, `vehiculo_crear`, `vehiculo_mover_sucursal`, `sucursal_crear`, `sucursal_renombrar` y `sucursal_eliminar`. Un vehículo inexistente y uno ajeno responden igual (`42501`).
- `audit_log` es inmutable y solo lo lee el administrador.
- La función `ultimas_mediciones` alimenta el bloque de Inicio y es `security invoker`.

Esquema, decisiones y apéndices por migración: [`docs/08-esquema-datos.md`](docs/08-esquema-datos.md). Auditoría de RLS reutilizable: [`supabase/audit/`](supabase/audit/README.md).

## 6. API de proveedor

Edge Function `api-proveedor` en el proyecto vigente. Contrato en [`docs/api/openapi.yaml`](docs/api/openapi.yaml) y decisiones en [`docs/07-api-proveedor.md`](docs/07-api-proveedor.md).

- **Base URL**: `https://kootszosdejmawanfxug.supabase.co/functions/v1/api-proveedor`. La función acepta las rutas con y sin ese prefijo; solo `POST`; sin CORS.
- **Autenticación**: `POST /auth/login` con email y clave de una cuenta de API; devuelve `access_token` (sin `refresh_token`; la app vuelve a iniciar sesión ante 401). El resto de los endpoints exige `Authorization: Bearer <access_token>`.
- **Endpoints**:

| Endpoint | Uso |
|---|---|
| `POST /auth/login` | Autenticar la cuenta de API |
| `POST /emenube/neumaticos/obtener_montaje` | Neumáticos montados de un vehículo (por `matricula` o `numero`) y su última medición |
| `POST /emenube/neumaticos/guardar_montaje_mm` | Guardar las mediciones por posición, con fallo parcial por neumático |

- **Mapeo de lecturas**: el contrato usa `mm1` a `mm4` con `mm3 = mm2`. En la base: `mm1` interno, `mm2` centro y `mm3` externo (API `mm4`). El mapa único está en `supabase/functions/api-proveedor/mapping.ts` (`LECTURA_MAP`).
- **Cuentas de API**: una por app, ligadas a un cliente (máximo 5 por cliente). El `cliente_id` sale siempre del perfil, nunca del cuerpo. Se crean desde la ficha del cliente (`crear-cuenta-api`); la contraseña la genera el servidor y se muestra una sola vez.
- **Idempotencia y límites**: cabecera opcional `Idempotency-Key`; sin ella se deduplica por contenido en una ventana de 10 minutos. Límites por cuenta y por IP (429).

## 7. Puesta en marcha local y pruebas

Requisitos: Node 22 y `npm ci`. El panel no requiere build: servir la raíz con `npm run serve` (equivale a `npx serve -p 3000 .`) y abrir `/adminpanel`. Abrir los archivos como `file://` falla por CORS.

| Script | Qué hace |
|---|---|
| `npm run lint` | ESLint sobre `assets` y `tests` |
| `npm run check` | Verifica la sintaxis de todos los módulos y scripts del panel |
| `npm test` | Pruebas unitarias (`tests/unit/*.test.mjs`, `node:test`) de la lógica de dominio y de la configuración de despliegue |
| `npm run e2e` | Panel real en Chrome headless contra Postgres y PostgREST locales (ver [`tests/e2e/README.md`](tests/e2e/README.md)) |

Otras pruebas, con sus propios lanzadores:

| Prueba | Comando | Cubre |
|---|---|---|
| Smoke | `tests/smoke/run.sh admin\|cliente\|secuser\|detalle\|flota` | Recorrido de vistas y modales con un Supabase simulado; cualquier `console.error` o «Acción desconocida» falla ([`README`](tests/smoke/README.md)) |
| Visual | `tests/visual/run.sh` | Capturas de escritorio y móvil para revisión a ojo ([`README`](tests/visual/README.md)) |
| SQL | `tests/sql/run.sh` | Todas las migraciones (aplicadas dos veces) y pruebas por rol en un Postgres desechable |
| Edge Functions | `deno task --config supabase/functions/deno.json test` | Pruebas de las funciones con dobles; `check` y `lint` equivalentes |

La integración continua (`.github/workflows/ci.yml`) ejecuta: `secrets` (gitleaks sobre todo el historial), `lint`, `static`, `deno`, `test`, `sql` y `e2e`.

## 8. Despliegue

**Vercel.** Sitio estático sin build, servido desde `main`. `vercel.json` define `cleanUrls`, la CSP, HSTS y demás cabeceras. `script-src` no admite scripts inline; `connect-src` solo admite el proyecto Supabase vigente. Los `.js` y `.css` de `/assets` se revalidan en cada carga; tras un despliegue conviene una recarga forzada si el panel muestra vistas vacías. Decisiones en [`docs/03-despliegue-vercel-supabase.md`](docs/03-despliegue-vercel-supabase.md).

**Supabase.**

- Migraciones: `supabase/migrations/`, idempotentes; se revisan en el PR, se aplican antes de fusionar el front que las usa (por MCP `apply_migration` o `supabase db push`) y se verifican con `get_advisors` y `supabase/audit/rls_audit.sql`.
- Edge Functions: `api-proveedor`, `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional` y `contacto`; todas con `verify_jwt = false` en `supabase/config.toml` (cada handler valida el JWT y el rol por su cuenta).
- Secretos necesarios (nombres, sin valores):

| Función | Secretos |
|---|---|
| `contacto` | `RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`; opcional `TURNSTILE_SECRET` |
| `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional` | `ALLOWED_ORIGINS` (sin él se deniega todo origen de navegador); opcional `INVITE_REDIRECT_TO` |
| `api-proveedor` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, provistos por Supabase |

Procedimientos paso a paso (crear el administrador, cuentas de API, migraciones, funciones, rotación de claves): [`docs/11-runbook-operacion.md`](docs/11-runbook-operacion.md). Política de seguridad y reporte de vulnerabilidades: [`SECURITY.md`](SECURITY.md).

## 9. Procesos del equipo

- **Ramas y PR**: cada cambio vive en una rama propia y entra a `main` por PR; nunca se empuja directo a `main`.
- **Revisión**: todo PR lo revisa una persona o agente distinto del autor, con el checklist de [`docs/13-checklist-revision-prs.md`](docs/13-checklist-revision-prs.md): buscar bugs ejecutando los caminos nuevos, pruebas por rol, revisión visual si toca la interfaz, copy y despliegue. Un arreglo incluye un test que falla sin él.
- **CI en verde**: no se fusiona con CI rojo ni se amplía el allowlist de secretos para acomodar un valor de ejemplo.
- **Migraciones**: el revisor las lee enteras (permisos, `search_path`, RLS) y se aplican antes de fusionar el front que las usa.
- **Textos**: según [`docs/14-guia-de-textos.md`](docs/14-guia-de-textos.md).
- **Estado del trabajo**: [`docs/10-tablero.md`](docs/10-tablero.md).

## 10. Estructura del repositorio

```
index.html, assets/js/landing.js   Sitio público
adminpanel/index.html              Panel (SPA)
assets/
  config.js                        window.NEUMET_CONFIG (URL y clave publicable de Supabase)
  css/, brand/, img/               Estilos, identidad visual e imágenes
  js/                              main.js, core/, domain/, views/ (ver assets/js/README.md)
supabase/
  migrations/                      Esquema, RLS, RPC y vistas
  functions/                       Edge Functions (Deno) y deno.json
  seed/demo.sql                    Datos de demostración (a mano, idempotente)
  audit/                           Auditoría de RLS
tests/                             unit, smoke, visual, sql, e2e
docs/                              Documentación técnica (ver índice)
vercel.json, .gitleaks.toml        Despliegue y escaneo de secretos
```

## 11. Pendientes y decisiones

- **Alertas personalizables**: hoy `v_alertas` genera cinco tipos sin estado. La propuesta es una sola alerta de «Neumático en estado crítico», con estados, histéresis y umbral por cliente, eje y posición. Diseño en [`docs/15-rotacion-alertas-rendimiento.md`](docs/15-rotacion-alertas-rendimiento.md) (sección B); implementación pendiente.
- **Rotación**: la acción manual existe; la recomendación automática de qué rotar está diseñada (sección A del mismo documento) y pendiente.
- **Optimización de vista**: auditoría de rendimiento del indicador de desgaste y reescritura de `v_estado_neumaticos` por neumático (sección C del mismo documento); se aplica según el tamaño de la flota.
- **Decisiones abiertas** con el dueño del producto: un cliente con más de un usuario global, retención de `mediciones`, plan de Vercel y Supabase, región y política de datos. Lista en [`docs/05-roadmap.md`](docs/05-roadmap.md).
- **Estado operativo**: prueba de punta a punta con sesión y datos reales, y sugerencias del revisor sin resolver, en [`docs/10-tablero.md`](docs/10-tablero.md).

## 12. Índice de documentación

El índice completo, con el estado de cada documento, está en [`docs/README.md`](docs/README.md). Identidad visual: [`assets/brand/README.md`](assets/brand/README.md).
