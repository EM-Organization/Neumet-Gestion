# 03 · Plan de despliegue: Vercel + Supabase

> Estado: propuesta (2026-11-06). Sin cambios de código ni de infraestructura ejecutados.

## 1. Veredicto

**Vercel (frontend) + Supabase (datos, auth, ingesta) es una combinación sensata y se adopta.** El repo ya está pensado para eso (README, historial con `vercel.json` y workflow, `.vercel` en `.gitignore`), pero **la definición de despliegue fue eliminada** (`d81dc36`) y hoy no hay nada versionado que la reproduzca. No encontré una razón técnica que justifique otra plataforma: el frontend es 100 % estático, Vercel lo sirve con CDN global, previews por PR y HTTPS automático.

Lo que sí hay que corregir **antes** de abrirlo al público son los bloqueantes de §2.

## 2. Bloqueantes previos al "go-live"

| # | Bloqueante | Ref |
|---|---|---|
| G1 | RLS, RPCs y Edge Functions no versionadas y sin revisar | `02` S1, S4 |
| G2 | Signup público de Auth posiblemente habilitado + "admin por exclusión" | `02` S2 |
| G3 | Ingesta de dispositivos sin autenticación | `02` S7 |
| G4 | Un solo entorno: los *preview deployments* de Vercel apuntarían a producción | `01` A4 |
| G5 | Sin CSP/cabeceras de seguridad | `02` S9 |
| G6 | Cuenta de Vercel **Hobby** no permitida para uso comercial según sus términos → usar **Pro** | §6 |

## 3. Arquitectura objetivo

```
                    ┌──────────── Vercel ─────────────┐
 navegador  ──────► │  / (landing estática)           │
                    │  /adminpanel, /app (SPA)        │──► CDN, HTTPS, headers (CSP)
                    └──────────────┬──────────────────┘
                                   │ supabase-js (anon/publishable key + JWT usuario)
                                   ▼
                    ┌──────────── Supabase (prod) ────────────┐
 dispositivo ─────► │ Edge Fn guardar-montaje-mm  (device key)│
                    │ Edge Fn crear-cliente  (rol admin)      │
                    │ Edge Fn contacto  (Turnstile + rate lim)│──► Resend
                    │ Postgres + RLS + RPC + vistas           │
                    │ Auth (MFA admin, signup OFF)            │
                    └─────────────────────────────────────────┘
        Staging: segundo proyecto Supabase ← Previews de Vercel
```

La ingesta de dispositivos **permanece en Supabase** (ver `01` §5).

## 4. Opciones de frontend evaluadas

| Opción | Esfuerzo | Pros | Contras | Decisión |
|---|---|---|---|---|
| **A. Static as-is en Vercel** (sin build, `vercel.json` con headers) | ~0,5 día | Rápido; sirve para tener la plataforma disponible ya | No permite inyectar variables por entorno; CSP laxa por `onclick` inline y CDN | **Fase 1** (con staging manual) |
| **B. Vite + TypeScript** (vanilla/ligero) | 1–2 semanas incremental | Variables `VITE_*` por entorno, módulos, tipos, CSP estricta, supabase-js fijado | Requiere refactor de `app.js` | **Fase 2 (recomendada)** |
| **C. Next.js (App Router)** | 3–5 semanas | SSR, middleware de auth con cookies (`@supabase/ssr`), mejores defaults de seguridad (sesión en cookie httpOnly) | Reescritura mayor; SSR/SEO sin valor para un panel; más superficie | Posponer; reconsiderar si hay portal de clientes público y crecimiento de equipo |

Argumento para no saltar directo a C: el producto no tiene problema de SSR/SEO; el costo real es la deuda del frontend (A3) y eso se resuelve igual con B. Next.js sí tendría un beneficio de seguridad real (sesión en cookie `httpOnly` vía `@supabase/ssr`, que elimina el robo de token por XSS); queda como **opción de evolución** si el modelo de amenazas lo exige.

## 5. Plan por fases

