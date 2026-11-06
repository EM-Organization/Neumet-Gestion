# 10 · Tablero del proyecto

> Actualizado: 2026-11-06 (director de proyecto). Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su worktree → PR con tests → revisor (agente "PR Reviewer") comenta y fusiona → el director aplica migraciones/despliega.
> Procedimientos de operación: [11-runbook-operacion.md](11-runbook-operacion.md).

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase **nuevo** `kootszosdejmawanfxug` | Migraciones `20261106000000` (esquema), `20261106010000` (API de proveedor) y `20261106020000` (vistas, odómetro, ciclo de vida) **aplicadas** |
| Edge Function `api-proveedor` | **Desplegada** en `kootszos…` (`verify_jwt = false`; el Bearer se verifica dentro del handler) |
| Edge Functions | `api-proveedor` y `crear-cliente` **desplegadas** en kootszos (crear-cliente sin ALLOWED_ORIGINS aún: el navegador recibe 403); `contacto` en el repo, despliegue pendiente |
| Proyecto Supabase heredado `dqgrlflrjcarxlfetvoj` | El frontend desplegado aún apunta a este (`assets/config.js`); **cutover pendiente** |
| Vercel `neumet-gestion-theta.vercel.app` | Desplegado desde `main`; CSP sin `unsafe-inline` en scripts |
| CI (GitHub Actions, `.github/workflows/ci.yml`) | Jobs: `secrets`, `lint`, `static`, `deno`, `test`, `sql` |

## Hecho (PR #1 a #25 fusionados en `main`)
- Auditoría, plan de despliegue, identidad visual, endurecimiento del panel (XSS, SRI), CSP, `.vercelignore`.
- Esquema SQL con RLS/roles/auditoría, API de proveedor (contrato, función, migración), vistas SQL, odómetro, ciclo de vida y umbrales por cliente.
- Benchmark de plataformas y backlog (`09-benchmark-gestion-neumaticos.md`).
- Panel en módulos ES (`assets/js/`) con tests unitarios y URL configurable (`assets/config.js`).
- Panel con: flota con prioridades, centro de alertas, salud de dispositivos, ficha de cliente, odómetro del vehículo, ciclo de vida del neumático, reportes exportables y baja lógica de clientes (`cliente_eliminar_suave`).

## Pendientes
### Acciones del dueño (dashboard de Supabase)
1. Crear el usuario administrador y registrar su rol (runbook §1) y **desactivar** "Allow new users to sign up".
2. Cargar los secrets de las funciones: `contacto` (`RESEND_API_KEY`, `TO_EMAIL`, `FROM_EMAIL`, `ALLOWED_ORIGINS`; opcional `TURNSTILE_SECRET`) y `crear-cliente` (`ALLOWED_ORIGINS`; opcional `INVITE_REDIRECT_TO`).
3. (Opcional) MFA para admins.

### Acciones del director / desarrollo
| Ítem | Notas |
|---|---|
| Desplegar `contacto` en kootszos; cargar secrets de `crear-cliente` (`ALLOWED_ORIGINS`) | Depende de los secrets anteriores |
| Cutover del frontend a `kootszos…` | Editar `assets/config.js` (URL + clave publishable) y `connect-src` en `vercel.json`; requiere funciones desplegadas y primer admin. Checklist en el runbook §6 |
| Cuenta con rol `api` para la app | Auth + fila en `perfiles` (runbook §2) |
| Confirmar con DAC el orden físico de `mm1..mm4` | Constante en el código |
| RPC de rotación | PR en curso |
| Prueba de punta a punta con sesión y datos reales | No realizada |

### Sugerencias del revisor (sin resolver)
- `x-forwarded-for` es falseable en el límite de intentos de login.
- Las RPC no comprueban `clientes.deleted_at`.
- La baja de un cliente no desactiva su perfil `api`.
- Paginación por offset en los exportes.
- `mapErr` de `crear-cliente` trata 422 como "email ya existe".

## Fuera de alcance de la primera versión
CPK, reencauche con costos y presión/temperatura (TPMS): dependen de km acumulados y eventos reales.

## Riesgos abiertos
- Orden físico de `mm1..mm4` (interno/externo) sin confirmar con la app de DAC.
- Avisos del linter de Supabase: 4 WARN `SECURITY DEFINER` ejecutables por `authenticated` (intencionales; mover helpers a esquema privado más adelante).
- Sin probar con sesión real y datos reales de punta a punta.
