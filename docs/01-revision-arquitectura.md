# 01 · Revisión crítica de arquitectura

> Estado: diagnóstico (2026-11-06). No se modificó código. Base: commit `188b3fc`.
> Alcance: todo lo versionado en el repo. Lo que **no** está versionado se señala como hallazgo en sí mismo.

## 1. Resumen ejecutivo

La decisión de fondo —**SPA estática + Supabase como BaaS (Postgres + Auth + Edge Functions), sin backend propio**— es **correcta para este producto y esta etapa** y se mantiene. Un equipo chico, un panel de gestión, cargas de escritura bajas (un POST por sesión de medición) y un dominio simple no justifican un servidor propio.

El problema no es la arquitectura elegida sino **cómo está ejecutada**:

| # | Hallazgo | Severidad |
|---|---|---|
| A1 | El modelo de seguridad entero depende de RLS/RPC/Edge Functions que **no están en el repo** | Crítica |
| A2 | Rol admin = "usuario autenticado sin fila en `clientes`" (deducido en el navegador) | Alta |
| A3 | Un único `app.js` de 2.732 líneas, 50 `innerHTML`, funciones globales, sin módulos, tipos ni tests | Alta |
| A4 | Un solo entorno (prod) con la URL/anon key hardcodeadas; no hay staging | Alta |
| A5 | Lógica de negocio y agregaciones en el cliente con `limit()` silenciosos | Media |
| A6 | Admin y portal de cliente son el mismo bundle; la separación es `display:none` | Media |
| A7 | Dependencia CDN sin versión fija ni SRI para la librería que maneja la sesión | Media |
| A8 | Documentación desfasada respecto del código | Baja |

## 2. Lo que está bien (y no hay que tocar)

- **Supabase como BaaS.** Auth + Postgres + RLS evita escribir y operar un backend CRUD. Es la decisión de mayor retorno del proyecto.
- **Onboarding "device-first"** (el equipo llega primero, el admin asigna cliente después) y el RPC transaccional `asignar_dispositivo_a_cliente`. Buen diseño de dominio, atómico y en el lugar correcto (la base).
- **Ingesta IoT en una Edge Function** y no en la SPA. Correcto; ver §5 sobre por qué no moverla a Vercel.
- **Sin build step** a esta escala: bajo costo de arranque. Deja de ser una virtud al pasar de ~1.000 líneas de JS (ver A3).
- Existe una función `esc()` y se usa en 39 sitios: hay conciencia de XSS, pero la cobertura es incompleta (ver `02-auditoria-seguridad.md`).

## 3. Hallazgos en detalle

### A1 · El perímetro de seguridad no está versionado
Lo que el código usa y **no existe en el repo**:

- Esquema SQL: `clientes`, `vehiculos`, `dispositivos`, `mediciones`, `neumaticos`, `stock_neumaticos`, `gastos`.
- **Políticas RLS** de cada tabla.
- RPCs `get_unregistered_devices` y `asignar_dispositivo_a_cliente` (¿`SECURITY DEFINER`? ¿validan rol?).
- Edge Functions `guardar-montaje-mm` y `crear-cliente` (solo `contacto` está versionada).
- Triggers, índices, vistas.

Consecuencias: (1) imposible auditar la seguridad desde el repo; (2) imposible recrear el entorno (staging, disaster recovery); (3) cualquier cambio manual en el dashboard queda sin historial; (4) el README documenta una función (`guardar-montaje-mm/`) que la "Estructura del proyecto" declara en el árbol pero no existe.

**Esto es el hallazgo número uno.** Con una anon key pública en el frontend (diseño normal de Supabase), RLS **es** la seguridad. Si no se puede revisar, no se puede afirmar que exista.

**Cambio de rumbo propuesto:** `supabase/` pasa a ser fuente de verdad (`migrations/`, `functions/`, `config.toml`, `seed.sql`), gestionado con Supabase CLI (`supabase db pull` para capturar el estado actual, luego sólo migraciones).

### A2 · Autorización deducida en el cliente
`checkAuth()` (`app.js:56-65`): busca una fila en `clientes` con `auth_user_id = session.user.id`; si existe → modo cliente, si **no** → modo admin. Es decir, *cualquier* usuario autenticado que no sea cliente se trata como administrador.

- La UI oculta vistas con `data-admin-only { display:none }`: es cosmética, no es control de acceso.
- Si el registro público de Supabase Auth (`Allow new users to sign up`) está habilitado, cualquiera puede crear una cuenta y quedar en el camino "admin" de la UI. Que además lea datos depende **únicamente** de RLS (no verificable, ver A1).
- Los datos financieros (`gastos`, `precio_mensual`) conviven en la misma base y las mismas tablas accesibles desde el mismo cliente.

**Propuesta:** rol explícito y verificable por el servidor: tabla `perfiles(user_id, rol)` o claim `app_metadata.role` (sólo escribible con service role), consumido por las políticas RLS y las Edge Functions. La UI sólo *refleja* el rol, nunca lo decide. Deshabilitar signup público.

### A3 · Monolito de frontend sin estructura
`assets/js/app.js`: 2.732 líneas, ~50 asignaciones `innerHTML` con templates de strings, handlers expuestos en `window.*` y llamados por `onclick="..."` inline, estado en variables globales (`clients`, `medTireData`, `medSelPos`…), sin tipos, sin tests, sin linter, sin CI.

Costos concretos ya visibles: XSS por escapado incompleto (porque escapar es manual en cada template), imposibilidad de CSP estricta (los `onclick` inline obligan a `unsafe-inline`), y duplicación (`mAvg`/`tireStatus`/umbrales 5 y 8 mm definidos en al menos tres lugares).

