# 02 · Auditoría de seguridad: secretos, autenticación y superficie de ataque

> **Nota (2026-11):** las referencias `app.js:N` de este documento apuntan al monolito `assets/js/app.js` previo a la modularización (PR del refactor a módulos ES). Hoy el panel vive en módulos ES bajo `assets/js/` (`main.js`, `core/`, `domain/`, `views/`; ver [`assets/js/README.md`](../assets/js/README.md)); los números de línea ya no existen y se conservan como evidencia histórica.

> Estado: Auditoría de 2026-11-06, conservada como registro histórico; varios hallazgos ya están corregidos (ver [10-tablero.md](10-tablero.md)). El proyecto Supabase citado como `dqgrlflrjcarxlfetvoj` es el anterior, ya sin uso.

## 1. Búsqueda de claves filtradas

**Método:** búsqueda por patrones sobre el árbol de trabajo y sobre **todo el historial git** (37 commits, todas las ramas): JWT (`eyJ…`), `service_role`, `sb_secret_`/`sb_publishable_`, claves Resend (`re_…`), `sk-…`, `AKIA…`, `ghp_`, `xox*`, asignaciones `password=`/`secret=`/`token=`. Se revisaron además los archivos eliminados (`vercel.json`, `.github/workflows/deploy.yml`, `landing/`, `onboarding-preview.html`) y no existió ningún `.env*` versionado en ningún commit.

### Resultado

