# 05 · Roadmap de cambios

> Plan original (2026-11-06) ordenado por riesgo/retorno; varios ítems ya se hicieron (ver las notas de avance y [10-tablero.md](10-tablero.md), que es la fuente de verdad del estado). Esfuerzos orientativos para una persona.

## Fase 0 · Línea base y seguridad (bloquea el go-live) — ~1 semana
| ID | Tarea | Doc | Esfuerzo |
|---|---|---|---|
| 0.1 | `supabase db pull` + descargar Edge Functions → versionar en `supabase/` | 01 A1 | 0,5 d |
| 0.2 | Auditoría RLS/RPC con checklist SQL y pruebas por rol; corregir | 02 S1 | 1–2 d |
| 0.3 | Deshabilitar signup público; rol admin explícito server-side | 02 S2 | 0,5 d |
| 0.4 | Autenticación + validación de payload en `guardar-montaje-mm` (coordinar con firmware) | 02 S7 | 2–3 d |
| 0.5 | Revisar `crear-cliente`: verificación de rol, transaccionalidad (reimplementada en `supabase/functions/crear-cliente`; falta desplegar y subir el mínimo de clave a 12 en el panel) | 02 S4 | 0,5 d |
| 0.6 | `gitleaks`/`trufflehog` sobre el repo (confirmar hallazgo "sin secretos") | 02 §1 | 0,5 d |
| 0.7 | Segundo proyecto Supabase (staging) con migraciones + seed sintético | 01 A4 | 1 d |

## Fase 1 · Disponibilizar en Vercel — ~2–3 días
| ID | Tarea | Doc |
|---|---|---|
| 1.1 | Proyecto Vercel (Pro), dominio, HTTPS | 03 |
| 1.2 | `vercel.json` con CSP y cabeceras | 02 S9 / 03 |
| 1.3 | Auth: Site URL / Redirect URLs, MFA admin, leaked-password protection | 02 S6 |
| 1.4 | Sacar `app-demo.mp4` del repo | 01 §4 |
| 1.5 | Remitente Resend con dominio verificado (SPF/DKIM/DMARC) | 02 S8 |

## Fase 2 · Calidad del frontend y endurecimiento — ~3–4 semanas (incremental)
| ID | Tarea | Doc |
|---|---|---|
| 2.1 | Vite + TypeScript; supabase-js por npm; variables por entorno | 01 A3, A4, A7 |
| 2.2 | Cerrar XSS conocidos (marca/modelo, reporte, categoría, `onclick` del MAC); eliminar `onclick` inline; CSP estricta | 02 §4 |
| 2.3 | Módulo `domain/desgaste` único (umbrales 5/8 mm, promedio, tasa mm/semana) con tests | 01 A5 |
| 2.4 | Vistas/RPC para agregaciones (flota, última medición por rueda, sesiones) + índices; eliminar `limit()` silenciosos | 01 A5 |
| 2.5 | `contacto`: Turnstile server-side, rate-limit, escape HTML, tabla `leads`, CORS restringido | 02 S8 |
| 2.6 | Alta de cliente por invitación; baja lógica; `audit_log` | 02 S3, S5 / 04 |
| 2.7 | Separar bundles admin / cliente | 01 A6 |
| 2.8 | CI: lint, tipos, tests, gitleaks | 03 |

> **Nota (avance 2.8):** ya existen ESLint (`npm run lint`, `eslint.config.js`) y el job `lint` en CI (`.github/workflows/ci.yml`, junto a `secrets` y `static`). La regla `no-unsanitized` queda en `warn` hasta migrar los `innerHTML` existentes (tarea 2.2); entonces pasará a `error`. Pendientes de 2.8: tipos y tests.

> **Nota (avance 2.2):** el panel ya no usa `innerHTML` directo: todo HTML pasa por `html\`...\`` + `setHtml()` (entonces `assets/js/app.js`, hoy `assets/js/core/html.js`), `no-unsanitized` está en `error`, y los manejadores inline del panel se sustituyeron por `data-action`/`data-change` con un listener delegado (`ACTIONS`). Eso permite quitar `'unsafe-inline'` de `script-src` en `vercel.json` (cambio aparte). Hay un arnés de humo headless en `tests/smoke/` (ver su README).

