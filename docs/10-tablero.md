# 10 · Tablero del proyecto

> Actualizado: 2026-11-13. Fuente de verdad del estado; los PR en GitHub tienen el detalle.
> Flujo: un agente por área en su rama y worktree → PR con tests → revisor distinto del autor (checklist en [13-checklist-revision-prs.md](13-checklist-revision-prs.md)) → el director aplica migraciones y despliega.
> Procedimientos de operación: [11-runbook-operacion.md](11-runbook-operacion.md). Lo que no pudo verificarse desde el repositorio va marcado **[confirmar]**.

## Infraestructura
| Pieza | Estado |
|---|---|
| Proyecto Supabase `kootszosdejmawanfxug` | Proyecto vigente. Migraciones en `supabase/migrations/`, todas aplicadas en el proyecto; comparar con `supabase migration list --remote` antes de cada despliegue |
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
- Montar y retirar neumáticos sin reemplazo, para un coche sin neumáticos (migración `20261114500000`; `docs/08` apéndice G).
- Km por cubierta: `v_km_cubierta` y diagnóstico de odómetro (migración `20261115000000`; apéndice H, F2).
- Calidad de datos de las mediciones: control al ingresar, invalidación auditada, valor original y unidad (migración `20261116000000`; apéndice I, F3).
- Precios y costos solo para admin y perfil global, con privilegios por columna (migración `20261116500000`; apéndice K).
- Costos por cubierta y costo por km (migración `20261117000000`; apéndice J, F4).
- Recauchutado por carcasa: vista Recauchutado, grupos Vida y Banda en el costo por km (migración `20261118000000`; apéndice L, F5).
- Alerta única «crítico» con estado, histéresis y umbral por cliente (migración `20261118500000`; apéndice M, F7).
- Documentación del producto: README raíz, índice de `docs/` y guías de revisión y de textos.
- Configuración de Claude Code versionada: `CLAUDE.md`, skills y subagentes (`.claude/`).

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
| Recomendación de rotación y etapas posteriores de alertas | La alerta «crítico» (etapa 1) está hecha; faltan destinatarios, correo y reglas por marca y modelo. Diseño en [15-rotacion-alertas-rendimiento.md](15-rotacion-alertas-rendimiento.md) (secciones A y B) |
| Referencia de flota en el servidor y tabla de estado por neumático | Medidas 2 a 4 de la sección C de [15](15-rotacion-alertas-rendimiento.md); se aplican según el tamaño de la flota |
| Destino «reparación» del neumático retirado | F1 y F5 cubren «almacenar» y el flujo de recauchutado; **[confirmar]** que «reparación» devuelve la cubierta al stock como «Reparado» |

### Sugerencias del revisor (sin resolver)
- `x-forwarded-for` es falseable en el límite de intentos de login.
- Las RPC no comprueban `clientes.deleted_at`.
- La baja de un cliente no desactiva su perfil `api`.
- Paginación por offset en los exportes.
- `mapErr` de `crear-cliente` trata 422 como «email ya existe».

## Fuera de alcance de la primera versión
Presión/temperatura (TPMS) y machine learning: dependen de datos que todavía no existen. CPK y recauchutado ya están implementados (F4 y F5).

## Riesgos abiertos
- Avisos del linter de Supabase: 4 WARN `SECURITY DEFINER` ejecutables por `authenticated` (intencionales; mover helpers a un esquema privado más adelante).
- Sin probar con sesión real y datos reales de punta a punta.