| Elemento | Dónde | Veredicto |
|---|---|---|
| Supabase **anon key** (JWT, `role:"anon"`, expira 2036) | `assets/js/app.js:4` y desde el commit inicial `035732f` | ✅ **No es un secreto.** Es la clave pública de cliente por diseño. Su seguridad es **igual a la calidad de RLS** (ver §3). |
| `service_role` | — | ✅ No encontrada en árbol ni historial |
| `RESEND_API_KEY` | Solo `Deno.env.get(...)` en `contacto/index.ts:3` | ✅ Correctamente externalizada (secret de Supabase) |
| Secrets de GitHub Actions (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`) | Workflow eliminado; solo referencias `${{ secrets.* }}` | ✅ Nunca hubo valores en claro |
| Project ref `dqgrlflrjcarxlfetvoj` (proyecto anterior, histórico) | README y código de entonces | ℹ️ Identificador, no secreto. Facilita reconocimiento del objetivo |
| Email de destino `contacto.neumet@gmail.com` | `contacto/index.ts:4` | ℹ️ Hardcodeado; ver §5 |
| Commit `39e5b13` "change recipient to emarichal.uy@gmail.com for testing" | Historial | ℹ️ Email personal en historial |

**Conclusión:** no hay claves secretas filtradas. Limitaciones honestas: es búsqueda por patrones, no una herramienta dedicada; no se puede ver el historial de forks/PRs externos ni lo que viva en el dashboard. Mitigación: ejecutar `gitleaks` y `trufflehog` en CI (ver roadmap) y rotar las claves **solo** si alguna vez se pegó una `service_role` en chat, issues o capturas.

**Acción preventiva recomendada:** como la anon key está en el historial desde el inicio, no tiene sentido reescribir historia por ella. Sí conviene: (a) migrar a las nuevas claves `sb_publishable_…` de Supabase si el proyecto las ofrece, que se rotan sin afectar JWT secrets; (b) rotar la anon key *después* de cerrar RLS si hubo ventanas de exposición.

## 2. Modelo de amenazas resumido

| Actor | Capacidad | Qué protege hoy |
|---|---|---|
| Anónimo (internet) | Conoce URL + anon key (están en el HTML) | Solo RLS **[verificar]** |
| Usuario autenticado sin fila en `clientes` | Se trata como admin en la UI | Solo RLS **[verificar]** |
| Cliente final | Credenciales dadas por el admin | RLS por `cliente_id` **[verificar]** |
| Dispositivo / atacante que simula uno | POST con `device_id` (MAC) | **Nada documentado** |
| Visitante de la landing | Formulario de contacto | CAPTCHA en el cliente (inefectivo) |

## 3. Autenticación y autorización

### S1 · RLS no verificable (Crítica) [verificar]
Ver `01-revision-arquitectura.md` A1. **Checklist mínimo** a ejecutar en el dashboard (SQL editor) antes de cualquier despliegue público:

```
-- Tablas sin RLS habilitada (debe devolver 0 filas)
select schemaname, tablename from pg_tables
where schemaname='public' and not rowsecurity;

-- Políticas existentes y sus expresiones
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' order by 1,2;

-- Funciones SECURITY DEFINER (revisar que validen rol y fijen search_path)
select proname, prosecdef, proconfig from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and prosecdef;
```
Además: probar con un JWT de cliente real que **no** puede leer `gastos`, ni `precio_mensual` de otros, ni filas de otros `cliente_id`, ni ejecutar `asignar_dispositivo_a_cliente`.

### S2 · "Admin por exclusión" (Alta)
`app.js:59-65` y `103-109`. Un usuario cualquiera autenticado, sin fila en `clientes`, es tratado como admin. Mitigaciones: deshabilitar *signups* públicos (Auth → Providers → Email → "Allow new users to sign up" OFF); rol explícito server-side; las políticas de escritura de admin deben exigir ese rol, no "authenticated".

### S3 · Alta de clientes con contraseña elegida por el admin (Media)
`saveCliente()` → `crear-cliente` con `{nombre,email,password}`; mínimo 6 caracteres, validado solo en el cliente (`app.js:406`). Problemas: el admin conoce (y transmite por canales inseguros, probablemente WhatsApp) la contraseña del cliente; política débil; sin verificación de email.
**Cambio propuesto:** invitación por email (`auth.admin.inviteUserByEmail`) o magic link; cliente fija su contraseña; política ≥ 12 caracteres con *leaked password protection* (HIBP) activada en Supabase.

### S4 · `crear-cliente` no auditable (Alta) [verificar]
No está en el repo. Debe: verificar el JWT, comprobar rol admin **server-side**, validar entrada, usar `service_role` solo dentro de la función, y ser transaccional (usuario Auth + fila `clientes`; si falla la segunda, borrar el usuario Auth).

### S5 · Borrado de cliente deja huérfano al usuario Auth (Media)
`deleteClient()` borra la fila de `clientes` desde el navegador; el usuario en `auth.users` no se elimina y las mediciones/vehículos dependen de cascadas no versionadas ("Se perderán sus mediciones asociadas", `app.js:2544`). Riesgos: cuenta que sigue pudiendo iniciar sesión, borrado accidental masivo irreversible. Propuesta: *soft delete* (`deleted_at`) y operación server-side.

### S6 · Sesión y endurecimiento de Auth (Media)
- JWT en `localStorage` (comportamiento por defecto de supabase-js): cualquier XSS = robo de sesión (ver §4).
- Sin MFA para el/los admin. Activar TOTP en Supabase Auth y exigirlo a admins.
- Sin límite de intentos propio: configurar *rate limits* de Auth y CAPTCHA de Supabase (hCaptcha/Turnstile) en login.
- Duración del JWT y *refresh token rotation*: revisar valores por defecto.
- Mensajes de error de Auth se muestran crudos (`app.js:100`): normalizar para no filtrar detalles.

## 4. Inyección y XSS (alto impacto por S6)

La función `esc()` existe, pero se aplica manualmente. Casos sin escapar detectados (texto controlado por usuarios o dispositivos):

| Línea | Dato | Contexto | Riesgo |
|---|---|---|---|
| `app.js:1061-1062` | `n.marca`, `n.modelo` | HTML en tabla del reporte | XSS almacenado (los carga un admin/cliente) |
| `app.js:1089,1129-1130` | `veh.nombre`, `veh.patente` | HTML escrito con `w.document.write(html)` en ventana nueva (`1168-1169`) | XSS en ventana **del mismo origen** → acceso a `localStorage` con la sesión |
| `app.js:1375` | `g.categoria` | HTML + clase CSS | XSS almacenado |
| `app.js:2625` | `d.mac` (campo `device_id`) | atributo `onclick="…('${…}')"`; solo se escapa `'` | Rompe fuera del atributo con `"` o `\`. **El MAC llega desde un endpoint público** (ver S7) → vector de XSS almacenado hacia el admin **[verificar]** si la función valida formato MAC |
| `contacto/index.ts:42-56` | `nombre`, `email`, `empresa`, `telefono`, `mensaje` | HTML de correo | Inyección HTML en el correo del dueño (phishing/enlaces falsos desde un remitente que parece legítimo) |

Positivo: `patente_raw`/`numero_raw` sí se escapan (`app.js:2686-2689`).

**Mitigación estructural (mejor que parchear línea por línea):**
1. Render con escapado por defecto (framework o `textContent`/DOM API); prohibir `innerHTML` con datos externos por lint (`no-unsanitized`).
2. Eliminar `onclick` inline → `addEventListener` → habilita **CSP** sin `unsafe-inline`.
3. CSP estricta + Trusted Types en `vercel.json` (ver doc de despliegue).
4. Validación de formato en origen: MAC con regex `^([0-9A-F]{2}:){5}[0-9A-F]{2}$`, patente alfanumérica, longitudes máximas y `CHECK` constraints en la base.

## 5. Endpoints públicos

### S7 · `guardar-montaje-mm`: ingesta sin autenticación documentada (Alta) [verificar]
README: el cuerpo contiene `device_id` (MAC) + patente + lecturas, sin credenciales. La MAC es un identificador **público y suplantable** (se emite en BLE/Wi-Fi). Cualquiera que conozca un MAC y una patente puede inyectar mediciones, ensuciar la historia de desgaste de un cliente (y su análisis predictivo) o llenar la tabla.
**Propuesta:** secreto por dispositivo (`device_key`, almacenado como hash, rotable) enviado en cabecera; firma HMAC opcional del body con timestamp (anti-replay); validación de rangos (0–30 mm), `posicion` ≤ `tipo_ruedas`, tamaño máximo del array; rate-limit por dispositivo; idempotencia (clave de sesión) para reintentos del firmware; registro de rechazos (ver `04-observabilidad-logging.md`).
Efecto lateral a vigilar: el modo "dispositivo no registrado" **acepta datos de cualquiera** por diseño (onboarding device-first). Acotarlo: aceptar solo MAC de un lote "de fábrica" pre-cargado en una tabla `dispositivos_inventario`, o requerir clave de provisión.

### S8 · `contacto`: abuso y spam (Media)
- `Access-Control-Allow-Origin: *`.
- El CAPTCHA se genera y valida **en el navegador** (`index.html`, `captchaCode`): cualquiera lo salta llamando directo al endpoint con `curl`. Es fricción visual, no control.
- Sin rate-limit: se puede agotar la cuota de Resend o inundar la bandeja.
- Remitente `onboarding@resend.dev`: solo entrega a la cuenta dueña de Resend y es un sandbox; en producción exige dominio verificado (SPF/DKIM/DMARC).
- `reply_to` toma el `email` sin validar.
**Propuesta:** Cloudflare Turnstile / hCaptcha con verificación **server-side** en la función; honeypot; rate-limit por IP (tabla o Upstash); validar email/longitudes; escapar HTML; mover `TO_EMAIL` a secret; CORS restringido al dominio de producción; guardar la consulta en una tabla `leads` además de enviar el mail (el correo no es sistema de registro). La función ya fue una vez *Turnstile* (commit `753030c`) y se revirtió a CAPTCHA local: documentar el motivo antes de reintroducirlo.

### S9 · Cabeceras HTTP ausentes (Media)
No hay CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` ni HSTS definidos (el `vercel.json` que los tenía —`nosniff`, `X-Frame-Options: DENY`— se eliminó). El panel es clickjackeable hoy. Ver doc de despliegue.

## 6. Privacidad y cumplimiento
- Datos personales: emails de clientes, y datos comerciales (precios, gastos). Confirmar región del proyecto Supabase y base legal (Uruguay: Ley 18.331 de protección de datos personales).
- La landing carga Google Fonts desde Google (transferencia de IP del visitante): autoalojar fuentes.
- Backups: verificar que PITR/backups diarios estén activos (plan Pro) antes de ofrecerlo como servicio de pago.

## 7. Prioridades (orden de ejecución)

1. **P0** — Ejecutar checklist SQL de §3 S1; deshabilitar signup público; volcar esquema/RLS/funciones al repo.
2. **P0** — Autenticar dispositivos y validar entrada en `guardar-montaje-mm`.
3. **P1** — Cerrar los XSS de §4 y CSP; fijar `supabase-js` por npm.
4. **P1** — Reemplazar alta por contraseña con invitación; MFA a admins.
5. **P1** — `contacto`: CAPTCHA server-side + rate-limit + escapado.
6. **P2** — Soft-delete y auditoría; gitleaks en CI; autoalojar fuentes.

## 8. Estado de remediación (2026-11-06)

| Hallazgo | Estado | Detalle |
|---|---|---|
| S8 `contacto` | 🟡 Código listo, sin desplegar ni probar en ejecución | Escapado HTML, validación, CORS por `ALLOWED_ORIGINS`, `TO_EMAIL` por secret, honeypot, Turnstile opcional (la landing aún no envía `cf_token`). Sin cabecera `Origin` (curl) la petición pasa: CORS no frena a clientes no-navegador; falta rate-limit. Ver `supabase/functions/contacto/README.md` |
| §4 XSS | 🟡 Código listo, no probado en navegador | `esc()` en marca/modelo/reporte/categoría; `onclick` con MAC → `data-mac`; errores genéricos. `supabase-js` fijado en 2.118.0 con SRI (hash verificado) |
| S9 cabeceras | 🟡 `vercel.json` listo, sin desplegar | CSP con `'unsafe-inline'` temporal (ver doc 03) |
| S1/S2 RLS y signup | 🔴 Pendiente (requiere dashboard) | `supabase/audit/rls_audit.sql` y `supabase/config.toml` listos; ejecutar y aplicar |
| S7 ingesta de dispositivos | 🔴 Pendiente | La función `guardar-montaje-mm` no está en el repo |
| S3–S6 | 🔴 Pendiente | Invitación de clientes, soft-delete, MFA |
