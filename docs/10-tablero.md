# 10 · Tablero del proyecto

> Actualizado: 2026-11-08. Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su rama y worktree → PR con tests → revisor distinto del autor (checklist en [13-checklist-revision-prs.md](13-checklist-revision-prs.md)) → el director aplica migraciones y despliega.
> Procedimientos de operación: [11-runbook-operacion.md](11-runbook-operacion.md). Lo que no pudo verificarse desde el repositorio va marcado **[confirmar]**.

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase `kootszosdejmawanfxug` | Proyecto vigente. Migraciones en `supabase/migrations/` (15, hasta `20261113000000_stock_cubiertas`), todas aplicadas en el proyecto; comparar con `list_migrations` antes de cada despliegue |
| Proyecto Supabase anterior `dqgrlflrjcarxlfetvoj` | **Cutover realizado**: sin referencias en código, CSP ni formulario de contacto. Solo queda su payload anon en `.gitleaks.toml` porque sigue en el historial |
| Edge Function `api-proveedor` | Desplegada (`verify_jwt = false`; el Bearer se valida dentro del handler). Devuelve el motivo `sin_neumaticos` (migración `20261112000000`) |
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
- Stock individual de cubiertas (migración `20261113000000`): quema, condición, sucursal, traslados y devolución al stock desde el cambio de neumático; demo con las cubiertas `S-001` a `S-012`.
- Tasa de desgaste robusta (al menos 3 mediciones y 14 días, ventana reiniciada por evento) y `v_estado_neumaticos` por neumático (migración `20261111000000`, función `posiciones_medidas_sin_neumatico`); referencia de flota con `MIN_MUESTRAS` = 5 (ver [15](15-rotacion-alertas-rendimiento.md), C.6 y C.7).
- Mini vehículos con posiciones legibles en Alertas y en el ciclo de vida del neumático.
- Motivo `sin_neumaticos` en la API de proveedor (migración `20261112000000`).
- Pantalla «Sin acceso» para sesiones sin perfil o con perfil `api` (sin menú ni consultas de datos).
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
| Alertas personalizables y recomendación de rotación | Diseño en [15-rotacion-alertas-rendimiento.md](15-rotacion-alertas-rendimiento.md) (secciones A y B); implementación pendiente |
| Referencia de flota en el servidor y tabla de estado por neumático | Medidas 2 a 4 de la sección C de [15](15-rotacion-alertas-rendimiento.md); se aplican según el tamaño de la flota |
| Destinos «reparación» y «recauchutado» sin vuelta al stock | Hoy esas cubiertas quedan aparcadas en el vehículo (fase F1 de [16](16-hoja-de-ruta.md)) |

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