### Fase 0 — Preparar (antes de publicar)
1. `supabase login` / `supabase link`; `supabase db pull` → commitear `supabase/migrations/…`. Exportar Edge Functions faltantes (`supabase functions download guardar-montaje-mm crear-cliente`).
2. Ejecutar auditoría RLS (`02` §3 S1) y corregir.
3. Auth: signup OFF, *leaked password protection* ON, MFA TOTP para admins, *Site URL* y *Redirect URLs* restringidas al dominio final y a `*.vercel.app` del proyecto.
4. Crear proyecto **staging** de Supabase; aplicar migraciones; datos semilla sintéticos (`seed.sql`).

### Fase 1 — Disponibilizar (static)
1. Importar el repo en Vercel (Framework: *Other*, sin build, Output: raíz). Dominio propio + HTTPS.
2. `vercel.json` (a crear en la implementación) con: `cleanUrls`, rewrites, y cabeceras:
   - `Content-Security-Policy`: `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://<ref>.supabase.co; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'` (se endurece en Fase 2 al eliminar inline y CDN)
   - `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínima, `X-Frame-Options: DENY`.
3. Mover `app-demo.mp4` fuera del repo (Vercel Blob o similar).
4. Producción: rama `main`. Previews: PR → apuntan a **staging** (en Fase 1 requiere una constante por host; en Fase 2, variables de entorno).

### Fase 2 — Modernizar el build
1. Vite + TS, `@supabase/supabase-js` en `package.json` con lockfile.
2. Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` en Vercel por entorno (Production → prod; Preview/Development → staging). Recordar: son públicas, no secretas.
3. Eliminar `onclick` inline → CSP sin `unsafe-inline` en scripts.
4. CI (GitHub Actions o Vercel): lint, `tsc --noEmit`, `gitleaks`, tests de dominio (umbrales de desgaste, tasa mm/semana).

### Fase 3 — Operación
Observabilidad (doc `04`), backups/PITR, alertas, runbook de rotación de claves, política de retención de `mediciones`.

## 6. Costos y planes (verificar precios vigentes antes de decidir)
- **Vercel Hobby** es para uso personal/no comercial; un SaaS que cobra mensualidades debe usar **Pro**.
- **Supabase Free** pausa proyectos inactivos y no incluye backups con restauración a un punto en el tiempo; un servicio pago a flotas debería estar en **Pro** (backups diarios, sin pausa, soporte).
- Resend: dominio verificado propio; el plan gratuito basta para el volumen de leads.

## 7. Gestión de secretos y variables

| Valor | Dónde vive | Público |
|---|---|---|
| Supabase URL + anon/publishable key | Variables de build de Vercel (por entorno) | Sí (en el bundle) |
| `service_role`/secret key | **Solo** Edge Functions (inyectada por Supabase). Nunca en Vercel ni en el cliente | No |
| `RESEND_API_KEY`, `TURNSTILE_SECRET`, `TO_EMAIL` | `supabase secrets set` (por proyecto) | No |
| `VERCEL_TOKEN` (si se usa GitHub Actions) | GitHub Secrets | No |

Se añadirá un `.env.example` documentado en la fase de implementación (no se creó ahora porque no hay código que lo consuma).

## 8. Checklist de salida a producción
- [ ] Esquema y funciones en `supabase/` y reproducibles en staging
- [ ] RLS auditada con pruebas por rol (anon, cliente A, cliente B, admin)
- [ ] Signup público desactivado; MFA admin activo
- [ ] Ingesta con clave de dispositivo y validación
- [ ] CSP + cabeceras activas (verificadas en securityheaders.com)
- [ ] `contacto` con CAPTCHA server-side y dominio de envío verificado
- [ ] Backups/PITR confirmados; restauración probada una vez
- [ ] Monitoreo y alertas (doc `04`)
- [ ] Dominio, HTTPS y *Redirect URLs* de Auth correctos
- [ ] Vercel plan Pro
- [ ] `gitleaks` limpio en CI
