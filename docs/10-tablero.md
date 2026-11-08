# 10 · Tablero del proyecto

> Actualizado: 2026-11-08. Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su rama y worktree → PR con tests → revisor distinto del autor (checklist en [13-checklist-revision-prs.md](13-checklist-revision-prs.md)) → el director aplica migraciones y despliega.
> Procedimientos de operación: [11-runbook-operacion.md](11-runbook-operacion.md). Lo que no pudo verificarse desde el repositorio va marcado **[confirmar]**.

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase `kootszosdejmawanfxug` | Proyecto vigente. Migraciones en `supabase/migrations/` (12, hasta `20261110020000_ultimas_mediciones`); comparar con `list_migrations` antes de cada despliegue |
| Proyecto Supabase anterior `dqgrlflrjcarxlfetvoj` | **Cutover realizado**: sin referencias en código, CSP ni formulario de contacto. Solo queda su payload anon en `.gitleaks.toml` porque sigue en el historial |
| Edge Function `api-proveedor` | Desplegada (`verify_jwt = false`; el Bearer se valida dentro del handler) |
| Edge Function `contacto` | Desplegada en el proyecto vigente con `RESEND_API_KEY`, `FROM_EMAIL`, `TO_EMAIL` y `ALLOWED_ORIGINS` cargados |
| Edge Functions `crear-cliente`, `crear-cuenta-api`, `crear-usuario-seccional` | En el repositorio; despliegue y `ALLOWED_ORIGINS` **[confirmar]** |
| Vercel `neumet-gestion-theta.vercel.app` | Desplegado desde `main`; CSP sin `unsafe-inline` en scripts |
| CI (`.github/workflows/ci.yml`) | Jobs `secrets`, `static`, `lint`, `test`, `deno`, `sql` y `e2e` |

## Hecho
- Auditoría, plan de despliegue, identidad visual, endurecimiento del panel (XSS, SRI), CSP, `.vercelignore`.
- Esquema SQL con RLS, roles y auditoría; API de proveedor (contrato, función, migración); vistas, odómetro, ciclo de vida y umbrales por cliente.
- Panel en módulos ES con tests unitarios, smoke, visuales, SQL y E2E contra base real local.
- Funcionalidades: Inicio con buscador y «Últimas mediciones», Vehículos y detalle con diagrama y gráfico, cambio de neumático, rotación, número de quema, km previos, Sucursales (crear, mover vehículos), Stock, Alertas, Reportes, Dispositivos (solo administrador), ficha de cliente con umbrales y cuentas de API, baja lógica de clientes.
- Cutover del frontend al proyecto vigente, incluido el formulario de contacto de la landing.
- Documentación del producto: README raíz, índice de `docs/` y guías de revisión y de textos.

## Pendientes
### Acciones del dueño (dashboard de Supabase) **[confirmar]**
1. Existencia del usuario administrador con su fila en `perfiles` y **Allow new users to sign up** desactivado (runbook §1).
2. Secretos de `crear-cliente`, `crear-cuenta-api` y `crear-usuario-seccional` (`ALLOWED_ORIGINS`; opcional `INVITE_REDIRECT_TO`).
3. (Opcional) MFA para administradores.

### Desarrollo
| Ítem | Notas |
|---|---|
| Cuenta con rol `api` para la app | Crearla desde la ficha del cliente (runbook §2) |
| Confirmar con DAC el orden físico de `mm1..mm4` | Resuelto en el mapeo (mm1 interno, mm2 centro, mm3 externo); falta la prueba con la app real |
| Prueba de punta a punta con sesión y datos reales | Los E2E cubren una base local con datos de demo; falta el entorno real |
| Alertas personalizables, recomendación de rotación y optimización de la vista de desgaste | Diseño en [15-rotacion-alertas-rendimiento.md](15-rotacion-alertas-rendimiento.md); implementación pendiente |

### Sugerencias del revisor (sin resolver)
- `x-forwarded-for` es falseable en el límite de intentos de login.
- Las RPC no comprueban `clientes.deleted_at`.
- La baja de un cliente no desactiva su perfil `api`.
- Paginación por offset en los exportes.
- `mapErr` de `crear-cliente` trata 422 como «email ya existe».

## Fuera de alcance de la primera versión
CPK, reencauche con costos y presión/temperatura (TPMS): dependen de km acumulados y eventos reales.

## Riesgos abiertos
- Avisos del linter de Supabase: 4 WARN `SECURITY DEFINER` ejecutables por `authenticated` (intencionales; mover helpers a un esquema privado más adelante).
- Sin probar con sesión real y datos reales de punta a punta.