**Propuesta (sin reescribir todo):** migrar a Vite + TypeScript con módulos ES por vista (`clientes`, `vehiculos`, `dispositivos`, `mediciones`, `balance`, `dashboard`), un único módulo `domain/desgaste.ts` para umbrales y promedios, y render con una librería que escape por defecto. **No** se recomienda saltar a Next.js: no hay SSR, SEO ni rutas dinámicas que lo justifiquen en el panel (ver `03-despliegue-vercel-supabase.md`).

### A4 · Un solo entorno
`SUPABASE_URL` y la anon key están literales en `app.js:3-4`; `index.html:731` repite la URL. Con Vercel, cada Pull Request genera un *preview deployment*: sin staging, **cada preview hablaría con producción**. Hace falta un segundo proyecto Supabase (o Supabase Branching) y configuración por entorno inyectada en build.

### A5 · Lógica y agregaciones en el navegador
- Dashboard: baja 600 mediciones y calcula "último dato por posición" en JS (`app.js:172-186`). Si un cliente supera 600 filas recientes, **los datos de ruedas se omiten silenciosamente** y los KPI mienten.
- Detalle de vehículo: `limit(500)`; sesiones por dispositivo: `limit(2000)`; sin paginación ni aviso de truncado.
- Contadores con `count: exact` sobre `mediciones` crecerán linealmente.
- Análisis predictivo (`mAnalysis`, tasa mm/semana) y estado de neumático se calculan en cliente; el mismo cálculo existe aparte en el reporte imprimible.

**Propuesta:** vistas/RPCs en Postgres (`v_ultima_medicion_por_rueda`, `v_estado_flota`, `rpc_sesiones_dispositivo`) con índice `(vehiculo_id, posicion, created_at desc)`. El cliente consume resultados ya agregados; los umbrales viven en una sola tabla/config.

### A6 · Admin y cliente en el mismo bundle
Un cliente final descarga el código y los endpoints del panel admin (incluida la ruta `crear-cliente`). No es una vulnerabilidad *si* RLS/Functions son correctas, pero amplía la superficie y la fuga de información. Opción: dos entradas (`/adminpanel` y `/app`) con bundles separados — barato una vez modularizado (A3).

### A7 · Cadena de suministro del frontend
`adminpanel/index.html:884` carga `@supabase/supabase-js@2` desde jsDelivr: versión flotante y sin `integrity=`. Esa librería custodia el JWT en `localStorage`; un compromiso del CDN o de una release = toma de sesión. Solución: dependencia por npm con versión fija y lockfile, empaquetada por el build (sin CDN).

### A8 · Documentación desfasada
- README describe `mm1`–`mm4` y promedio de cuatro lecturas; el código usa tres (`mm1`–`mm3`; commit `9cf63e6` "reducir mediciones a 3 huellas"). **El contrato con el firmware está mal documentado.**
- README afirma lectura "en tiempo real"; el código no usa suscripciones Realtime (ni `channel()` ni `subscribe()`), es polling por navegación.
- README declara que Vercel hospeda el frontend, pero `vercel.json` y el workflow de deploy se eliminaron (`d81dc36`) y `.vercel` está ignorado: **no hay definición de despliegue en el repo**.
- No existen `LICENSE`, `CONTRIBUTING`, ni documentación de esquema.

## 4. Higiene del repositorio

| Ítem | Observación | Acción |
|---|---|---|
| `app-demo.mp4` (6,6 MB) | Binario en git; inflará el historial con cada versión | Mover a Vercel Blob / Supabase Storage / YouTube; `git rm` |
| `assets/img/WhatsApp Image …jpeg` | ✅ Resuelto: logo anterior sin uso, eliminado; la identidad vive en `assets/brand/` | — |
| `.claude/launch.json` | Config de herramienta local versionada | Ignorar o mover |
| Autores del historial | Emails personales/`admin@neumet.com` en commits | Informativo; revisar si el repo es público |
| Mensajes de commit | Mezcla inglés/español, convención parcial | Adoptar Conventional Commits |
| CI | Eliminado | Reintroducir (lint + tipos + gitleaks) |

## 5. ¿Debería la ingesta IoT moverse a Vercel?

**No.** Razones: (1) el firmware ya apunta a `…supabase.co/functions/v1/guardar-montaje-mm` y cambiar una URL en dispositivos en campo es costoso y arriesgado; (2) la Edge Function está a un salto de la base de datos; (3) Vercel Functions no aportan nada aquí y añaden un segundo lugar con secretos. Vercel debe hospedar **solo** el frontend. Si el firmware aún no está desplegado masivamente, igual se mantiene la ruta; lo que cambia es la **autenticación del dispositivo** (ver auditoría).

## 6. Decisiones a tomar (ADR pendientes)

1. **Modelo de roles** (tabla `perfiles` vs. custom claims). Recomendado: custom claims en `app_metadata` + tabla `perfiles` para datos de negocio.
2. **Multi-tenant**: confirmar que `cliente_id` en cada tabla + RLS por `auth.uid()` → `clientes.auth_user_id` es el modelo definitivo. ¿Un cliente puede tener varios usuarios? (hoy es 1:1 con `auth_user_id`).
3. **Autenticación de dispositivos**: clave por dispositivo (hash en BD) vs. JWT firmado vs. mTLS. Recomendado: clave por dispositivo, rotable.
4. **Frontend**: Vite+TS (recomendado) vs. mantener vanilla.
5. **Entornos**: segundo proyecto Supabase vs. Branching.