> **Nota (avance 2.3 / modularización):** el monolito `assets/js/app.js` (ya eliminado) se dividió en **módulos ES nativos** (sin bundler): `assets/js/main.js` + `core/` (config, supabase, html, ui, actions, auth, nav, brand, svg) + `views/` (una por vista) + `domain/desgaste.js` (funciones puras: umbrales 5/8 mm, promedio, tasa mm/semana, predicción), con tests `node:test` en `tests/unit/` (`npm test`, job `test` en CI). La configuración del cliente vive en `assets/config.js` (`window.NEUMET_CONFIG`), lo que deja el cambio de proyecto Supabase como edición de un solo archivo. Estructura y guía para añadir una vista: `assets/js/README.md`. Sigue pendiente 2.1 (Vite/TS) si se decide un bundler; los módulos ya son compatibles.

## Fase 3 · Operación y escala
| ID | Tarea | Doc |
|---|---|---|
| 3.1 | `ingesta_log`, vista de salud de dispositivos, alertas | 04 |
| 3.2 | Sentry, uptime, canal de alertas | 04 |
| 3.3 | Retención/particionado de `mediciones`; backups y prueba de restauración | 04 / 03 |
| 3.4 | Evaluar Next.js + `@supabase/ssr` (sesión httpOnly) si el riesgo XSS/token lo amerita | 03 §4 |
| 3.5 | Documentación de esquema (diagrama ER) y runbooks. *Avance:* esquema deducido y migración inicial en borrador (sin aplicar) en `08-esquema-datos.md` y `supabase/migrations/`; falta contrastar con `db dump` real y probar en staging | 08 |

## Línea paralela · Identidad visual (ver `06-identidad-visual.md` §8)
B0 ✅ assets y documentación · B1 pedir vectores/licencia al estudio · B2 `tokens.css` único · B3 logo/favicon/og en el sitio · B4 eliminar hex hardcodeados · B5 email `contacto` · B6 autoalojar fuentes · B7 verificación de contraste.
Conviene hacer B2–B4 **junto con** la Fase 2 (Vite + tokens compartidos) para no tocar dos veces los mismos archivos; B3 puede ir en la Fase 1 (bajo riesgo).

Nota: `deno check` de las Edge Functions es reproducible vía `supabase/functions/deno.json` y corre en CI (job `deno`); ver `supabase/functions/contacto/README.md`.

## Decisiones abiertas (requieren al dueño del producto)
1. ¿Un cliente tendrá más de un usuario? (hoy 1:1).
2. ¿El firmware en campo ya está desplegado? Define cuánto cuesta cambiar el contrato de autenticación de dispositivos.
3. ¿El repo es público en GitHub? (cambia la urgencia de la historia con emails personales y de cualquier rotación).
4. ¿Se factura a clientes hoy? (fija el plan Vercel/Supabase y la urgencia de backups).
5. Región y política de datos de clientes (Ley 18.331).

## Criterios de "hecho" de la Fase 0+1 (plataforma disponible de forma responsable)
Ver checklist final en `03-despliegue-vercel-supabase.md` §8.

Nota (producto): la migración `supabase/migrations/20261106020000_producto_vistas.sql` (umbrales por cliente, odómetro, ciclo de vida, vistas para panel/alertas/salud de dispositivos y `cliente_eliminar_suave`) cubre la base de datos de los ítems 1, 2, 4, 5, 6, 7, 8 y 9 del backlog de `09-benchmark-gestion-neumaticos.md` §6. Aún falta el panel que las consuma y que la ingesta rellene `odometro_km`. Tests: `tests/sql/run.sh` (job `sql` en CI). Ver `08-esquema-datos.md` Apéndice A.

## Nota · API de proveedor (app de medición DAC)
Implementada como Edge Function `supabase/functions/api-proveedor` + migración `20261106010000_api_proveedor.sql` (PR `feat/api-proveedor`). Pendiente antes de producción: aplicar la migración en staging, crear la cuenta `api` (perfil), confirmar el orden interno/externo de `mm1..mm4` con el equipo de la app y probar contra la app real. Detalle y decisiones en `07-api-proveedor.md` (Apéndice A). El job `deno` de CI ejecuta ahora `deno test`.
