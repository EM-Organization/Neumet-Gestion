# 03 · Plan de despliegue: Vercel + Supabase

> Estado: plan original (2026-11-06), conservado como registro de decisiones. La plataforma ya está desplegada en Vercel + Supabase (proyecto `kootszosdejmawanfxug`); el estado actual está en [10-tablero.md](10-tablero.md) y los procedimientos en [11-runbook-operacion.md](11-runbook-operacion.md). Las secciones 1 a 3 describen el diagnóstico de entonces (por ejemplo, la definición de despliegue ya existe como `vercel.json`).

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
| **B. Vite + TypeScript** (vanilla/ligero) | 1–2 semanas incremental | Variables `VITE_*` por entorno, módulos, tipos, CSP estricta, supabase-js fijado | Requería refactor del monolito `app.js` (ya dividido en módulos ES, ver `assets/js/README.md`) | **Fase 2 (recomendada)** |
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

## Decisiones de la CSP (vercel.json)

- **`script-src` ya NO lleva `'unsafe-inline'`** (landing y panel sin `<script>` ni handlers inline; PR #5 y #7). `style-src` **conserva** `'unsafe-inline'` a propósito: hay ~100 atributos `style=""` (y los generados desde JS) y el riesgo de inyección por estilos es mucho menor; endurecerlo exigiría pasar todo a clases CSS. Si se carga un script nuevo, debe ir en archivo propio y su origen listarse en `script-src`.
- Como endurecer: (1) mover scripts y estilos en linea a archivos en `assets/`; (2) sustituir handlers `onclick=` por `addEventListener`; (3) quitar `'unsafe-inline'` de `script-src` y probar antes con `Content-Security-Policy-Report-Only`; (4) para estilos, usar clases en lugar de `style=`; (5) si hiciera falta algun inline, usar nonces o hashes.
- `https://cdn.jsdelivr.net` se permite para librerias (p. ej. supabase-js); idealmente fijar version y anadir SRI, o servirlas desde `/assets`.
- `connect-src` limita las llamadas al proyecto Supabase vigente `kootszosdejmawanfxug` (REST, Auth, Functions, Realtime por wss). El proyecto anterior se retiró tras el cutover; `tests/unit/despliegue.test.mjs` verifica que no vuelva a aparecer.
- `frame-ancestors 'none'` y `X-Frame-Options: DENY` evitan clickjacking.
- Cache: imagenes y fuentes en `/assets` son `immutable` (1 ano); CSS/JS sin hash usan `max-age=0, must-revalidate` (se revalidan con ETag en cada carga: los módulos ES se piden por separado y con `max-age` el navegador mezclaba archivos viejos con el HTML nuevo tras un despliegue). Si se cambia una imagen, cambiar tambien su nombre de archivo.
